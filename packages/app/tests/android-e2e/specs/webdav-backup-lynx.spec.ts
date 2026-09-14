/**
 * WebDAV 备份 lynx 原生链路 E2E（spec docs/specs/webdav-backup.md §5/§6；安卓模拟器）。
 *
 * 为什么这样测（而非 UI 点击）：Lynx 4.0.1 accessibility 树不暴露内容节点
 * （settings-sync-contract 已记录），lynx 侧 UI 自动化不可行。改为走 lynx 引擎的
 * 「启动时自动备份」：写 prefs（client_kind=lynx + webdav 配置）→ 启动 app →
 * LynxActivity → router.loadSettings → runStartupAutoBackup → PictelioWebDavModule
 * → OkHttp → 真实 WebDAV 服务器。全程无需 UI 点击。
 *
 * 运行（默认跳过）：
 *   node /tmp/pictelio-dav-server.cjs &        # 或任意 WebDAV 服务器
 *   adb reverse tcp:8081 tcp:8081
 *   WEBDAV_E2E_ENABLED=1 ANDROID_E2E_SKIP_BUILD=1 ANDROID_E2E_AVD=pictelio_ui \
 *     pnpm vitest run -c tests/android-e2e/vitest.config.ts specs/webdav-backup-lynx.spec.ts
 *
 * oracle（独立于实现）：
 * - 服务器磁盘新快照的 engine 字段 = "lynx"（来源引擎）
 * - appVersion 为真实构建版本（非硬编码 "lynx"——review M5 回归防线）
 * - settings_webdav_last_backup 由 lynx 模块写回真实 SharedPreferences
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import {
  currentTopActivity,
  forceStopApp,
  readClientPrefs,
  startMainActivity,
  writeClientKind,
  writePrefKey,
} from "../prefs";

const DAV_ROOT = process.env.WEBDAV_E2E_ROOT ?? "/tmp/pictelio-dav";
const DAV_URL = process.env.WEBDAV_E2E_URL ?? "http://127.0.0.1:8081/";
const DAV_DIR = "Pictelio/backup";
const BACKUP_DIR = path.join(DAV_ROOT, DAV_DIR);
const LYNX_ACTIVITY = "io.pictelio.app.LynxActivity";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(
  cond: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await sleep(1_500);
  }
  throw new Error(`等待超时（${timeoutMs / 1000}s）: ${what}`);
}

function findBackupFiles(): string[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter(
    (f) => f.startsWith("pictelio-backup-") && f.endsWith(".json"),
  );
}

const ENABLED = process.env.WEBDAV_E2E_ENABLED === "1";

describe.skipIf(!ENABLED)("WebDAV 备份 lynx 原生链路（模拟器）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e("pictelio_ui");
  }, 900_000);

  afterAll(async () => {
    try {
      forceStopApp(ctx.serial);
      writeClientKind(ctx.serial, "webview"); // 恢复默认引擎，避免影响其他 spec
    } catch {
      /* 收尾失败不阻断 */
    }
    await ctx?.teardown();
  });

  it("lynx 启动时自动备份经 PictelioWebDavModule 上传（engine=lynx，真实版本）", async () => {
    const before = findBackupFiles();

    forceStopApp(ctx.serial);
    writeClientKind(ctx.serial, "lynx");
    writePrefKey(ctx.serial, "settings_webdav_enabled", "true");
    writePrefKey(ctx.serial, "settings_webdav_url", DAV_URL);
    writePrefKey(ctx.serial, "settings_webdav_username", "e2e");
    writePrefKey(ctx.serial, "settings_webdav_dir", DAV_DIR);
    writePrefKey(ctx.serial, "settings_webdav_auto_backup", "true");
    writePrefKey(ctx.serial, "settings_webdav_auto_backup_days", "1");
    writePrefKey(ctx.serial, "settings_webdav_last_backup", "");
    startMainActivity(ctx.serial);

    // 1) 确认进入 lynx 引擎
    await waitUntil(
      () => currentTopActivity(ctx.serial) === LYNX_ACTIVITY,
      60_000,
      "进入 LynxActivity",
    );
    expect(currentTopActivity(ctx.serial)).toBe(LYNX_ACTIVITY);

    // 2) 等 lynx 原生模块真实上传（服务器落盘新快照）
    await waitUntil(
      () => findBackupFiles().length === before.length + 1,
      150_000,
      "lynx 自动备份落盘新快照",
    );

    const newest = findBackupFiles().toSorted().at(-1)!;
    const snapshot = JSON.parse(readFileSync(path.join(BACKUP_DIR, newest), "utf8")) as {
      engine: string;
      appVersion: string;
      deviceKeys: Record<string, string>;
    };
    expect(snapshot.engine).toBe("lynx");
    expect(typeof snapshot.appVersion).toBe("string");
    expect(snapshot.appVersion).not.toBe("lynx"); // M5 回归防线：必须是构建注入的真实版本
    expect(snapshot.deviceKeys.settings_webdav_url).toBe(DAV_URL);

    // 3) lynx 模块把「上次备份时间」写回真实 SharedPreferences（完整回路）
    await waitUntil(
      () => /name="settings_webdav_last_backup">[^<]+</u.test(readClientPrefs(ctx.serial).rawXml),
      30_000,
      "lynx 写回 settings_webdav_last_backup",
    );
  }, 420_000);
});
