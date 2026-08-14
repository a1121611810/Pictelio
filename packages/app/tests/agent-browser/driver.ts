/**
 * Agent-browser Driver
 *
 * 封装 agent-browser CLI 调用，提供 TypeScript API 供测试使用。
 * 遵循官方推荐做法：通过 CLI 命令操作浏览器。
 *
 * 核心设计原则：每次交互前都获取新 snapshot，避免 @e ref 过期。
 */

import { spawnSync } from "node:child_process";

const BASE_URL = "http://localhost:5173";
const SNAPSHOT_FLAGS = "-i";

const SPAWN_TIMEOUT = 30_000;

// ─── 底层 CLI 调用 ─────────────────────────────────

// 日志脱敏：refresh_token 等凭证是 ≥16 位的 [A-Za-z0-9_-] 长字符串。
// fixtures 会把 PIXIV_REFRESH_TOKEN 内联进 evaluate JS，若日志打印完整参数会泄漏明文凭证，
// 因此在输出前将所有符合该形态的长串替换为 "***"（仅影响日志，不影响实际执行的参数）。
const SECRET_LIKE_PATTERN = /[A-Za-z0-9_-]{16,}/gu;

function redactSecrets(text: string): string {
  return text.replace(SECRET_LIKE_PATTERN, "***");
}

function ab(...args: string[]): string {
  console.log(`[agent-browser] agent-browser ${redactSecrets(args.join(" "))}`);
  const result = spawnSync("agent-browser", args, {
    encoding: "utf-8",
    timeout: SPAWN_TIMEOUT,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `agent-browser exited code ${result.status}: ${(result.stderr ?? "").trim() || (result.stdout ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

// ─── batch 调用（D 方向：合并多次 spawn，消除 per-command 进程启动开销） ───

/**
 * batch 单命令结果（逐命令恢复后的结构化形式）。
 * 对应 CLI stdout JSON 数组元素：
 * `{"command":[...],"error":null,"result":{"result":"...","snapshot":"..."},"success":true}`
 */
export interface BatchResult {
  /** 原始命令 argv（如 `["eval","document.title"]` / `["snapshot","-i"]`） */
  command: string[];
  /** 该命令是否成功。batch 逐命令语义：整批 exit 1 ≠ 全部失败，必须看这个字段 */
  success: boolean;
  /**
   * 命令输出：eval 命令为 JSON 编码的返回值（`result.result`），
   * snapshot 命令为 a11y 树文本（`result.snapshot`），其余命令可能为 null。
   */
  output: string | null;
  /** 失败时的错误消息；成功为 null */
  error: string | null;
}

/** CLI `batch --json` 的原始输出结构（仅声明 driver 依赖的字段，其余忽略） */
interface RawBatchEntry {
  command?: unknown;
  success?: unknown;
  error?: unknown;
  result?: {
    result?: unknown;
    snapshot?: unknown;
  } | null;
}

// batch 内命令在同一已连接会话内顺序执行，总超时按命令数线性放大
//（单命令沿用独立调用的 30s 上限；5 命令探测批 = 150s 兜底，正常实测 <1s）。
const BATCH_TIMEOUT_PER_COMMAND = 30_000;

// D 报告 3.5 节硬约束：spawnSync 默认 maxBuffer=1MB，实测 150 命令 batch 输出 4.38MB
// 会被静默截断导致 JSON 解析失败。取 16MB（约为全量实测的 3.7 倍余量）。
// 调用方仍须按输出体积分批：单批预算 ≤1MB（约 ≤15 个 snapshot 或 ≤100 个 eval）。
const BATCH_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * 一次进程调用顺序执行多条 agent-browser 命令（D 方向：消除 per-command spawn 开销，
 * 实测纯 eval 序列 41.2ms/命令 → 1.7ms/命令）。
 *
 * 硬约束实现要点（D 报告第 3 节，违反即错误）：
 * 1. **必须 stdin JSON 模式**（`batch --json` + stdin 传 JSON 数组）：参数模式会把命令
 *    字符串二次解析，带引号的 JS（如 `document.querySelector('h1')`）被破坏成
 *    `querySelector(h1)` 抛 ReferenceError；stdin JSON 模式引号/中文/换行全保真。
 * 2. **maxBuffer 16MB**：默认 1MB 在大 batch 下被截断（见 BATCH_MAX_BUFFER 注释）。
 * 3. **逐命令错误恢复**：任一命令失败 → CLI 整体 exit 1、stderr 为空、错误在 stdout
 *    JSON 的 `error` 字段。因此**不能**复用 ab() 的 `status !== 0 即抛`——那会把整批
 *    误判失败并丢失同批成功命令的结果。这里解析 stdout JSON、按 `success` 逐命令检查，
 *    收集所有失败后抛出一条汇总 Error（保留"失败即抛"语义，失败绝不静默降级）。
 *
 * 表达能力限制（D 报告 4.2）：batch 是固定序列，**无法表达条件分支/轮询循环**，
 * 调用方需自行做"探测→决策"两段式拆分。
 *
 * @param commands - 命令数组，每个元素是一条完整命令的 argv（如 `["eval", js]`、`["snapshot", "-i"]`）
 * @returns 与 commands 等长、按序对应的结果数组
 * @throws 任一命令失败（消息汇总全部失败命令），或进程级失败 / 输出缺失 / JSON 不可解析
 */
export function abBatch(commands: string[][]): BatchResult[] {
  if (commands.length === 0) return [];
  console.log(
    `[agent-browser] agent-browser batch --json（stdin JSON，${commands.length} 条命令）`,
  );
  for (const cmd of commands) {
    console.log(`[agent-browser]   ├ ${redactSecrets(cmd.join(" "))}`);
  }
  const result = spawnSync("agent-browser", ["batch", "--json"], {
    input: JSON.stringify(commands),
    encoding: "utf-8",
    timeout: BATCH_TIMEOUT_PER_COMMAND * commands.length,
    maxBuffer: BATCH_MAX_BUFFER,
    shell: false,
  });
  if (result.error) throw result.error;
  const stdout = (result.stdout ?? "").trim();
  // 注意：status !== 0 只说明"至少一条命令失败"，不代表进程级失败。
  // 进程级失败的判定 = stdout 为空或不可解析。
  if (!stdout) {
    throw new Error(
      `agent-browser batch 无输出（exit ${result.status}）: ${redactSecrets((result.stderr ?? "").trim())}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `agent-browser batch 输出不是合法 JSON（exit ${result.status}）: ` +
        `${err instanceof Error ? err.message : String(err)}; ` +
        `stdout 前 200 字符: ${redactSecrets(stdout.slice(0, 200))}`,
      { cause: err },
    );
  }
  if (!Array.isArray(raw) || raw.length !== commands.length) {
    throw new Error(
      `agent-browser batch 输出条数与请求不符（期望 ${commands.length} 条）: ` +
        redactSecrets(stdout.slice(0, 200)),
    );
  }
  const results: BatchResult[] = (raw as RawBatchEntry[]).map((entry, i) => {
    const command = Array.isArray(entry.command) ? entry.command.map(String) : commands[i];
    const success = entry.success === true;
    const error = typeof entry.error === "string" ? entry.error : null;
    const evalOutput = typeof entry.result?.result === "string" ? entry.result.result : null;
    const snapshotOutput =
      typeof entry.result?.snapshot === "string" ? entry.result.snapshot : null;
    return { command, success, output: evalOutput ?? snapshotOutput, error };
  });
  // 逐命令错误恢复：收集全部失败后一次抛出（等价 ab() 的"失败即抛"，且保留全部失败诊断）。
  // 调用方需要容错时应自行 catch（如 clickReliable 探测失败回退串行路径，且必须打日志）。
  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    const detail = failures
      .map((f) => `[${f.command.join(" ")}] ${f.error ?? "未知错误"}`)
      .join("；");
    throw new Error(
      redactSecrets(
        `agent-browser batch ${failures.length}/${results.length} 条命令失败: ${detail}`,
      ),
    );
  }
  return results;
}

// ─── 工具函数（导出以便 fixture 使用） ─────────────

/**
 * 从 accessibility snapshot 中提取指定文本对应的 @e ref。
 */
export function findRefByText(snapshot: string, text: string): string | null {
  const lines = snapshot.split("\n");
  for (const line of lines) {
    if (line.includes(text)) {
      const refMatch = line.match(/ref=(e\d+)/u);
      if (refMatch) return refMatch[1];
    }
  }
  return null;
}

// ─── Driver 类 ──────────────────────────────────────

export class AgentBrowserDriver {
  private sessionActive = false;

  async launch(): Promise<void> {
    ab("open", BASE_URL);
    this.sessionActive = true;
    console.log("[agent-browser] 浏览器已启动");
  }

  async navigate(path: string): Promise<void> {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    ab("open", url);
  }

  /**
   * SPA 内部导航：pushState + popstate，由 TanStack Router 处理。
   *
   * 与 navigate()（整页 open）的区别：整页加载会重跑 startup 流程，
   * 被 __root.tsx 的启动导航强制覆盖（如 navigate("/debug") 会跳回 /home）。
   * SPA 导航不重跑 startup，可直达任意路由。
   */
  async navigateSpa(path: string): Promise<void> {
    await this.evaluate(
      `window.history.pushState({}, '', ${JSON.stringify(path)}); ` +
        `window.dispatchEvent(new PopStateEvent('popstate')); 'pushed'`,
    );
  }

  /**
   * 等待页面渲染出实质内容（pageText 非空）。
   *
   * 用途：路由切换/数据加载期间页面可能短暂空白（白屏竞态），
   * AI 断言此时执行会误报"页面文本为空"。等待内容出现后再断言。
   */
  async waitForPageContent(timeoutMs = 10_000, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const text = await this.pageText();
        if (text.trim().length > 20) return true;
      } catch {
        /* 继续等待 */
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  /**
   * 等待指定 CSS 选择器对应的元素出现在 DOM 中。
   *
   * 用途：tab 切换/数据加载后组件尚未渲染时，避免"找不到卡片"类误报。
   */
  async waitForSelector(selector: string, timeoutMs = 10_000, intervalMs = 500): Promise<boolean> {
    return this.waitForProbe(
      "document.querySelector(" + JSON.stringify(selector) + ") !== null",
      timeoutMs,
      intervalMs,
    );
  }

  /**
   * 条件等待核心：轮询 evaluate 返回的谓词值，直到命中或超时。
   *
   * B 方向（固定 SLEEP → 条件等待）的基础原语。轮询用 evaluate（~45ms/次、
   * 返回 ~10B）而非 snapshot（~42ms/次、返回 ~100KB），负载差 3~4 个数量级
   * （B 报告 S9 实测）。interval 默认 500ms（B 报告 S11：间隔只影响尾延迟上限，
   * 条件已满足时 1 轮即返回；300ms 与 500ms 差异在噪声内）。
   *
   * @param probe - 返回浏览器内布尔/真值 JSON 的 JS 表达式（单行，agent-browser eval 约束）
   * @param timeoutMs - 超时上限（兜底，条件永不满足时返回 false，不悬挂）
   */
  private async waitForProbe(probe: string, timeoutMs: number, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await this.evaluate(probe);
        if (result.includes("true") || result.includes("yes") || result.includes("1")) return true;
      } catch {
        /* 页面未就绪或 eval 失败，继续等待 */
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    return false;
  }

  /**
   * 等待 URL 包含指定片段（路由变化的可靠信号）。
   * 轮询 evaluate location.pathname，超时返回 false。
   */
  async waitForUrl(fragment: string, timeoutMs = 10_000, intervalMs = 500): Promise<boolean> {
    return this.waitForProbe(
      "location.pathname.includes(" + JSON.stringify(fragment) + ")",
      timeoutMs,
      intervalMs,
    );
  }

  /**
   * 等待页面文本包含指定内容（数据加载完成、弹窗出现等）。
   * 例：await driver.waitForText("发现新版本") 等更新弹窗。
   */
  async waitForText(text: string, timeoutMs = 10_000, intervalMs = 500): Promise<boolean> {
    return this.waitForProbe(
      "document.body.innerText.includes(" + JSON.stringify(text) + ")",
      timeoutMs,
      intervalMs,
    );
  }

  /**
   * 等待 DOM 中匹配选择器的元素数量 ≥ count（分页加载、列表增长等）。
   * 例：await driver.waitForCount('[data-testid="illust-card"]', 2) 等第二张卡片。
   */
  async waitForCount(
    selector: string,
    count: number,
    timeoutMs = 10_000,
    intervalMs = 500,
  ): Promise<boolean> {
    return this.waitForProbe(
      "document.querySelectorAll(" + JSON.stringify(selector) + ").length >= " + count,
      timeoutMs,
      intervalMs,
    );
  }

  /**
   * 等待自定义 JS 谓词为真（scrollY、aria-pressed 等无选择器可表达的语义）。
   * 例：await driver.waitForJs("window.scrollY === 0") 等回顶完成。
   */
  async waitForJs(predicate: string, timeoutMs = 10_000, intervalMs = 500): Promise<boolean> {
    return this.waitForProbe("(" + predicate + ")", timeoutMs, intervalMs);
  }

  /**
   * 获取当前页面的 accessibility tree 快照。
   * AI 断言的主要输入源。
   */
  async snapshot(): Promise<string> {
    return ab("snapshot", SNAPSHOT_FLAGS);
  }

  /**
   * 通过 @e ref 点击（最可靠的方式）。
   */
  async click(selector: string): Promise<void> {
    // 用 JSON.stringify 包裹：选择器可能含双引号（如 nav[aria-label="主导航"]），
    // 模板字符串 `"${selector}"` 会产生引号嵌套破坏导致 CLI 参数非法。
    ab("click", JSON.stringify(selector));
  }

  /**
   * 核心：智能点击。
   *
   * 优先级：@e ref（从最新 snapshot 获取）> aria-label > CSS 选择器
   * 每次调用都会获取新 snapshot，避免 ref 过期。
   *
   * @param text - 按钮/链接上的文本
   * @returns 是否成功点击
   */
  async clickByText(text: string): Promise<boolean> {
    const snap = await this.snapshot();
    const ref = findRefByText(snap, text);
    if (ref) {
      await this.click(`@${ref}`);
      return true;
    }
    return false;
  }

  // ── clickReliable 注入 JS 构造器（探测路径与串行兜底路径共用，防止两处漂移） ──

  /** 步骤 0：scope 容器内精确点击（探测+点击原子执行，消除同文本多元素歧义） */
  private jsScopeClick(scopeSelector: string, text: string): string {
    return `(() => {
          const root = document.querySelector(${JSON.stringify(scopeSelector)});
          if (!root) return 'no-scope';
          const btn = [...root.querySelectorAll('button, fluent-button, fluent-switch, [role="button"], [role="switch"]')]
            .find((el) => el.textContent && el.textContent.includes(${JSON.stringify(text)}));
          if (btn) { btn.click(); return 'clicked'; }
          return 'not-found';
        })()`;
  }

  /** 步骤 2：aria-label 精确点击（选择器含双引号时 CLI click 参数会被破坏，用 evaluate） */
  private jsAriaClick(label: string): string {
    return `(() => {
          const el = document.querySelector(${JSON.stringify(`[aria-label*="${label}"]`)});
          if (el) { el.click(); return 'clicked'; }
          return 'not-found';
        })()`;
  }

  /** 步骤 4：CSS 选择器精确点击（选择器可能含双引号，evaluate 的 JSON.stringify 转义最可靠） */
  private jsCssClick(cssSelector: string): string {
    return `(() => {
            const el = document.querySelector(${JSON.stringify(cssSelector)});
            if (el) { el.click(); return 'clicked'; }
            return 'not-found';
          })()`;
  }

  /** 步骤 5：按文本查找按钮并注入 el.click()（fluent-button 自定义元素的 CLI click 不可靠） */
  private jsTextClick(text: string): string {
    return `(() => {
        const btn = [...document.querySelectorAll('button, fluent-button, [role="button"]')]
          .find((el) => el.textContent && el.textContent.includes(${JSON.stringify(text)}));
        if (btn) { btn.click(); return 'clicked'; }
        return 'not-found';
      })()`;
  }

  /**
   * 带 fallback 链的可靠点击：@e ref → aria-label → 直接 text → CSS → evaluate 注入。
   *
   * D 方向曾尝试"探测→决策两段式"（probeClickTargets + clickWithProbe），实测回归：
   * @e ref 点击对 fluent-button 返回成功但页面无响应，且 textHit 探测结果过期会跳过
   * 可靠的 evaluate 注入路径（登录按钮点击失效，全量 8 用例失败）。已回退为无条件
   * 串行链（B 方向 45/45 通过时的行为），保留 js*Click 共享构造器与 abBatch 工具。
   *
   * @param text - 目标文本
   * @param ariaLabel - aria-label 匹配（可选）
   * @param cssFallback - CSS 选择器（可选）
   * @param scopeSelector - 限定查找范围（可选）。页面存在同文本多元素时
   *   （如底部导航"关注" vs 卡片"关注"按钮），用 scope 消除歧义。
   */
  async clickReliable(
    text: string,
    ariaLabel?: string,
    cssFallback?: string,
    scopeSelector?: string,
  ): Promise<boolean> {
    // 0. scope 定位优先：在指定容器内用 evaluate 精确点击（消除文本歧义）
    if (scopeSelector) {
      const scoped = await this.evaluate(this.jsScopeClick(scopeSelector, text));
      if (scoped.includes("clicked")) return true;
      if (scoped.includes("no-scope")) {
        console.log(`[driver] scope ${scopeSelector} 不存在，继续 fallback`);
      }
    }

    // 1. 尝试 @e ref
    const snap = await this.snapshot();
    const ref = findRefByText(snap, text);
    if (ref) {
      try {
        await this.click(`@${ref}`);
        return true;
      } catch {
        console.log(`[driver] @${ref} 点击失败，尝试 fallback`);
      }
    }

    // 2. 尝试 aria-label（用 evaluate 精确点击：选择器含双引号时 CLI click 参数会被破坏）
    const label = ariaLabel || text;
    try {
      const r2 = await this.evaluate(this.jsAriaClick(label));
      if (r2.includes("clicked")) return true;
    } catch {
      /* 继续 */
    }

    // 3. 尝试直接文本点击
    try {
      await this.click(text);
      return true;
    } catch {
      /* 继续 */
    }

    // 4. CSS fallback（用 evaluate 精确点击：CSS 选择器可能含双引号）
    if (cssFallback) {
      try {
        const r4 = await this.evaluate(this.jsCssClick(cssFallback));
        if (r4.includes("clicked")) return true;
      } catch {
        /* 继续 */
      }
    }

    // 5. evaluate 注入 el.click()：fluent-button 自定义元素的 CLI click 不可靠
    try {
      const result = await this.evaluate(this.jsTextClick(text));
      if (JSON.parse(result) === "clicked") return true;
    } catch {
      /* 继续 */
    }

    return false;
  }

  /**
   * 点击第一个可交互元素（用于点卡片等通用操作）。
   */
  async clickFirst(skipCount = 6): Promise<boolean> {
    // 1. 尝试 CSS 选择器（不受 snapshot ref 过期影响）。
    //    主 Feed 为 L5 单列 IllustSingleCard（ADR-0075），无 .image-card class，
    //    用 S4 补充的 data-testid="illust-card" 稳定定位（ImageCard 瀑布流同用）。
    try {
      await this.click('[data-testid="illust-card"]');
      return true;
    } catch {
      /* fall through */
    }

    // 2. snapshot ref + 重试（处理页面重新渲染导致 ref 过期）
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await this.snapshot();
      const matches = [...snap.matchAll(/ref=(e\d+)/gu)];
      const idx = Math.min(skipCount, matches.length - 1);
      if (matches[idx]) {
        try {
          await this.click(`@${matches[idx][1]}`);
          return true;
        } catch {
          // ref 过期，重试
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // 3. evaluate 注入 el.click()：模拟点击受视口/遮挡影响，
    //    注入点击无视视口位置，卡片在视口外也能触发
    try {
      const r = await this.evaluate(
        `(() => {
          const el = document.querySelector('[data-testid="illust-card"]');
          if (el) { el.click(); return 'clicked'; }
          return 'not-found';
        })()`,
      );
      if (r.includes("clicked")) return true;
    } catch {
      /* fall through */
    }

    return false;
  }

  async fill(selector: string, text: string): Promise<void> {
    ab("fill", `"${selector}"`, `"${text}"`);
  }

  async scroll(direction: "down" | "up", pixels?: number): Promise<void> {
    const args = ["scroll", direction];
    if (pixels) args.push(String(pixels));
    ab(...args);
  }

  async evaluate(js: string): Promise<string> {
    // agent-browser CLI 直接执行 js 表达式并 JSON.stringify 输出。
    // 不能额外包引号——否则表达式变成字符串字面量，不会执行。
    return ab("eval", js);
  }

  /**
   * 注入页面级 fetch mock：拦截 URL 包含指定片段的请求，返回固定 JSON。
   * 其他请求透传原生 fetch。多次调用会**累积**规则（每次调用不覆盖前一次的拦截）。
   * 用于构造 E2E 无法自然到达的状态（如更新弹窗）。
   * 注意：页面导航（navigate/open）会清空注入，须在导航完成后注入；
   * 注入 JS 必须为单行（agent-browser CLI 不支持多行参数）。
   */
  async mockFetch(urlContains: string, responseJson: string): Promise<void> {
    // 用 JSON.stringify 生成 JS 字符串字面量：正确处理反斜杠/引号/换行转义，
    // 避免注入路径二次解释（如 JSON 里的 \n 被浏览器当成真实换行导致 JSON 非法）
    const patternLiteral = JSON.stringify(urlContains);
    const bodyLiteral = JSON.stringify(responseJson);
    const js =
      `(() => { if (!window.__originalFetch) window.__originalFetch = window.fetch.bind(window); ` +
      `window.__mockRules = window.__mockRules || []; ` +
      `window.__mockRules.push({ pattern: ${patternLiteral}, body: ${bodyLiteral} }); ` +
      `window.fetch = (input, init) => { ` +
      `const url = typeof input === 'string' ? input : input.url; ` +
      `const rule = window.__mockRules.find(r => url.indexOf(r.pattern) !== -1); ` +
      `if (rule) { ` +
      `return Promise.resolve(new Response(rule.body, { status: 200, headers: { 'Content-Type': 'application/json' } })); } ` +
      `return window.__originalFetch(input, init); }; return 'ok'; })()`;
    await this.evaluate(js);
  }

  /**
   * 注入 window.open spy：记录所有调用 URL，供断言"跳转是否真实发生"。
   * 防止 window.open 真的打开新标签页干扰测试。
   */
  async spyOnWindowOpen(): Promise<void> {
    const js =
      `(() => { window.__openCalls = []; ` +
      `window.__originalOpen = window.open.bind(window); ` +
      `window.open = function () { window.__openCalls.push(String(arguments[0])); return null; }; ` +
      `return 'ok'; })()`;
    await this.evaluate(js);
  }

  /**
   * 取回 window.open spy 记录的 URL 列表。
   */
  async getWindowOpenCalls(): Promise<string[]> {
    // 表达式直接返回数组（CLI 会 JSON.stringify 输出），不要再包一层 JSON.stringify
    const result = await this.evaluate("window.__openCalls || []");
    try {
      return JSON.parse(result) as string[];
    } catch {
      return [];
    }
  }

  async pageText(): Promise<string> {
    const result = await this.evaluate("document.body.innerText");
    try {
      return JSON.parse(result) as string;
    } catch {
      return result;
    }
  }

  /**
   * 获取指定 CSS 选择器匹配的第一个元素的属性值。
   * 用于精确 DOM 属性断言（如 aria-pressed、class 等）。
   * @param selector - CSS 选择器
   * @param attr - 属性名
   * @returns 属性值，元素不存在时返回 null 的字符串表示
   */
  async getAttribute(selector: string, attr: string): Promise<string | null> {
    const js = `(() => {
      const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      return el ? el.getAttribute('${attr}') : null;
    })()`;
    const result = await this.evaluate(js);
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed === null ? null : String(parsed);
    } catch {
      return result;
    }
  }

  /**
   * 获取指定 CSS 选择器匹配的第一个元素的计算样式值。
   * 用于精确样式断言（如 opacity、transition 等）。
   * @param selector - CSS 选择器
   * @param prop - CSS 属性名（驼峰命名，如 "opacity"、"transition"）
   * @returns 计算样式值字符串
   */
  async getComputedStyle(selector: string, prop: string): Promise<string | null> {
    const js = `(() => {
      const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      return el ? getComputedStyle(el).getPropertyValue('${prop}') : null;
    })()`;
    const result = await this.evaluate(js);
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed === null ? null : String(parsed);
    } catch {
      return result;
    }
  }

  async screenshot(path?: string): Promise<string> {
    const args = ["screenshot"];
    if (path) args.push(path);
    return ab(...args);
  }

  async close(): Promise<void> {
    if (this.sessionActive) {
      ab("close");
      this.sessionActive = false;
      console.log("[agent-browser] 浏览器已关闭");
    }
  }

  isActive(): boolean {
    return this.sessionActive;
  }
}
