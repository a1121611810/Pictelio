// backupCore 双端同源一致性（spec docs/specs/webdav-backup.md §3.2/§5/§6 / ADR-0156）
// 差分 oracle：两个 backupCore.ts 的常量与导出面必须逐字一致（双端差分对齐约定，
// downloadManager 先例）；任一漂移 = 同一备份在两引擎解析/恢复行为分叉。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.resolve(testDir, "../../../src/utils/backupCore.ts"), "utf8");
const lynx = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/utils/backupCore.ts"),
  "utf8",
);

/** spec §3.2 快照字段（唯一的规范字段序） */
const SNAPSHOT_FIELDS = [
  "format",
  "schemaVersion",
  "appVersion",
  "engine",
  "createdAt",
  "excludedKeys",
  "deviceKeys",
  "accountKeys",
  "sets",
] as const;

/** spec §3.1 账号级键前缀（ADR-0103 契约键） */
const ACCOUNT_PREFIXES = ["show_r18_", "show_r18g_", "ai_filter_mode_"] as const;

/** spec §6 解析拒绝分类 */
const FORMAT_ERROR_KINDS = ["NOT_BACKUP", "SCHEMA_TOO_NEW", "CORRUPT"] as const;

/** spec §5 错误分类 + §6 CRYPTO */
const ERROR_KINDS = [
  "AUTH_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "QUOTA_EXCEEDED",
  "CONFLICT",
  "NETWORK",
  "SERVER",
  "CRYPTO",
] as const;

/** 公共导出面（T6/T7 消费） */
const EXPORTS = [
  "partitionKeys",
  "buildSnapshot",
  "serializeSnapshot",
  "parseSnapshot",
  "planRestore",
  "summarize",
  "isAccountScopedKey",
  "accountUidOf",
] as const;

describe("backupCore 双端同源一致性", () => {
  it("快照格式标识与 schema 版本逐字一致（spec §3.2）", () => {
    for (const src of [app, lynx]) {
      expect(src).toContain('"pictelio-backup"');
      expect(src).toContain("BACKUP_SCHEMA_VERSION = 1");
      for (const field of SNAPSHOT_FIELDS) expect(src).toContain(field);
    }
  });

  it("账号级键前缀双端一致（spec §3.1 / ADR-0103）", () => {
    for (const src of [app, lynx]) {
      for (const prefix of ACCOUNT_PREFIXES) expect(src).toContain(`"${prefix}"`);
    }
  });

  it("解析拒绝分类双端一致（spec §6）", () => {
    for (const src of [app, lynx]) {
      for (const kind of FORMAT_ERROR_KINDS) expect(src).toContain(`"${kind}"`);
    }
  });

  it("错误分类集合双端一致（spec §5 + §6 CRYPTO）", () => {
    for (const src of [app, lynx]) {
      for (const kind of ERROR_KINDS) expect(src).toContain(`${kind}:`);
    }
  });

  it("导出面双端一致（T6/T7 消费同一组函数）", () => {
    for (const fn of EXPORTS) {
      expect(app).toContain(`export function ${fn}`);
      expect(lynx).toContain(`export function ${fn}`);
    }
  });

  it("恢复计划字段双端一致（apply/sets/skipped*）", () => {
    for (const src of [app, lynx]) {
      for (const f of ["apply", "sets", "skippedAccountKeys", "skippedExcludedKeys"]) {
        expect(src).toContain(f);
      }
    }
  });
});
