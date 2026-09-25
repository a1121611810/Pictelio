// ─── resolveNotificationTarget 纯函数测试（ADR-0188 D6 / spec 测试决策）───
// scheme 映射 oracle：ADR-0188 D6（pixiv://users|illusts|novels/{id} → 端内路由；
// http(s) → 系统浏览器；其它 scheme 静默忽略）。与 lynx 侧用例集逐字同构（differential）。
// 运行时跳转层（openNotificationTarget）打桩 window.open + navigate 注入隔离。
import { describe, expect, it, vi } from "vitest";
import { openNotificationTarget, resolveNotificationTarget } from "@/utils/notificationTarget";

describe("resolveNotificationTarget（pixiv:// 三 scheme + http(s) + 未知 scheme 忽略）", () => {
  it("pixiv://users/{id} → user 目标", () => {
    expect(resolveNotificationTarget("pixiv://users/100000000")).toEqual({
      kind: "user",
      id: 100000000,
    });
  });

  it("pixiv://illusts/{id} → illust 目标", () => {
    expect(resolveNotificationTarget("pixiv://illusts/12345")).toEqual({
      kind: "illust",
      id: 12345,
    });
  });

  it("pixiv://novels/{id} → novel 目标", () => {
    expect(resolveNotificationTarget("pixiv://novels/987654")).toEqual({
      kind: "novel",
      id: 987654,
    });
  });

  it("https:// → external（url 原样透传给系统浏览器通道）", () => {
    expect(resolveNotificationTarget("https://www.pixiv.net/announcement.php?p=1")).toEqual({
      kind: "external",
      url: "https://www.pixiv.net/announcement.php?p=1",
    });
  });

  it("http:// → external", () => {
    expect(resolveNotificationTarget("http://example.com/a")).toEqual({
      kind: "external",
      url: "http://example.com/a",
    });
  });

  it("未知 pixiv 主机段（pixiv://stickers/1）→ 忽略", () => {
    expect(resolveNotificationTarget("pixiv://stickers/1")).toEqual({ kind: "ignore" });
  });

  it("未知 scheme（pixiv-ish://、intent://）→ 忽略", () => {
    expect(resolveNotificationTarget("pixiv-ish://users/1")).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget("intent://x")).toEqual({ kind: "ignore" });
  });

  it("畸形：非数字 id / 无 id / 空主机段 → 忽略（fail-closed，不产生坏路由）", () => {
    expect(resolveNotificationTarget("pixiv://users/abc")).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget("pixiv://users/")).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget("pixiv://users")).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget("pixiv://")).toEqual({ kind: "ignore" });
  });

  it("id 带尾部 query/hash → 剥尾后仍可解析（服务端加参不破）", () => {
    expect(resolveNotificationTarget("pixiv://users/42?from=notif")).toEqual({
      kind: "user",
      id: 42,
    });
    expect(resolveNotificationTarget("pixiv://novels/42#top")).toEqual({ kind: "novel", id: 42 });
  });

  it("空串 / null / undefined → 忽略（target_url 宽容缺省）", () => {
    expect(resolveNotificationTarget("")).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget(null)).toEqual({ kind: "ignore" });
    expect(resolveNotificationTarget(undefined)).toEqual({ kind: "ignore" });
  });
});

describe("openNotificationTarget（运行时跳转层）", () => {
  it("三 scheme → 注入的 navigate 分别路由（webview 端内路径）", () => {
    const navigate = vi.fn();
    openNotificationTarget("pixiv://users/42", navigate);
    openNotificationTarget("pixiv://illusts/43", navigate);
    openNotificationTarget("pixiv://novels/44", navigate);
    expect(navigate.mock.calls.map((c) => c[0])).toEqual(["/user/42", "/illust/43", "/novel/44"]);
  });

  it("http(s) → window.open（noopener，webview 现有外链通道）", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    openNotificationTarget("https://www.pixiv.net/announcement.php?p=1", vi.fn());
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.pixiv.net/announcement.php?p=1",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("ignore（未知 scheme / 空值）→ 零跳转零外链（静默，不抛错）", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const navigate = vi.fn();
    openNotificationTarget("intent://x", navigate);
    openNotificationTarget("pixiv://users/abc", navigate);
    openNotificationTarget(null, navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
