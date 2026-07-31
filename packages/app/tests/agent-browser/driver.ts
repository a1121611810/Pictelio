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

function ab(...args: string[]): string {
  console.log(`[agent-browser] agent-browser ${args.join(" ")}`);
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
  async waitForPageContent(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const text = await this.pageText();
        if (text.trim().length > 20) return true;
      } catch {
        /* 继续等待 */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /**
   * 等待指定 CSS 选择器对应的元素出现在 DOM 中。
   *
   * 用途：tab 切换/数据加载后组件尚未渲染时，避免"找不到卡片"类误报。
   */
  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.evaluate(
        `document.querySelector(${JSON.stringify(selector)}) ? "yes" : "no"`,
      ).catch(() => "no");
      if (r.includes("yes")) return true;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return false;
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
    ab("click", `"${selector}"`);
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

  /**
   * 带 fallback 链的可靠点击：@e ref → aria-label → 直接 text → CSS → evaluate 注入。
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
      const scoped = await this.evaluate(
        `(() => {
          const root = document.querySelector(${JSON.stringify(scopeSelector)});
          if (!root) return 'no-scope';
          const btn = [...root.querySelectorAll('button, fluent-button, fluent-switch, [role="button"], [role="switch"]')]
            .find((el) => el.textContent && el.textContent.includes(${JSON.stringify(text)}));
          if (btn) { btn.click(); return 'clicked'; }
          return 'not-found';
        })()`,
      );
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

    // 2. 尝试 aria-label
    const label = ariaLabel || text;
    try {
      await this.click(`[aria-label*="${label}"]`);
      return true;
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

    // 4. CSS fallback
    if (cssFallback) {
      try {
        await this.click(cssFallback);
        return true;
      } catch {
        /* 继续 */
      }
    }

    // 5. evaluate 注入 el.click()：fluent-button 自定义元素的 CLI click 不可靠
    try {
      const js = `(() => {
        const btn = [...document.querySelectorAll('button, fluent-button, [role="button"]')]
          .find((el) => el.textContent && el.textContent.includes(${JSON.stringify(text)}));
        if (btn) { btn.click(); return 'clicked'; }
        return 'not-found';
      })()`;
      const result = await this.evaluate(js);
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
    // 1. 尝试 CSS 选择器（不受 snapshot ref 过期影响）
    try {
      await this.click(".image-card");
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
          const el = document.querySelector('.image-card');
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
