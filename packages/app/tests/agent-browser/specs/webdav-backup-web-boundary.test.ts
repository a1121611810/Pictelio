/**
 * WebDAV 备份设置区块的环境边界（spec docs/specs/webdav-backup.md §2/§7）。
 *
 * 被测行为：Web（浏览器 dev）端不渲染 WebDAV 区块——浏览器 CORS 无法对任意
 * 自托管 WebDAV 服务器发 PROPFIND/MKCOL，入口仅 Android 原生暴露。
 * 原生交互路径由组件测试（tests/unit/components/SettingsWebdav.test.tsx）覆盖，
 * 真机链路属 android-e2e 设备批次（repo 先例）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";

describe("WebDAV 备份 — Web 端边界", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("设置页不渲染 WebDAV 区块（spec §2：仅原生暴露入口）", async () => {
    await driver.navigateSpa("/settings");
    // 等待设置页框架渲染
    const text = await driver.pageText();
    expect(text).toContain("设置");
    expect(text).not.toContain("WebDAV 备份");
    expect(text).not.toContain("立即备份");
  });
});
