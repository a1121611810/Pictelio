import { describe, it, expect, vi } from "vitest";
import {
  translateParagraphs,
  alignParagraphs,
  chunkParagraphs,
  buildChunkOrder,
  translateNovel,
  retryDelayMs,
  type NovelTranslatorDeps,
  type TranslateChunkOptions,
} from "@/primitives/createNovelTranslator";

function makeParagraphs(count: number, len = 80): string[] {
  return Array.from({ length: count }, (_, i) => `段落${i}` + "字".repeat(len));
}

function makeDeps(requestTranslate: ReturnType<typeof vi.fn>): NovelTranslatorDeps {
  return { requestTranslate: requestTranslate as never };
}

describe("alignParagraphs", () => {
  it("aligns when translated count equals original count", () => {
    const original = ["段一", "段二", "段三"];
    const result = alignParagraphs("译文一\n\n译文二\n\n译文三", original);
    expect(result).toEqual(["译文一", "译文二", "译文三"]);
  });

  it("falls back to original paragraphs when translated count is fewer (warns)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = ["段一", "段二", "段三"];
    const result = alignParagraphs("译文一", original);
    expect(result).toEqual(["译文一", "段二", "段三"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[createNovelTranslator]"));
    warnSpy.mockRestore();
  });

  it("truncates extra translated paragraphs (warns)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = ["段一", "段二"];
    const result = alignParagraphs("译文一\n\n译文二\n\n译文三", original);
    expect(result).toEqual(["译文一", "译文二"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[createNovelTranslator]"));
    warnSpy.mockRestore();
  });
});

describe("translateParagraphs (S1 单块兼容)", () => {
  it("joins paragraphs into one request and returns aligned translation", async () => {
    const requestTranslate = vi
      .fn()
      .mockResolvedValue({ content: "译文一\n\n译文二", finishReason: "stop" });
    const result = await translateParagraphs(
      ["原文一", "原文二"],
      { apiKey: "sk-test", model: "deepseek-v4-flash", sourceLang: "ja" },
      makeDeps(requestTranslate),
    );
    expect(result).toEqual(["译文一", "译文二"]);
    const payload = requestTranslate.mock.calls[0][0];
    expect(payload.messages[0].content).toContain("日语");
    expect(payload.messages[1].content).toBe("原文一\n\n原文二");
  });

  it("returns empty array for empty input", async () => {
    const requestTranslate = vi.fn();
    const result = await translateParagraphs(
      [],
      { apiKey: "k", model: "deepseek-v4-flash" },
      makeDeps(requestTranslate),
    );
    expect(result).toEqual([]);
    expect(requestTranslate).not.toHaveBeenCalled();
  });
});

describe("chunkParagraphs", () => {
  it("keeps short texts as a single chunk", () => {
    const paragraphs = makeParagraphs(3, 100);
    const chunks = chunkParagraphs(paragraphs, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(3);
  });

  it("splits long texts at paragraph boundaries without cutting paragraphs", () => {
    // 30 段 × 100 字 = 3000 字 → 应分 2 块（每块 ≤2000 字，按段界）
    const paragraphs = makeParagraphs(30, 100);
    const chunks = chunkParagraphs(paragraphs, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // 不拆段落：start/end 覆盖整段区间
      expect(c.start).toBeLessThan(c.end);
      expect(c.end - c.start).toBeGreaterThan(0);
      const joinedLen = paragraphs.slice(c.start, c.end).join("\n").length;
      expect(joinedLen).toBeLessThanOrEqual(2000);
    }
    // 全覆盖且无重叠
    const coverage = chunks.flatMap((c) =>
      Array.from({ length: c.end - c.start }, (_, i) => c.start + i),
    );
    expect(coverage).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("keeps an oversized single paragraph in its own chunk (段落不拆)", () => {
    const paragraphs = ["超长段" + "字".repeat(3000), "正常段"];
    const chunks = chunkParagraphs(paragraphs, 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(1);
    expect(chunks[1].start).toBe(1);
    expect(chunks[1].end).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(chunkParagraphs([], 2000)).toEqual([]);
  });
});

describe("buildChunkOrder", () => {
  it("prioritizes chunk 0 by default", () => {
    const order = buildChunkOrder(5, undefined);
    expect(order[0]).toBe(0);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("prioritizes the chunk containing the current reading paragraph", () => {
    // 5 块，每块 10 段；阅读进度在第 22 段 → 块 2 优先
    const chunks = Array.from({ length: 5 }, (_, i) => ({ start: i * 10, end: i * 10 + 10 }));
    const order = buildChunkOrder(chunks.length, 22, chunks);
    expect(order[0]).toBe(2);
    // 其余块按原序
    expect(order.slice(1)).toEqual([0, 1, 3, 4]);
  });

  it("clamps out-of-range priority", () => {
    expect(buildChunkOrder(3, 9999)[0]).toBe(0);
    expect(buildChunkOrder(3, -5)[0]).toBe(0);
  });

  it("treats the chunk end as exclusive (paragraph at boundary belongs to next chunk)", () => {
    // 每块 10 段；第 20 段是块 2 的起点（块 1 end 为 exclusive）
    const chunks = Array.from({ length: 3 }, (_, i) => ({ start: i * 10, end: i * 10 + 10 }));
    expect(buildChunkOrder(3, 20, chunks)[0]).toBe(2);
    expect(buildChunkOrder(3, 19, chunks)[0]).toBe(1);
  });
});

describe("retryDelayMs", () => {
  it("exponentially backs off per attempt", () => {
    expect(retryDelayMs(0, 500)).toBe(500);
    expect(retryDelayMs(1, 500)).toBe(1000);
    expect(retryDelayMs(2, 500)).toBe(2000);
  });
});

describe("translateNovel（分块并发管线）", () => {
  const baseOpts = (overrides: Partial<TranslateChunkOptions> = {}): TranslateChunkOptions => ({
    apiKey: "sk-test",
    model: "deepseek-v4-flash",
    maxChunkChars: 2000,
    concurrency: 3,
    retryBaseMs: 1,
    ...overrides,
  });

  it("translates all chunks and merges paragraphs in order", async () => {
    const requestTranslate = vi
      .fn()
      .mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) => {
        const text = messages[1].content;
        // 每块返回译文（段数 = 输入段数）
        const lines = text.split(/\n\n+/u).filter((l) => l.length > 0);
        return {
          content: lines.map((l) => `译:${l.slice(0, 4)}`).join("\n\n"),
          finishReason: "stop",
        };
      });
    const paragraphs = makeParagraphs(30, 100); // 3000 字 → 2 块
    const progress: number[] = [];
    const result = await translateNovel(
      paragraphs,
      baseOpts(),
      (p) => progress.push(p.done),
      makeDeps(requestTranslate),
    );
    // 全部段落都有译文
    expect(Object.keys(result)).toHaveLength(30);
    for (let i = 0; i < 30; i++) {
      expect(result[i]).toContain("译:段落");
    }
    // 进度单调递增到 total
    expect(progress[progress.length - 1]).toBe(2);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const requestTranslate = vi.fn().mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight--;
          resolve({ content: "译文\n\n译文", finishReason: "stop" });
        }, 20);
      });
    });
    const paragraphs = makeParagraphs(60, 100); // 6 块
    const result = await translateNovel(
      paragraphs,
      baseOpts(),
      () => {},
      makeDeps(requestTranslate),
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(Object.keys(result)).toHaveLength(60);
  });

  it("retries 429 with backoff and succeeds", async () => {
    const err429 = Object.assign(new Error("429"), { code: "rate_limit", status: 429 });
    let call = 0;
    const requestTranslate = vi.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.reject(err429)
        : Promise.resolve({ content: "译文", finishReason: "stop" });
    });
    const result = await translateNovel(["段一"], baseOpts(), () => {}, makeDeps(requestTranslate));
    expect(requestTranslate).toHaveBeenCalledTimes(2);
    expect(result[0]).toBe("译文");
  });

  it("leaves failed chunks untranslated (falls back to original display) and keeps going", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("policy"), { code: "content_filter" });
    const requestTranslate = vi
      .fn()
      .mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) => {
        if (messages[1].content.includes("段落0")) {
          throw err;
        }
        const lines = messages[1].content.split(/\n\n+/u).filter((l) => l.length > 0);
        return {
          content: lines.map((l) => `译:${l.slice(0, 4)}`).join("\n\n"),
          finishReason: "stop",
        };
      });
    const paragraphs = makeParagraphs(30, 100);
    const result = await translateNovel(
      paragraphs,
      baseOpts(),
      () => {},
      makeDeps(requestTranslate),
    );
    // 失败块段落不写入 map（显示回退原文）；其余块为译文
    expect(result[0]).toBeUndefined();
    expect(result[20]).toContain("译:");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[createNovelTranslator]"),
      expect.any(Object),
    );
    warnSpy.mockRestore();
  });

  it("still converges progress to total when chunks fail", async () => {    const err = Object.assign(new Error("policy"), { code: "content_filter" });
    const requestTranslate = vi.fn().mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) => {
      if (messages[1].content.includes("段落0")) {
        throw err;
      }
      const lines = messages[1].content.split(/\n\n+/u).filter((l) => l.length > 0);
      return { content: lines.map((l) => `译:${l.slice(0, 4)}`).join("\n\n"), finishReason: "stop" };
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const paragraphs = makeParagraphs(30, 100); // 2 块
    const progress: number[] = [];
    await translateNovel(paragraphs, baseOpts(), (p) => progress.push(p.done), makeDeps(requestTranslate));
    expect(progress[progress.length - 1]).toBe(2); // 失败块也推进进度
    warnSpy.mockRestore();
  });

  it("flags fallback blocks (translated fewer paragraphs than input) via progress", async () => {
    // 单块返回 1 段译文，输入 3 段 → 回退 2 段 → onProgress.fallback === true + fallbackIndexes 指向末 2 段
    const requestTranslate = vi.fn().mockResolvedValue({ content: "只有一段译文", finishReason: "stop" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const progress: Array<{ fallback?: boolean; fallbackIndexes?: number[] }> = [];
    await translateNovel(
      ["段一", "段二", "段三"],
      baseOpts(),
      (p) => progress.push({ fallback: p.fallback, fallbackIndexes: p.fallbackIndexes }),
      makeDeps(requestTranslate),
    );
    expect(progress.some((p) => p.fallback === true)).toBe(true);
    const fb = progress.find((p) => p.fallback === true);
    expect(fb?.fallbackIndexes).toEqual([1, 2]); // 末 2 段回退原文
    warnSpy.mockRestore();
  });

  it("stops issuing requests once aborted", async () => {
    const abort = new AbortController();
    const requestTranslate = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ content: "译文", finishReason: "stop" }), 5),
          ),
      );
    const paragraphs = makeParagraphs(60, 100); // 6 块
    const promise = translateNovel(
      paragraphs,
      baseOpts({ signal: abort.signal }),
      () => {},
      makeDeps(requestTranslate),
    );
    await vi.waitFor(() => expect(requestTranslate.mock.calls.length).toBeGreaterThan(0));
    abort.abort();
    const result = await promise;
    const calls = requestTranslate.mock.calls.length;
    expect(calls).toBeLessThan(6); // 未全部请求
    expect(result).toBeDefined();
  });

  it("returns empty map for empty input", async () => {
    const requestTranslate = vi.fn();
    const result = await translateNovel([], baseOpts(), () => {}, makeDeps(requestTranslate));
    expect(result).toEqual({});
    expect(requestTranslate).not.toHaveBeenCalled();
  });
});
