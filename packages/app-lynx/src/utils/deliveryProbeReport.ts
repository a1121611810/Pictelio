// ─── 送达通道 · 触达探测的**报告**（spec notification-delivery-probe / #941）───
//
// 【这个文件解决什么】探测器已经能发出通知、能记点击（#938/#939/#940），但**结论还没人下**。
//   报告的难点不在算比率，而在**不说谎**：
//
//   ⚠️ 头号陷阱：「点击率 0%」既可能是「发了 30 条没人点」，也可能是「一条都没发出来」。
//     两者在结论上完全相反 —— 前者说明用户不想被打扰，后者说明探测器自己坏了。
//     ⇒ 分母为 0 时比率是 **null**，不是 0；verdict 是 `no-data`。
//
//   ⚠️ 次号陷阱：权限状态有**三种**取值——已授予 / 未授予 / **查不到**。
//     把「查不到」写成「未授予」会把探针自身的故障记成用户的拒绝（禁静默降级）。
//
//   ⚠️ 三号陷阱：读者看到「点了 N 次」会自然理解成「被通知叫回来 N 次」。
//     而 #940 已在真机上证伪四种冷热判据（处理点击本身即状态跃迁，进程内观测必被污染），
//     ⇒ 这个拆分**不可判定**，报告必须显式声明，否则会被误读成一个更强的结论。

import type { DeliveryProbeCounts } from "../stores/deliveryProbeStore"

export interface ReportInput {
  counts: DeliveryProbeCounts
  /** null = 宿主模块不可用或查询失败 ⇒ **不知道**，不等于未授予 */
  permissionGranted: boolean | null
}

export type ProbeVerdict =
  /** 没数据：分母为 0，或权限从未授予 ⇒ 不可解读为「没人点」 */
  | "no-data"
  /** 发出过、确实没人点 */
  | "not-clicked"
  /** 有点击（⚠️ 不代表「被叫回来」，见 caveats） */
  | "clicked"

export interface DeliveryProbeReport {
  counts: DeliveryProbeCounts
  permissionGranted: boolean | null
  permissionState: "granted" | "denied" | "unknown"
  /** 点击 ÷ 发出；分母为 0 或计数自相矛盾时为 **null**（绝不用 0 冒充「无数据」） */
  rate: number | null
  /** 比率的人读文本；null 时明说无法计算 */
  rateText: string
  verdict: ProbeVerdict
  /** 计数自相矛盾等「数字不可信」的信号，报告须一并展示 */
  anomalies: string[]
  /** 固定的结论限制，顺序稳定以便逐轮比对 */
  caveats: string[]
}

const CAVEATS: readonly string[] = [
  "本结论是**定性观察**，单用户样本不构成统计显著性，不可据此宣称「用户不想被打扰」。",
  "本形态**不覆盖**「App 久未打开、从通知栏被叫回来」的时刻 —— 那恰恰是服务端推送的主场；" +
    "因此「没人点」不能用来否决服务端推送（ADR-0220 §3.3）。",
  "若观察到「有人点」，**不可推广**：单用户样本的上限就是该用户的打开频率，推广到他人无依据。",
  "注意：点击数**无法区分**「App 仍开着时点的」与「被通知叫回来点的」：" +
    "四种冷热判据已在真机被证伪（处理点击本身即状态跃迁，进程内观测必被污染，ADR-0220 §6-3）。" +
    "报告不得把点击数说成「被叫回来的比例」。",
]

/** 比率的人读文本。null 必须**明说原因**，不得输出 0% 冒充。 */
export function rateText(rate: number | null): string {
  if (rate === null) return "无法计算（没有可用的分母，见下方 anomalies）"
  return `${Math.round(rate * 100)}%`
}

export function buildProbeReport(input: ReportInput): DeliveryProbeReport {
  const { counts, permissionGranted } = input
  const anomalies: string[] = []

  if (counts.clicked > counts.sent) anomalies.push("clicked>sent")
  // 没有权限就发不出通知 ⇒ 这组数字至少有一边是错的，报告须并列展示而非照单全收
  if (permissionGranted === false && counts.sent > 0) {
    anomalies.push("permission=denied-but-sent>0")
  }

  // 比率：三个「不可计算」的理由都要落到 null，而不是 0
  let rate: number | null = null
  if (counts.sent <= 0) {
    anomalies.push("sent=0")
  } else if (counts.clicked > counts.sent) {
    // 已在上面记入 anomalies
  } else {
    rate = counts.clicked / counts.sent
  }

  // verdict：无数据必须优先于「没人点」，否则读者会把探测器故障读成用户拒绝
  const verdict: ProbeVerdict =
    counts.sent <= 0
      ? "no-data"
      : permissionGranted === false
        ? "no-data"
        : counts.clicked > 0
          ? "clicked"
          : "not-clicked"

  return {
    counts,
    permissionGranted,
    permissionState:
      permissionGranted === null ? "unknown" : permissionGranted ? "granted" : "denied",
    rate,
    rateText: rateText(rate),
    verdict,
    anomalies,
    caveats: [...CAVEATS],
  }
}