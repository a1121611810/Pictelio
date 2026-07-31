import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// Capacitor mock：isNativePlatform 可变，供双模式分支测试
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { request: vi.fn() },
}));

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  requestTranslate,
  sanitizeResponseBody,
  classifyTranslateError,
  TranslateError,
  DEEPSEEK_BASE_URL,
} from "@/api/translate";

const isNativeMock = Capacitor.isNativePlatform as Mock;
const httpRequestMock = CapacitorHttp.request as Mock;

function fetchResponse(status: number, body: string) {
  return { status, text: () => Promise.resolve(body) } as Response;
}

/** 官方 API 文档 Chat Completions 响应 schema 样例（契约测试真实样例） */
function officialSample(content = "译文段落", finishReason = "stop") {
  return JSON.stringify({
    id: "chatcmpl-A1b2C3d4",
    object: "chat.completion",
    created: 1770000000,
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 90,
      total_tokens: 210,
      prompt_cache_hit_tokens: 60,
      prompt_cache_miss_tokens: 60,
    },
  });
}

beforeEach(() => {
  isNativeMock.mockReturnValue(false);
  httpRequestMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sanitizeResponseBody", () => {
  it("strips keep-alive blank lines and SSE comments (DeepSeek 请求保活机制)", () => {
    const raw = '\n\n: keep-alive\n: keep-alive\n{"id":"x"}\n\n';
    expect(sanitizeResponseBody(raw)).toBe('{"id":"x"}');
  });

  it("keeps normal JSON intact", () => {
    expect(sanitizeResponseBody('{"a":1}')).toBe('{"a":1}');
  });
});

describe("classifyTranslateError", () => {
  it("maps HTTP status codes to user-facing errors", () => {
    expect(classifyTranslateError(401).code).toBe("unauthorized");
    expect(classifyTranslateError(402).code).toBe("insufficient_balance");
    expect(classifyTranslateError(429).code).toBe("rate_limit");
    expect(classifyTranslateError(500).code).toBe("server");
    expect(classifyTranslateError(503).code).toBe("server");
    expect(classifyTranslateError(422).code).toBe("unknown");
  });
});

describe("requestTranslate (Web fetch 分支)", () => {
  it("returns content from a successful response (官方 schema 样例)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(fetchResponse(200, officialSample()));

    const result = await requestTranslate({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "原文" }],
    });

    expect(result.content).toBe("译文段落");
    expect(result.finishReason).toBe("stop");
    expect(result.promptCacheHitTokens).toBe(60);

    // 请求契约：端点 / Bearer / thinking disabled / 默认温度
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${DEEPSEEK_BASE_URL}/chat/completions`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBe(0.5);
  });

  it("enables thinking mode when payload.thinking is true（思考开关，决策 #22）", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(fetchResponse(200, officialSample()));
    await requestTranslate({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "原文" }],
      thinking: true,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("tolerates keep-alive blank lines before the JSON body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(fetchResponse(200, `\n\n: keep-alive\n${officialSample()}\n\n`));
    const result = await requestTranslate({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "原文" }],
    });
    expect(result.content).toBe("译文段落");
  });

  it("throws unauthorized on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(401, "{}"));
    await expect(
      requestTranslate({
        apiKey: "bad-key",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("throws insufficient_balance on 402", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(402, "{}"));
    await expect(
      requestTranslate({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "insufficient_balance", status: 402 });
  });

  it("throws rate_limit on 429", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(429, "{}"));
    await expect(
      requestTranslate({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "rate_limit", status: 429 });
  });

  it("throws server error on 503", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(503, "{}"));
    await expect(
      requestTranslate({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "server", status: 503 });
  });

  it("throws content_filter when finish_reason=content_filter（政策拒绝）", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(200, officialSample("", "content_filter")));
    await expect(
      requestTranslate({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "R18 内容" }],
      }),
    ).rejects.toMatchObject({ code: "content_filter" });
  });

  it("throws network error when fetch rejects", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      requestTranslate({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("is a TranslateError instance", async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(401, "{}"));
    await requestTranslate({
      apiKey: "bad",
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "x" }],
    }).catch((err) => {
      expect(err).toBeInstanceOf(TranslateError);
      expect(err.message).toContain("API Key");
    });
  });
});

describe("requestTranslate (Native CapacitorHttp 分支)", () => {
  it("uses CapacitorHttp on native platform（CORS 规避）", async () => {
    isNativeMock.mockReturnValue(true);
    httpRequestMock.mockResolvedValue({
      status: 200,
      data: officialSample("原生译文"),
      headers: {},
      url: `${DEEPSEEK_BASE_URL}/chat/completions`,
    });

    const result = await requestTranslate({
      apiKey: "sk-test",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "原文" }],
    });

    expect(result.content).toBe("原生译文");
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
    const call = httpRequestMock.mock.calls[0][0];
    expect(call.url).toBe(`${DEEPSEEK_BASE_URL}/chat/completions`);
    // CapacitorHttp data 透传请求体字符串（不做 JSON.parse 往返）
    const data = JSON.parse(call.data as string);
    expect(data.thinking).toEqual({ type: "disabled" });
    expect(data.model).toBe("deepseek-v4-pro");
  });
});
