// 发布文案的「模型总结」步骤 —— 通用 OpenAI 兼容客户端。
//
// 决策（2026-09-17 与用户逐问拍板）：
// - 通道通用化：不绑死任何供应商，只认两种协议形态 —— Chat Completions
//   （POST {base}/chat/completions）与 Responses（POST {base}/responses）。
//   DeepSeek / OpenAI / Azure / 本地 Ollama 等只要兼容其一即可用，换供应商只改 .env。
// - 配置全部无默认值（四个键都必须显式填在 packages/app/.env，该文件不进 git）；
//   缺任一键 = 未配置 → 调用方跳过本步骤并打 warn（不静默、也不问一个做不到的问题）。
// - 请求只发最小必需字段（model + 消息体），不发 temperature / max_tokens：
//   不同供应商对可选参数的支持不一（部分模型直接 400 拒绝），长度改用提示词约束。
// - 唯一例外是 Responses 协议的 store:false —— 该协议缺省会把请求留在服务端（缺省 true），
//   发版素材没有留存价值，显式关闭比依赖供应商默认值可靠。
// - base URL 是「拼接前缀」：脚本自己追加端点路径（DeepSeek 给 https://api.deepseek.com，
//   OpenAI 给 https://api.openai.com/v1）；协议显式配置，不做自动探测（探测白费一次请求，
//   还会把配错藏起来）。
// - 本文件不直接读文件系统、不读 process.env：读文本与 env 都走端口注入
//   （readText / env，见 loadAiConfig），故全部函数可单测。

/** 四个配置键（packages/app/.env，值全部留空由使用者自填） */
export const AI_CONFIG_KEYS = {
  protocol: "PICTELIO_AI_PROTOCOL",
  baseUrl: "PICTELIO_AI_BASE_URL",
  apiKey: "PICTELIO_AI_API_KEY",
  model: "PICTELIO_AI_MODEL",
};

/** 支持的协议 → 端点路径（与 AI_CONFIG_KEYS.protocol 的取值一一对应） */
export const PROTOCOL_PATHS = {
  chat: "/chat/completions",
  responses: "/responses",
};

// 单次超时默认 240s：2026-09-17 实测「思考型」模型单次可达百秒级（deepseek-flash 13s、
// deepseek-v4-pro 103s，实测素材为 v5.0.0→v5.1.0 的 32 条提交），而模型由使用者自填、
// 脚本无从预判。超时不重试（见下）：慢模型重试一次等于把等待翻倍。
export const DEFAULT_TIMEOUT_MS = 240_000;
/** 尝试次数（含首次）：网络瞬断/限流/5xx/空输出重试一次；4xx 与超时直接放弃 */
export const DEFAULT_ATTEMPTS = 2;
export const DEFAULT_RETRY_DELAY_MS = 2_000;

/**
 * 风格 brief（system 提示词）。
 * 按 5.1.0 已发布的 fastlane changelog（50100.txt）固化：用户视角句子、术语加粗、
 * 标「作用于谁」、去工单号与实现细节、纯文档/测试类不进文案。
 * 示例条目为虚构，避免模型把某一版的真实条目抄进后续版本。
 */
export const RELEASE_NOTES_SYSTEM_PROMPT = `你是 Pictelio 的发布文案撰写者。Pictelio 是 Android 上的 Pixiv 第三方客户端，内置 WebView 与 Lynx 两套渲染客户端（用户可能只见到其中一个）。你要把开发者给的素材改写成用户读得懂的更新日志。

## 输出格式（严格遵守）
1. 第一行固定为 "# Pictelio 更新日志"
2. 小节按内容取舍，节标题只从这四个里选："## ✨ 新功能"、"## 🐛 问题修复"、"## ⚡ 体验优化"、"## 🔧 内部优化"；有明显主题的节可在冒号后加一句（如 "## ✨ 新功能：Lynx 成为默认引擎"）；没有内容的小节不要出现
3. 条目以 "- " 开头，一条一句话，写「现在变成什么样」而不是「改了什么代码」
4. 直接输出 Markdown 正文：不要用代码块包裹，不要任何前言、后记或解释文字

## 写作规则
- 简体中文，语气平实克制；不用感叹号，不写「重磅」「史诗级」这类营销词
- 哪一端受影响必须写清楚，但不要用「仅 Lynx」「双端」「全新安装」「开发者可见」这类纯作用域标签当条目开头；二选一：
  ① 用受影响的功能名作前缀，如 "- **Lynx 搜索**：…"、"- **WebView 阅读器**：…"
  ② 把范围写进句子里，如 "全新安装的用户默认进入 **Lynx 引擎**…；此前手动选择过 WebView 的用户不受影响"
- 能给出用户可感知结果的要给（启动更快、不再白屏、加载更顺、不再重复提示），不要只复述实现
- 删掉所有工单号、PR 号、ADR 号、commit hash 和提交类型前缀（feat/fix/docs/chore/refactor 等）
- 以下素材不要进文案：纯文档与 ADR、纯测试、CI 与构建脚本、格式化、OpenWiki 自动更新、版本号提交、merge 提交
- 仅开发者可见的内部工具、自检页、调试页不要单独成条；只有用户会遇到的差异才写
- 修复条目要写清楚「原来坏在哪、现在好了」（如「此前滚到底会提示加载失败，现已可正常加载下一页」），不要写成「修复若干问题」
- 同一条改动不要在多个小节里重复
- 全篇控制在 900 字以内；内部优化只保留用户可能感知或对定位问题有价值的

## 术语
- **WebView 引擎**：基于系统 WebView 渲染的客户端；**Lynx 引擎**：自绘渲染的客户端。两者 UI 与能力有差异
- 引擎相关的实现细节要换算成用户能感知的结果（启动更快、不再白屏、切换后记住选择）
- 素材若已是写好的草稿，则只做统一风格、补「作用于谁」、删工单号与实现细节，不新增素材里没有的内容

## 格式示例（示范语气与粒度，内容与本项目无关，禁止照抄进输出）
# Pictelio 更新日志

## 🐛 问题修复

- **WebView 阅读器**：字号调节现在按屏幕宽度自动适配，小屏不再出现半行裁切
- 首次进入时不再弹出多余的权限询问；已授权过的用户不受影响`;

/** 待改写素材的 user 提示词（提交记录或已写好的草稿，两种模式共用） */
export function buildSummaryUserPrompt(rawNotes) {
  return `以下是本次发布要改写的素材（可能是提交记录，也可能是已写好的草稿）：\n\n${rawNotes}`;
}

/**
 * 解析 .env 文本（只认 KEY=VALUE；容忍注释、空行、export 前缀、引号、CRLF）。
 * 纯函数：文件本身由调用方读入，便于单测覆盖解析边界。
 * 注意：不支持行内注释（与 dotenv 不同）——`KEY=value # 说明` 的 `# 说明` 会算进值里。
 */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/u, "")
      .trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * 解析模型配置。优先级：process.env > .env 文件。
 * 四个键缺任一 = 未配置（返回 missing 列表，供调用方 warn 时点名）。
 * 协议值非法同样算未配置（点名非法值），避免把配错静默当成"没配"。
 */
export function resolveAiConfig({ env = {}, envFile = {} } = {}) {
  const pick = (key) => {
    const fromEnv = env[key];
    if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
    const fromFile = envFile[key];
    if (typeof fromFile === "string" && fromFile.trim() !== "") return fromFile.trim();
    return "";
  };

  const protocol = pick(AI_CONFIG_KEYS.protocol);
  const baseUrl = pick(AI_CONFIG_KEYS.baseUrl);
  const apiKey = pick(AI_CONFIG_KEYS.apiKey);
  const model = pick(AI_CONFIG_KEYS.model);

  const missing = [];
  for (const [value, key] of [
    [protocol, AI_CONFIG_KEYS.protocol],
    [baseUrl, AI_CONFIG_KEYS.baseUrl],
    [apiKey, AI_CONFIG_KEYS.apiKey],
    [model, AI_CONFIG_KEYS.model],
  ]) {
    if (value === "") missing.push(key);
  }
  const protocolValid = Object.hasOwn(PROTOCOL_PATHS, protocol);
  if (protocol !== "" && !protocolValid) {
    missing.push(
      `${AI_CONFIG_KEYS.protocol}=${protocol}（仅支持 ${Object.keys(PROTOCOL_PATHS).join(" / ")}）`,
    );
  }

  return {
    configured: missing.length === 0,
    missing,
    protocol: protocolValid ? protocol : null,
    baseUrl,
    apiKey,
    model,
  };
}

/**
 * 读取 .env 文本并解析配置 —— 本模块唯一读文件之处，注入 readText 以便单测两条路径。
 * 读失败：ENOENT = 没有 .env（按未配置处理，静默；紧随其后的未配置告警已让破坏可见）；
 * 其它错误（权限/IO）打 warn 说明原因 —— 否则使用者明明填了却被告知「缺键」（禁静默降级）。
 *
 * @param {object} params
 * @param {Function} params.readText 读文本端口：readText(相对路径) → Promise<string>
 * @param {object} [params.env] 环境变量（优先级高于 .env 文件）
 * @param {Function} [params.warn] 告警端口（消息不带前缀，口吻由调用方加）
 */
export async function loadAiConfig({ readText, env = {}, warn = console.warn } = {}) {
  let envFileText = "";
  try {
    envFileText = await readText(".env");
  } catch (e) {
    if (e?.code !== "ENOENT") {
      warn(`读取 packages/app/.env 失败（按未配置处理）: ${e?.message ?? e}`);
    }
  }
  return resolveAiConfig({ env, envFile: parseEnvFile(envFileText) });
}

/** chat/completions 请求体（最小字段：model + messages） */
function buildChatRequest(model, rawNotes) {
  return {
    model,
    messages: [
      { role: "system", content: RELEASE_NOTES_SYSTEM_PROMPT },
      { role: "user", content: buildSummaryUserPrompt(rawNotes) },
    ],
  };
}

/** responses 请求体（system 走 instructions；store:false 保持无状态） */
function buildResponsesRequest(model, rawNotes) {
  return {
    model,
    instructions: RELEASE_NOTES_SYSTEM_PROMPT,
    input: buildSummaryUserPrompt(rawNotes),
    store: false,
  };
}

/**
 * 剥掉内联在正文里的思考块。
 * 实测（2026-09-17，MiniMax-M3）：它的思考**内联在 content 里**（`<think>…</think>` 后接正文，
 * 实测标题前有 1924 字英文推理），而 DeepSeek 是放在独立字段 reasoning_content —— 两种形态
 * 都不能进发布文案。未闭合的 `<think>`（输出被截断）= 残稿，连同其后内容一并丢弃，
 * 剩下的空文本自然走「空输出」失败路径（可见，不静默）。
 */
export function stripThinking(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/giu, "")
    .replace(/<think>[\s\S]*$/iu, "")
    .trim();
}

/**
 * 从响应体取成稿正文（纯函数，供单测直接喂真实响应样例）。
 * - chat：choices[0].message.content
 * - responses：output[].content[].text（type === "output_text"）；
 *   注意顶层 output_text 只是各家 SDK 合成的便利属性，线上报文里没有。
 */
export function extractNotesText(protocol, payload) {
  if (protocol === "responses") {
    const parts = [];
    for (const item of payload?.output ?? []) {
      if (item?.type !== "message") continue;
      for (const part of item?.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") parts.push(part.text);
      }
    }
    return stripThinking(parts.join(""));
  }
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? stripThinking(content) : "";
}

/** 供应商错误信息（OpenAI 兼容家族统一为 { error: { message } }） */
function extractErrorMessage(payload) {
  const message = payload?.error?.message;
  return typeof message === "string" ? message.trim() : "";
}

/** HTTP 状态 → 人话（不猜供应商私有错误码，只按 HTTP 语义 + error.message 呈现） */
function describeHttpStatus(status, payload) {
  const detail = extractErrorMessage(payload);
  const suffix = detail ? `：${detail}` : "";
  if (status === 401 || status === 403) return `HTTP ${status}（API key 无效或无权限）${suffix}`;
  if (status === 402) return `HTTP 402（账户余额不足）${suffix}`;
  if (status === 404) return `HTTP 404（端点不存在，检查 base URL 是否含正确前缀）${suffix}`;
  if (status === 429) return `HTTP 429（请求被限流）${suffix}`;
  if (status >= 500) return `HTTP ${status}（服务端异常）${suffix}`;
  return `HTTP ${status}${suffix}`;
}

/** 可重试：限流与 5xx（4xx 是配置/凭据问题，重试无意义） */
function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/** 超时判定：AbortSignal.timeout 在 Node 抛 TimeoutError（部分封装层会把它塞进 cause） */
function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError";
}

function describeNetworkError(error, timeoutMs) {
  if (isTimeoutError(error)) {
    return `超时（${timeoutMs / 1000}s 未返回，可换更快的模型或调小素材量后重试）`;
  }
  if (error?.name === "AbortError") return `请求被中断`;
  const cause = error?.cause?.message ?? error?.message ?? String(error);
  return `网络不可用（${cause}）`;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 调用模型总结发布文案。
 * 契约：永不抛出 —— 成功返回 { ok: true, text }，失败返回 { ok: false, reason }，
 * 由调用方决定降级（本仓库禁止静默降级，失败必须经用户显式选择）。
 *
 * @param {object} params
 * @param {string} params.rawNotes 待改写的原始文案（提交清单或已写好的草稿）
 * @param {object} params.config resolveAiConfig 的返回值（须 configured === true）
 * @param {Function} [params.fetchImpl] 注入 fetch（单测用；缺省全局 fetch）
 * @param {number} [params.timeoutMs] 单次请求超时
 * @param {number} [params.attempts] 尝试次数（含首次）
 * @param {number} [params.retryDelayMs] 重试间隔（单测注入 0 避免真实等待）
 */
export async function summarizeReleaseNotes({
  rawNotes,
  config,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const { protocol, baseUrl, apiKey, model } = config;
  const endpoint = `${baseUrl.replace(/\/+$/u, "")}${PROTOCOL_PATHS[protocol]}`;
  const request =
    protocol === "responses"
      ? buildResponsesRequest(model, rawNotes)
      : buildChatRequest(model, rawNotes);

  let lastReason = "未知错误";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status;
    let rawBody;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      rawBody = await res.text();
    } catch (e) {
      lastReason = describeNetworkError(e, timeoutMs);
      // 超时不重试：慢模型再等一轮等于把等待翻倍，用户在场按 e 即可重来
      if (isTimeoutError(e) || attempt >= attempts) {
        return { ok: false, reason: lastReason };
      }
      await delay(retryDelayMs);
      continue;
    }

    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // 供应商返回非 JSON（网关 HTML 错误页等）：保留片段便于定位，不外泄 key
      payload = null;
    }

    if (status >= 400 || payload === null) {
      lastReason =
        payload === null
          ? `响应不是合法 JSON（HTTP ${status}）：${rawBody.slice(0, 120)}`
          : describeHttpStatus(status, payload);
      // 可重试：限流/5xx/非 JSON；4xx 是配置或凭据问题，重试无意义
      const retryable = payload === null || isRetryableStatus(status);
      if (retryable && attempt < attempts) {
        await delay(retryDelayMs);
        continue;
      }
      return { ok: false, reason: lastReason };
    }

    const text = extractNotesText(protocol, payload);
    if (text === "") {
      lastReason = "模型返回空内容";
      if (attempt < attempts) {
        await delay(retryDelayMs);
        continue;
      }
      return { ok: false, reason: lastReason };
    }
    return { ok: true, text };
  }
  return { ok: false, reason: lastReason };
}

/**
 * 「是否模型总结」这一步的交互闭环。
 * 端口注入（ask / summarize / warn / log）以便单测覆盖语义——这些语义是使用者逐问拍板的规格：
 * ① 答 n 不调用模型，直接用原文案；② 成稿确认 n = 回退原文案；③ e = 重新总结，且**始终以原始
 * 文案为输入**重跑（不拿上一版成稿再喂一遍，避免逐轮漂移）；④ 调用失败 warn 说明成因后问
 * 「改用原文案继续?」，答 n 中止发布（不擅自替使用者决定用哪份文案）。
 *
 * @param {object} params
 * @param {string} params.rawNotes 原始文案（提交清单或已写好的草稿）
 * @param {object} params.config resolveAiConfig 的返回值（调用方须已确认 configured）
 * @param {Function} params.ask 提问端口：ask(问题) → Promise<答案>（release.mjs 传 askQuestion）
 * @param {Function} [params.summarize] 总结端口；契约：成功必须返回 `{ ok: true, text: 非空 }`
 *   （空输出由缺省实现归为 `ok: false`，端口替换方同样不得回传空文本——否则空文案会落进发布）
 * @param {Function} [params.warn] 告警端口（消息不带前缀，口吻由调用方加；缺省 console.warn）
 * @param {Function} [params.log] 输出端口（缺省 console.log）
 * @returns {Promise<{ notes: string, cancelled: boolean }>} notes 为最终采用的文案；
 *          cancelled=true 表示使用者选择中止发布（调用方负责退出）
 */
export async function runSummaryStep({
  rawNotes,
  config,
  ask,
  summarize = summarizeReleaseNotes,
  warn = console.warn,
  log = console.log,
}) {
  const want = ((await ask("\n是否让模型总结这份文案? (Y/n): ")) || "y").trim().toLowerCase();
  if (want === "n") {
    return { notes: rawNotes, cancelled: false };
  }

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const result = await summarize({ rawNotes, config });
    if (!result.ok) {
      warn(`模型总结失败：${result.reason}`);
      // eslint-disable-next-line no-await-in-loop
      const fallback = ((await ask("改用原文案继续? (Y/n): ")) || "y").trim().toLowerCase();
      return { notes: rawNotes, cancelled: fallback === "n" };
    }
    log("\n模型总结稿：");
    log("─".repeat(40));
    log(result.text);
    log("─".repeat(40));
    // eslint-disable-next-line no-await-in-loop
    const choice = ((await ask("确认使用? (Y/n/e=重新总结): ")) || "y").trim().toLowerCase();
    if (choice === "e") {
      continue;
    }
    return { notes: choice === "n" ? rawNotes : result.text, cancelled: false };
  }
}
