// 探测报告的口径诚实性（spec notification-delivery-probe / #941 / ADR-0220 D10/D13/D15）
//
// ⚠️ 本文件测的是**结论的表述**，不是数字本身。数字对但表述骗人，比数字错更糟：
//   「点击率 0%」可以指「发了 30 条没人点」，也可以指「一条都没发出来」。
//   报告必须让读者能分开这两种情况 —— 这正是 ADR-0220 §4「权限被拒即无数据」的失效面。
import { describe, expect, it } from "vitest"

import { buildProbeReport, rateText, type ReportInput } from "./deliveryProbeReport"

const base: ReportInput = {
  counts: { sent: 30, clicked: 3, startedAt: 1_700_000_000_000 },
  permissionGranted: true,
}

describe("探测报告 · 口径诚实（#941）", () => {
  describe("点击率：分母为 0 时不得报 0%", () => {
    it("一条都没发出去 ⇒ 比率是 null，不是 0", () => {
      // 这是本文件存在的头号理由：「0%」会被读成「有人点，没点」，
      // 而真相是「什么都没发」——两者在结论上完全相反。
      const r = buildProbeReport({ ...base, counts: { sent: 0, clicked: 0, startedAt: null } })
      expect(r.rate, "分母为 0 却报 0% ⇒ 无数据被读成「没人点」").toBeNull()
      expect(r.verdict).toBe("no-data")
    })

    it("发出去过、也确实没人点 ⇒ 才是真正的 0%", () => {
      const r = buildProbeReport({ ...base, counts: { sent: 30, clicked: 0, startedAt: 1 } })
      expect(r.rate).toBe(0)
      expect(r.verdict).toBe("not-clicked")
    })

    it("有点击 ⇒ verdict 为 clicked", () => {
      const r = buildProbeReport({ ...base, counts: { sent: 10, clicked: 1, startedAt: 1 } })
      expect(r.verdict).toBe("clicked")
      expect(r.rate).toBeCloseTo(0.1)
    })

    it("点击数大于发出数（计数被污染）⇒ 不得静默给出 >100% 的比率", () => {
      const r = buildProbeReport({ ...base, counts: { sent: 5, clicked: 9, startedAt: 1 } })
      expect(r.rate, "分子超分母说明计数不可信，须报数并说明").toBeNull()
      expect(r.anomalies).toContain("clicked>sent")
    })
  })

  describe("权限状态：查不到 ≠ 未授予", () => {
    it("未授予 ⇒ verdict 是 no-data（读者据此知道「是没权限，不是没人点」）", () => {
      const r = buildProbeReport({ ...base, counts: { sent: 0, clicked: 0, startedAt: null }, permissionGranted: false })
      expect(r.verdict).toBe("no-data")
      expect(r.rate).toBeNull()
      expect(r.permissionGranted).toBe(false)
    })

    it("未授予却发出过通知 ⇒ 计数自相矛盾，须记入 anomalies", () => {
      // 没有权限就不可能发得出通知 ⇒ 这组数字至少有一边是错的，
      // 报告若照单全收，会把「计数器坏了」说成「用户不想被打扰」。
      const r = buildProbeReport({ ...base, permissionGranted: false })
      expect(r.anomalies).toContain("permission=denied-but-sent>0")
      expect(r.verdict, "矛盾输入下不得给出「没人点」的结论").toBe("no-data")
    })

    it("查不到（null）⇒ 不得当作未授予", () => {
      // 宿主模块不可用 / 查询失败是「不知道」，把它写成「没有」会把探针自身的故障
      // 记成用户的拒绝 —— 禁静默降级的典型场景。
      const r = buildProbeReport({ ...base, permissionGranted: null })
      expect(r.permissionGranted).toBeNull()
      expect(r.permissionState).toBe("unknown")
    })

    it("已授予 ⇒ 明确写 granted", () => {
      expect(buildProbeReport(base).permissionState).toBe("granted")
    })
  })

  describe("结论必须自带的三条限制（#941 AC-4/5/6）", () => {
    it("声明为定性观察、否认统计显著性", () => {
      const r = buildProbeReport(base)
      const joined = r.caveats.join()
      expect(joined).toContain("定性")
      // 「不宣称显著」的正确写法是**否认**它，故断言必须有否认词而不是不含该词
      expect(joined, "只提「统计显著」而不否认，等于没说").toMatch(/不构成统计显著性|不可据此宣称/)
    })

    it("写明不覆盖「App 久未打开、从通知栏被叫回来」", () => {
      // ADR-0220 §3.3：这恰恰是服务端推送的主场，漏掉它会让「没人点」被过度解读
      const r = buildProbeReport(base)
      expect(r.caveats.join()).toContain("久未打开")
    })

    it("写明「有人点」不可推广（单用户样本上限=用户打开频率）", () => {
      const r = buildProbeReport(base)
      expect(r.caveats.join()).toContain("不可推广")
    })

    it("写明点击数**无法区分**冷热（#940 已证伪四种判据）", () => {
      // 这是最容易在报告期被误用的一条：读者看到「点了 3 次」会自然理解成
      // 「被通知叫回来 3 次」，而那在设备上根本不可判定。
      const r = buildProbeReport(base)
      expect(r.caveats.join()).toContain("无法区分")
    })

    it("限制条数与顺序稳定（报告可比对）", () => {
      expect(buildProbeReport(base).caveats).toEqual(buildProbeReport({ ...base }).caveats)
    })
  })

  describe("呈现层：比率文本不得把 null 说成 0", () => {
    it("null ⇒ 明说无法计算并给出原因", () => {
      expect(rateText(null)).toContain("无法计算")
      expect(rateText(null)).not.toContain("0%")
    })

    it("0 ⇒ 就是 0%", () => {
      expect(rateText(0)).toBe("0%")
    })

    it("有值 ⇒ 百分比取整", () => {
      expect(rateText(0.1)).toBe("10%")
      expect(rateText(1 / 3)).toBe("33%")
    })
  })

  describe("重置后读数（#941 AC-1）", () => {
    it("重置保留开始时间、只清计数", () => {
      // 数字层面的保障在 store 的单测；此处确保报告如实呈现该形状
      const r = buildProbeReport({
        ...base,
        counts: { sent: 0, clicked: 0, startedAt: 1_700_000_000_000 },
      })
      expect(r.counts.startedAt).toBe(1_700_000_000_000)
      expect(r.verdict).toBe("no-data")
      expect(r.rateText).toContain("无法计算")
    })
  })
})