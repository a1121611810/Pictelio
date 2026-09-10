import { describe, it, expect } from "vitest";
import { isValidHomeTab } from "@/components/home/SideNavShell";

/**
 * isValidHomeTab 纯函数契约（spec #422 D1）
 *
 * oracle 溯源：
 * - 4 个合法 HomeTab 来自 SideNavShell.tsx:39 类型定义
 *   `type HomeTab = "recommended" | "follow" | "bookmarks" | "history"`
 * - 非法 "me" 来自 uiStore.ts:4 类型 `Tab = ... | "me" | ...`
 *   PersonalCenter 用 setCurrentTab("me") 时必须被守卫拦截
 *   （src/routes/PersonalCenter.tsx:57）
 *
 * 本测试是 spec #422 D1「非法 HomeTab 跳过逻辑（可抽成 isValidHomeTab 纯函数 +
 * 单测）」的可测锚定——若 uiStore.Tab 增减或 HomeTab 重命名，本测试红，
 * 与 SideNavShell 的内联守卫两处形成漂移防线。
 */
describe("isValidHomeTab（SideNavShell HomeTab 白名单守卫）", () => {
  it("4 个合法 HomeTab：recommended / follow / bookmarks / history", () => {
    expect(isValidHomeTab("recommended")).toBe(true);
    expect(isValidHomeTab("follow")).toBe(true);
    expect(isValidHomeTab("bookmarks")).toBe(true);
    expect(isValidHomeTab("history")).toBe(true);
  });

  it("非法值 'me'（PersonalCenter 专用）被拦截", () => {
    expect(isValidHomeTab("me")).toBe(false);
  });

  it("其他非法值：空串、未知字符串、大小写敏感", () => {
    expect(isValidHomeTab("")).toBe(false);
    expect(isValidHomeTab("unknown")).toBe(false);
    expect(isValidHomeTab("Recommended")).toBe(false); // 大小写敏感
    expect(isValidHomeTab("RECOMMENDED")).toBe(false);
  });

  it("ts 类型守卫：合法值通过后 typeof 收窄为 HomeTab", () => {
    const input: string = "follow";
    if (isValidHomeTab(input)) {
      // 编译期确认收窄；运行期无作用
      const narrowed: "recommended" | "follow" | "bookmarks" | "history" = input;
      expect(narrowed).toBe("follow");
    } else {
      throw new Error("isValidHomeTab 应当对 'follow' 返回 true");
    }
  });
});
