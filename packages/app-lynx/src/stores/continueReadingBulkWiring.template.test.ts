// 跨轴批量清理的**接线守卫**（票 #929 / spec US28「清除全部浏览记录」+ §11.2 落地）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件断言的是**接线**——`/continue` 页有没有挂两个入口、二次确认弹窗在不在、
//    两个入口有没有分别接到 `clearAll` / `clearCompleted`、i18n 键两侧齐不齐、
//    占位符是不是 `{{name}}`。被测对象是「页面 + 两个 store + 两份 locale 之间的关系」，
//    **不是**任一 store 的内部行为（那在 continueReadingBulkOps.test.ts）。
//    命名沿用仓库既有 `*.template.test.ts` 约定（.vue 不经 vitest 渲染）。
//
// ⚠️ **锚点找不到必须即红**：本仓 v1 版守卫写了「找不到就 return」的兜底，模板换行一变
//   就命中兜底 ⇒ 守卫恒绿、形同不存在（continueReadingWiring.template.test.ts 头注
//   记着这三次假绿）。本文件全部用 indexOf + 显式 expect，不写任何 return 兜底。
// ⚠️ 解析标签时**排除自闭合标签**（`<view ... />`）：否则深度匹配只增不减、closeAt 指错。
//
// 期望值溯源（测试硬约束 #6：不从实现反推，每条指回 spec / ADR 的某条）：
// - 入口在 `/continue`（唯一聚合面），不新开页面/不扩段      → ADR-0219 §2.1 + spec §11「28」
// - 两个入口分属两条轴、不合并成一个「清空」                → ADR-0219 §2.5（两套生命周期）
// - 不可逆批量删除 ⇒ 必须有二次确认层                        → ADR-0219 §2.5 完成态行 + 测试硬约束 #3
// - i18n 占位符是 `{{name}}`（单花括号被 applyVars 原样返回） → i18n/index.ts `applyVars`
// - 键两侧 locale 齐备（缺一侧 = 静默回退到另一语言）          → 同 continueReadingWiring 先例
// - 批量删除后同样要整树重建（原生 list 索引错位，ADR-0107 D4）→ ContinueReading.vue 既有 epoch
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
// t() 是纯函数（locale = 模块级 ref，默认 zh-CN）⇒ 可直测插值是否真的生效
import { t } from "../i18n"

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

const PAGE = "../pages/ContinueReading.vue"
const ZH = "../i18n/locales/zh-CN/pages.ts"
const EN = "../i18n/locales/en/pages.ts"

/** 切出 `function <name>` 到下一个顶层 function / 模板起点之间的函数体 */
function bodyOf(file: string, fnName: string): { start: number; body: string } {
  const s = src(file)
  const start = s.indexOf(`function ${fnName}`)
  // 锚点找不到 = 守卫已失效，必须由调用方断言（此处返回空串让 toContain 断言转红）
  if (start === -1) return { start, body: "" }
  const iEnd = s.indexOf("\nfunction ", start + 1)
  return { start, body: s.slice(start, iEnd === -1 ? undefined : iEnd) }
}

describe("接线：入口挂在 /continue，两个动作各接各的 store（票 #929 / ADR-0219 §2.1）", () => {
  it("📌 页面挂了两个独立入口，分别接 clearAll / clearCompleted（**不合并**成清空）", () => {
    const { start, body } = bodyOf(PAGE, "confirmClear")
    expect(start, "confirmClear 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // 反事实：把两个分支并成一个「清空两边」⇒ 下面两条至少一条转红
    expect(body, "清除全部浏览记录未接 historyStore.clearAll").toContain("historyStore.clearAll()")
    expect(body, "清除已读完未接 continueStore.clearCompleted").toContain(
      "continueStore.clearCompleted()",
    )
    // 两条轴不共用一个函数名 ⇒ 至少两个不同的 store 接收方
    expect(body).toMatch(/historyStore\.\w+/)
    expect(body).toMatch(/continueStore\.\w+/)
  })

  it("📌 两个入口按钮真的在模板里，且各自绑定 askClear 的两个不同目标", () => {
    const s = src(PAGE)
    expect(s).toContain("t('continue.clear.history')")
    expect(s).toContain("t('continue.clear.completed')")
    // 反事实：删掉任一按钮 ⇒ 转红
    expect(s, "缺少「清除全部浏览记录」入口").toContain("@tap=\"askClear('history')\"")
    expect(s, "缺少「清除已读完」入口").toContain("@tap=\"askClear('completed')\"")
  })

  it("📌 入口的可见性由 settled 门控（hydrate 在飞时不得显示——把「还不知道」说成「没有」）", () => {
    const s = src(PAGE)
    // 两个 computed 都必须与 settled 做合取；缺它则首载瞬间显示可点的清空按钮
    expect(s).toContain("const canClearHistory = computed(() => settled.value &&")
    expect(s).toContain("const canClearCompleted = computed(() => settled.value &&")
  })
})

describe("接线：不可逆批量删除 ⇒ 必须有二次确认（ADR-0219 §2.5 + 测试硬约束 #3）", () => {
  it("📌 弹窗存在，且**取消**路径不触碰任何 store（误触即吞数据）", () => {
    const { start, body } = bodyOf(PAGE, "cancelClear")
    expect(start, "cancelClear 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // 反事实：把 clearAll 挪进 cancelClear ⇒ 转红
    expect(body, "取消路径里出现了清除动作").not.toMatch(/clearAll\(|clearCompleted\(/)
    const s = src(PAGE)
    expect(s, "弹窗没有「取消」按钮").toContain(`@tap="cancelClear"`)
    expect(s, "弹窗没有「确认清除」按钮").toContain(`@tap="confirmClear"`)
  })

  it("📌 入口点击**不直接**清除，只打开确认层（askClear 不含清除调用）", () => {
    const { start, body } = bodyOf(PAGE, "askClear")
    expect(start, "askClear 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // 反事实：让入口直接调 clearAll（无确认）⇒ 转红
    expect(body, "askClear 里直接执行了清除，未过确认层").not.toMatch(
      /historyStore\.clearAll\(|continueStore\.clearCompleted\(/,
    )
    expect(body, "askClear 应只置目标状态").toContain("clearTarget.value = target")
  })

  it("📌 弹窗正文带条数，且条数按目标取不同口径（清的数 = 报给用户的数）", () => {
    const { start, body } = bodyOf(PAGE, "askClear")
    expect(start).toBeGreaterThan(-1)
    expect(body, "浏览历史口径应取 items.length").toContain("historyStore.items.length")
    expect(body, "已读完口径应取 completed.length（不是全部条目）").toContain(
      "continueStore.completed.length",
    )
    const s = src(PAGE)
    // 📌 锚点用插值调用（代码串），不是注释里出现的键名
    expect(s, "弹窗未把 count 传给 i18n").toContain("t(clearHintKey, { count: clearCount })")
  })

  it("📌 标题与提示都按目标**分流**（两轴不共用一条含混提示）", () => {
    const s = src(PAGE)
    const iTitle = s.indexOf("const clearTitleKey = computed")
    const iHint = s.indexOf("const clearHintKey = computed")
    expect(iTitle, "clearTitleKey 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    expect(iHint, "clearHintKey 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    // 标题块与提示块各自切到下一个 computed 之前，两块都必须是二选一的三元
    const titleBlock = s.slice(iTitle, iHint)
    const hintBlock = s.slice(iHint, s.indexOf("\n\n", iHint))
    for (const [label, block, a, b] of [
      ["clearTitleKey", titleBlock, "continue.clear.history.title", "continue.clear.completed.title"],
      ["clearHintKey", hintBlock, "continue.clear.history.hint", "continue.clear.completed.hint"],
    ] as const) {
      expect(block, `${label} 未按目标分流（两轴共用一条提示）`).toContain(
        "clearTarget.value === 'history'",
      )
      expect(block, `${label} 缺历史侧文案`).toContain(a)
      expect(block, `${label} 缺已读完侧文案`).toContain(b)
    }
  })

  it("📌 返回键优先关弹窗而不是 pop 页面（modalStack 同款接线，Watchlist.vue 先例）", () => {
    const s = src(PAGE)
    const iWatch = s.indexOf("watch(clearTarget")
    expect(iWatch, "clearTarget 未接 modalStack ⇒ 返回键会直接退出页面").toBeGreaterThan(-1)
    expect(s).toContain("useModalStack().registerModal(() => cancelClear())")
  })
})

describe("接线：批量删除后同样整树重建（原生 list 索引错位，ADR-0107 D4 / ADR-0162）", () => {
  it("📌 confirmClear 递增 refreshEpoch（与单条 removeItem 同纪律）", () => {
    const { start, body } = bodyOf(PAGE, "confirmClear")
    expect(start).toBeGreaterThan(-1)
    // ⚠️ **不能**用 `indexOf("refreshEpoch.value++")` 判存在：把它包进 `if (false) …`
    //   之后子串仍在、indexOf 照样命中 ⇒ 守卫对着「永不执行的重建」恒绿。
    //   ⇒ 必须排除**被条件包裹**的写法：只认「整行就是那条语句」的形态。
    const stmt = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("refreshEpoch"))
    expect(stmt.length, "confirmClear 内没有 refreshEpoch 递增语句").toBeGreaterThan(0)
    expect(
      stmt.every((l) => l === "refreshEpoch.value++"),
      `重建语句被条件包裹或改写，实际执行不到：${JSON.stringify(stmt)}`,
    ).toBe(true)
    // 递增必须发生在清除动作**之后**（先清后重建），否则重建的是旧树
    const iClear = body.indexOf("cancelClear()")
    expect(iClear).toBeGreaterThan(-1)
    expect(body.indexOf("refreshEpoch.value++")).toBeGreaterThan(iClear)
  })
})

describe("i18n：键两侧齐备 + 占位符是 {{name}}（单花括号会被原样显示）", () => {
  const KEYS = [
    "continue.clear.history",
    "continue.clear.completed",
    "continue.clear.history.title",
    "continue.clear.history.hint",
    "continue.clear.completed.title",
    "continue.clear.completed.hint",
    "continue.clear.cancel",
    "continue.clear.confirm",
  ]

  it("zh-CN 与 en 两侧都定义了全部 8 个键（缺一侧 = 静默回退到另一语言）", () => {
    const zh = src(ZH)
    const en = src(EN)
    for (const key of KEYS) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`"${key}"`)
      expect(en, `en 缺 ${key}`).toContain(`"${key}"`)
    }
  })

  it("📌 带 count 的两条 hint 在两侧都用**双花括号**（applyVars 只匹配 \\{\\{(\\w+)\\}\\}）", () => {
    for (const rel of [ZH, EN]) {
      const s = src(rel)
      for (const key of ["continue.clear.history.hint", "continue.clear.completed.hint"]) {
        const m = s.match(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`))
        expect(m, `${key} 在 ${rel} 未取到值`).not.toBeNull()
        const value = String(m?.[1] ?? "")
        expect(value, `${key} 缺 {{count}} 占位符`).toContain("{{count}}")
        // ⚠️ 不能用 `/\{count\}/` 判「出现单花括号」——`{{count}}` 本身就含子串 `{count}`，
        //   那条断言对着正确值也红（本次首跑即如此）。要禁的是**没有**前导花括号包裹的
        //   单花括号：`{{` 开头的双花括号合法，用负向前查排除。
        expect(value, `${key} 出现未被双花括号包裹的单花括号，applyVars 不匹配`).not.toMatch(
          /(?<!\{)\{count\}(?!\})/,
        )
      }
    }
  })

  it("📌 插值真的生效：t() 返回的文案里 count 被替换掉，不含字面量 {{count}}", () => {
    // 反事实：把 locale 文件里的 {{count}} 改成 {count} ⇒ 这条转红
    for (const key of ["continue.clear.history.hint", "continue.clear.completed.hint"] as const) {
      const out = t(key, { count: 7 })
      expect(out, `${key} 插值未生效`).not.toContain("{{count}}")
      expect(out, `${key} 插值未生效`).not.toContain("{count}")
      expect(out, `${key} 未带上条数 7`).toContain("7")
    }
  })
})
