// @vitest-environment happy-dom
/**
 * StartupUpdateDialog 更新弹窗单元测试。
 *
 * 通过 vi.mock 隔离 settingsStore（信号全部桩化），验证 ADR-0068 的尺寸/滚动布局：
 * ① 弹窗卡片 max-h-[85vh] + 宽度约束保留；
 * ② changelog 区 flex-1 min-h-0 overflow-y-auto（独立滚动）；
 * ③ 标题/正文/按钮 flex-shrink-0（弹窗达上限后始终可见）。
 * 同时验证「稍后再说」点击行为不变（dismiss）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "solid-js/web";
import StartupUpdateDialog from "@/components/StartupUpdateDialog";

vi.mock("@/stores/settingsStore", () => ({
  showUpdateDialog: vi.fn(() => true),
  setShowUpdateDialog: vi.fn(),
  latestVersion: vi.fn(() => "3.21.2"),
  latestReleaseUrl: vi.fn(() => "https://example.com/releases/3.21.2"),
  latestChangelog: vi.fn(() => "• 新增功能 A\n• 修复问题 B"),
  setLastDismissedVersion: vi.fn(),
  hasUpdate: vi.fn(() => true),
  checkCompleted: vi.fn(() => true),
  lastDismissedVersion: vi.fn(() => ""),
}));

import { setShowUpdateDialog, setLastDismissedVersion } from "@/stores/settingsStore";

/** 遍历 container 内所有元素，返回 class 同时包含全部 token 的第一个元素 */
function findByClasses(container: HTMLElement, ...tokens: string[]): HTMLElement | null {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
    const cls = el.getAttribute("class") ?? "";
    if (tokens.every((t) => cls.split(/\s+/).includes(t))) return el;
  }
  return null;
}

function classTokens(el: HTMLElement | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("StartupUpdateDialog（ADR-0068 尺寸与滚动）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("弹窗卡片含 max-h-[85vh]，宽度约束 min(85vw,360px) 保留", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <StartupUpdateDialog />, container);

    const card = findByClasses(container, "max-h-[85vh]");
    expect(card, "应存在带 max-h-[85vh] 的弹窗卡片").toBeTruthy();
    expect(classTokens(card)).toContain("w-[min(85vw,360px)]");
    expect(classTokens(card)).toContain("flex");
    expect(classTokens(card)).toContain("flex-col");

    dispose();
    container.remove();
  });

  it("changelog 区含 flex-1 min-h-0 overflow-y-auto（占剩余空间独立滚动）且保留 thin 滚动条", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <StartupUpdateDialog />, container);

    const changelog = findByClasses(container, "overflow-y-auto", "whitespace-pre-wrap");
    expect(changelog, "应存在 changelog 滚动区").toBeTruthy();
    expect(classTokens(changelog)).toContain("flex-1");
    expect(classTokens(changelog)).toContain("min-h-0");
    expect(classTokens(changelog)).toContain("overflow-y-auto");
    // 原 max-h-[25vh] 应移除
    expect(classTokens(changelog)).not.toContain("max-h-[25vh]");
    // 滚动条保持 thin（系统默认基础上收窄）
    expect(changelog?.getAttribute("style")).toContain("scrollbar-width");

    dispose();
    container.remove();
  });

  it("标题/正文/按钮区均含 flex-shrink-0（弹窗达上限后始终可见）", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <StartupUpdateDialog />, container);

    // 标题区：标题 h2 的直接父容器
    const title = container.querySelector("h2");
    expect(title?.parentElement).toBeTruthy();
    expect(classTokens(title?.parentElement ?? null)).toContain("flex-shrink-0");

    // 正文区：正文 p 的直接父容器
    const body = container.querySelector("p.m-0");
    expect(body?.parentElement).toBeTruthy();
    expect(classTokens(body?.parentElement ?? null)).toContain("flex-shrink-0");

    // 按钮区：含「稍后再说」按钮的按钮容器
    const laterBtn = [...container.querySelectorAll("fluent-button")].find((b) =>
      b.textContent?.includes("稍后再说"),
    );
    expect(laterBtn?.parentElement).toBeTruthy();
    expect(classTokens(laterBtn?.parentElement ?? null)).toContain("flex-shrink-0");

    dispose();
    container.remove();
  });

  it("点击「稍后再说」仍执行 dismiss（记录版本 + 关闭弹窗），行为不变", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <StartupUpdateDialog />, container);

    const laterBtn = [...container.querySelectorAll("fluent-button")].find((b) =>
      b.textContent?.includes("稍后再说"),
    );
    laterBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(setLastDismissedVersion).toHaveBeenCalledWith("3.21.2");
    expect(setShowUpdateDialog).toHaveBeenCalledWith(false);

    dispose();
    container.remove();
  });
});
