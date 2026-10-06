// ─── 送达通道 · 触达探测的**判定与投递**（spec notification-delivery-probe / ADR-0220 决策 2/3/6/10）───
//
// 【分层】本文件只回答「**这一轮该不该发、发不发得出去**」；「**什么时候轮**」归
//   deliveryProbeLifecycle（它握有前台时刻与计时器）。静默期已过毫秒数由调用方以实参传入 ——
//   反过来 import 生命周期会形成循环依赖：生命周期要调本文件的投递，本文件要读它的时刻。
//
// 【两条轨的输入源都是外部的，不得自造】
//   - 权限轨 ← 宿主 NotificationManager 查询（JS 无任何 API 可读）；
//   - 未读轨 ← **通知 store 那个** unreadCount（外环角标 + Me 圆点数据源）。
//     ⚠️ 不是 pages/Updates.vue 内的页面本地同名量（ADR-0220 §6-2 警示的接错点）。
import { useDeliveryProbeStore, decideProbe } from "../stores/deliveryProbeStore"
import { useNotificationStore } from "../stores/notificationStore"
import { locale } from "../i18n"
import { getNativeModules } from "../api/client"

interface NativeNotification {
  areNotificationsEnabled(cb: (granted: boolean, err: string | null) => void): void
  postSummary(
    unreadCount: number,
    locale: string,
    cb: (posted: boolean, err: string | null) => void,
  ): void
}

function nativeNotify(): NativeNotification | undefined {
  return getNativeModules()?.PictelioNotification as NativeNotification | undefined
}

/** 宿主权限状态。拿不到模块/失败 ⇒ 视为未授予（走降级轨），并显式告警。 */
function queryPermissionGranted(): Promise<boolean> {
  return new Promise((resolve) => {
    const mod = nativeNotify()
    if (!mod) {
      console.warn("[deliveryProbe] 原生通知模块不可用（按未授予降级）")
      resolve(false)
      return
    }
    mod.areNotificationsEnabled((granted, err) => {
      if (err) console.warn("[deliveryProbe] 权限状态查询失败（按未授予降级）", err)
      resolve(granted === true)
    })
  })
}

/**
 * 跑一轮判定。该发则发并递增发出样本；否则记下判定理由。
 *
 * ⚠️ 每次判定都打日志（无论发不发）：「没发」的原因必须可追溯，
 * 否则报告里「没人点」与「压根没发」不可区分（决策 12 的全部意义所在）。
 *
 * ⚠️ **generation-gate**（AGENTS.md 即时导航硬约束 3）：本函数有两处 await
 *   （宿主权限查询、网络刷未读），期间用户完全可能切后台。只在**投递之前**判一次
 *   `stillForeground` 不够——它只能表达「现在在前台」，表达不了「这一轮是不是已经过期」。
 *   用户「切后台再切回来」时 stillForeground 又变 true，旧的那轮照样会投递，与新一轮重复。
 *   故调用方传入的是**当轮代号**的比对器：代号一变即本轮作废（`abandoned`）。
 *
 * @param elapsed        自进入前台已过的毫秒数；null = 当前不在前台，本轮跳过
 * @param stillCurrent   本轮是否仍然有效（生命周期持有代号；测试可省略）
 */
export async function runProbeOnce(
  elapsed: number | null,
  stillCurrent: () => boolean = () => true,
): Promise<string> {
  if (elapsed === null) {
    console.log("[deliveryProbe] 未在前台，跳过本轮判定")
    return "not-foreground"
  }
  const permissionGranted = await queryPermissionGranted()
  if (!stillCurrent()) {
    console.log("[deliveryProbe] 本轮作废：权限查询期间已切走，未投递")
    return "abandoned"
  }
  // 先刷新未读再判定：判定要基于**当下**的未读，不是上次进 App 时的旧值。
  // ⚠️ refreshUnreadBadge 失败时**保留上次计数**（角标语义），故必须看返回值：
  //   拿旧值当新值判「该发」，发出去的条数就是错的，且无任何告警 —— 正是禁静默降级。
  const unreadStore = useNotificationStore()
  let unreadCount = 0
  if (await unreadStore.refreshUnreadBadge()) {
    unreadCount = unreadStore.unreadCount
  } else {
    console.warn("[deliveryProbe] 未读刷新失败，本轮按无未读处理（不拿旧计数发通知）")
  }
  if (!stillCurrent()) {
    console.log("[deliveryProbe] 本轮作废：未读刷新期间已切走，未投递")
    return "abandoned"
  }

  const decision = decideProbe({ quietElapsedMs: elapsed, permissionGranted, unreadCount })
  if (decision !== "should-send") {
    console.log(
      `[deliveryProbe] 本轮不发：${decision}（权限=${permissionGranted} 未读=${unreadCount}）`,
    )
    return decision
  }

  const mod = nativeNotify()
  if (!mod) {
    console.warn("[deliveryProbe] 原生通知模块不可用，发出失败")
    return "module-unavailable"
  }
  const posted = await new Promise<boolean>((resolve) => {
    mod.postSummary(unreadCount, locale.value, (ok, err) => {
      if (err) console.warn("[deliveryProbe] 汇总通知发送失败", err)
      resolve(ok === true)
    })
  })
  if (posted) {
    // 一次轮询 = 一个发出样本（决策 6）。
    // ⚠️ **不推进已读记忆**（#939 AC：角标未读数必须保持真实）——
    //   推进了会让「发出样本」的对照基准随每次探测缩小。
    await useDeliveryProbeStore().recordSent()
    console.log(
      `[deliveryProbe] 已发汇总通知（未读 ${unreadCount} 条，${locale.value}），记 1 个发出样本`,
    )
  }
  return posted ? "sent" : "post-failed"
}
