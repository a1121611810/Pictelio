// ─── 导航迁移提示（一次性）[维度重构 2026-10-03 新增] ───
//
// 【解决什么】spec §7 风险表「老用户找不到收藏/追更」的缓解措施写了两条：
//   ①「我的」保留次级入口（收藏/稍后看/通知/追更 4 条）—— 已落地；
//   ②**一次性迁移提示** —— 此前全仓无任何实现（第三轮 Spec 审查 I-1 实证：
//   `whatsNew`/`newFeature`/`firstRun`/`migrationHint` 等检索 0 命中），也未挂账。
//   本 store 是第②条的落点。
//
// 【为什么是「设备级」而不是账号级】提示的内容是**应用导航结构**变了（插画/小说
//   并入「发现」），与用户是谁无关。换账号不该让老用户再看一遍；同一台设备上
//   换账号重复弹是纯粹的噪音。
//
// 【为什么不进备份域】与 `stores/usageMetrics.ts` 同款纪律：这是**设备行为**
//   （「这台设备上的用户看过没有」），不是账号数据，不该随备份外传。
//   反过来说：把备份恢复到新设备时再看一次提示是**合意的**——新设备上的用户
//   本来就还没被告知过结构变了。落盘键因此不带 uid，也不进 BACKUP_DEVICE_KEYS。
//
// 【失败语义】读取失败按「未看过」处理并告警（测试硬约束 #3 禁静默降级）：
//   最坏后果是用户多看一次提示，可接受；反向（读到脏值而永久不再提示）才是真损失。
import { defineStore } from "pinia"
import { ref } from "vue"
import { prefs } from "./settingsStore"

/** 落盘键（设备级、无 uid 后缀 ⇒ 不进备份域） */
export const NAV_MIGRATION_NOTICE_KEY = "nav_migration_v1_seen"

export const useNavMigrationNoticeStore = defineStore("navMigrationNotice", () => {
  /** 是否已看过。**初值 false** ⇒ 未 load 前就显示，避免「先闪一下再消失」。 */
  const seen = ref(false)
  let loaded = false

  /** 读一次即可；重复调用不重复读盘（Me 页可能反复挂载）。 */
  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      const raw = await prefs().get(NAV_MIGRATION_NOTICE_KEY)
      seen.value = raw === "1"
    } catch (e) {
      console.warn("[navMigrationNotice] 已读旗标读取失败（按未看过处理）", e)
      seen.value = false
    }
  }

  /**
   * 用户关闭提示：先落盘再改内存。
   *
   * ⚠️ 顺序反了（先改内存、异步落盘）会有一处窗口：此刻若进程被杀，旗标没落盘 ⇒
   *   下次启动又弹一次。反过来（先落盘）最坏是「关了但这次仍显示到本次会话结束」，
   *   代价小得多。落盘失败只告警不抛：关不掉提示不该让界面崩。
   */
  async function dismiss(): Promise<void> {
    try {
      await prefs().set(NAV_MIGRATION_NOTICE_KEY, "1")
    } catch (e) {
      console.warn("[navMigrationNotice] 已读旗标落盘失败（本次仍会隐藏，重启后可能再现）", e)
    }
    seen.value = true
  }

  return { seen, load, dismiss }
})
