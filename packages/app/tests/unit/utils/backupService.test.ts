// @vitest-environment happy-dom
// backupService 单测（spec docs/specs/webdav-backup.md §5/§6/§7）
// oracle：spec 流程步骤与固定值（KEEP_BACKUPS=10 / VERIFY_MAX_ATTEMPTS=3 /
// 文件名格式 pictelio-backup-<yyyyMMdd-HHmmss>.json[.enc]）+ §6 恢复规则。
import { describe, it, expect, vi } from "vitest";
import {
  BACKUP_FILE_PREFIX,
  KEEP_BACKUPS,
  VERIFY_MAX_ATTEMPTS,
  backupFileName,
  backupNow,
  dirUrlOf,
  listBackups,
  restoreFrom,
  selectBackupFiles,
  testConnection,
  type BackupDeps,
} from "@/utils/backupService";
import { parseSnapshot, type RestorePlan } from "@/utils/backupCore";

const RAW = {
  settings_ugoira_mode: "fflate",
  show_r18_42: "true",
  show_r18_99: "false",
};
const SETS = { blocked_user_ids: [1, 2], reported_ids: [] };

interface Calls {
  ensureDir: string[];
  uploadWithVerify: Array<{ url: string; bytes: Uint8Array; maxAttempts?: number }>;
  prune: Array<{ dirUrl: string; prefix: string; keep?: number }>;
  encrypt: Array<{ password: string; bytes: Uint8Array }>;
  decrypt: Array<{ password: string; bytes: Uint8Array }>;
  apply: RestorePlan[];
  beforeApply: number;
}

function deps(
  overrides: Partial<BackupDeps> = {},
  canned: {
    list?: Array<{ href: string; isCollection: boolean; contentLength: number | null }>;
    download?: Uint8Array;
    isEncrypted?: boolean;
  } = {},
): { deps: BackupDeps; calls: Calls } {
  const calls: Calls = {
    ensureDir: [],
    uploadWithVerify: [],
    prune: [],
    encrypt: [],
    decrypt: [],
    apply: [],
    beforeApply: 0,
  };
  const base: BackupDeps = {
    bridge: {
      async ensureDir(url) {
        calls.ensureDir.push(url);
      },
      async uploadWithVerify(url, _creds, bytes, maxAttempts) {
        calls.uploadWithVerify.push({ url, bytes, maxAttempts });
      },
      async download() {
        return canned.download ?? new Uint8Array();
      },
      async list() {
        return canned.list ?? [];
      },
      async prune(dirUrl, _creds, prefix, keep) {
        calls.prune.push({ dirUrl, prefix, keep });
        return ["/dav/old.json"];
      },
      async encrypt(bytes, password) {
        calls.encrypt.push({ password, bytes });
        return new Uint8Array([...bytes, 1, 2, 3]); // 标记密文
      },
      async decrypt(bytes, password) {
        calls.decrypt.push({ password, bytes });
        return bytes.subarray(0, bytes.length - 3);
      },
      async isEncrypted() {
        return canned.isEncrypted ?? false;
      },
    },
    config: {
      url: "https://dav.example.com/remote.php/dav/files/alice/",
      username: "alice",
      dir: "Pictelio/backup",
      excludedKeys: [],
    },
    async collect() {
      return { raw: RAW, sets: SETS };
    },
    async apply(plan) {
      calls.apply.push(plan);
    },
    async credentials() {
      return { loginPassword: "login-pw", backupPassword: null };
    },
    currentUid: () => 42,
    engine: "webview",
    appVersion: "1.2.3",
    now: () => new Date(2026, 8, 11, 17, 30, 5), // 2026-09-11 17:30:05 本地
    ...overrides,
  };
  return { deps: base, calls };
}

describe("backupService — URL 与文件名（spec §3.4/§7）", () => {
  it("dirUrlOf 归一化斜杠；dir 为空回落服务器根", () => {
    expect(
      dirUrlOf({ url: "https://dav/", username: "", dir: "Pictelio/backup", excludedKeys: [] }),
    ).toBe("https://dav/Pictelio/backup/");
    expect(dirUrlOf({ url: "https://dav", username: "", dir: "", excludedKeys: [] })).toBe(
      "https://dav/",
    );
  });

  it("backupFileName 精确匹配 spec §3.4 格式（含加密封装后缀）", () => {
    const d = new Date(2026, 8, 11, 17, 30, 5);
    expect(backupFileName(d, false)).toBe("pictelio-backup-20260911-173005.json");
    expect(backupFileName(d, true)).toBe("pictelio-backup-20260911-173005.json.enc");
    expect(BACKUP_FILE_PREFIX).toBe("pictelio-backup-");
  });
});

describe("backupService — 选档筛选（spec §7 恢复入口）", () => {
  it("只保留备份前缀 + .json/.json.enc，剔除目录与无关文件，按时间倒序", () => {
    const files = selectBackupFiles([
      { href: "/dav/backup/", isCollection: true, contentLength: null },
      {
        href: "/dav/backup/pictelio-backup-20260901-120000.json",
        isCollection: false,
        contentLength: 10,
      },
      {
        href: "/dav/backup/pictelio-backup-20260903-120000.json.enc",
        isCollection: false,
        contentLength: 20,
      },
      { href: "/dav/backup/other-file.txt", isCollection: false, contentLength: 5 },
      {
        href: "/dav/backup/pictelio-backup-20260902-120000.json",
        isCollection: false,
        contentLength: 15,
      },
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "pictelio-backup-20260903-120000.json.enc",
      "pictelio-backup-20260902-120000.json",
      "pictelio-backup-20260901-120000.json",
    ]);
    expect(files[0].encrypted).toBe(true);
    expect(files[1].encrypted).toBe(false);
    expect(files[1].timestamp).toBe("20260902-120000");
    expect(files[1].contentLength).toBe(15);
  });
});

describe("backupService — 备份流程（spec §5）", () => {
  it("明文路径：收集→快照→MKCOL→上传校验→旋转，快照字段正确", async () => {
    const { deps: d, calls } = deps();
    const result = await backupNow(d);

    expect(calls.ensureDir).toEqual([
      "https://dav.example.com/remote.php/dav/files/alice/Pictelio/backup/",
    ]);
    expect(calls.uploadWithVerify).toHaveLength(1);
    expect(calls.uploadWithVerify[0].maxAttempts).toBe(VERIFY_MAX_ATTEMPTS);
    expect(VERIFY_MAX_ATTEMPTS).toBe(3);
    expect(calls.prune[0]).toEqual({
      dirUrl: "https://dav.example.com/remote.php/dav/files/alice/Pictelio/backup/",
      prefix: BACKUP_FILE_PREFIX,
      keep: KEEP_BACKUPS,
    });
    expect(KEEP_BACKUPS).toBe(10);
    expect(calls.encrypt).toHaveLength(0);

    // 上传字节可解析回快照（字段与分区正确）
    const snapshot = parseSnapshot(calls.uploadWithVerify[0].bytes);
    expect(snapshot.engine).toBe("webview");
    expect(snapshot.appVersion).toBe("1.2.3");
    expect(snapshot.deviceKeys).toEqual({ settings_ugoira_mode: "fflate" });
    expect(new Set(Object.keys(snapshot.accountKeys))).toEqual(
      new Set(["show_r18_42", "show_r18_99"]),
    );
    expect(snapshot.sets).toEqual(SETS);

    expect(result.fileName).toBe("pictelio-backup-20260911-173005.json");
    expect(result.encrypted).toBe(false);
    expect(result.deletedOld).toEqual(["/dav/old.json"]);
  });

  it("加密路径：有备份密码 → encrypt 参与且文件名带 .enc", async () => {
    const { deps: d, calls } = deps({
      async credentials() {
        return { loginPassword: "login-pw", backupPassword: "backup-pw" };
      },
    });
    const result = await backupNow(d);

    expect(calls.encrypt).toHaveLength(1);
    expect(calls.encrypt[0].password).toBe("backup-pw");
    expect(result.encrypted).toBe(true);
    expect(result.fileName.endsWith(".json.enc")).toBe(true);
    // 上传的是密文（比明文多 3 字节标记）
    const uploaded = calls.uploadWithVerify[0].bytes;
    const plain = calls.encrypt[0].bytes;
    expect(uploaded.length).toBe(plain.length + 3);
  });

  it("excludedKeys 生效：排除键不进快照任何分组（spec §7）", async () => {
    const { deps: d, calls } = deps({
      config: {
        url: "https://dav/",
        username: "alice",
        dir: "Pictelio/backup",
        excludedKeys: ["show_r18_42"],
      },
    });
    await backupNow(d);
    const snapshot = parseSnapshot(calls.uploadWithVerify[0].bytes);
    expect(snapshot.excludedKeys).toEqual(["show_r18_42"]);
    expect(snapshot.accountKeys.show_r18_42).toBeUndefined();
    expect(snapshot.accountKeys.show_r18_99).toBe("false");
  });
});

describe("backupService — 恢复流程（spec §6）", () => {
  async function snapshotBytes(overrides: Record<string, unknown> = {}): Promise<Uint8Array> {
    const { deps: d, calls } = deps();
    await backupNow(d);
    const snap = JSON.parse(new TextDecoder().decode(calls.uploadWithVerify[0].bytes));
    return new TextEncoder().encode(JSON.stringify({ ...snap, ...overrides }));
  }

  it("明文恢复：下载→解析→计划（uid 过滤）→写回，onBeforeApply 先于 apply", async () => {
    const bytes = await snapshotBytes();
    const { deps: d, calls } = deps({}, { download: bytes });
    d.onBeforeApply = async () => {
      calls.beforeApply += 1;
      expect(calls.apply).toHaveLength(0); // T9 应急快照必须先于写回
    };
    const result = await restoreFrom(d, { name: "pictelio-backup-x.json", encrypted: false });

    expect(calls.beforeApply).toBe(1);
    expect(calls.apply).toHaveLength(1);
    expect(result.plan.apply.settings_ugoira_mode).toBe("fflate");
    expect(result.plan.apply.show_r18_42).toBe("true");
    expect(result.plan.apply.show_r18_99).toBeUndefined();
    expect(result.plan.skippedAccountKeys).toEqual(["show_r18_99"]);
    expect(result.wasEncrypted).toBe(false);
  });

  it("加密恢复：decrypt 用备份密码，apply 收到明文计划", async () => {
    const bytes = await snapshotBytes();
    const encryptedBytes = new Uint8Array([...bytes, 1, 2, 3]);
    const { deps: d, calls } = deps(
      {
        async credentials() {
          return { loginPassword: "login-pw", backupPassword: "backup-pw" };
        },
      },
      { download: encryptedBytes, isEncrypted: true },
    );
    const result = await restoreFrom(d, { name: "pictelio-backup-x.json.enc", encrypted: true });
    expect(calls.decrypt).toHaveLength(1);
    expect(calls.decrypt[0].password).toBe("backup-pw");
    expect(result.plan.apply.settings_ugoira_mode).toBe("fflate");
    expect(result.wasEncrypted).toBe(true);
  });

  it("加密恢复但无备份密码 → 明确报错（不静默）", async () => {
    const { deps: d } = deps({}, { download: new Uint8Array([1, 2, 3]), isEncrypted: true });
    await expect(
      restoreFrom(d, { name: "pictelio-backup-x.json.enc", encrypted: true }),
    ).rejects.toThrow("该备份已加密");
  });

  it("schema 过高 → SCHEMA_TOO_NEW 透传（spec §6 拒绝边界）", async () => {
    const bytes = await snapshotBytes({ schemaVersion: 99 });
    const { deps: d } = deps({}, { download: bytes });
    const err = await restoreFrom(d, { name: "pictelio-backup-x.json", encrypted: false }).catch(
      (e) => e,
    );
    expect(err.kind).toBe("SCHEMA_TOO_NEW");
  });

  it("恢复不改动远端（无 upload/prune 调用）", async () => {
    const bytes = await snapshotBytes();
    const { deps: d, calls } = deps({}, { download: bytes });
    await restoreFrom(d, { name: "pictelio-backup-x.json", encrypted: false });
    expect(calls.uploadWithVerify).toHaveLength(0);
    expect(calls.prune).toHaveLength(0);
  });
});

describe("backupService — 列档与连接测试（spec §7）", () => {
  it("listBackups 经 list + 筛选返回时间倒序", async () => {
    const { deps: d } = deps(
      {},
      {
        list: [
          {
            href: "/dav/backup/pictelio-backup-20260901-120000.json",
            isCollection: false,
            contentLength: 1,
          },
          {
            href: "/dav/backup/pictelio-backup-20260902-120000.json",
            isCollection: false,
            contentLength: 2,
          },
        ],
      },
    );
    const files = await listBackups(d);
    expect(files.map((f) => f.name)).toEqual([
      "pictelio-backup-20260902-120000.json",
      "pictelio-backup-20260901-120000.json",
    ]);
  });

  it("testConnection：MKCOL + 列目录，返回档案数", async () => {
    const { deps: d, calls } = deps(
      {},
      {
        list: [
          {
            href: "/dav/backup/pictelio-backup-20260901-120000.json",
            isCollection: false,
            contentLength: 1,
          },
        ],
      },
    );
    const res = await testConnection(d);
    expect(calls.ensureDir).toHaveLength(1);
    expect(res.fileCount).toBe(1);
  });
});
describe("backupService — 自动备份判定（spec §7 T8）", () => {
  it("maybeAutoBackup：开关关 → 跳过；从未备份 → 执行；未到期 → 跳过；到期 → 执行", async () => {
    const { maybeAutoBackup } = await import("@/utils/backupService");
    const now = new Date(2026, 8, 11, 12, 0, 0);
    const { deps: d, calls } = deps();
    expect(await maybeAutoBackup(d, { enabled: false, days: 7, lastBackupAt: "" }, now)).toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(0);

    // 从未备份 → 执行
    const r1 = await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: "" }, now);
    expect(r1).not.toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(1);

    // 3 天前备份（周期 7）→ 跳过
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: threeDaysAgo }, now),
    ).toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(1);

    // 8 天前备份（周期 7）→ 执行
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: eightDaysAgo }, now),
    ).not.toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(2);
  });

  it("maybeAutoBackup：恰好 N 天 → 跳过；超过 N 天 → 执行（spec §7「超过 N 天」，S9 边界）", async () => {
    const { maybeAutoBackup } = await import("@/utils/backupService");
    const now = new Date(2026, 8, 11, 12, 0, 0);
    const { deps: d, calls } = deps();
    const exactly7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: exactly7 }, now),
    ).toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(0);

    const justOver7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 60_000).toISOString();
    expect(
      await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: justOver7 }, now),
    ).not.toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(1);
  });

  it("maybeAutoBackup：时间戳损坏 → warn 并按从未备份处理（不静默）", async () => {
    const { maybeAutoBackup } = await import("@/utils/backupService");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps: d, calls } = deps();
    const r = await maybeAutoBackup(d, { enabled: true, days: 7, lastBackupAt: "not-a-date" });
    expect(r).not.toBeNull();
    expect(calls.uploadWithVerify).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
