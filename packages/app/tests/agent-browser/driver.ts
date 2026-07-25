/**
 * Agent-browser Driver
 *
 * 封装 agent-browser CLI 调用，提供 TypeScript API 供测试使用。
 * 遵循官方推荐做法：通过 CLI 命令操作浏览器。
 *
 * 核心设计原则：每次交互前都获取新 snapshot，避免 @e ref 过期。
 */

import { execSync, type ExecSyncOptions } from "node:child_process";

const BASE_URL = "http://localhost:5173";
const SNAPSHOT_FLAGS = "-i";

const EXEC_OPTIONS: ExecSyncOptions = {
  encoding: "utf-8",
  timeout: 30_000,
  shell: true,
};

// ─── 底层 CLI 调用 ─────────────────────────────────

function ab(...args: string[]): string {
  const cmd = `agent-browser ${args.join(" ")}`;
  console.log(`[agent-browser] ${cmd}`);
  return execSync(cmd, EXEC_OPTIONS).trim();
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

/**
 * 从 snapshot 中获取第一个可点击元素的 ref。
 */
function firstClickableRef(snapshot: string): string | null {
  const refMatch = snapshot.match(/ref=(e\d+)/u);
  return refMatch ? refMatch[1] : null;
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
   * 带 fallback 链的可靠点击：@e ref → aria-label → 直接 text → CSS。
   */
  async clickReliable(
    text: string,
    ariaLabel?: string,
    cssFallback?: string,
  ): Promise<boolean> {
    // 1. 尝试 @e ref
    const snap = await this.snapshot();
    const ref = findRefByText(snap, text);
    if (ref) {
      await this.click(`@${ref}`);
      return true;
    }

    // 2. 尝试 aria-label
    const label = ariaLabel || text;
    try {
      await this.click(`[aria-label*="${label}"]`);
      return true;
    } catch { /* 继续 */ }

    // 3. 尝试直接文本点击
    try {
      await this.click(text);
      return true;
    } catch { /* 继续 */ }

    // 4. CSS fallback
    if (cssFallback) {
      try {
        await this.click(cssFallback);
        return true;
      } catch { /* 继续 */ }
    }

    return false;
  }

  /**
   * 点击第一个可交互元素（用于点卡片等通用操作）。
   */
  async clickFirst(): Promise<boolean> {
    const snap = await this.snapshot();
    const ref = firstClickableRef(snap);
    if (ref) {
      await this.click(`@${ref}`);
      return true;
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
    return ab("eval", `"${js.replace(/"/g, '\\"')}"`);
  }

  async pageText(): Promise<string> {
    return ab("eval", '"document.body.innerText"');
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
