// 续读（ContinueReading）**跨文件接线守卫**（ADR-0219 §4 / spec
// docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #926 验收项 3）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件断言的是**接线**（`continueStore.record(...)` 落在哪个页面、路由表里有没有
//    `/history`、i18n 键在不在），被测对象是「整个 app 的这几个文件之间的关系」，
//    **不是** `continueReadingStore.ts` 的行为。留在 store 行为文件里会把 281 行的
//    store 当分母、把整 app 的接线成本算到它头上（超标 219% 的主因之一）。
//    命名沿用仓库既有 `*.template.test.ts` 约定（.vue 不经 vitest 渲染，模板/源码接线
//    以源级断言做机器防线；先例 pages/watchLaterPage.template.test.ts、pages/novelDetailTemplate.test.ts
//    ——后者同样跨 `router.ts` / `utils/` 读源码，不只读那一个 .vue）。`Wiring` 后缀标明
//    「这一份守卫的是接线而非 store 行为」。断言、测试名、注释自原
//    continueReadingStore.test.ts 逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策）：
// - 进入即记录、零门槛（记录点必须在详情落地后、拉正文前）    → ADR-0219 §2.3
// - 记录不得挂在「仅触底」路径（触底是完成判定，不是进入判定）→ ADR-0219 §2.3
// - 段 3 渲染续读条目 + 「查看全部」进 /continue              → ADR-0219 §2.1
// - 续读入口经 openNovel 的 resume 参数，不在页面内联拼导航串 → ADR-0183 单点缝隙
// - 术语文档易混辨析 #1：store 不 import / 不调用 watchLater·watchlist 任何符号
// - i18n 键两侧 locale 齐备（缺一侧 = 静默回退到另一语言）
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

// ─── 源级守卫（票 #926 验收项 3 / ADR-0219 §4）────────────────────────────
// 先例 watchLaterStore.test.ts 尾部的 readFileSync 守卫。守住**接线**而非运行时：
// 运行时行为已由 continueReadingStore.test.ts 的 store 用例覆盖，守卫防的是「有人把接线拆了而 store 用例全绿」。
describe("源级守卫（票 #926 / ADR-0219 §4）", () => {
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

  it("正文页在**详情落地后立刻**写续读记录（进入即记录，零门槛，ADR-0219 §2.3）", () => {
    const s = src("../pages/NovelDetail.vue")
    // 记录调用必须出现在 loadNovelDetail 之后、fetchNovelData（拉正文）之前
    // ——位置记录不依赖正文是否可读（受限作品也该被记住）
    const iDetail = s.indexOf("loadNovelDetail(")
    const iRecord = s.indexOf("recordContinueReading(detailRes.novel")
    const iBody = s.indexOf("fetchNovelData(")
    expect(iDetail).toBeGreaterThan(-1)
    expect(iRecord).toBeGreaterThan(iDetail)
    expect(iBody).toBeGreaterThan(iRecord)
  })

  it("📌 反例守卫：记录**不得**挂在「仅触底」路径上（触底只是完成判定，不是进入判定）", () => {
    const s = src("../pages/NovelDetail.vue")
    const iStart = s.indexOf("function onNovelToBottom")
    // ⚠️ 按**下一个 function 边界**切函数体，不用固定字符窗口——函数体一旦长过窗口，
    //    窗口外的 record 调用不被检查、守卫静默失效（本次 review 的 N3 发现）
    const iEnd = s.indexOf("\nfunction ", iStart + 1)
    const body = s.slice(iStart, iEnd === -1 ? undefined : iEnd)
    expect(body).not.toContain("continueStore.record")
    // 反向钉住：record 确实挂在「进入」路径上（loadNovel 内），不是压根没接
    expect(s).toContain("recordContinueReading(detailRes.novel")
  })

  it("段 3 渲染续读条目 + 「查看全部」进 /continue（ADR-0219 §2.1）", () => {
    const s = src("../pages/Shelf.vue")
    expect(s).toContain("<ContinueRow")
    expect(s).toContain("navigate('/continue')")
    expect(s).toContain("t('shelf.section.continueReading')")
  })

  it("📌 段 3 首载骨架**真的被接线**（此前只匹配标识符存在 ⇒ 同义反复，恒绿）", () => {
    const s = src("../pages/Shelf.vue")
    // 反事实验证：把 `= true` 删掉，旧的 `toContain("continueLoading")` 仍绿
    //   —— 那条断言防不住「骨架永不渲染」这个回归。现改为钉**顺序**。
    // ⚠️ 锚点用**代码**串而非注释里也出现的名字：indexOf 会先命中注释
    const iTrue = s.indexOf("continueLoading.value = true")
    const iLoad = s.indexOf("const continueDone = continueStore")
    expect(iTrue, "continueLoading 从未被置 true ⇒ 骨架 v-if 恒假").toBeGreaterThan(-1)
    expect(iLoad, "未找到段 3 装载调用").toBeGreaterThan(-1)
    expect(iTrue, "置 true 必须在装载之前，否则窗口为空").toBeLessThan(iLoad)
  })

  it("📌 段 3 骨架与空态是**同一个 v-if 链上的相邻兄弟**（不是只排先后）", () => {
    const s = src("../pages/Shelf.vue")
    // ⚠️ 只断言「iEmpty > iSkeleton」是**弱守卫**（反事实实证）：把 v-else-if 块
    //   挪过一个非 v-if 元素之后，链已断（两者成为独立分支、可同时命中），
    //   而纯文本顺序断言照样绿。⇒ 必须验**标签结构相邻**。
    //
    // ⚠️⚠️ 本守卫**不得有「找不到就 return」的兜底**：v1 正是这么写的，而实际模板是
    //   单行 `<view v-if=...`、兜底分支命中后直接 return ⇒ 守卫恒绿、形同不存在。
    //   锚点改为对空白不敏感，且**找不到即红**（抽取器不得静默空转，ArchUnit
    //   failOnEmptyShould 教训）。
    const iSkeleton = s.indexOf('v-if="continueLoading && continueEntries.length === 0"')
    expect(iSkeleton, "段 3 骨架分支消失（锚点未命中 ⇒ 本守卫已失效）").toBeGreaterThan(-1)

    // ⚠️ 扫描起点必须是**包含该 v-if 的开标签**，不是 v-if 串本身
    //   （`<view v-if=...>` 里 v-if 在标签内部；从中途起扫会把内层当根，深度全错）
    const iOpen = s.lastIndexOf("<view", iSkeleton)
    expect(iOpen, "未能定位骨架块的开标签").toBeGreaterThan(-1)
    let depth = 0
    let closeAt = -1
    // ⚠️ 必须排除**自闭合**标签（`<view ... />`）：骨架内有两片 shimmer 自闭合块，
    //   若按 `<view` 一律计深度，深度只增不减，closeAt 永远指错位置。
    //   （这正是本守卫 v1/v2 连续两版假绿的原因之一。）
    for (const m of s.slice(iOpen).matchAll(/<view\b[^>]*\/>|<view\b|<\/view>/g)) {
      if (m[0].startsWith("</")) {
        depth -= 1
        if (depth === 0) { closeAt = iOpen + m.index; break }
      } else if (!m[0].endsWith("/>")) {
        depth += 1
      }
    }
    expect(closeAt, "未能匹配骨架块的闭合标签").toBeGreaterThan(-1)

    // 闭合之后**紧邻**（仅允许空白）的下一个元素必须就是 v-else-if
    const next = s.slice(closeAt + "</view>".length).trimStart()
    expect(
      next.startsWith('<view v-else-if="continueEntries.length === 0"'),
      "骨架块与空态块之间插入了元素 ⇒ v-if 链已断，两者可同时命中",
    ).toBe(true)
  })

  it("段 3 接上分段观测读点（ADR-0219 §2.6）", () => {
    const s = src("../pages/Shelf.vue")
    expect(s).toContain("recordSectionObserved('continueReading'")
  })

  it("📌 续读入口经 openNovel 的 resume 参数，**不在页面里内联拼导航串**（ADR-0183 单点缝隙）", () => {
    for (const page of ["../pages/Shelf.vue", "../pages/ContinueReading.vue"]) {
      const s = src(page)
      expect(s).toContain("openNovel(")
      expect(s).toContain("resume: true")
      // 页面里不得出现 `/intro` 串——那是 novelNavigation.ts 的专属
      expect(s).not.toContain("/intro")
    }
  })

  it("📌 续读 store 不 import / 不调用 watchLater·watchlist 任何符号（术语文档易混辨析 #1）", () => {
    const impl = src("./continueReadingStore.ts")
    // watchlist：**零容忍**（连注释里都不该出现——它是服务端追更，与本地两条轴无关）
    expect(/watchlist/i.test(impl)).toBe(false)
    // watchLater：只禁**代码**（import / 调用），注释里引用「先例 watchLaterStore」是合法文档
    expect(/from ["'][^"']*watchLater/i.test(impl)).toBe(false)
    expect(/useWatchLaterStore/i.test(impl)).toBe(false)
  })

  it("i18n 键在 zh-CN 与 en 两侧齐备（缺一侧 = 静默回退到另一语言）", () => {
    const zh = src("../i18n/locales/zh-CN/pages.ts")
    const en = src("../i18n/locales/en/pages.ts")
    for (const key of [
      "continue.title",
      "continue.empty.title",
      "continue.empty.hint",
      "continue.remove",
      "continue.open",
      "continue.back",
      "continue.unavailable",
      "continue.restricted",
      "continue.label.chapter",
      "shelf.continueReading.empty",
      "shelf.continueReading.hint",
    ]) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`"${key}"`)
      expect(en, `en 缺 ${key}`).toContain(`"${key}"`)
    }
  })
})
