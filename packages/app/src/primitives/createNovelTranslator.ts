/**
 * 翻译管线层 —— S1 最小版：≤2000 字整章单块翻译。
 * S2 扩展：分块（≤2000 字/块）→ 首屏优先排序 → 并发 → 保序重组 → 进度 / 取消。
 *
 * 注入点契约：返回的译文段落数组与输入段落数组一一对应（段落索引不变），
 * 由 NovelDetail 的 blocks memo 消费（只替换 TextBlock.text，不碰 novelHtml）。
 */
import { buildTranslationSystemPrompt, buildTranslationUserPrompt } from "@/utils/prompts";
import { requestTranslate, type TranslateModel } from "@/api/translate";

export interface TranslateNovelOptions {
  apiKey: string;
  model: TranslateModel;
  sourceLang?: string;
  targetLang?: string;
}

export interface NovelTranslatorDeps {
  requestTranslate?: typeof requestTranslate;
}

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
