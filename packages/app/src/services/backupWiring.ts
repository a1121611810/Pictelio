// ─── WebDAV 备份接线（spec docs/specs/webdav-backup.md §5/§6/§7，T6/T9）───
// 把编排服务（utils/backupService.ts）与 app 侧的真实 IO 接起来：
//   collect  = settings registry 原始字符串 + persisted sets
//   apply    = setRawValues 写回 + sets 写回（merge-by-keys）
//   deps     = 桥（native/WebDav）+ 凭据（secure storage）+ 当前 uid + 版本
// T9：pre-restore 应急快照（单 Preferences 键，保留到下次成功备份为止）+ 撤销。
import { Preferences } from "@capacitor/preferences";
import { settings as defaultSettings } from "@/settings";
import type { Settings } from "@/settings/types";
import * as webdavBridge from "@/native/WebDav";
import { user } from "@/stores/authStore";
import { loadBackupPassword, loadWebdavPassword } from "@/utils/webdavCredentials";
import type { BackupSets } from "@/utils/backupCore";
import {
  maybeAutoBackup,
  type BackupBridge,
  type BackupConfig,
  type BackupDeps,
  type BackupResult,
} from "@/utils/backupService";
import {
  setWebdavLastBackup,
  webdavAutoBackup,
  webdavAutoBackupDays,
  webdavEnabled,
  webdavExcludedKeys,
  webdavLastBackup,
  webdavDir,
  webdavUrl,
  webdavUsername,
} from "@/stores/settingsStore";

/** persisted sets 的注册键（blockStore / reportStore，spec §3.1「sets」） */
export const BACKUP_SET_KEYS = ["blocked_user_ids", "reported_ids"] as const;

/** pre-restore 应急快照的 Preferences 键（T9；与设置域隔离，不参与备份） */
export const PRE_RESTORE_KEY = "webdav_pre_restore_snapshot";

export interface CollectedBackupData {
  raw: Record<string, string>;
  sets: BackupSets;
}

export interface BackupWiring {
  collect(): Promise<CollectedBackupData>;
  apply(plan: { apply: Record<string, string>; sets: BackupSets }): Promise<{
    applied: string[];
    skipped: string[];
  }>;
}

export interface BackupWiringOptions {
  settings?: Settings;
}

export interface BackupDepsOptions extends BackupWiringOptions {
  credentials?: () => Promise<{ loginPassword: string | null; backupPassword: string | null }>;
  currentUid?: () => number | null;
}

/** 解析 sets 原始字符串（损坏 → warn 可见 + 跳过该 set） */
function parseSets(raw: Record<string, string>): BackupSets {
  const sets: BackupSets = {};
  for (const key of BACKUP_SET_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        sets[key] = parsed;
      } else {
        console.warn("[backupWiring] set 值非数组，跳过:", key);
      }
    } catch (e) {
      console.warn("[backupWiring] set 值解析失败，跳过:", key, e);
    }
  }
  return sets;
}

export function createBackupWiring(opts: BackupWiringOptions = {}): BackupWiring {
  const store = opts.settings ?? defaultSettings;

  return {
    async collect(): Promise<CollectedBackupData> {
      const all = await store.rawValues();
      const raw: Record<string, string> = {};
      for (const [key, value] of Object.entries(all)) {
        // sets 独立成组（spec §3.2 sets 字段），不重复出现在 deviceKeys
        if ((BACKUP_SET_KEYS as readonly string[]).includes(key)) continue;
        raw[key] = value;
      }
      return { raw, sets: parseSets(all) };
    },
    async apply(plan) {
      const result = await store.setRawValues(plan.apply);
      const applied = [...result.applied];
      const skipped = [...result.skipped];
      for (const key of BACKUP_SET_KEYS) {
        const value = plan.sets[key];
        if (value === undefined) continue; // merge-by-keys：备份没有的 set 不触碰
        const res = await store.setRawValues({ [key]: JSON.stringify(value) });
        applied.push(...res.applied);
        skipped.push(...res.skipped);
      }
      return { applied, skipped };
    },
  };
}

export interface PreRestoreSnapshot {
  at: string;
  raw: Record<string, string>;
  sets: BackupSets;
}

/** 恢复前应急快照（T9）：写单 Preferences 键；写失败必须可见 */
export async function savePreRestoreSnapshot(wiring: BackupWiring): Promise<void> {
  const data = await wiring.collect();
  const snapshot: PreRestoreSnapshot = { at: new Date().toISOString(), ...data };
  await Preferences.set({ key: PRE_RESTORE_KEY, value: JSON.stringify(snapshot) });
}

/** 读取应急快照；无记录/损坏 → null + warn（损坏不静默） */
export async function loadPreRestoreSnapshot(): Promise<PreRestoreSnapshot | null> {
  const { value } = await Preferences.get({ key: PRE_RESTORE_KEY });
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PreRestoreSnapshot).at === "string" &&
      typeof (parsed as PreRestoreSnapshot).raw === "object" &&
      (parsed as PreRestoreSnapshot).raw !== null
    ) {
      return parsed as PreRestoreSnapshot;
    }
    console.warn("[backupWiring] 应急快照结构非法，按无快照处理");
    return null;
  } catch (e) {
    console.warn("[backupWiring] 应急快照解析失败，按无快照处理", e);
    return null;
  }
}

/** 清除应急快照（下次成功备份后调用，spec §6「保留到下次成功备份为止」） */
export async function clearPreRestoreSnapshot(): Promise<void> {
  await Preferences.remove({ key: PRE_RESTORE_KEY });
}

/** 撤销上次恢复（T9）：把应急快照写回；无快照返回 false */
export async function undoLastRestore(wiring: BackupWiring): Promise<boolean> {
  const snapshot = await loadPreRestoreSnapshot();
  if (snapshot === null) return false;
  await wiring.apply({ apply: snapshot.raw, sets: snapshot.sets });
  return true;
}

/** 从设置域读当前连接配置（UI 与启动钩子共用口径） */
export function currentBackupConfig(): BackupConfig {
  return {
    url: webdavUrl(),
    username: webdavUsername(),
    dir: webdavDir(),
    excludedKeys: webdavExcludedKeys(),
  };
}

/**
 * 启动时自动备份（T8，spec §7）：开关关 → 直接返回；到期则由 maybeAutoBackup 执行。
 * 成功后记录时间并清除应急快照；失败不打扰用户（warn + 下次启动再试）。
 */
export async function runStartupAutoBackup(): Promise<BackupResult | null> {
  if (!webdavEnabled()) return null;
  try {
    const result = await maybeAutoBackup(createBackupDeps(currentBackupConfig()), {
      enabled: webdavAutoBackup(),
      days: webdavAutoBackupDays(),
      lastBackupAt: webdavLastBackup(),
    });
    if (result !== null) {
      await setWebdavLastBackup(new Date().toISOString());
      await clearPreRestoreSnapshot();
    }
    return result;
  } catch (e) {
    // 自动备份失败不弹窗不阻塞启动；warn 可见（禁静默降级）
    console.warn("[backupWiring] 启动时自动备份失败", e);
    return null;
  }
}

/** 构造编排服务依赖（T6 UI / T8 自动备份共用） */
export function createBackupDeps(config: BackupConfig, opts: BackupDepsOptions = {}): BackupDeps {
  const wiring = createBackupWiring(opts);
  const credentials = async () => {
    if (opts.credentials) return opts.credentials();
    return {
      loginPassword: await loadWebdavPassword(),
      backupPassword: await loadBackupPassword(),
    };
  };
  return {
    bridge: webdavBridge as unknown as BackupBridge,
    config,
    collect: () => wiring.collect(),
    apply: (plan) => wiring.apply(plan).then(() => undefined),
    credentials,
    currentUid: opts.currentUid ?? (() => user()?.id ?? null),
    engine: "webview",
    appVersion: APP_VERSION,
    onBeforeApply: () => savePreRestoreSnapshot(wiring),
  };
}
