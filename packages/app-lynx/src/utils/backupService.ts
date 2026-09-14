// ─── WebDAV 备份编排服务（spec docs/specs/webdav-backup.md §5/§6/§7）───
// 与 app-lynx utils/backupService.ts 同源同语义（差分对齐约定）。
// 深模块：把「收集 → 快照 → 加密 → MKCOL → 上传校验 → 旋转」与
// 「列档 → 下载 → 解密 → 解析 → 恢复计划 → 写回」两条流程收敛为纯编排，
// IO 全部经注入 seam（bridge / collect / apply / credentials / config），
// UI（T6/T7）只负责渲染与调用。
import { t } from "../i18n";
import {
  BACKUP_SCHEMA_VERSION,
  buildSnapshot,
  parseSnapshot,
  planRestore,
  serializeSnapshot,
  summarize,
  type BackupEngine,
  type BackupSets,
  type BackupSnapshotV1,
  type BackupSummary,
  type RestorePlan,
} from "./backupCore";

/** 旋转保留份数（与 Java WebDavClient.KEEP_BACKUPS=10 同值，spec §5 固定不可配） */
export const KEEP_BACKUPS = 10;
/** 写后校验重试上限（与 Java WebDavClient.VERIFY_MAX_ATTEMPTS=3 同值） */
export const VERIFY_MAX_ATTEMPTS = 3;
/** 备份文件名前缀（spec §3.4） */
export const BACKUP_FILE_PREFIX = "pictelio-backup-";
/** 加密封装后缀（spec §3.4） */
export const ENCRYPTED_SUFFIX = ".enc";

/** 注入的桥面（app: native/WebDav.ts；lynx: utils/webDavBridge.ts） */
export interface BackupBridge {
  ensureDir(url: string, creds: { user: string; password: string }): Promise<void>;
  uploadWithVerify(
    url: string,
    creds: { user: string; password: string },
    data: Uint8Array,
    maxAttempts?: number,
  ): Promise<void>;
  download(url: string, creds: { user: string; password: string }): Promise<Uint8Array>;
  list(
    url: string,
    creds: { user: string; password: string },
  ): Promise<Array<{ href: string; isCollection: boolean; contentLength: number | null }>>;
  prune(
    dirUrl: string,
    creds: { user: string; password: string },
    prefix: string,
    keep?: number,
  ): Promise<string[]>;
  encrypt(data: Uint8Array, password: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array, password: string): Promise<Uint8Array>;
  isEncrypted(data: Uint8Array): Promise<boolean>;
}

export interface BackupConfig {
  /** 服务器根地址（可含路径前缀） */
  url: string;
  username: string;
  /** 远程目录（默认 Pictelio/backup，spec §7） */
  dir: string;
  /** 导出界面勾选的敏感项排除清单 */
  excludedKeys: string[];
}

export interface BackupDeps {
  bridge: BackupBridge;
  config: BackupConfig;
  /** 收集备份域原始键值 + sets（T6/T7 接线到 settings registry / persisted sets） */
  collect(): Promise<{ raw: Record<string, string>; sets: BackupSets }>;
  /** 写回恢复计划（T6/T7 接线：settings 写回 + sets 写回）；返回实际写入/跳过键（spec §6.8） */
  apply(plan: RestorePlan): Promise<{ applied: string[]; skipped: string[] }>;
  /** 读取两个密码（secure storage；登录密码必填，备份加密密码可选） */
  credentials(): Promise<{ loginPassword: string | null; backupPassword: string | null }>;
  /** 当前登录 uid（账号级键过滤；未登录 null，spec §6） */
  currentUid(): number | null;
  engine: BackupEngine;
  appVersion: string;
  /** 注入时钟（测试可复现） */
  now?(): Date;
  /** 恢复写回前的钩子（T9 pre-restore 应急快照） */
  onBeforeApply?(): Promise<void>;
}

/** 远程目录 URL（去重斜杠；dir 为空 → 服务器根） */
export function dirUrlOf(config: BackupConfig): string {
  const base = config.url.replace(/\/+$/, "");
  const dir = config.dir.replace(/^\/+|\/+$/g, "");
  return dir === "" ? `${base}/` : `${base}/${dir}/`;
}

/** 远程文件 URL（href 可能是绝对路径 → 用 core 的规则在桥层已绝对化；此处拼完整 URL） */
export function fileUrlOf(config: BackupConfig, fileName: string): string {
  return dirUrlOf(config) + fileName;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** 备份文件名（spec §3.4：pictelio-backup-<yyyyMMdd-HHmmss>.json[.enc]） */
export function backupFileName(date: Date, encrypted: boolean): string {
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${BACKUP_FILE_PREFIX}${stamp}.json${encrypted ? ENCRYPTED_SUFFIX : ""}`;
}

/** 远程档案条目（设置页选档列表） */
export interface BackupFileInfo {
  name: string;
  href: string;
  encrypted: boolean;
  contentLength: number | null;
  /** 文件名中的时间戳（yyyyMMdd-HHmmss）；无法解析为 null */
  timestamp: string | null;
}

function nameOfHref(href: string): string {
  const trimmed = href.endsWith("/") ? href.slice(0, -1) : href;
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** 从 PROPFIND 条目筛出备份档案（前缀 + .json/.json.enc），按时间戳倒序（新→旧） */
export function selectBackupFiles(
  entries: Array<{ href: string; isCollection: boolean; contentLength: number | null }>,
): BackupFileInfo[] {
  const files: BackupFileInfo[] = [];
  for (const e of entries) {
    const name = nameOfHref(e.href);
    if (e.isCollection || !name.startsWith(BACKUP_FILE_PREFIX)) continue;
    const encrypted = name.endsWith(ENCRYPTED_SUFFIX);
    if (!encrypted && !name.endsWith(".json")) continue;
    const m = name.match(/^pictelio-backup-(\d{8}-\d{6})\.json/);
    files.push({
      name,
      href: e.href,
      encrypted,
      contentLength: e.contentLength,
      timestamp: m ? m[1] : null,
    });
  }
  // 时间戳字典序 = 时间序（固定宽度零填充），倒序取最新在前
  files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return files;
}

export interface BackupResult {
  fileName: string;
  encrypted: boolean;
  bytes: number;
  deletedOld: string[];
}

/** 备份（spec §5）：收集 → 快照 → 可选加密 → MKCOL → 上传校验 → 旋转 */
export async function backupNow(deps: BackupDeps): Promise<BackupResult> {
  const { bridge, config } = deps;
  const { raw, sets } = await deps.collect();
  const now = deps.now?.() ?? new Date();
  const creds = await deps.credentials();
  const backupPassword = creds.backupPassword;
  const encrypted = backupPassword !== null && backupPassword !== "";

  const snapshot = buildSnapshot({
    raw,
    excludedKeys: config.excludedKeys,
    sets,
    engine: deps.engine,
    appVersion: deps.appVersion,
    createdAt: now.toISOString(),
  });
  const plain = serializeSnapshot(snapshot);
  const payload = encrypted ? await bridge.encrypt(plain, backupPassword) : plain;

  const dirUrl = dirUrlOf(config);
  const fileName = backupFileName(now, encrypted);
  const auth = { user: config.username, password: creds.loginPassword ?? "" };

  await bridge.ensureDir(dirUrl, auth);
  await bridge.uploadWithVerify(fileUrlOf(config, fileName), auth, payload, VERIFY_MAX_ATTEMPTS);
  const deletedOld = await bridge.prune(dirUrl, auth, BACKUP_FILE_PREFIX, KEEP_BACKUPS);

  return { fileName, encrypted, bytes: payload.length, deletedOld };
}

/** 列出可恢复档案（时间倒序） */
export async function listBackups(deps: BackupDeps): Promise<BackupFileInfo[]> {
  const creds = await deps.credentials();
  const auth = { user: deps.config.username, password: creds.loginPassword ?? "" };
  const entries = await deps.bridge.list(dirUrlOf(deps.config), auth);
  return selectBackupFiles(entries);
}

/** 恢复准备结果（下载→解密→解析→计划+摘要；spec §6.2 摘要确认前零写回） */
export interface PreparedRestore {
  snapshot: BackupSnapshotV1;
  plan: RestorePlan;
  summary: BackupSummary;
  wasEncrypted: boolean;
}

export interface RestoreResult extends PreparedRestore {
  applied: string[];
  skipped: string[];
}

/**
 * 恢复准备（spec §6.1/§6.2）：下载 → 加密判定 → 解密 → 解析 → 恢复计划 + 摘要。
 * 不写回任何本地状态——pre-restore 快照与写回都在 applyPreparedRestore。
 * passwordOverride：用户为本次加密档临时输入的备份密码（优先于 secure storage）。
 */
export async function prepareRestore(
  deps: BackupDeps,
  file: { name: string; encrypted: boolean },
  passwordOverride?: string,
): Promise<PreparedRestore> {
  const creds = await deps.credentials();
  const auth = { user: deps.config.username, password: creds.loginPassword ?? "" };
  const downloaded = await deps.bridge.download(fileUrlOf(deps.config, file.name), auth);

  const wasEncrypted = file.encrypted || (await deps.bridge.isEncrypted(downloaded));
  let plain = downloaded;
  if (wasEncrypted) {
    const pwd =
      passwordOverride !== undefined && passwordOverride !== ""
        ? passwordOverride
        : creds.backupPassword;
    if (pwd === null || pwd === "") {
      throw new Error(t("backupService.encryptedNeedsPassword")); // i18n: 抛出时快照（瞬态）
    }
    plain = await deps.bridge.decrypt(downloaded, pwd);
  }

  const snapshot: BackupSnapshotV1 = parseSnapshot(plain, BACKUP_SCHEMA_VERSION);
  return {
    snapshot,
    plan: planRestore(snapshot, deps.currentUid()),
    summary: summarize(snapshot, deps.currentUid()),
    wasEncrypted,
  };
}

/**
 * 恢复执行（spec §6.4/§6.8）：pre-restore 应急快照 → 写回 → 返回实际写入/跳过计数。
 * 与 prepareRestore 分离，保证「摘要确认」发生在任何写回之前。
 */
export async function applyPreparedRestore(
  deps: BackupDeps,
  prepared: PreparedRestore,
): Promise<{ applied: string[]; skipped: string[] }> {
  if (deps.onBeforeApply) await deps.onBeforeApply();
  return await deps.apply(prepared.plan);
}

/** 一步恢复（prepare + apply；程序化调用用；UI 走两段式以展示摘要确认） */
export async function restoreFrom(
  deps: BackupDeps,
  file: { name: string; encrypted: boolean },
): Promise<RestoreResult> {
  const prepared = await prepareRestore(deps, file);
  const result = await applyPreparedRestore(deps, prepared);
  return { ...prepared, ...result };
}

/** 连接测试（spec §7「连接测试按钮」）：MKCOL 幂等 + 列目录探活 */
export async function testConnection(deps: BackupDeps): Promise<{ fileCount: number }> {
  const creds = await deps.credentials();
  const auth = { user: deps.config.username, password: creds.loginPassword ?? "" };
  const dirUrl = dirUrlOf(deps.config);
  await deps.bridge.ensureDir(dirUrl, auth);
  const entries = await deps.bridge.list(dirUrl, auth);
  return { fileCount: selectBackupFiles(entries).length };
}
/** 自动备份开关状态（T8；设置域注入） */
export interface AutoBackupState {
  enabled: boolean;
  /** 周期天数（spec §7：1/3/7/30，默认 7） */
  days: number;
  /** 上次备份时间（ISO；空串 = 从未备份） */
  lastBackupAt: string;
}

/**
 * 启动时自动备份判定（T8，spec §7：生命周期内触发——WebView 无后台执行）。
 * 规则（spec §7「距上次备份超过 N 天则执行」）：开关关 → 不执行；从未备份 → 执行；
 * 距上次 ≤ N 天（含恰好 N 天）→ 跳过；> N 天 → 执行。
 * 返回本次备份结果或 null（跳过）。
 */
export async function maybeAutoBackup(
  deps: BackupDeps,
  state: AutoBackupState,
  now: Date = deps.now?.() ?? new Date(),
): Promise<BackupResult | null> {
  if (!state.enabled) return null;
  if (state.lastBackupAt !== "") {
    const last = Date.parse(state.lastBackupAt);
    if (!Number.isNaN(last)) {
      const elapsedDays = (now.getTime() - last) / (24 * 60 * 60 * 1000);
      if (elapsedDays <= state.days) return null;
    } else {
      // 时间戳损坏：不静默跳过，warn 后按「该备份了」处理（硬约束 #3）
      console.warn("[backupService] 上次备份时间非法，按从未备份处理:", state.lastBackupAt);
    }
  }
  return backupNow(deps);
}
