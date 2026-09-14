// 期望值出处：zh-CN.ts / en.ts 字典字面量（真实样例，非实现推导）——抽取原型 #496 的行为锚。
// SolidJS 2 批处理语义（registry #415 注释）：settings handle 的 set 在无 flush 时同步读不可见，
// 断言前必须 flush 微任务（solidjs2-authoring-gotchas 先例）。
import { describe, expect, it, vi } from "vitest";
import { currentLocale, isFollowingSystem, setLanguage, t } from "@/i18n";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("i18n 原型（@solid-primitives/i18n）", () => {
  it("显式切回 zh-CN 后输出源语言文案", async () => {
    setLanguage("zh-CN");
    await flush();
    expect(t("error.action.retry")).toBe("重试");
    expect(t("error.hint.unauthorized")).toBe("登录已过期，需要重新登录");
    expect(currentLocale()).toBe("zh-CN");
  });

  it("切 en 后动态 chunk 就绪即输出英文（per-locale chunk 实证）", async () => {
    setLanguage("en");
    await vi.waitFor(() => {
      expect(t("error.action.retry")).toBe("Retry");
    });
    expect(t("error.hint.proxy")).toBe("Make sure the local proxy 127.0.0.1:10808 is running");
    expect(currentLocale()).toBe("en");
  });

  it("回切 zh-CN 立即生效（源语言静态内联，无 pending 窗口）", async () => {
    setLanguage("zh-CN");
    await flush();
    expect(t("error.action.retry")).toBe("重试");
    expect(t("settings.appearance.language")).toBe("语言");
  });

  it("跟随系统态：setLanguage 空串后 isFollowingSystem 为真（设置页入口选中态，#511）", async () => {
    setLanguage("en");
    await flush();
    expect(isFollowingSystem()).toBe(false);
    setLanguage("");
    await flush();
    expect(isFollowingSystem()).toBe(true);
  });

  it("缺 key 防御：warn 且回退 key 本身（禁静默降级——类型外运行时防御路径）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error 故意传不存在的 key 走运行时防御分支
    expect(t("nonexistent.key" as never)).toBe("nonexistent.key");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
