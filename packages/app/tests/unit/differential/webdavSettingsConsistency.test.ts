// WebDAV 连接配置键双端一致性（spec docs/specs/webdav-backup.md §7/§8 / ADR-0156 D4）
// oracle 分层（如实标注，硬约束 #6）：
//   - settings_webdav_* 精确键名：spec 只给通配（§8「settings_webdav_*」），
//     键名 oracle = 双端逐字一致（差分）+ settings_* 跨引擎命名约定（ADR-0103）
//   - 默认值 "Pictelio/backup" / 7：spec §7 字面（spec:65/110）
//   - SECURE_KEYS：spec §8 原文（"键如 webdav_password/webdav_backup_password"）
// 防漂移：app settingsStore 与 app-lynx settingsStore 必须使用同一组键字符串，
// 否则同一设备切换引擎后 WebDAV 连接配置读不到（跨引擎契约破坏）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appStore = readFileSync(
  path.resolve(testDir, "../../../src/stores/settingsStore.ts"),
  "utf8",
);
const lynxStore = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/stores/settingsStore.ts"),
  "utf8",
);
const appCreds = readFileSync(
  path.resolve(testDir, "../../../src/utils/webdavCredentials.ts"),
  "utf8",
);
const lynxCreds = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/utils/webdavCredentials.ts"),
  "utf8",
);

// spec §7 设置区块（服务器地址/用户名/目录/自动备份开关/周期/上次备份时间/敏感项排除）
// + §8 主开关；连接配置进备份域（密码除外）
const KEYS = [
  "settings_webdav_enabled",
  "settings_webdav_url",
  "settings_webdav_username",
  "settings_webdav_dir",
  "settings_webdav_auto_backup",
  "settings_webdav_auto_backup_days",
  "settings_webdav_last_backup",
  "settings_webdav_excluded_keys",
] as const;

// spec §8：两个密码键——secure storage，绝不进普通 Preferences / 备份文件
const SECURE_KEYS = ["webdav_password", "webdav_backup_password"] as const;

describe("WebDAV 设置键双端一致（spec webdav-backup §7/§8）", () => {
  for (const key of KEYS) {
    it(`app 与 app-lynx 均声明 ${key}`, () => {
      expect(appStore).toContain(`"${key}"`);
      expect(lynxStore).toContain(`"${key}"`);
    });
  }

  it("默认值与 spec §7 一致（默认目录 Pictelio/backup、周期默认 7）", () => {
    expect(appStore).toContain('"Pictelio/backup"');
    expect(lynxStore).toContain('"Pictelio/backup"');
    expect(appStore).toContain("default: 7");
    // 语义断言（非形态锁定）：lynx 侧 days 默认值 7，容忍 ref<number>(7) 等写法
    expect(/ref(?:<[^>]+>)?\(\s*7\s*\)/.test(lynxStore)).toBe(true);
  });

  for (const key of SECURE_KEYS) {
    it(`双端凭据模块均声明 secure storage 键 ${key}`, () => {
      expect(appCreds).toContain(`"${key}"`);
      expect(lynxCreds).toContain(`"${key}"`);
    });
  }

  it("密码键不得出现在连接配置（settings_webdav_* 进备份域，密码绝不进备份）", () => {
    // 备份域会序列化 settings_webdav_*；若密码键混入即违反 spec §8 红线
    for (const key of SECURE_KEYS) {
      for (const [name, src] of [
        ["appStore", appStore],
        ["lynxStore", lynxStore],
      ] as const) {
        expect(src.includes(`"${key}"`), `${name} 不得包含 ${key}`).toBe(false);
      }
    }
  });
});
