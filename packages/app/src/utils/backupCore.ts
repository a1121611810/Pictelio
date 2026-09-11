// ─── WebDAV 备份共享核心（纯函数，spec docs/specs/webdav-backup.md §3.2/§5/§6）───
// 与 app-lynx utils/backupCore.ts 同源同语义（downloadManager 差分对齐约定）。
// 职责：备份域分区（设备级/账号级/排除）、快照 v1 序列化与解析、恢复计划（merge-by-keys）。
// 无 IO：原始 KV（键→存储字符串）与 sets 由调用层（T6/T7 接线）注入——
// 快照内的值就是存储层原始字符串（跨引擎共享 SharedPreferences 的口径，ADR-0103）。
import type { WebDavErrorKind } from "@/native/WebDav";

/** 快照格式标识（spec §3.2；与 Java BackupCrypto 的 magic 是不同层的契约） */
export const BACKUP_FORMAT = "pictelio-backup";
/** 快照 schema 版本（spec §3.2） */
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * 账号级键前缀（spec §3.1；ADR-0103 契约键）。
 * 恢复时按当前登录 uid 过滤（spec §6）——非本账号的账号级键跳过。
 */
export const ACCOUNT_KEY_PREFIXES = ["show_r18_", "show_r18g_", "ai_filter_mode_"] as const;

/** 备份引擎标识（快照元数据，仅供展示；恢复不依赖来源引擎） */
export type BackupEngine = "webview" | "lynx";

/** sets 数据（blockStore / reportStore 的原始集合） */
export type BackupSets = Record<string, unknown[]>;

/** 快照 v1（spec §3.2 逐字字段） */
export interface BackupSnapshotV1 {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  appVersion: string;
  engine: BackupEngine;
  createdAt: string;
  excludedKeys: string[];
  deviceKeys: Record<string, string>;
  accountKeys: Record<string, string>;
  sets: BackupSets;
}

/** 解析失败分类（spec §6 拒绝边界） */
export type BackupFormatErrorKind = "NOT_BACKUP" | "SCHEMA_TOO_NEW" | "CORRUPT";

export class BackupFormatError extends Error {
  constructor(
    public readonly kind: BackupFormatErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BackupFormatError";
  }
}

/** 是否账号级键（前缀匹配，spec §3.1 三类键） */
export function isAccountScopedKey(key: string): boolean {
  return ACCOUNT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 账号级键的 uid 后缀；非账号级键或后缀非数字 → null */
export function accountUidOf(key: string): number | null {
  if (!isAccountScopedKey(key)) return null;
  const idx = key.lastIndexOf("_");
  if (idx < 0 || idx === key.length - 1) return null;
  const suffix = key.slice(idx + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

export interface PartitionInput {
  /** 存储层原始键值（含所有 settings_* / 账号级键） */
  raw: Record<string, string>;
  /** 导出界面勾选排除的敏感键（spec §7）；这些键不进快照任何分组 */
  excludedKeys: string[];
}

export interface Partitioned {
  deviceKeys: Record<string, string>;
  accountKeys: Record<string, string>;
}

/**
 * 备份域分区：excludedKeys 剔除 → 账号级键按前缀归入 accountKeys，其余 deviceKeys。
 * oracle = spec §3.1 备份域构成 + §7 敏感项排除。
 */
export function partitionKeys(input: PartitionInput): Partitioned {
  const excluded = new Set(input.excludedKeys);
  const deviceKeys: Record<string, string> = {};
  const accountKeys: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.raw)) {
    if (excluded.has(key)) continue;
    if (isAccountScopedKey(key)) accountKeys[key] = value;
    else deviceKeys[key] = value;
  }
  return { deviceKeys, accountKeys };
}

export interface BuildSnapshotInput extends PartitionInput {
  engine: BackupEngine;
  appVersion: string;
  /** 快照时间（ISO-8601）；调用方注入以便测试可复现 */
  createdAt: string;
  sets: BackupSets;
}

/** 构造快照 v1（纯函数；序列化由 serializeSnapshot 负责） */
export function buildSnapshot(input: BuildSnapshotInput): BackupSnapshotV1 {
  const { deviceKeys, accountKeys } = partitionKeys(input);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: input.appVersion,
    engine: input.engine,
    createdAt: input.createdAt,
    excludedKeys: [...input.excludedKeys],
    deviceKeys,
    accountKeys,
    sets: input.sets,
  };
}

/** 快照 → UTF-8 字节（明文；加密在 Java BackupCrypto，spec §3.3） */
export function serializeSnapshot(snapshot: BackupSnapshotV1): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringMap(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string");
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * 字节 → 快照 v1（解析 + 校验）。
 * 拒绝边界（spec §6）：
 *   - 非 Pictelio 备份（format 不符 / 非 JSON / 非对象）→ NOT_BACKUP
 *   - schemaVersion 高于本应用支持 → SCHEMA_TOO_NEW（提示升级）
 *   - 字段缺失/类型不符 → CORRUPT
 */
export function parseSnapshot(
  bytes: Uint8Array,
  supportedVersion: number = BACKUP_SCHEMA_VERSION,
): BackupSnapshotV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BackupFormatError("NOT_BACKUP", "不是有效的 Pictelio 备份（JSON 解析失败）");
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupFormatError("NOT_BACKUP", "不是 Pictelio 备份（format 标识不符）");
  }
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new BackupFormatError("CORRUPT", "备份 schemaVersion 缺失或非法");
  }
  if (schemaVersion > supportedVersion) {
    throw new BackupFormatError(
      "SCHEMA_TOO_NEW",
      `备份来自更新版本的应用（schemaVersion ${schemaVersion} > ${supportedVersion}），请升级后恢复`,
    );
  }
  if (
    typeof raw.appVersion !== "string" ||
    (raw.engine !== "webview" && raw.engine !== "lynx") ||
    typeof raw.createdAt !== "string" ||
    !isStringArray(raw.excludedKeys) ||
    !isStringMap(raw.deviceKeys) ||
    !isStringMap(raw.accountKeys) ||
    !isRecord(raw.sets) ||
    !Object.values(raw.sets).every((v) => Array.isArray(v))
  ) {
    throw new BackupFormatError("CORRUPT", "备份字段缺失或类型不符");
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: raw.appVersion,
    engine: raw.engine,
    createdAt: raw.createdAt,
    excludedKeys: raw.excludedKeys,
    deviceKeys: raw.deviceKeys,
    accountKeys: raw.accountKeys,
    sets: raw.sets as BackupSets,
  };
}

/** 恢复计划（spec §6 merge-by-keys：只写计划内键，备份中没有的键不触碰） */
export interface RestorePlan {
  /** 要写回的原始键值（设备级全部 + 匹配当前 uid 的账号级键） */
  apply: Record<string, string>;
  /** sets 写回数据 */
  sets: BackupSets;
  /** 因非当前账号被跳过的账号级键 */
  skippedAccountKeys: string[];
  /** 因出现在 excludedKeys 而被拒绝写回的键（防御：正常构建不会出现） */
  skippedExcludedKeys: string[];
}

/**
 * 恢复计划（纯函数；实际写入由 T6/T7 接线）。
 * 规则（spec §6）：
 *   - deviceKeys 全量进 apply
 *   - accountKeys 仅 uid === currentUid 者进 apply；currentUid 为 null → 全跳过
 *   - excludedKeys 列出的键一律不写回（即使畸形快照里仍存在）
 *   - 备份中不存在的键不出现在 apply（调用方只写 apply 内的键 = merge-by-keys）
 */
export function planRestore(snapshot: BackupSnapshotV1, currentUid: number | null): RestorePlan {
  const excluded = new Set(snapshot.excludedKeys);
  const apply: Record<string, string> = {};
  const skippedAccountKeys: string[] = [];
  const skippedExcludedKeys: string[] = [];

  const tryApply = (key: string, value: string, isAccount: boolean) => {
    if (excluded.has(key)) {
      skippedExcludedKeys.push(key);
      return;
    }
    if (isAccount) {
      if (currentUid === null || accountUidOf(key) !== currentUid) {
        skippedAccountKeys.push(key);
        return;
      }
    }
    apply[key] = value;
  };

  for (const [key, value] of Object.entries(snapshot.deviceKeys)) tryApply(key, value, false);
  for (const [key, value] of Object.entries(snapshot.accountKeys)) tryApply(key, value, true);

  return { apply, sets: snapshot.sets, skippedAccountKeys, skippedExcludedKeys };
}

/** 备份摘要（恢复确认对话框展示；spec §6 摘要确认） */
export interface BackupSummary {
  createdAt: string;
  engine: BackupEngine;
  appVersion: string;
  deviceKeyCount: number;
  accountKeyCount: number;
  accountKeyCountForUid: number;
  setCount: number;
}

export function summarize(snapshot: BackupSnapshotV1, currentUid: number | null): BackupSummary {
  const accountKeys = Object.keys(snapshot.accountKeys);
  return {
    createdAt: snapshot.createdAt,
    engine: snapshot.engine,
    appVersion: snapshot.appVersion,
    deviceKeyCount: Object.keys(snapshot.deviceKeys).length,
    accountKeyCount: accountKeys.length,
    accountKeyCountForUid:
      currentUid === null ? 0 : accountKeys.filter((k) => accountUidOf(k) === currentUid).length,
    setCount: Object.keys(snapshot.sets).length,
  };
}

/** 错误分类的用户文案（spec §5；T6/T7 UI 直接渲染） */
export const WEBDAV_ERROR_MESSAGES: Record<WebDavErrorKind, string> = {
  AUTH_FAILED: "认证失败，请检查用户名与密码",
  FORBIDDEN: "服务器拒绝访问，请检查目录权限",
  NOT_FOUND: "路径不存在，请检查服务器地址与目录",
  QUOTA_EXCEEDED: "服务器配额不足",
  CONFLICT: "服务器文件冲突，请重试",
  NETWORK: "网络中断，请检查网络后重试",
  SERVER: "服务器返回错误，请稍后重试",
  CRYPTO: "密码错误或文件损坏",
};
