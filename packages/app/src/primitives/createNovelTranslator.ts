/**
 * 翻译管线层 —— S2：分块（≤2000 字/块、段落边界不拆段）→ 首屏优先排序 →
 * 并发（≤3 路、指数退避重试 ×2）→ 保序重组 → 进度回调 → AbortController 取消。
 * S1 的 translateParagraphs（单块）保留兼容（≤2000 字内容整章翻译）。
 *
 * 注入点契约：返回段落 map（paragraphIndex → 译文），失败块不写入（显示回退原文），
 * 由 NovelDetail 的 displayBlocks 消费（只替换 TextBlock.text）。
 * S4 扩展：失败块「未翻译」标记 + 断点续翻。
 */
import { buildTranslationSystemPrompt, buildTranslationUserPrompt } from "@/utils/prompts";
import { requestTranslate, type TranslateError, type TranslateModel } from "@/api/translate";

export interface TranslateNovelOptions {
  apiKey: string;
  model: TranslateModel;
  sourceLang?: string;
  targetLang?: string;
}

export interface TranslateChunkOptions extends TranslateNovelOptions {
  /** 分块最大字符数（默认 2000） */
  maxChunkChars?: number;
  /** 并发路数（默认 3，DeepSeek 并发限额 2500 内无压力） */
  concurrency?: number;
  /** 可重试错误的最大重试次数（默认 2，指数退避） */
  maxRetries?: number;
  /** 退避基数 ms（默认 500；测试可调小） */
  retryBaseMs?: number;
  /** 取消信号（切章/离开页面中止） */
  signal?: AbortSignal;
  /** 当前阅读段落 index（首屏优先排序锚点） */
  priorityParagraph?: number;
}

export interface ChunkRange {
  /** 段落起始 index（含） */
  start: number;
  /** 段落结束 index（不含） */
  end: number;
}

export interface ChunkProgress {
  done: number;
  total: number;
  /** 本块覆盖的段落区间 */
  start: number;
  end: number;
  /** 本块已完成的段落译文（index = 全局段落 index；失败块为空数组） */
  paragraphs: Array<{ index: number; text: string }>;
}

export interface NovelTranslatorDeps {
  requestTranslate?: typeof requestTranslate;
}

// ── 分块 ──

/**
 * 按段落边界分块：每块 ≤maxChars 字符（含段落间空行），不拆段落。
 * 超长单段自成一块（段落不拆，允许该块超限）。
 */
export function chunkParagraphs(paragraphs: string[], maxChars = 2000): ChunkRange[] {
  const chunks: ChunkRange[] = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i].length + (i > start ? 2 : 0); // +2 = \n\n 段落分隔
    if (i > start && acc + len > maxChars) {
      chunks.push({ start, end: i });
      start = i;
      acc = len;
    } else {
      acc += len;
    }
  }
  if (start < paragraphs.length) {
    chunks.push({ start, end: paragraphs.length });
  }
  return chunks;
}

// ── 首屏优先排序 ──

/**
 * 构造块执行顺序：优先「当前阅读进度所在块」，其余按块序。
 * priorityParagraph 越界/未提供 → 块 0 优先。
 */
export function buildChunkOrder(
  totalChunks: number,
  priorityParagraph?: number,
  chunks?: ChunkRange[],
): number[] {
  let priority = 0;
  if (priorityParagraph !== undefined && chunks) {
    const idx = chunks.findIndex((c) => priorityParagraph >= c.start && priorityParagraph < c.end);
    if (idx !== -1) {
      priority = idx;
    }
  }
  return [
    priority,
    ...Array.from({ length: totalChunks }, (_, i) => i).filter((i) => i !== priority),
  ];
}

// ── 退避与取消 ──

/** 指数退避：base × 2^attempt（决策：429/5xx 时退避重试，S2 上限 2 次） */
export function retryDelayMs(attempt: number, baseMs = 500): number {
  return baseMs * 2 ** attempt;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 可重试错误：429 限流 / 5xx 服务异常 / network 弱网抖动；认证/余额/政策拒绝等不可重试 */
function isRetryableError(err: unknown): boolean {
  const code = (err as Partial<TranslateError> | null)?.code;
  return code === "rate_limit" || code === "server" || code === "network";
}

/** 是否中止错误（AbortController 触发，不计为翻译失败） */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// ── 单块翻译（S1 兼容）──

/**
 * 单块翻译：全部段落拼接为一次请求，返回与输入段落数一致的译文数组。
 */
export async function translateParagraphs(
  paragraphs: string[],
  options: TranslateNovelOptions,
  deps: NovelTranslatorDeps = {},
): Promise<string[]> {
  if (paragraphs.length === 0) {
    return [];
  }
  const doRequest = deps.requestTranslate ?? requestTranslate;
  const joined = paragraphs.join("\n\n");
  const result = await doRequest({
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: "system",
        content: buildTranslationSystemPrompt({
          targetLang: options.targetLang,
          sourceLang: options.sourceLang,
        }),
      },
      { role: "user", content: buildTranslationUserPrompt(joined) },
    ],
  });
  return alignParagraphs(result.content, paragraphs);
}

/**
 * 译文段落对齐：模型输出按空行拆段后与原文段落数对齐。
 * 数量不符是契约破坏（AGENTS.md 禁止静默降级）——必须 console.warn：
 * - 译文段数 < 原文：不足段回退原文（后续 S4 改为「未翻译」标记）
 * - 译文段数 > 原文：截断多余段
 */
export function alignParagraphs(translated: string, original: string[]): string[] {
  const parts = translated
    .split(/\n\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length < original.length) {
    console.warn(
      `[createNovelTranslator] 译文段落数(${parts.length}) < 原文(${original.length})，末 ${original.length - parts.length} 段回退原文`,
    );
  } else if (parts.length > original.length) {
    console.warn(
      `[createNovelTranslator] 译文段落数(${parts.length}) > 原文(${original.length})，已截断多余段落`,
    );
  }
  const out: string[] = [];
  for (let i = 0; i < original.length; i++) {
    out.push(i < parts.length ? parts[i] : original[i]);
  }
  return out;
}

// ── 分块并发管线（S2）──

/**
 * 分块翻译整章：分块 → 首屏优先排序 → ≤3 路并发（指数退避重试）→ 保序重组。
 *
 * @returns paragraphIndex → 译文 的映射；失败块不写入（显示回退原文）。
 * @remarks signal 中止时不抛错——workers 静默退出，返回已完成的部分译文（调用方
 * 以 generation-gate 校验版本后丢弃）；中止路径不触发失败 warn、不推进进度。
 */
export async function translateNovel(
  paragraphs: string[],
  options: TranslateChunkOptions,
  onProgress: (p: ChunkProgress) => void,
  deps: NovelTranslatorDeps = {},
): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  if (paragraphs.length === 0) {
    return result;
  }
  const doRequest = deps.requestTranslate ?? requestTranslate;
  const maxChars = options.maxChunkChars ?? 2000;
  const concurrency = options.concurrency ?? 3;
  const maxRetries = options.maxRetries ?? 2;
  const retryBase = options.retryBaseMs ?? 500;
  const chunks = chunkParagraphs(paragraphs, maxChars);
  const order = buildChunkOrder(chunks.length, options.priorityParagraph, chunks);
  const total = chunks.length;
  let done = 0;

  async function fetchChunk(range: ChunkRange): Promise<string[]> {
    const slice = paragraphs.slice(range.start, range.end);
    const joined = slice.join("\n\n");
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      try {
        const res = await doRequest({
          apiKey: options.apiKey,
          model: options.model,
          messages: [
            {
              role: "system",
              content: buildTranslationSystemPrompt({
                targetLang: options.targetLang,
                sourceLang: options.sourceLang,
              }),
            },
            { role: "user", content: buildTranslationUserPrompt(joined) },
          ],
          signal: options.signal,
        });
        return alignParagraphs(res.content, slice);
      } catch (err) {
        if (isAbortError(err)) {
          throw err;
        }
        if (!isRetryableError(err) || attempt >= maxRetries) {
          throw err;
        }
        await sleep(retryDelayMs(attempt, retryBase), options.signal);
      }
    }
    throw new Error("unreachable");
  }

  // 并发池：固定 worker 数，各自从 order 队列取块；任一块失败仅 warn 不中断
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, order.length) }, async () => {
    while (true) {
      if (options.signal?.aborted) {
        return;
      }
      const idx = cursor++;
      if (idx >= order.length) {
        return;
      }
      const chunkIndex = order[idx];
      const range = chunks[chunkIndex];
      try {
        const translated = await fetchChunk(range);
        const chunkParas: Array<{ index: number; text: string }> = [];
        for (let i = 0; i < translated.length; i++) {
          result[range.start + i] = translated[i];
          chunkParas.push({ index: range.start + i, text: translated[i] });
        }
        onProgress({ done: done + 1, total, start: range.start, end: range.end, paragraphs: chunkParas });
      } catch (err) {
        if (isAbortError(err) || options.signal?.aborted) {
          // 中止：静默退出（不当作失败 warn，不推进进度）
          continue;
        }
        // S2：失败块不写入 map（显示回退原文）；S4 完整失败标记 + 断点续翻
        console.warn("[createNovelTranslator] 分块翻译失败，该块回退原文", {
          chunkIndex,
          err,
        });
        onProgress({ done: done + 1, total, start: range.start, end: range.end, paragraphs: [] });
      } finally {
        done++;
      }
    }
  });
  await Promise.all(workers);
  return result;
}
