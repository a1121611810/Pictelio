// WebDAV 备份格式契约测试（spec docs/specs/webdav-backup.md §3.2/§3.4/§3.3；T10）
// oracle = spec 文档字面量（独立来源）：格式标识 / schemaVersion / 文件名前缀 /
// 加密封装 magic / 固定值。防实现与 spec 漂移（文档是需求侧单一事实源）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.resolve(testDir, ...p), "utf8");

const spec = read("../../../../../docs/specs/webdav-backup.md");
const adr = read("../../../../../docs/adr/ADR-0156-webdav-backup-architecture.md");
const appCore = read("../../../src/utils/backupCore.ts");
const lynxCore = read("../../../../app-lynx/src/utils/backupCore.ts");
const appService = read("../../../src/utils/backupService.ts");
const lynxService = read("../../../../app-lynx/src/utils/backupService.ts");
const cryptoJava = read("../../../android/app/src/main/java/io/pictelio/app/BackupCrypto.java");
const clientJava = read("../../../android/app/src/main/java/io/pictelio/app/WebDavClient.java");

describe("WebDAV 备份格式契约（spec ↔ 代码）", () => {
  it("快照格式标识与 schemaVersion：spec §3.2 与双端 core 一致", () => {
    expect(spec).toContain('"format": "pictelio-backup"');
    expect(spec).toContain('"schemaVersion": 1');
    for (const src of [appCore, lynxCore]) {
      expect(src).toContain('BACKUP_FORMAT = "pictelio-backup"');
      expect(src).toContain("BACKUP_SCHEMA_VERSION = 1");
    }
  });

  it("快照九个字段：spec §3.2 与双端 core 逐字一致", () => {
    for (const field of [
      "format",
      "schemaVersion",
      "appVersion",
      "engine",
      "createdAt",
      "excludedKeys",
      "deviceKeys",
      "accountKeys",
      "sets",
    ]) {
      expect(spec).toContain(field);
      expect(appCore).toContain(field);
      expect(lynxCore).toContain(field);
    }
  });

  it("文件名前缀与加密封装后缀：spec §3.4 与双端 service 一致", () => {
    expect(spec).toContain("pictelio-backup-<yyyyMMdd-HHmmss>.json");
    expect(spec).toContain(".json.enc");
    for (const src of [appService, lynxService]) {
      expect(src).toContain('BACKUP_FILE_PREFIX = "pictelio-backup-"');
      expect(src).toContain('ENCRYPTED_SUFFIX = ".enc"');
    }
  });

  it("加密封装 magic：spec §3.3 与 Java BackupCrypto 一致（13B 字面量）", () => {
    expect(spec).toContain("PICTELIO-ENC1");
    expect(cryptoJava).toContain('"PICTELIO-ENC1"');
    expect(cryptoJava).toContain("PBKDF2WithHmacSHA256");
    expect(cryptoJava).toContain("AES/GCM/NoPadding");
    expect(spec).toContain("PBKDF2-HMAC-SHA256");
    expect(adr).toContain("PICTELIO-ENC1");
  });

  it("协议子集：spec §4 与 Java WebDavClient 一致（无 LOCK/MOVE/ETag）", () => {
    // 非标准动词必须显式传字符串 method；GET/DELETE 走 OkHttp builder
    for (const verb of ["MKCOL", "PUT", "PROPFIND"]) {
      expect(spec).toContain(verb);
      expect(clientJava).toContain(`"${verb}"`);
    }
    for (const verb of ["GET", "DELETE"]) expect(spec).toContain(verb);
    expect(clientJava).toContain(".get()");
    expect(clientJava).toContain(".delete()");
    expect(clientJava).not.toContain('"LOCK"');
    expect(clientJava).not.toContain('"MOVE"');
    expect(clientJava).not.toContain('"If-Match"'); // 注释中说明「不实现」，但不得作为头上传
  });

  it("固定值重试 3 / 保留 10：spec §5 与 Java + 双端 service 一致", () => {
    expect(spec).toContain("重试 ×3");
    expect(spec).toContain("保留最近 10 份");
    for (const src of [appService, lynxService, clientJava]) {
      expect(src).toContain("VERIFY_MAX_ATTEMPTS = 3");
      expect(src).toContain("KEEP_BACKUPS = 10");
    }
  });

  it("跨引擎连接配置键前缀：spec §8 与双端 store 一致", () => {
    expect(spec).toContain("settings_webdav_*");
    const appStore = read("../../../src/stores/settingsStore.ts");
    const lynxStore = read("../../../../app-lynx/src/stores/settingsStore.ts");
    for (const prefix of [
      "settings_webdav_enabled",
      "settings_webdav_url",
      "settings_webdav_username",
      "settings_webdav_dir",
      "settings_webdav_auto_backup",
      "settings_webdav_auto_backup_days",
      "settings_webdav_last_backup",
      "settings_webdav_excluded_keys",
    ]) {
      expect(appStore).toContain(`"${prefix}"`);
      expect(lynxStore).toContain(`"${prefix}"`);
    }
  });
});
