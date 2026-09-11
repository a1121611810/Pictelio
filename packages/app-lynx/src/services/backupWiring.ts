// ─── WebDAV 备份接线（app-lynx，spec docs/specs/webdav-backup.md §5/§6/§7，T7/T8/T9）───
// 与 app services/backupWiring.ts 同源同语义（差分对齐约定）：
//   collect = settingsStore.exportRawValues()（prefs 原始字符串）+ sets（lynx 无对应 store → {}）
//   apply   = settingsStore.importRawValues()（merge-by-keys + 账号级键按当前 uid）
//   T9      = pre-restore 应急快照（idbKV 单键，保留到下次成功备份）+ 撤销
//   T8      = 启动时自动备份（开关关 → 零 IO）
import { useAuthStore } from "../stores/authStore"
import { useSettingsStore } from "../stores/settingsStore"
import * as bridge from "../utils/webDavBridge"
import { isNativeMode } from "../api/client"
import { idbGet, idbRemove, idbSet } from "../utils/idbKV"
import {
  loadBackupPassword,
  loadWebdavPassword,
} from "../utils/webdavCredentials"
import {
  maybeAutoBackup,
  type BackupBridge,
  type BackupConfig,
  type BackupDeps,
  type BackupResult,
} from "../utils/backupService"
import type { BackupSets } from "../utils/backupCore"

/** pre-restore 应急快照键（T9；设备级 idbKV，不参与备份域） */
export const PRE_RESTORE_KEY = "webdav_pre_restore_snapshot"

export interface CollectedBackupData {
  raw: Record<string, string>
  sets: BackupSets
}

export interface LynxBackupWiring {
  collect(): Promise<CollectedBackupData>
  apply(plan: { apply: Record<string, string>; sets: BackupSets }): Promise<{
    applied: string[]
    skipped: string[]
  }>
}

export function createLynxBackupWiring(): LynxBackupWiring {
  return {
    async collect(): Promise<CollectedBackupData> {
      const raw = await useSettingsStore().exportRawValues()
      // app-lynx 暂无屏蔽/举报 store（spec §3.1 sets 为空对象）
      return { raw, sets: {} }
    },
    async apply(plan) {
      // sets 在 lynx 无落点：仅写回 apply 键（跨引擎恢复时 sets 由 app 侧处理）
      return await useSettingsStore().importRawValues(plan.apply)
    },
  }
}

export interface PreRestoreSnapshot {
  at: string
  raw: Record<string, string>
  sets: BackupSets
}

/** 恢复前应急快照（T9）：写 idbKV 单键；失败必须可见 */
export async function savePreRestoreSnapshot(wiring: LynxBackupWiring): Promise<void> {
  const data = await wiring.collect()
  const snapshot: PreRestoreSnapshot = { at: new Date().toISOString(), ...data }
  await idbSet(PRE_RESTORE_KEY, JSON.stringify(snapshot))
}

/** 读取应急快照；无记录/损坏 → null + warn（损坏不静默） */
export async function loadPreRestoreSnapshot(): Promise<PreRestoreSnapshot | null> {
  const value = await idbGet(PRE_RESTORE_KEY)
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PreRestoreSnapshot).at === "string" &&
      typeof (parsed as PreRestoreSnapshot).raw === "object" &&
      (parsed as PreRestoreSnapshot).raw !== null
    ) {
      return parsed as PreRestoreSnapshot
    }
    console.warn("[backupWiring] 应急快照结构非法，按无快照处理")
    return null
  } catch (e) {
    console.warn("[backupWiring] 应急快照解析失败，按无快照处理", e)
    return null
  }
}

/** 清除应急快照（下次成功备份后调用，spec §6） */
export async function clearPreRestoreSnapshot(): Promise<void> {
  await idbRemove(PRE_RESTORE_KEY)
}

/** 撤销上次恢复（T9）：把应急快照写回；无快照返回 false */
export async function undoLastRestore(wiring: LynxBackupWiring): Promise<boolean> {
  const snapshot = await loadPreRestoreSnapshot()
  if (snapshot === null) return false
  await wiring.apply({ apply: snapshot.raw, sets: snapshot.sets })
  return true
}

/** 当前连接配置（设置域口径，UI/启动钩子共用） */
export function currentBackupConfig(): BackupConfig {
  const s = useSettingsStore()
  return {
    url: s.webdavUrl,
    username: s.webdavUsername,
    dir: s.webdavDir,
    excludedKeys: s.webdavExcludedKeys,
  }
}

/** 当前登录 uid（账号级键过滤，spec §6；未登录 null） */
export function currentUid(): number | null {
  return useAuthStore().currentUser?.id ?? null
}

/** 构造编排依赖（T7 UI / T8 启动钩子共用） */
export function createLynxBackupDeps(config: BackupConfig = currentBackupConfig()): BackupDeps {
  const wiring = createLynxBackupWiring()
  return {
    bridge: bridge as unknown as BackupBridge,
    config,
    collect: () => wiring.collect(),
    apply: (plan) => wiring.apply(plan).then(() => undefined),
    credentials: async () => ({
      loginPassword: await loadWebdavPassword(),
      backupPassword: await loadBackupPassword(),
    }),
    currentUid,
    engine: "lynx",
    appVersion: "lynx",
    onBeforeApply: () => savePreRestoreSnapshot(wiring),
  }
}

/**
 * 启动时自动备份（T8，spec §7）：开关关 → 零 IO；到期执行。
 * 成功后记录时间并清除应急快照；失败仅 warn（不阻塞启动）。
 * web-core dev 无原生模块 → bridge 显式失败，同样只 warn。
 */
export async function runStartupAutoBackup(): Promise<BackupResult | null> {
  const s = useSettingsStore()
  if (!s.webdavEnabled) return null
  try {
    const result = await maybeAutoBackup(createLynxBackupDeps(), {
      enabled: s.webdavAutoBackup,
      days: s.webdavAutoBackupDays,
      lastBackupAt: s.webdavLastBackup,
    })
    if (result !== null) {
      s.setWebdavLastBackup(new Date().toISOString())
      await clearPreRestoreSnapshot()
    }
    return result
  } catch (e) {
    console.warn("[backupWiring] 启动时自动备份失败", e)
    return null
  }
}

/** 是否原生环境（UI 控制入口显隐：web-core 不渲染，spec §2） */
export { isNativeMode }
