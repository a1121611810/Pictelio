import { describe, expect, it } from "vitest";
import {
  AI_CONFIG_KEYS,
  DEFAULT_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  PROTOCOL_PATHS,
  RELEASE_NOTES_SYSTEM_PROMPT,
  buildSummaryUserPrompt,
  extractNotesText,
  loadAiConfig,
  parseEnvFile,
  resolveAiConfig,
  runSummaryStep,
  summarizeReleaseNotes,
} from "../../../scripts/lib/release-notes-ai.mjs";

// ── oracle 溯源（测试硬约束 6：期望值出处可追溯）──
//
// 1. chat 响应样例（CHAT_FIXTURE）：2026-09-17 对 https://api.deepseek.com/chat/completions 的
//    真实调用捕获（model=deepseek-flash，真实报文 4824 字节，id/usage/reasoning_content 等字段
//    逐字保留，正文为可读性截短）。其中 message.reasoning_content 是思考模型的真实字段——
//    抓「只取 content、不泄漏思考草稿」这条契约。
// 2. responses 响应样例（RESPONSES_FIXTURE）：OpenAI 官方 Responses 参考文档的报文形状——
//    output[].content[].text，内容项 type="output_text"；顶层 output_text 只是各家 SDK 合成的
//    便利属性，线上报文里没有（故实现必须自己走 output 数组）。output 里混入 reasoning 项，
//    对应官方「工具/推理输出项与 message 平级」的结构。
// 3. 失败语义：本次改动与用户逐问拍板——4xx（凭据/配置问题）不重试、429/5xx/网络错误/空输出
//    重试一次、超时不重试；判据与 scripts/release.mjs 既有 NON_RETRYABLE（4xx 不重试）一致。
// 4. 协议端点与最小请求体：PROTOCOL_PATHS 由两种协议形态决定；「只发 model + 消息体，
//    不发 temperature/max_tokens」是本次拍板的通用性约束（部分供应商对可选参数直接 400）。

const CONFIG = {
  configured: true,
  missing: [],
  protocol: "chat",
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-test-key",
  model: "deepseek-flash",
};

/** 真实捕获的 chat/completions 响应（字段逐字保留，正文截短） */
const CHAT_FIXTURE = {
  id: "fbb900d7-7787-4246-873d-7c76e87a7a42",
  object: "chat.completion",
  created: 1789635120,
  model: "deepseek-flash",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content:
          "# Pictelio 更新日志\n\n## ✨ 新功能：Lynx 成为默认引擎\n\n- **默认引擎**：全新安装的用户默认进入 Lynx 引擎",
        reasoning_content: "（思考草稿：先把提交按节分组，再逐条换算成用户视角……）",
      },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1566,
    completion_tokens: 2174,
    total_tokens: 3740,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 1877 },
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 1566,
  },
  system_fingerprint: "fp_a1b2c3",
};

const RESPONSE_TEXT =
  "# Pictelio 更新日志\n\n## 🐛 问题修复\n\n- **Lynx 搜索**：翻页此前必定失败，现在可以正常加载下一页";

/** 真实捕获：MiniMax-M3 把思考内联在 content 里（标题前 1924 字英文推理），正文在 </think> 之后 */
const MINIMAX_INLINE_THINK_FIXTURE = {
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content:
          "<think>Let me analyze the material provided and figure out what to include in the changelog.\n\n" +
          "Looking at the commits: merge commit → exclude; docs/spec → exclude; feat(lynx) → include.\n" +
          "This looks good. Let me output it.</think>\n\n" +
          "# Pictelio 更新日志\n\n## ✨ 新功能\n\n- **Lynx 阅读器**：长按正文可选中文字并复制",
      },
      finish_reason: "stop",
    },
  ],
};

/** 官方 Responses 报文形状（含一条 reasoning 输出项） */
const RESPONSES_FIXTURE = {
  id: "resp_68f0c1a2b3c4d5e6",
  object: "response",
  created_at: 1789635120,
  status: "completed",
  model: "gpt-5-mini",
  output: [
    {
      type: "reasoning",
      id: "rs_0a1b2c3d",
      summary: [{ type: "summary_text", text: "思考摘要" }],
    },
    {
      type: "message",
      id: "msg_7f8e9d0c",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: RESPONSE_TEXT, annotations: [] }],
    },
  ],
  usage: { input_tokens: 1540, output_tokens: 397, total_tokens: 1937 },
};

/** 造一个可断言的假 fetch（calls 记录每次调用的 url/init） */
function makeFetch({ status = 200, body, error } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    return {
      status,
      ok: status < 400,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const jsonBody = (fetchImpl) => JSON.parse(fetchImpl.calls[0].init.body);

describe("parseEnvFile", () => {
  it("解析 KEY=VALUE，忽略注释与空行", () => {
    const env = parseEnvFile("# 注释\n\nPICTELIO_AI_MODEL=deepseek-flash\n");
    expect(env.PICTELIO_AI_MODEL).toBe("deepseek-flash");
    expect(Object.keys(env)).toEqual(["PICTELIO_AI_MODEL"]);
  });

  it("容忍 export 前缀、CRLF 换行与首尾空白", () => {
    const env = parseEnvFile("export PICTELIO_AI_MODEL =  deepseek-flash  \r\n");
    expect(env.PICTELIO_AI_MODEL).toBe("deepseek-flash");
  });

  it("剥掉成对的引号，值内部的 = 不受影响", () => {
    const env = parseEnvFile("A=\"x=y\"\nB='z'\nC=a=b\n");
    expect(env).toEqual({ A: "x=y", B: "z", C: "a=b" });
  });

  it("无等号行与空键行被忽略", () => {
    expect(parseEnvFile("没有等号\n=空键\nA=1\n")).toEqual({ A: "1" });
  });

  it("空文本/undefined → 空对象", () => {
    expect(parseEnvFile("")).toEqual({});
    expect(parseEnvFile(undefined)).toEqual({});
  });

  it("不支持行内注释（与 dotenv 不同）：# 之后的内容算进值里", () => {
    // 钉住这个已知限制，避免有人以为写了行内注释生效
    expect(parseEnvFile("PICTELIO_AI_MODEL=deepseek-flash # 快档").PICTELIO_AI_MODEL).toBe(
      "deepseek-flash # 快档",
    );
  });
});

describe("spec 常量（拍板值，变异实证：改掉它们曾能全绿）", () => {
  it("超时默认 240s（实测思考型模型单次可 >100s，90s 会误杀）", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(240_000);
  });

  it("尝试次数默认 2（含首次，即最多重试一次）", () => {
    expect(DEFAULT_ATTEMPTS).toBe(2);
  });
});

describe("resolveAiConfig", () => {
  const full = {
    [AI_CONFIG_KEYS.protocol]: "chat",
    [AI_CONFIG_KEYS.baseUrl]: "https://api.deepseek.com",
    [AI_CONFIG_KEYS.apiKey]: "sk-1",
    [AI_CONFIG_KEYS.model]: "deepseek-flash",
  };

  it("四个键齐全（来自 .env）→ configured 且 missing 为空", () => {
    const config = resolveAiConfig({ env: {}, envFile: full });
    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config).toMatchObject({
      protocol: "chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-1",
      model: "deepseek-flash",
    });
  });

  it("process.env 优先于 .env 文件", () => {
    const config = resolveAiConfig({
      env: { [AI_CONFIG_KEYS.model]: "from-env" },
      envFile: full,
    });
    expect(config.model).toBe("from-env");
  });

  it("值为空白串等同未配置（不被当成有效值）", () => {
    const config = resolveAiConfig({
      env: {},
      envFile: { ...full, [AI_CONFIG_KEYS.model]: "   " },
    });
    expect(config.configured).toBe(false);
    expect(config.missing).toEqual([AI_CONFIG_KEYS.model]);
  });

  it("缺键时逐个点名（供 warn 提示填哪个）", () => {
    const config = resolveAiConfig({ env: {}, envFile: { [AI_CONFIG_KEYS.protocol]: "chat" } });
    expect(config.configured).toBe(false);
    expect(config.missing).toEqual([
      AI_CONFIG_KEYS.baseUrl,
      AI_CONFIG_KEYS.apiKey,
      AI_CONFIG_KEYS.model,
    ]);
  });

  it("全空（无 .env）→ 四个键全缺", () => {
    const config = resolveAiConfig({ env: {}, envFile: {} });
    expect(config.configured).toBe(false);
    expect(config.missing).toHaveLength(4);
  });

  it("协议值非法 → 未配置且点名非法值（不静默当成没配）", () => {
    const config = resolveAiConfig({
      env: {},
      envFile: { ...full, [AI_CONFIG_KEYS.protocol]: "gemini" },
    });
    expect(config.configured).toBe(false);
    expect(config.protocol).toBeNull();
    expect(config.missing[0]).toContain("gemini");
    expect(config.missing[0]).toContain("chat / responses");
  });

  it("两种协议各对应一个端点路径", () => {
    expect(Object.keys(PROTOCOL_PATHS).toSorted()).toEqual(["chat", "responses"]);
  });
});

describe("extractNotesText", () => {
  it("chat：取 choices[0].message.content", () => {
    expect(extractNotesText("chat", CHAT_FIXTURE)).toBe(CHAT_FIXTURE.choices[0].message.content);
  });

  it("chat：不把 reasoning_content 混进成稿（思考草稿不得泄漏）", () => {
    const text = extractNotesText("chat", CHAT_FIXTURE);
    expect(text).not.toContain("思考草稿");
  });

  it("chat：content 为 null 时不得回退到 reasoning_content（思考草稿不进成稿）", () => {
    // 变异实证：把实现改成 content ?? reasoning_content 时，只断言 CHAT_FIXTURE 的用例仍全绿——
    // 因为那条的 content 非空。真正钉住该契约的是这条：content 为 null 且 reasoning_content 有内容。
    const payload = {
      choices: [{ message: { content: null, reasoning_content: "思考草稿：我打算写成……" } }],
    };
    expect(extractNotesText("chat", payload)).toBe("");
  });

  it("responses：取 output[].content[].text，跳过 reasoning 项", () => {
    expect(extractNotesText("responses", RESPONSES_FIXTURE)).toBe(RESPONSE_TEXT);
  });

  it("responses：顶层 output_text 不是线上字段，不得被当正文读走", () => {
    // 该字段只是各家 SDK 合成的便利属性（spec 明文），实现必须自己走 output 数组
    expect(extractNotesText("responses", { output_text: "SDK 合成属性，线上报文没有" })).toBe("");
  });

  it("responses：多个 output_text 片段拼接", () => {
    const payload = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "上" },
            { type: "output_text", text: "下" },
          ],
        },
      ],
    };
    expect(extractNotesText("responses", payload)).toBe("上下");
  });

  it("chat：剥掉内联思考块（真实样例：MiniMax-M3 把 <think> 内联在 content 里）", () => {
    // 2026-09-17 实测捕获：content = "<think>Let me analyze the material…</think>\n\n# Pictelio 更新日志\n…"
    // （真实报文里标题前 1924 字是英文推理）。思考不得进发布文案。
    expect(extractNotesText("chat", MINIMAX_INLINE_THINK_FIXTURE)).toBe(
      "# Pictelio 更新日志\n\n## ✨ 新功能\n\n- **Lynx 阅读器**：长按正文可选中文字并复制",
    );
  });

  it("chat：思考块未闭合（输出被截断）→ 残稿一并丢弃，交给「空输出」失败路径", () => {
    const payload = {
      choices: [
        {
          message: {
            content: "<think>分析中，还没写完结论",
          },
        },
      ],
    };
    expect(extractNotesText("chat", payload)).toBe("");
  });

  it("responses：同样剥掉内联思考块", () => {
    const payload = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "<think>想一下</think>\n\n## 🐛 问题修复\n\n- 修好了" },
          ],
        },
      ],
    };
    expect(extractNotesText("responses", payload)).toBe("## 🐛 问题修复\n\n- 修好了");
  });

  it("结构缺失/空对象 → 空串（不抛）", () => {
    expect(extractNotesText("chat", {})).toBe("");
    expect(extractNotesText("responses", {})).toBe("");
    expect(extractNotesText("responses", { output: [{ type: "message" }] })).toBe("");
  });
});

describe("summarizeReleaseNotes - 请求形状", () => {
  it("chat：POST 到 base + /chat/completions，带 Bearer 鉴权与 system brief", async () => {
    const fetchImpl = makeFetch({ body: CHAT_FIXTURE });
    const result = await summarizeReleaseNotes({
      rawNotes: "abc123 fix(app): 修好一件事",
      config: CONFIG,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, text: CHAT_FIXTURE.choices[0].message.content });
    expect(fetchImpl.calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(fetchImpl.calls[0].init.method).toBe("POST");
    expect(fetchImpl.calls[0].init.headers.Authorization).toBe("Bearer sk-test-key");

    const body = jsonBody(fetchImpl);
    expect(body.model).toBe("deepseek-flash");
    expect(body.messages[0]).toEqual({ role: "system", content: RELEASE_NOTES_SYSTEM_PROMPT });
    expect(body.messages[1].content).toBe(buildSummaryUserPrompt("abc123 fix(app): 修好一件事"));
  });

  it("每次请求都带上超时信号（变异实证：删掉 signal 曾能全绿）", async () => {
    const fetchImpl = makeFetch({ body: CHAT_FIXTURE });
    await summarizeReleaseNotes({ rawNotes: "素材", config: CONFIG, fetchImpl });
    // 不用 instanceof：AbortSignal 跨 realm 会脆
    expect(fetchImpl.calls[0].init.signal).toBeDefined();
    expect(fetchImpl.calls[0].init.signal.aborted).toBe(false);
  });

  it("chat：只发最小字段（不发 temperature / max_tokens / stream）", async () => {
    const fetchImpl = makeFetch({ body: CHAT_FIXTURE });
    await summarizeReleaseNotes({ rawNotes: "素材", config: CONFIG, fetchImpl });
    expect(Object.keys(jsonBody(fetchImpl)).toSorted()).toEqual(["messages", "model"]);
  });

  it("responses：POST 到 base + /responses，system 走 instructions，store:false", async () => {
    const fetchImpl = makeFetch({ body: RESPONSES_FIXTURE });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: { ...CONFIG, protocol: "responses", model: "gpt-5-mini" },
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, text: RESPONSE_TEXT });
    expect(fetchImpl.calls[0].url).toBe("https://api.deepseek.com/responses");
    expect(jsonBody(fetchImpl)).toEqual({
      model: "gpt-5-mini",
      instructions: RELEASE_NOTES_SYSTEM_PROMPT,
      input: buildSummaryUserPrompt("素材"),
      store: false,
    });
  });

  it("base URL 尾斜杠不会拼出双斜杠（OpenAI 形状的 /v1 前缀同样支持）", async () => {
    const fetchImpl = makeFetch({ body: CHAT_FIXTURE });
    await summarizeReleaseNotes({
      rawNotes: "素材",
      config: { ...CONFIG, baseUrl: "https://api.openai.com/v1/" },
      fetchImpl,
    });
    expect(fetchImpl.calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("summarizeReleaseNotes - 失败与重试", () => {
  const fail = (props) => {
    const fetchImpl = makeFetch(props);
    return fetchImpl;
  };

  it("401（key 无效）→ 不重试，reason 指明凭据问题", async () => {
    const fetchImpl = fail({ status: 401, body: { error: { message: "Authentication Fails" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("401");
    expect(result.reason).toContain("API key 无效");
    expect(result.reason).toContain("Authentication Fails");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("402（余额不足）→ 不重试，reason 说清是余额", async () => {
    const fetchImpl = fail({ status: 402, body: { error: { message: "Insufficient Balance" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("余额不足");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("404 → 提示检查 base URL 前缀（最常见的配错）", async () => {
    const fetchImpl = fail({ status: 404, body: { error: { message: "Not Found" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("base URL");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("408 也属 4xx → 不重试（拍板口径是「4xx 不重试」，不做 RFC 例外）", async () => {
    const fetchImpl = fail({ status: 408, body: { error: { message: "Request Timeout" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(fetchImpl.calls).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("429（限流）→ 重试到上限后失败", async () => {
    const fetchImpl = fail({ status: 429, body: { error: { message: "Rate limit reached" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("限流");
    expect(fetchImpl.calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("5xx → 重试，最终失败仍带服务端原文", async () => {
    const fetchImpl = fail({ status: 503, body: { error: { message: "Service Unavailable" } } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("服务端异常");
    expect(result.reason).toContain("Service Unavailable");
    expect(fetchImpl.calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("网络错误 → 重试，reason 带底层原因", async () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("getaddrinfo ENOTFOUND example.invalid"),
    });
    const fetchImpl = fail({ error });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("网络不可用");
    expect(result.reason).toContain("ENOTFOUND");
    expect(fetchImpl.calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("超时 → 不重试（慢模型再等一轮等于翻倍），reason 提示换快档", async () => {
    const error = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchImpl = fail({ error });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      timeoutMs: 2_000,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("超时（2s");
    expect(result.reason).toContain("换更快的模型");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("非 JSON 报文（网关错误页）→ 重试后失败，reason 带报文片段", async () => {
    const fetchImpl = fail({ status: 502, body: "<html>502 Bad Gateway</html>" });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toContain("不是合法 JSON");
    expect(result.reason).toContain("502 Bad Gateway");
    expect(fetchImpl.calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("空输出 → 重试后失败（避免把空文案写进发布）", async () => {
    const fetchImpl = fail({ body: { choices: [{ message: { content: "" } }] } });
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.reason).toBe("模型返回空内容");
    expect(fetchImpl.calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("第二次尝试成功 → 返回成稿（首次 429 不致命）", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          status: 429,
          ok: false,
          text: async () => JSON.stringify({ error: { message: "Rate limit reached" } }),
        };
      }
      return { status: 200, ok: true, text: async () => JSON.stringify(CHAT_FIXTURE) };
    };
    const result = await summarizeReleaseNotes({
      rawNotes: "素材",
      config: CONFIG,
      fetchImpl,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("loadAiConfig - .env 读取（唯一 IO 边界，成功与失败双路）", () => {
  const FULL_ENV_TEXT = [
    "# 发布文案模型",
    "PICTELIO_AI_BASE_URL=https://api.deepseek.com",
    "PICTELIO_AI_API_KEY=sk-from-file",
    "PICTELIO_AI_MODEL=deepseek-flash",
    "PICTELIO_AI_PROTOCOL=chat",
  ].join("\n");

  it("读到 .env → 解析出已配置的四个键（并核对读取路径）", async () => {
    const seen = [];
    const config = await loadAiConfig({
      readText: async (path) => {
        seen.push(path);
        return FULL_ENV_TEXT;
      },
      env: {},
    });
    expect(config.configured).toBe(true);
    expect(config.model).toBe("deepseek-flash");
    expect(config.protocol).toBe("chat");
    // 路径写错会退化成「静默未配置 + 缺键」——把成因指向使用者的配置，故钉住
    expect(seen).toEqual([".env"]);
  });

  it("ENOENT（没有 .env）→ 静默按未配置处理，不打 warn", async () => {
    // 静默是刻意的：紧随其后的「未配置」告警已让破坏可见，这里再喊一次是噪音
    const warns = [];
    const enoent = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    const config = await loadAiConfig({
      readText: async () => {
        throw enoent;
      },
      env: {},
      warn: (m) => warns.push(m),
    });

    expect(warns).toEqual([]);
    expect(config.configured).toBe(false);
    expect(config.missing).toHaveLength(4);
  });

  it("其它读取错误（权限/IO）→ 打 warn 说明原因（否则填了也被说成「缺键」）", async () => {
    const warns = [];
    const eacces = Object.assign(new Error("EACCES: permission denied, open '.env'"), {
      code: "EACCES",
    });
    const config = await loadAiConfig({
      readText: async () => {
        throw eacces;
      },
      env: {},
      warn: (m) => warns.push(m),
    });

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("读取 packages/app/.env 失败");
    expect(warns[0]).toContain("EACCES");
    expect(config.configured).toBe(false);
  });

  it("process.env 优先于 .env 文件（同键时以环境为准）", async () => {
    const config = await loadAiConfig({
      readText: async () => FULL_ENV_TEXT,
      env: { [AI_CONFIG_KEYS.model]: "from-process-env" },
    });
    expect(config.model).toBe("from-process-env");
  });
});

describe("runSummaryStep - 交互闭环（使用者逐问拍板的语义）", () => {
  const RAW = "abc123 fix(lynx): 原始素材";
  const DRAFT =
    "# Pictelio 更新日志\n\n## 🐛 问题修复\n\n- **Lynx 搜索**：翻页现在可以正常加载下一页";

  /** 按序喂答案的 ask 端口，并记录每个问题 */
  function makeAsk(answers) {
    const asked = [];
    const ask = async (question) => {
      asked.push(question);
      const next = answers.shift();
      if (next === undefined) throw new Error(`ask 被多调了一次：${question}`);
      return next;
    };
    ask.asked = asked;
    return ask;
  }

  /** 记录调用的 summarize 端口（可指定每次的结果） */
  function makeSummarize(results) {
    const calls = [];
    const summarize = async (params) => {
      calls.push(params);
      return results[calls.length - 1] ?? { ok: true, text: DRAFT };
    };
    summarize.calls = calls;
    return summarize;
  }

  const collect = () => {
    const lines = [];
    const warns = [];
    return {
      lines,
      warns,
      ports: { log: (m) => lines.push(m), warn: (m) => warns.push(m) },
    };
  };

  it("答 n → 不调用模型，直接用原文案", async () => {
    const summarize = makeSummarize([]);
    const sink = collect();
    const ask = makeAsk(["n"]);
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask,
      summarize,
      ...sink.ports,
    });

    expect(result).toEqual({ notes: RAW, cancelled: false });
    expect(summarize.calls).toHaveLength(0);
    // 问句是拍板给定的原文（变异实证：把问句改文案曾能全绿）
    expect(ask.asked[0]).toBe("\n是否让模型总结这份文案? (Y/n): ");
  });

  it("回车（空答案）默认走总结，成稿确认回车即采用", async () => {
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["", ""]),
      summarize: makeSummarize([{ ok: true, text: DRAFT }]),
      ...collect().ports,
    });

    expect(result).toEqual({ notes: DRAFT, cancelled: false });
  });

  it("成稿会整篇打印（人工闸口可见）", async () => {
    const sink = collect();
    await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["y", "y"]),
      summarize: makeSummarize([{ ok: true, text: DRAFT }]),
      ...sink.ports,
    });

    expect(sink.lines.join("\n")).toContain(DRAFT);
    expect(sink.lines.join("\n")).toContain("模型总结稿");
  });

  it("成稿确认 n → 回退原文案，且不重复调用模型", async () => {
    const summarize = makeSummarize([{ ok: true, text: DRAFT }]);
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["y", "n"]),
      summarize,
      ...collect().ports,
    });

    expect(result).toEqual({ notes: RAW, cancelled: false });
    expect(summarize.calls).toHaveLength(1);
  });

  it("e → 重新总结，且每次都以**原始文案**为输入（不拿上一版成稿再喂一遍）", async () => {
    const summarize = makeSummarize([
      { ok: true, text: "第一版成稿" },
      { ok: true, text: "第二版成稿" },
    ]);
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["y", "e", "y"]),
      summarize,
      ...collect().ports,
    });

    expect(result).toEqual({ notes: "第二版成稿", cancelled: false });
    expect(summarize.calls.map((c) => c.rawNotes)).toEqual([RAW, RAW]);
    expect(summarize.calls.map((c) => c.config)).toEqual([CONFIG, CONFIG]);
  });

  it("失败 → warn 说明成因，再问「改用原文案继续?」；答 y 用原文案继续", async () => {
    const sink = collect();
    const ask = makeAsk(["y", "y"]);
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask,
      summarize: makeSummarize([{ ok: false, reason: "HTTP 429（请求被限流）" }]),
      ...sink.ports,
    });

    expect(result).toEqual({ notes: RAW, cancelled: false });
    expect(sink.warns.join("\n")).toContain("模型总结失败");
    expect(sink.warns.join("\n")).toContain("HTTP 429（请求被限流）");
    // 告警不带口吻前缀（前缀由调用方端口加）——双层前缀会污染日志
    expect(sink.warns.join("\n")).not.toContain("[release]");
    // 两个选项在紧随其后的问句里（同为拍板原文）
    expect(ask.asked[1]).toBe("改用原文案继续? (Y/n): ");
  });

  it("成稿确认问句也是拍板原文", async () => {
    const ask = makeAsk(["y", "y"]);
    await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask,
      summarize: makeSummarize([{ ok: true, text: DRAFT }]),
      ...collect().ports,
    });

    expect(ask.asked[1]).toBe("确认使用? (Y/n/e=重新总结): ");
  });

  it("失败 → 答 n → cancelled（不擅自替使用者决定用哪份文案）", async () => {
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["y", "n"]),
      summarize: makeSummarize([{ ok: false, reason: "网络不可用" }]),
      ...collect().ports,
    });

    expect(result).toEqual({ notes: RAW, cancelled: true });
  });

  it("失败回车默认用原文案继续（与脚本既有 Y/n 习惯一致）", async () => {
    const result = await runSummaryStep({
      rawNotes: RAW,
      config: CONFIG,
      ask: makeAsk(["y", ""]),
      summarize: makeSummarize([{ ok: false, reason: "超时" }]),
      ...collect().ports,
    });

    expect(result.cancelled).toBe(false);
    expect(result.notes).toBe(RAW);
  });
});
