// backupService 双端同源一致性 + 与 Java 固定值对齐（spec §5/§3.4 / ADR-0156）
// oracle：spec §5 固定值（重试 ×3 / 保留 10 份）+ §3.4 文件名契约，Java 源码为协议侧单一事实源。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.resolve(testDir, "../../../src/utils/backupService.ts"), "utf8");
const lynx = readFileSync(
  path.resolve(testDir, "../../../../app-lynx/src/utils/backupService.ts"),
  "utf8",
);
const javaClient = readFileSync(
  path.resolve(testDir, "../../../android/app/src/main/java/io/pictelio/app/WebDavClient.java"),
  "utf8",
);

const ASYNC_EXPORTS = ["backupNow", "listBackups", "restoreFrom", "testConnection"] as const;
const SYNC_EXPORTS = ["selectBackupFiles", "dirUrlOf", "fileUrlOf", "backupFileName"] as const;

describe("backupService 双端同源一致性", () => {
  it("固定值与 spec §5 / Java WebDavClient 逐字一致（重试 3 / 保留 10）", () => {
    for (const src of [app, lynx]) {
      expect(src).toContain("KEEP_BACKUPS = 10");
      expect(src).toContain("VERIFY_MAX_ATTEMPTS = 3");
      expect(src).toContain('BACKUP_FILE_PREFIX = "pictelio-backup-"');
      expect(src).toContain('ENCRYPTED_SUFFIX = ".enc"');
    }
    // 协议侧单一事实源（Java）同值——两处漂移会让旋转/重试语义分叉
    expect(javaClient).toContain("VERIFY_MAX_ATTEMPTS = 3");
    expect(javaClient).toContain("KEEP_BACKUPS = 10");
  });

  it("导出面双端一致（UI 只消费这一组）", () => {
    for (const fn of ASYNC_EXPORTS) {
      expect(app).toContain(`export async function ${fn}`);
      expect(lynx).toContain(`export async function ${fn}`);
    }
    for (const fn of SYNC_EXPORTS) {
      expect(app).toContain(`export function ${fn}`);
      expect(lynx).toContain(`export function ${fn}`);
    }
  });

  it("恢复流程钩子顺序（T9 应急快照先于写回）双端一致", () => {
    for (const src of [app, lynx]) {
      const hookIdx = src.indexOf("await deps.onBeforeApply()");
      const applyIdx = src.indexOf("await deps.apply(plan)");
      expect(hookIdx).toBeGreaterThan(0);
      expect(applyIdx).toBeGreaterThan(hookIdx);
    }
  });
});
