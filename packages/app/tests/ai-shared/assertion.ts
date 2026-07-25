/**
 * AI 断言工具 — 通用 LLM 断言层。
 *
 * 向指定 LLM 提交页面状态文本，询问"页面状态是否符合预期"，
 * 返回结构化断言结果（passed + reason）。
 *
 * 支持重试逻辑（与 CI 策略对齐：重试 ≥2 次，全部失败则阻断）。
 */

export interface AiAssertResult {
  reason: string;
}

export interface AiAssertOptions {
  /** 重试次数（默认 2） */
  retries?: number;
  /** 每次重试间隔 ms（默认 2000） */
  retryDelay?: number;
  /** LLM 请求超时 ms（默认 30_000） */
  timeout?: number;
  /** DeepSeek API base URL */
  baseURL?: string;
  /** 模型名称（默认 deepseek-v4-flash） */
  model?: string;
}

const DEEPSEEK_BASE = "https://api.deepseek.com";

/**
 * 向 DeepSeek Flash 发送页面状态并获取断言结果。
 */
async function queryLlmForAssertion(
  stepDescription: string,
  pageState: string,
  options: Required<AiAssertOptions>,
): Promise<AiAssertResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { passed: false, reason: "DEEPSEEK_API_KEY 未设置，无法执行 AI 断言" };
  }

  const prompt = `你是一个 Web 应用 E2E 测试断言助手。你的任务是判断页面状态是否符合预期。

## 当前测试步骤描述
${stepDescription}

## 页面当前状态（文本 DOM + 交互元素树）
${pageState}

## 判断标准
请根据以下标准判断页面状态是否正常：
1. 页面是否正常加载（没有白屏、没有错误提示）
2. 页面是否包含预期的内容元素
3. 页面是否处于正确的路由/状态
4. 是否有明显的 UI 异常

## 输出格式
请严格按以下 JSON 格式输出，不要包含其他内容：
{
  "passed": true 或 false,
  "reason": "简要说明判断理由（中文），如果失败请指出具体问题"
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);

  try {
    const response = await fetch(`${options.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: "system",
            content:
              "你是一个严格的 Web 应用 E2E 测试断言助手。请基于页面文本状态判断页面是否正常。请始终以 JSON 格式输出。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        passed: false,
        reason: `LLM API 请求失败: HTTP ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";

    // 尝试解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/u);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as AiAssertResult;
      } catch {
        // fall through
      }
    }

    // 无法解析 JSON，回退到文本判断
    const passed = !/失败|错误|异常|没有|缺少|白屏/u.test(content);
    return { passed, reason: content };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { passed: false, reason: `LLM 调用异常: ${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 执行 AI 断言。
 *
 * @param stepDescription - 当前步骤的描述（如"登录成功后跳转到推荐 Feed"）
 * @param pageState - 页面当前状态文本（snapshot 输出或 innerText）
 * @param options - 可选配置
 * @returns 断言结果
 */
export async function aiAssert(
  stepDescription: string,
  pageState: string,
  options: AiAssertOptions = {},
): Promise<AiAssertResult> {
  const opts: Required<AiAssertOptions> = {
    retries: options.retries ?? 2,
    retryDelay: options.retryDelay ?? 2_000,
    timeout: options.timeout ?? 30_000,
    baseURL: options.baseURL ?? DEEPSEEK_BASE,
    model: options.model ?? "deepseek-v4-flash",
  };

  let lastResult: AiAssertResult = { passed: false, reason: "未执行" };

  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    console.log(`[AI断言] 第 ${attempt}/${opts.retries} 次尝试: ${stepDescription}`);
    lastResult = await queryLlmForAssertion(stepDescription, pageState, opts);

    if (lastResult.passed) {
      console.log(`[AI断言] ✅ 通过: ${lastResult.reason}`);
      return lastResult;
    }

    console.warn(`[AI断言] ❌ 失败: ${lastResult.reason}`);
    if (attempt < opts.retries) {
      console.log(`[AI断言] 等待 ${opts.retryDelay}ms 后重试...`);
      await new Promise((r) => setTimeout(r, opts.retryDelay));
    }
  }

  return lastResult;
}
