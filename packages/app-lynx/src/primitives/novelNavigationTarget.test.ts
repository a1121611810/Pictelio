// 小说导航目的地判定（decideNovelTarget）纯函数直测
// （ADR-0219 / spec docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #926）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    这两条用例的被测对象是 `primitives/novelNavigationTarget.ts`（28 行纯模块），
//    此前寄居在 continueReadingStore.test.ts 里——把它算进 store 的分母是失真。
//    断言、测试名、注释自原文件逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策）：
// - 导航落点：resume 时无视介绍页开关                          → ADR-0219 §2.4
// ⚠️ 从 primitives 引（纯模块）而非 utils/novelNavigation——后者是 IO 壳，
//    import router 会拉进整条 app 链（构建期注入 __PUBLIC_CONFIG__）而无法在 node 下加载
import { describe, expect, it } from "vitest"
import { decideNovelTarget } from "./novelNavigationTarget"

describe("导航落点：resume 无视介绍页开关（ADR-0219 §2.4）", () => {
  it("普通入口：开关开 → 介绍页；开关关 → 正文", () => {
    expect(decideNovelTarget({ novelIntroFirst: true, resume: false })).toBe("intro")
    expect(decideNovelTarget({ novelIntroFirst: false, resume: false })).toBe("body")
  })

  it("📌 续读入口：**无论开关如何都进正文**（用户意图是读，不是重新考虑）", () => {
    expect(decideNovelTarget({ novelIntroFirst: true, resume: true })).toBe("body")
    expect(decideNovelTarget({ novelIntroFirst: false, resume: true })).toBe("body")
  })
})
