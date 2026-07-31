/**
 * DeepSeek 翻译协议层 —— OpenAI 兼容 POST /chat/completions。
 *
 * 决策来源：
 * - 双模式（Web fetch / Native CapacitorHttp）：评估文档第 9 章 —— Android WebView
 *   fetch 直连多数国内服务商会 CORS 失败，Native 必须走 CapacitorHttp。
 * - 不得复用 Pixiv 的 apiClient（绑定 Pixiv 域 + 401 自动刷新逻辑）。
 * - 翻译默认禁用思考模式（决策 #22）：`thinking: {"type":"disabled"}`，
 *   更快、无 reasoning token 计费、temperature 才生效。
 * - 请求保活（DeepSeek 官方）：响应前持续返回空行（非流式）/ `: keep-alive` 注释（流式），
 *   解析 JSON 前必须剔除；10 分钟未开始推理服务端断连。
 * - 错误码：401 key 无效 / 402 余额不足 / 429 限流 / 5xx 服务异常；
 *   政策拒绝信号 `finish_reason=content_filter`（决策 #23，S4 完整处理失败即止）。
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** 翻译可用模型（决策 #22：标准 / 高质量两档，S7 完整档位选择） */
export const TRANSLATE_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export type TranslateModel = (typeof TRANSLATE_MODELS)[number];

export interface TranslateMessage {
  role: "system" | "user";
  content: string;
}

export interface TranslateRequestPayload {
  /** 用户自填的 DeepSeek API key（BYOK） */
  apiKey: string;
  model: TranslateModel;
  messages: TranslateMessage[];
  /** 采样温度，翻译建议 0.3~0.7；禁用思考模式下生效 */
  temperature?: number;
  /** 单块输出上限，按块大小设置 */
  maxTokens?: number;
  /** 取消信号（透传到 fetch / CapacitorHttp，中止在途请求） */
  signal?: AbortSignal;
  /** 思考模式：默认 false（disabled，更快/无 reasoning token/temperature 生效）；true = enabled（决策 #22 可开开关） */
  thinking?: boolean;
}

export interface TranslateResult {
  /** 译文纯文本（模型输出，可能含 \n\n 段落分隔） */
  content: string;
  finishReason: string;
  /** KV 缓存命中观测（省钱策略验证用） */
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export type TranslateErrorCode =
  | "unauthorized" // 401：key 无效
  | "insufficient_balance" // 402：余额不足
  | "rate_limit" // 429
  | "server" // 5xx
  | "network" // 网络不可用
  | "content_filter" // finish_reason=content_filter：政策拒绝
  | "unknown";

export class TranslateError extends Error {
  readonly code: TranslateErrorCode;
  readonly status?: number;

  constructor(code: TranslateErrorCode, message: string, status?: number) {
    super(message);
    this.name = "TranslateError";
    this.code = code;
    this.status = status;
  }
}

export interface HttpResponseLike {
  status: number;
  text(): Promise<string>;
}

export type Transport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<HttpResponseLike>;

/** Web 模式：fetch 直连（DEV 环境无 CORS 问题；signal 中止在途请求） */
const webTransport: Transport = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  return { status: res.status, text: () => res.text() };
};

/** Native 模式：CapacitorHttp 直连（原生层无 CORS 限制）。
 * 注：@capacitor/core 的 HttpOptions 类型不支持 AbortSignal，Native 在途请求暂无法取消，
 * 靠调用方 generation-gate 丢弃其落地结果；Web 分支已透传 signal 可真正中止。 */
const nativeTransport: Transport = async (url, init) => {
  const res = await CapacitorHttp.request({
    method: init.method as "POST",
    url,
    headers: init.headers,
    // CapacitorHttp 支持字符串 data（作为请求体原样发送），无需 JSON.parse 往返
    data: init.body,
  });
  return { status: res.status, text: async () => String(res.data ?? "") };
};

/** 默认传输层：Native 走 CapacitorHttp，其余走 fetch（可注入以便测试） */
export function defaultTransport(): Transport {
  return Capacitor.isNativePlatform() ? nativeTransport : webTransport;
}

/**
 * 剔除请求保活噪声，返回可 JSON.parse 的正文。
 * 非流式响应前会持续返回空行；流式响应混有 `: keep-alive` 注释与 `data:` 行。
 */
export function sanitizeResponseBody(body: string): string {
  return body
    .split(/\r?\n/u)
    .filter((line) => {
      const t = line.trim();
      return t !== "" && !t.startsWith(": keep-alive") && !t.startsWith("data:");
    })
    .join("\n");
}

/**
 * 错误归一化（纯函数可单测）。message 面向用户，契约测试用真实响应样例。
 */
export function classifyTranslateError(status: number, _body?: unknown): TranslateError {
  switch (status) {
    case 401:
      return new TranslateError("unauthorized", "API Key 无效，请检查后重试", 401);
    case 402:
      return new TranslateError(
        "insufficient_balance",
        "DeepSeek 余额不足，请前往平台充值后重试",
        402,
      );
    case 429:
      return new TranslateError("rate_limit", "请求过于频繁，请稍后重试", 429);
    default:
      if (status >= 500) {
        return new TranslateError("server", `DeepSeek 服务异常（HTTP ${status}）`, status);
      }
      return new TranslateError("unknown", `翻译请求失败（HTTP ${status}）`, status);
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string };
  }>;
  usage?: {
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

/**
 * 发起一次翻译请求（单块）。
 * 契约：OpenAI 兼容 chat/completions；翻译固定 thinking disabled + 默认温度 0.5。
 */
export async function requestTranslate(
  payload: TranslateRequestPayload,
  transport: Transport = defaultTransport(),
): Promise<TranslateResult> {
  let res: HttpResponseLike;
  try {
    res = await transport(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        thinking: { type: payload.thinking ? "enabled" : "disabled" },
        temperature: payload.temperature ?? 0.5,
        max_tokens: payload.maxTokens,
      }),
      signal: payload.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // 取消信号触发：原样上抛，不归类为 network（避免无谓退避重试）
      throw err;
    }
    throw new TranslateError("network", "网络不可用，请检查连接");
  }

  const rawBody = await res.text();
  const body = sanitizeResponseBody(rawBody);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.warn("[translate] 响应体解析失败", rawBody.slice(0, 200));
    throw classifyTranslateError(res.status);
  }

  if (res.status >= 400) {
    throw classifyTranslateError(res.status, parsed);
  }

  const data = parsed as ChatCompletionResponse;
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? "";
  if (finishReason === "content_filter") {
    // 决策 #23：政策拒绝 → 失败即止（S4 处理回退原文 + 「未翻译」标记）
    throw new TranslateError("content_filter", "内容被服务商审核拒绝，该部分保留原文");
  }

  return {
    content: choice?.message?.content ?? "",
    finishReason,
    promptCacheHitTokens: data.usage?.prompt_cache_hit_tokens,
    promptCacheMissTokens: data.usage?.prompt_cache_miss_tokens,
  };
}
