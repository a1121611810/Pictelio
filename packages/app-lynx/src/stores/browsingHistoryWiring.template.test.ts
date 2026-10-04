// 浏览历史（BrowsingHistory）**跨文件接线守卫**（ADR-0219 §2.1-§2.5 / spec
// docs/specs/lynx-continue-reading-and-browsing-history.md / 票 #927 验收项）。
//
// 📦 **按被测对象拆缝**（门禁冻结线规模线：单个门禁文件 ≤ 被测对象 30%）。
//    本文件断言的是**接线**——`historyStore.record(...)` 落在哪个页面、`/continue` 页
//    怎么分流、路由表里有没有 `/history`、类型徽章的 i18n 键有没有消费点。被测对象是
//    「这些文件之间的关系」，**不是** `browsingHistoryStore.ts` 的行为。留在 store 行为
//    文件里会把 282 行的 store 当分母、把整 app 的接线成本算到它头上（超标 219% 的主因之一）。
//    命名沿用仓库既有 `*.template.test.ts` 约定（.vue 不经 vitest 渲染，模板/源码接线以
//    源级断言做机器防线；先例 pages/watchLaterPage.template.test.ts、pages/novelDetailTemplate.test.ts
//    ——后者同样跨 `router.ts` / `utils/` 读源码，不只读那一个 .vue）。`Wiring` 后缀标明
//    「这一份守卫的是接线而非 store 行为」。断言、测试名、注释自原
//    browsingHistoryStore.test.ts 逐字搬运，未作任何改动。
//
// 期望值溯源（测试硬约束 #6：不自洽反推，每条指回一条已拍板决策或票面 AC）：
// - 打开插画详情页**即**产生/更新记录，快照取自该次响应（零新增网络请求）      → 票 #927 AC #1
// - 详情加载失败 ⇒ 显式标注已有记录不可用（不静默隐藏）                        → AC #10
// - 两类条目进**同一个** `/continue` 页；不建 `/history`、不扩第 4 段            → ADR-0219 §2.1 + AC #3
// - 两轴接线互不交叉（AC #12）+ 术语文档易混辨析 #1（store 间零 import/调用）
// - 段 3 与 /continue 的骨架/空态条件以**合并列表**为准（退回单轴即红）          → ADR-0219 §2.1
// - 行内状态文案只由 chapterNo 决定（插画恒 null ⇒ 永不渲染「第N话」）            → ADR-0219 §2.1
// - i18n 占位符是 `{{name}}`；单花括号会被 applyVars 原样返回（键在、行里显示字面量）
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
// t() 是纯函数（locale = 模块级 ref，默认 zh-CN）⇒ 可直测插值是否真的生效
import { t } from "../i18n"

// ─── 源级守卫（票 #927 验收项 / ADR-0219 §2.1-§2.5）────────────────────────────
// 守卫防的是「有人把接线拆了而 store 用例全绿」。⚠️ 每条都做过**反事实检验**：
//   把被守卫的代码删掉/改坏，这条断言必须变红；只匹配「标识符存在」的一律不写
//   （上一票的教训：那种守卫对着死代码恒绿）。
describe("源级守卫（票 #927 / ADR-0219 §2.1-§2.5）", () => {
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

  it("插画详情页在**详情落地后立刻**写浏览记录，且快照取自该次响应（零新增网络请求）", () => {
    const s = src("../pages/IllustDetail.vue")
    // 反事实：改成用新请求的数据构造快照、或删掉 record ⇒ 下面两条都红
    const iLoad = s.indexOf("const res = await loadDetail(")
    const iRecord = s.indexOf("historyStore.record(toIllustHistorySnapshot(res.illust)")
    expect(iLoad).toBeGreaterThan(-1)
    expect(iRecord).toBeGreaterThan(iLoad)
    // 「零新增网络请求」是可数的：全文只允许出现一次详情请求
    expect(s.match(/loadDetail\(/g) ?? []).toHaveLength(1)
  })

  it("详情加载失败 ⇒ 显式标注已有记录不可用（AC #10，不静默隐藏）", () => {
    const s = src("../pages/IllustDetail.vue")
    expect(s).toContain("historyStore.markUnavailable(illustId.value)")
    // 反事实：把 catch 分支里这行删掉 ⇒ 转红
    const iCatch = s.indexOf("} catch (err) {")
    const iMark = s.indexOf("historyStore.markUnavailable(illustId.value)")
    expect(iCatch).toBeGreaterThan(-1)
    expect(iMark).toBeGreaterThan(iCatch)
  })

  it("📌 两轴接线互不交叉：插画页只碰浏览历史、小说页只碰续读（AC #12）", () => {
    // 反事实：给 NovelDetail 加一行 browsingHistory.record ⇒ 红；给 IllustDetail 加 continueReading ⇒ 红
    expect(/continueReading/i.test(src("../pages/IllustDetail.vue"))).toBe(false)
    expect(/browsingHistory/i.test(src("../pages/NovelDetail.vue"))).toBe(false)
    // 反向钉住：两条轴的写点确实各在各自那一侧（不是压根没接）
    expect(src("../pages/IllustDetail.vue")).toContain("useBrowsingHistoryStore")
    expect(src("../pages/NovelDetail.vue")).toContain("useContinueReadingStore")
  })

  it("📌 浏览历史 store 不 import / 不调用 watchLater·watchlist·continueReading 任何符号", () => {
    const impl = src("./browsingHistoryStore.ts")
    // watchlist：**零容忍**（连注释里都不该出现——它是服务端追更，与本地两条轴无关）
    expect(/watchlist/i.test(impl)).toBe(false)
    // watchLater / continueReading：只禁**代码**（import / 调用），
    // 注释里引用「先例 watchLaterStore」「另一 store continueReadingStore」是合法文档
    expect(/from ["'][^"']*watchLater/i.test(impl)).toBe(false)
    expect(/useWatchLaterStore/i.test(impl)).toBe(false)
    expect(/from ["'][^"']*continueReading/i.test(impl)).toBe(false)
    expect(/useContinueReadingStore/i.test(impl)).toBe(false)
  })

  it("📌 段 3 的骨架/空态条件以**合并列表**为准（退回单轴即红）", () => {
    const s = src("../pages/Shelf.vue")
    expect(s).toContain('v-if="continueLoading && continueEntries.length === 0"')
    expect(s).toContain('v-else-if="continueEntries.length === 0"')
    // 反事实：把条件改回 `continueStore.items.length`（只看小说轴）⇒ 红
    expect(s).not.toContain("continueStore.items.length")
  })

  it("📌 段 3 骨架旗标等**两条轴都**落定才撤（只等小说侧会让插画段静悄悄消失）", () => {
    const s = src("../pages/Shelf.vue")
    // 反事实：把置 false 挪回小说侧自己的 finally（不等 historyDone）⇒ 红
    expect(
      s,
      "骨架旗标必须在 Promise.all([continueDone, historyDone]) 之后才撤",
    ).toMatch(/Promise\.all\(\[[^\]]*historyDone[^\]]*\]\)\.finally\(\(\) => \{\s*continueLoading\.value = false/)
    expect(s).toContain("const historyDone = historyStore")
  })

  it("📌 /continue 页渲染**合并列表**，且移除分流到两条 store（AC #3 / #7）", () => {
    const s = src("../pages/ContinueReading.vue")
    expect(s).toContain("mergeContinueEntries(continueStore.items, historyStore.items)")
    expect(s).toContain("continueStore.remove(entry.id)")
    expect(s).toContain("historyStore.remove(entry.id)")
    // 反事实：删掉 removeItem 的 else 分支 ⇒ 红
    expect(s).toContain("if (entry.kind === 'novel') continueStore.remove(entry.id)")
  })

  it("/continue 页的空态/骨架等**两轴都** ready（只等小说侧会把插画段说成「你没有」）", () => {
    const s = src("../pages/ContinueReading.vue")
    expect(s).toContain("continueStore.ready && historyStore.ready")
  })

  it("📌 混排行的点击分流：小说走 openNovel 的 resume 单点缝隙，插画走插画详情路由", () => {
    for (const page of ["../pages/Shelf.vue", "../pages/ContinueReading.vue"]) {
      const s = src(page)
      expect(s).toContain("entry.kind === 'novel'")
      expect(s).toContain("navigate(`/illust/${entry.id}`)")
      // `/intro` 串只许存在于 novelNavigation.ts（novelIntroEntryGuards 源级守卫）
      expect(s).not.toContain("/intro")
    }
  })

  it("📌 AC #3：不新建 `/history` 页、也不扩为第 4 段（路由表与段数都没动）", () => {
    const r = src("../router.ts")
    expect(r).not.toContain("'/history'")
    expect(r).not.toContain('"/history"')
    // `/continue` 仍是**唯一**的完整列表次级页
    expect(r.match(/path: '\/continue'/g) ?? []).toHaveLength(1)
  })

  it("📌 类型徽章的 i18n 键既有定义**也有消费点**（上一票的教训：只定义不消费 = 死键）", () => {
    const row = src("../components/ContinueRow.vue")
    for (const key of ["continue.badge.novel", "continue.badge.illust"]) {
      expect(row, `${key} 无消费点`).toContain(`t('${key}')`)
      expect(src("../i18n/locales/zh-CN/pages.ts")).toContain(`"${key}"`)
      expect(src("../i18n/locales/en/pages.ts")).toContain(`"${key}"`)
    }
    // 徽章还要进无障碍标签：整行挂了 accessibility-label，子文本不再被朗读
    expect(row).toContain("t('continue.open', { type: typeBadge.value })")
  })

  it("📌 行内状态文案只由 chapterNo 决定（插画恒 null ⇒ 永不渲染「第N话」）", () => {
    const row = src("../components/ContinueRow.vue")
    // 反事实：改回按 store 条目现算 decideContinueLabel(item) ⇒ 红
    expect(row).toContain("entry.chapterNo === null")
  })
})

describe("i18n 插值真的生效（行为断言，不是「键存在」）", () => {
  // ⚠️ 本仓 `t()` 的占位符是 `{{name}}`（i18n/index.ts 的 applyVars 只替换双花括号）。
  //   写成单花括号 `{name}` 时 t() **原样返回**——键在、守卫全绿、行里却显示字面量「{n}」。
  //   票 #926 的 `continue.label.chapter` 就是这样坏的（小说行显示「上次读到 第{n}话」），
  //   本组用例把它钉死。期望值溯源：i18n/index.ts applyVars 的实现 + 两份 locale 的写法。
  it("章节文案：t() 真的把 {{n}} 换成话数（单花括号 = 静默失效）", () => {
    const out = t("continue.label.chapter", { n: "3" })
    expect(out).toContain("3")
    expect(out).not.toContain("{n}")
  })

  it("行无障碍标签：t() 真的把 {{type}} 换成类型徽章文案", () => {
    const out = t("continue.open", { type: t("continue.badge.novel") })
    expect(out).toContain(t("continue.badge.novel"))
    expect(out).not.toContain("{type}")
  })

  // ⚠️ 上面两条只覆盖**当前 locale**（`t()` 读 `DICTS[locale.value]`）——
  //   另一侧写坏时它们照样绿（本次就先踩到：只改 zh-CN 时 50 条全过，
  //   改 en 才转红）。故补一条**逐字两侧都查**的守卫。
  it("📌 两侧 locale 的占位符都必须是 {{}}，缺一侧即红", () => {
    for (const loc of ["zh-CN", "en"] as const) {
      const src = readFileSync(
        new URL(`../i18n/locales/${loc}/pages.ts`, import.meta.url),
        "utf-8",
      )
      for (const key of ["continue.label.chapter", "continue.open"]) {
        const line = src.split("\n").find((l) => l.includes(`"${key}":`))
        expect(line, `${loc} 缺 ${key}`).toBeDefined()
        // 单花括号 {x} 会被 applyVars 原样返回 ⇒ 行内显示字面量
        // ⚠️ lookaround 必需：`{{n}}` 内部也含 `{n}` 子串，纯 /\{[^{}]+\}/ 会误判
        expect(line, `${loc}/${key} 含单花括号占位符`).not.toMatch(/(?<!\{)\{[^{}]+\}(?!\})/)
        expect(line, `${loc}/${key} 缺 {{}} 占位符`).toMatch(/\{\{[^{}]+\}\}/)
      }
    }
  })
})
