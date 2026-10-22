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

/** 备份域排除的运行时键（spec §3.1；进快照会扰动自动备份调度，review S10） */
export const BACKUP_RUNTIME_KEYS = ["settings_webdav_last_backup"] as const

export interface CollectedBackupData {
  raw: Record<string, string>
  sets: BackupSets
}

export interface LynxBackupWiring {
  collect(): Promise<CollectedBackupData>
  /** sets 可缺省：撤销路径读的历史快照可能没有该字段（缺 = 无数据可丢 ⇒ 无告警） */
  apply(plan: { apply: Record<string, string>; sets?: BackupSets | null }): Promise<{
    applied: string[]
    skipped: string[]
  }>
}

/**
 * sets 丢弃告警（#1059 裁定）。
 * app-lynx 无屏蔽/举报落点，且 WebView 客户端已随 ADR-0203 删除 ⇒ **不再有对侧引擎承接 sets**，
 * 恢复旧备份时 sets 里的数据会被丢弃。丢弃必须可见（测试硬约束 #3「禁止静默降级」）。
 * 判定口径：**至少一个数组有元素**（≠ 键数 > 0；`{ blocked_user_ids: [] }` 无数据，不告警）。
 * 只落日志，不做用户可见提示（恢复摘要页与 i18n 不变）。
 *
 * 入参允许 null/undefined：撤销路径的应急快照是 idbKV 里的历史 JSON，
 * `loadPreRestoreSnapshot` 的结构校验只认 `at` + `raw`，`sets` 可能整个缺失。
 * 缺失 = 没有数据可丢 ⇒ 不告警；且绝不能抛（否则撤销被一条日志打断）。
 */
function warnDroppedSets(sets: BackupSets | null | undefined): void {
  const dropped: string[] = []
  for (const [key, value] of Object.entries(sets ?? {})) {
    if (Array.isArray(value) && value.length > 0) dropped.push(`${key}(${value.length})`)
  }
  if (dropped.length === 0) return
  console.warn(
    `[backupWiring] 该备份含屏蔽/举报数据（sets），当前版本无落点、无法恢复，已丢弃：${dropped.join("、")}`,
  )
}

export function createLynxBackupWiring(): LynxBackupWiring {
  return {
    async collect(): Promise<CollectedBackupData> {
      const all = await useSettingsStore().exportRawValues()
      const raw: Record<string, string> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((BACKUP_RUNTIME_KEYS as readonly string[]).includes(key)) continue
        raw[key] = value
      }
      // app-lynx 暂无屏蔽/举报 store（spec §3.1 sets 为空对象）
      return { raw, sets: {} }
    },
    async apply(plan) {
      // sets 在 lynx 无落点：仅写回 apply 键。对侧引擎已随 ADR-0203 删除，
      // sets 真有数据时在此显式告警（#1059）——丢弃不得静默。
      warnDroppedSets(plan.sets)
      return await useSettingsStore().importRawValues(plan.apply)
    },
  }
}

export interface PreRestoreSnapshot {
  at: string
  raw: Record<string, string>
  /** 可能缺失：旧形态快照只存 at + raw（结构校验只认这两项，撤销语义不变） */
  sets?: BackupSets
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
    apply: (plan) => wiring.apply(plan),
    credentials: async () => ({
      loginPassword: await loadWebdavPassword(),
      backupPassword: await loadBackupPassword(),
    }),
    currentUid,
    engine: "lynx",
    // spec §3.2：快照记录应用版本（构建期注入，与 APK 版本单一事实源一致）
    appVersion: __APP_VERSION__,
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
    // 携带 message：Lynx console 对 Error 对象只显示 {}，仅带对象无法定位
    console.warn("[backupWiring] 启动时自动备份失败:", e instanceof Error ? e.message : String(e), e)
    return null
  }
}

/** 是否原生环境（UI 控制入口显隐：web-core 不渲染，spec §2） */
export { isNativeMode }
