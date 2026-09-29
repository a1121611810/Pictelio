// ─── @pictelio/update-check 单元测试 ───
// 用例自主 app tests/unit/services/updateService.test.ts 迁移 + 增强：
//   - error 字段（「检查失败」与「无更新」可区分）
//   - fetchImpl 依赖注入（不 stub 全局 fetch）
//   - 超时路径（fake timers + signal abort）
// 契约 mock 使用真实 version.json 字段（version/url/changelog），生产 schema 见
// packages/website/version.json。
// oracle 溯源：
//   - hasUpdate/latestVersion 期望值来自「远端 APK 版本 > 本地版本」的规格语义
//   - 错误路径期望值来自「显式暴露 error、禁静默降级」的契约约束
//
// ⚠️ OTA web bundle 双坐标（minWebVersion / webBundle / isBelowMin）的用例已随
// ADR-0202（发布通道下线）+ ADR-0203（WebView 源码删除）整体移除——其唯一消费层
// `packages/app/src/services/otaService.ts` 已随包删除。留存即为恒空读。
// 反向守卫见文件末尾 describe「web bundle 契约已下线」。
import { describe, it, expect, vi, afterEach } from "vitest";
import { isNewer, checkForUpdate } from "../src/index";
import type { CheckResult } from "../src/index";

describe("isNewer", () => {
  it("returns false when versions are equal", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns true when remote major is newer", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when remote minor is newer", () => {
    expect(isNewer("1.2.0", "1.3.0")).toBe(true);
  });

  it("returns true when remote patch is newer", () => {
    expect(isNewer("1.2.3", "1.2.4")).toBe(true);
  });

  it("returns false when local is newer", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(false);
  });

  it("handles leading v prefix on remote", () => {
    expect(isNewer("1.0.0", "v1.1.0")).toBe(true);
  });

  it("handles leading v prefix on local", () => {
    expect(isNewer("v1.0.0", "1.1.0")).toBe(true);
  });

  it("handles leading v prefix on both sides", () => {
    expect(isNewer("v1.0.0", "v1.0.1")).toBe(true);
  });

  it("ignores build metadata after plus sign", () => {
    expect(isNewer("1.0.0+1", "1.1.0+99")).toBe(true);
  });

  it("ignores build metadata when core versions are equal", () => {
    expect(isNewer("1.0.0+1", "1.0.0+2")).toBe(false);
  });

  it("trims whitespace around version strings", () => {
    expect(isNewer(" 1.0.0 ", " 1.1.0 ")).toBe(true);
  });

  it("handles mixed depth (remote shorter)", () => {
    expect(isNewer("1.2.3", "1.3")).toBe(true);
  });

  it("handles mixed depth (local shorter) when equal", () => {
    expect(isNewer("1.2", "1.2.0")).toBe(false);
  });

  it("handles mixed depth when local is newer", () => {
    expect(isNewer("1.2", "1.1.9")).toBe(false);
  });

  it("treats non-numeric segments as 0 (defensive, no crash)", () => {
    expect(isNewer("abc", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "abc")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("解析 version.json 的 url 字段为 latestReleaseUrl，远端更新时 hasUpdate=true", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "9.9.9",
          url: "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
          changelog: "✨ 新功能",
        }),
        { status: 200 },
      ),
    );

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("9.9.9");
    expect(result.latestReleaseUrl).toBe(
      "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
    );
    expect(result.latestChangelog).toBe("✨ 新功能");
    expect(result.error).toBeUndefined();
  });

  it("远端版本与本地相等时 hasUpdate=false 且无 error", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "4.5.0",
          url: "https://github.com/a1121611810/Pictelio/releases/tag/v4.5.0",
        }),
        { status: 200 },
      ),
    );

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe("4.5.0");
    expect(result.error).toBeUndefined();
  });

  it("fetch 失败（网络异常）返回安全默认值 + error 字段 + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result).toEqual({
      hasUpdate: false,
      latestVersion: "",
      latestReleaseUrl: "",
      latestChangelog: "",
      error: "network down",
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("HTTP 非 2xx 返回安全默认值 + error 字段 + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result).toEqual({
      hasUpdate: false,
      latestVersion: "",
      latestReleaseUrl: "",
      latestChangelog: "",
      error: "HTTP 404",
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("200 但响应体非 JSON（json 解析失败）→ 安全默认值 + error + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("<html>gateway error</html>", { status: 200 }));

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("合法 JSON 但 body 为字面量 null / 数组 → 按检查失败处理（不崩溃，调用方无需 try/catch）", async () => {
    for (const body of ["null", "[]"]) {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));

      const result = await checkForUpdate("4.5.0", mockFetch);

      expect(result.hasUpdate, `body=${body}`).toBe(false);
      expect(result.error, `body=${body}`).toBeTruthy();
      expect(warnSpy, `body=${body}`).toHaveBeenCalled();
      warnSpy.mockRestore();
    }
  });

  it("环境无全局 fetch 且未注入 fetchImpl → 安全默认值 + error（不崩溃）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 模拟 web-core 等无全局 fetch 的环境（fetchWrapper.ts 实测场景）
    vi.stubGlobal("fetch", undefined);

    const result = await checkForUpdate("4.5.0");

    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBeTruthy();
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it("version.json 缺 version 字段时 hasUpdate=false（不崩溃）", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe("");
    expect(result.error).toBeUndefined();
  });

  it("version 非字符串（脏数据）→ hasUpdate=false 且不崩溃", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 9999, url: "https://example.com" }), {
        status: 200,
      }),
    );

    const result = await checkForUpdate("4.5.0", mockFetch);

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe("");
    expect(result.error).toBeUndefined();
  });

  it("超过 10s 超时中止请求并返回安全默认值 + error", async () => {
    // fetchImpl 注入 seam：mock fetch 尊重 AbortSignal，永不 resolve
    const mockFetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.useFakeTimers();

    const pending = checkForUpdate("4.5.0", mockFetch);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("未传 fetchImpl 时使用全局 fetch（默认依赖）", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: "1.0.1" }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0");

    expect(result.hasUpdate).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ─────────────────────────────────────────────────────────────
// 反向守卫：web bundle 双坐标契约必须**不在**本包存在。
// 期望值溯源：ADR-0202（发布通道下线）+ ADR-0203 / spec「决策四」（消费层随源码删除）。
//
// 检测式按**语义**而非按字面量：断言的是「运行时导出面」与「CheckResult 的键集合」，
// 改名复活（isBelowMin → isWebFloor）会让导出面多出成员，照样转红——
// 本仓已有「改名复活导致按字面量匹配的守卫全漏过」的先例。
// ─────────────────────────────────────────────────────────────
describe("web bundle 契约已下线（ADR-0202 发布通道 + ADR-0203 源码删除）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("运行时导出面只剩 APK 更新检查所需成员（isNewer / checkForUpdate）", async () => {
    const mod = await import("../src/index");
    // 阳性对照：APK 更新检查的导出确实在，否则本断言是「什么都没了」而非「删对了」
    expect(typeof mod.isNewer).toBe("function");
    expect(typeof mod.checkForUpdate).toBe("function");
    // 精确集合而非黑名单：任何新增导出（含改名后的门槛判定）都会转红
    expect(Object.keys(mod).toSorted()).toEqual(["checkForUpdate", "isNewer"]);
  });

  it("version.json 仍带 OTA 字段时，结果对象不含任何 bundle 元数据", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 存量 version.json 可能仍被旧发布产物写过这些键——解析层必须整体忽略
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "4.21.0",
          url: "https://github.com/a1121611810/Pictelio/releases/tag/v4.21.0",
          minWebVersion: "4.21.0",
          webBundle: { version: "4.21.0", url: "https://example.com/prefix" },
        }),
        { status: 200 },
      ),
    );

    const result = await checkForUpdate("4.20.0", mockFetch);

    // 阳性对照：APK 坐标照常解析（不是把整个响应判为失败）
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("4.21.0");
    expect(result.error).toBeUndefined();
    // 语义匹配：断言键集合，不逐个点名字段
    expect(Object.keys(result).toSorted()).toEqual([
      "hasUpdate",
      "latestChangelog",
      "latestReleaseUrl",
      "latestVersion",
    ]);
    // 解析层已不再关心这些键 → 不得刷 warn（否则是残留的脏数据防御还挂在上面）
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("类型面：CheckResult 不再暴露 web bundle 字段（@ts-expect-error 失效即 tsc 转红）", () => {
    const result = {} as CheckResult;
    // @ts-expect-error 双坐标已下线；字段若被加回，tsc 报「未使用的 @ts-expect-error」
    expect(result.minWebVersion).toBeUndefined();
    // @ts-expect-error 同上
    expect(result.webBundle).toBeUndefined();
  });
});
