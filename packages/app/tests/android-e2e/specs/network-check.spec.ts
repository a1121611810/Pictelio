/**
 * 网络自检页设备验收（spec docs/specs/network-self-check.md / ticket I5）。
 *
 * 断言：webview 内可达 /network-check（登录前可达），页面完成一次自检并渲染逐项结果。
 * oracle = spec 的检查项清单（本机网络 / DNS / TCP / TLS）与状态词（通过/失败/跳过/注意）；
 * 不依赖外网可达——探测失败同样算「自检完成并渲染」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

describe("android-e2e 网络自检", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("webview 渲染 /network-check 并完成一次自检", async () => {
    const { driver } = ctx;
    try {
      await driver.switchToWebView();
      await driver.raw.waitUntil(async () => (await driver.raw.$("#root")).isExisting(), {
        timeout: 30_000,
        timeoutMsg: "等待 #root 挂载超时",
        interval: 1_000,
      });

      // browser history 路由（该页登录前可达）
      await driver.raw.execute(() => {
        window.history.pushState({}, "", "/network-check");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

      await driver.raw.waitUntil(
        async () => {
          const text = (await driver.raw.execute(() => document.body.innerText)) as string;
          return typeof text === "string" && text.includes("网络自检") && text.includes("本机网络");
        },
        { timeout: 90_000, timeoutMsg: "等待网络自检页渲染检查项超时", interval: 1_000 },
      );

      const text = (await driver.raw.execute(() => document.body.innerText)) as string;
      expect(text).toContain("网络自检");
      expect(text).toContain("本机网络");
      expect(text).toContain("DNS 解析");
      expect(text).toMatch(/通过|失败|跳过|注意/);
    } catch (e) {
      await driver.collectEvidence("network-check-failed").catch(() => {});
      throw e;
    }
  });
});
