// 「/continue」三态链的**结构相邻**守卫（票 #929 真机取证发现的阻塞缺陷的机器防线）。
//
// 【缺陷本体】`pages/ContinueReading.vue` 的 `<list v-else>` 曾被「跨轴批量清理入口」的
//   `v-if` 抢走：Vue 的 `v-else` 只能**紧跟** `v-if`/`v-else-if` 兄弟，清理入口条插在
//   「空态」与 `<list>` 之间 ⇒ list 变成孤儿 ⇒ **真机上只要清理入口可见，列表整块不渲染**
//   （两条轴互斥，用户永远看不到列表）。存证 screenshots-2026-10/42、51、60。
//   ⚠️ 该缺陷在提交时**单测与源级守卫全绿**——既有守卫只查接线存在，不查 v-if/v-else 配对。
//
// 【本守卫的判据】三态链 `骨架(v-if) → 空态(v-else-if) → 列表(v-else)` 必须**相邻**：
//   两者之间只允许空白与注释，**不得**出现任何携带 `v-if`/`v-else`/`v-for` 的元素。
//   （同款守卫已在 `Shelf.vue` 的骨架/空态上建过——同一个错在两处重犯，故此处独立成文件。）
//
// ⚠️ 本守卫**不得有「锚点找不到就 return」的兜底**（本项目已连续多次栽在兜底命中⇒守卫恒绿）。
//   锚点找不到必须**即红**。
import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"

const src = readFileSync(
  new URL("../pages/ContinueReading.vue", import.meta.url),
  "utf-8",
)

/**
 * 去掉注释后只看结构行。
 * ⚠️ 必须**先整体剥多行 HTML 注释再分行**：逐行过滤会让多行注释的**中间行**漏出来，
 *   而那些行里常含 `v-else` / `v-if` 字样（本文件所在页面的解释性注释正是如此）⇒ 假红。
 */
function structuralLines(text: string): string[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")   // 整体剥多行注释（v1 栽在这：逐行剥导致基线假红）
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"))
}

describe("/continue 三态链必须相邻（票 #929 真机阻塞缺陷的防线）", () => {
  it("三个锚点都存在（缺一即红——不许兜底）", () => {
    expect(src, "骨架 v-if 消失").toContain('<view v-if="showSkeleton"')
    expect(src, "空态 v-else-if 消失").toContain('<view v-else-if="isEmpty"')
    expect(src, "列表 v-else 消失").toContain("<list v-else")
  })

  it("📌 骨架与空态之间只有空白/注释（无携带 v-if/v-for 的元素）", () => {
    const lines = structuralLines(src)
    const a = lines.findIndex((l) => l.includes('<view v-if="showSkeleton"'))
    const b = lines.findIndex((l) => l.includes('<view v-else-if="isEmpty"'))
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
    // 空态的**整个 view 块**与骨架之间不得有别的 v- 元素
    const between = lines.slice(a + 1, b)
    expect(
      //   ⚠️ 只拦 v-if/v-else-if/v-else：**v-for 不截断链**（骨架块内部的占位行就是合法 v-for）
      between.filter((l) => /\bv-(if|else-if|else)\b/.test(l)),
      "骨架与空态之间插入了 v-if/v-else 兄弟 ⇒ v-else 链被截断",
    ).toEqual([])
  })

  it("📌 空态与列表之间只有空白/注释 —— 本条就是抢 v-else 那类缺陷的防线", () => {
    const lines = structuralLines(src)
    const b = lines.findIndex((l) => l.includes('<view v-else-if="isEmpty"'))
    // 空态块只有一个自闭合的 <EmptyState>，故取该行到 list 之间的结构行
    const c = lines.findIndex((l) => l.includes("<list v-else"))
    expect(b).toBeGreaterThan(-1)
    expect(c, "列表 v-else 消失").toBeGreaterThan(b)
    // ⚠️ **不能**要求 `v-if` 与 `<view` 同行：多行标签里属性独占一行，
    //   写成 `/<view[^>]*\bv-(if|else|for)\b/` 会让本守卫对着真实缺陷**恒绿**（v1 栽在这）。
    //   这里只判「这段区间内出现任何 v- 指令」，不关心它挂在哪个标签上。
    const between = lines.slice(b + 1, c)
    expect(
      between.filter((l) => /\bv-(if|else-if|else)\b/.test(l)),
      "空态与列表之间插入了 v-if/v-else 兄弟 ⇒ <list v-else> 变成孤儿，列表不渲染",
    ).toEqual([])
  })

  it("清理入口条排在三态链**之前**（它不能是链中的一环）", () => {
    const lines = structuralLines(src)
    const bar = lines.findIndex((l) => l.includes('v-if="!showSkeleton && !isEmpty && showClearBar"'))
    const a = lines.findIndex((l) => l.includes('<view v-if="showSkeleton"'))
    expect(bar, "清理入口条消失").toBeGreaterThan(-1)
    expect(bar, "清理入口条必须排在骨架之前，否则会抢走 list 的 v-else").toBeLessThan(a)
  })
})
