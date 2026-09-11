/**
 * WebDAV 备份原生链路 E2E（spec docs/specs/webdav-backup.md §5/§6/§8；安卓模拟器真实链路）。
 *
 * 运行（默认跳过，避免无服务器环境 CI 失败）：
 *   WEBDAV_E2E_ENABLED=1 ANDROID_E2E_SKIP_BUILD=1 ANDROID_E2E_AVD=pictelio_ui \
 *     node /tmp/pictelio-dav-server.cjs &   # 或任意 WebDAV 服务器（DAV_PORT/WEBDAV_E2E_URL 可配）
 *   adb reverse tcp:8081 tcp:8081
 *   adb shell settings put global http_proxy 10.0.2.2:10808   # 本机需代理出网时
 *   pnpm vitest run -c tests/android-e2e/vitest.config.ts specs/webdav-backup.spec.ts
 *
 * 前置（本文件不负责启动）：
 * - 宿主最小 WebDAV 服务器：/tmp/pictelio-dav-server.cjs 监听 0.0.0.0:8081，根 /tmp/pictelio-dav
 * - adb reverse tcp:8081 tcp:8081（debug 网络安全配置仅放行回环 cleartext）
 * - 模拟器全局代理 → 宿主（adb shell settings put global http_proxy 10.0.2.2:10808），否则登录不可达
 * - PIXIV_REFRESH_TOKEN（packages/app/.env）用于登录
 *
 * 期望值来源（oracle，独立于实现）：
 * - 服务器磁盘上的真实备份文件（存在性 + 内容可解析为 spec §3.2 快照）
 * - spec §8 红线：备份文件不得包含任何密码键
 * - spec §5/§6 流程文案（连接成功 / 已备份 / 已恢复）
 *
 * 说明：全程不杀进程、不 reload——避免 Appium WebView/DevTools 断连（实测两轮失败于此）。
 * 连接配置经 UI 写入（赋值 + input 事件，组件 onInput → setter 持久化）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

const TOKEN = process.env.PIXIV_REFRESH_TOKEN ?? "";
const DAV_ROOT = process.env.WEBDAV_E2E_ROOT ?? "/tmp/pictelio-dav";
const DAV_URL = process.env.WEBDAV_E2E_URL ?? "http://127.0.0.1:8081/";
const DAV_DIR = "Pictelio/backup";
const BACKUP_DIR = path.join(DAV_ROOT, DAV_DIR);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WebDriver execute 的脚本体必须显式 `return`（IIFE 返回值会被丢弃 → 恒 null，实测坑） */
async function exec(ctx: AndroidE2eContext, script: string): Promise<unknown> {
  return ctx.driver.raw.execute(script);
}

async function bodyText(ctx: AndroidE2eContext): Promise<string> {
  // innerText 在该 WebView 返回 null（实测）；textContent 稳定
  const v = await exec(ctx, "return (document.body && document.body.textContent) || '';").catch(
    () => "",
  );
  return v === null || v === undefined ? "" : String(v);
}

async function clickByText(ctx: AndroidE2eContext, text: string): Promise<boolean> {
  return (
    (await exec(
      ctx,
      `return (() => {
        const nodes = [...document.querySelectorAll('button, fluent-button, [role="button"]')];
        const hit = nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
        if (!hit) return false;
        hit.click();
        return true;
      })();`,
    )) === true
  );
}

async function waitForText(
  ctx: AndroidE2eContext,
  needle: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await bodyText(ctx);
    if (last.includes(needle)) return;
    await sleep(1_000);
  }
  throw new Error(
    `等待文本「${needle}」超时（${timeoutMs / 1000}s）；当前片段: ${last.slice(0, 400)}`,
  );
}

/** token 注入登录（settings-sync-contract 同款） */
async function loginWithToken(ctx: AndroidE2eContext): Promise<void> {
  await ctx.driver.raw.waitUntil(
    async () =>
      (await ctx.driver.raw.$("fluent-textarea").isExisting()) &&
      (await ctx.driver.raw.$("fluent-button=登录").isExisting()),
    { timeout: 45_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
  );
  await exec(
    ctx,
    `return (() => {
      const ta = document.querySelector('fluent-textarea');
      const inner = ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
      if (!inner) return false;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(inner, ${JSON.stringify(TOKEN)});
      inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    })();`,
  );
  await ctx.driver.raw.waitUntil(
    async () => (await ctx.driver.raw.$("fluent-button=登录").getAttribute("disabled")) === null,
    { timeout: 15_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 500 },
  );
  await ctx.driver.raw.$("fluent-button=登录").click();
  await ctx.driver.raw.waitUntil(async () => !(await ctx.driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
}

/** 导航设置页（SPA pushState，不 reload） */
async function navigateSettings(ctx: AndroidE2eContext): Promise<void> {
  await exec(
    ctx,
    `return (() => {
      window.history.pushState({}, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return true;
    })();`,
  );
  await waitForText(ctx, "WebDAV 备份", 60_000);
}

/** 打开 WebDAV 主开关（fluent-switch：置 checked + 派发 change，触发组件 onChange） */
async function enableWebdav(ctx: AndroidE2eContext): Promise<void> {
  const ok = await exec(
    ctx,
    `return (() => {
      // 设置页有多个 fluent-switch（主题/R18/AI…）——按「启用 WebDAV 备份」文本定位所在行
      const label = [...document.querySelectorAll('span, p, div')].find(
        (el) => el.children.length === 0 && (el.textContent || '').trim() === '启用 WebDAV 备份',
      );
      const row = label && label.closest('div');
      const sw = row ? row.querySelector('fluent-switch') : null;
      if (!sw) return false;
      sw.checked = true;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })();`,
  );
  expect(ok).toBe(true);
  await waitForText(ctx, "服务器地址", 30_000);
}

/** 填输入框：原生 value setter + input 事件（组件 onInput → setter 持久化） */
async function fillInput(
  ctx: AndroidE2eContext,
  placeholderPrefix: string,
  value: string,
): Promise<void> {
  const ok = await exec(
    ctx,
    `return (() => {
      const inputs = [...document.querySelectorAll('input')];
      const el = inputs.find((i) => (i.placeholder || '').startsWith(${JSON.stringify(placeholderPrefix)}));
      if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })();`,
  );
  expect(ok, `输入框未找到或赋值失败: ${placeholderPrefix}`).toBe(true);
}

/** 按字段 label 文本定位输入框（用户名/目录等无 placeholder） */
async function fillByLabel(
  ctx: AndroidE2eContext,
  labelText: string,
  value: string,
): Promise<void> {
  const ok = await exec(
    ctx,
    `return (() => {
      const label = [...document.querySelectorAll('span')].find(
        (el) => (el.textContent || '').trim() === ${JSON.stringify(labelText)},
      );
      const row = label && label.parentElement;
      const el = row ? row.querySelector('input') : null;
      if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })();`,
  );
  expect(ok, `按 label 未找到输入框: ${labelText}`).toBe(true);
}

function findBackupFiles(): string[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter(
    (f) => f.startsWith("pictelio-backup-") && f.endsWith(".json"),
  );
}

const ENABLED = process.env.WEBDAV_E2E_ENABLED === "1";

describe.skipIf(!ENABLED)("WebDAV 备份原生链路（模拟器）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    if (!TOKEN) throw new Error("缺 PIXIV_REFRESH_TOKEN（packages/app/.env）——WebDAV E2E 需要登录");
    ctx = await setupAndroidE2e("pictelio_ui");
  }, 900_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("启用 → 连接测试 → 备份落盘（§3.2/§5/§8）→ 恢复摘要与写回（§6）", async () => {
    await ctx.driver.switchToWebView(60_000);
    await loginWithToken(ctx);
    await navigateSettings(ctx);

    // UI 配置连接（不重启；组件 onInput → setter 持久化）
    await enableWebdav(ctx);
    await fillInput(ctx, "https://dav.example.com", DAV_URL);
    await fillByLabel(ctx, "用户名", "e2e");
    // 目录保持默认 Pictelio/backup（与 DAV_DIR 一致），不额外填写

    // 连接测试（真实 MKCOL + PROPFIND）
    expect(await clickByText(ctx, "连接测试")).toBe(true);
    await waitForText(ctx, "连接成功", 60_000);

    // 立即备份 → 服务器真实落盘（独立 oracle）
    const before = findBackupFiles();
    expect(await clickByText(ctx, "立即备份")).toBe(true);
    await waitForText(ctx, "已备份", 120_000);

    const after = findBackupFiles();
    expect(after.length).toBe(before.length + 1);
    const newest = [...after].toSorted().at(-1)!;
    const snapshot = JSON.parse(readFileSync(path.join(BACKUP_DIR, newest), "utf8")) as {
      format: string;
      schemaVersion: number;
      appVersion: string;
      deviceKeys: Record<string, string>;
      accountKeys: Record<string, string>;
    };
    expect(snapshot.format).toBe("pictelio-backup");
    expect(snapshot.schemaVersion).toBe(1);
    expect(typeof snapshot.appVersion).toBe("string");
    expect(snapshot.deviceKeys.settings_webdav_url).toBe(DAV_URL);
    const rawSnapshot = JSON.stringify(snapshot);
    expect(rawSnapshot).not.toContain("webdav_password");
    expect(rawSnapshot).not.toContain("webdav_backup_password");

    // 恢复：列档 → 摘要前置 → 确认写回（§6）
    expect(await clickByText(ctx, "恢复")).toBe(true);
    await waitForText(ctx, newest, 60_000);
    expect(await clickByText(ctx, newest)).toBe(true);
    await waitForText(ctx, "来源引擎", 30_000);
    expect(await clickByText(ctx, "确认恢复")).toBe(true);
    await waitForText(ctx, "已恢复", 120_000);
  }, 600_000);
});
