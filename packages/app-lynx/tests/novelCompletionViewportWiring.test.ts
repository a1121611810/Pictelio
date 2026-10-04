// 完成判定**前置条件**的接线面源级守卫（ADR-0219 §2.3 / ADR-0219 §2.3 触底前置）。
//
// 守卫防的是「有人把接线拆了/换成 setup 期固化，而纯函数用例全绿」。
// 纯函数面（单位换算、前置语义、降级）→ `src/primitives/novelContentFitsViewport.test.ts`。
//
// ## 为什么这里全是源级断言
// 前置的真实输入（正文段数、中位段高、原生内容区尺寸）都是组件内部状态，node 里没有
// LynxView 可渲染 ⇒ 只能在源上钉。代价是**锚点漂移即假绿**，故：
// ⚠️ **锚点找不到一律 `expect(...).toBeGreaterThan(-1)` 即红**，绝不 `if (!found) return`
//   （本仓 v1 版守卫栽在这条上：模板换行一变就命中兜底 ⇒ 守卫恒绿、形同不存在）。
// ⚠️ 函数体按**下一个顶层 function 边界**切，不用固定字符窗口（窗口外的调用不被检查）。
//
// 每条守卫的反事实检验（临时改坏实现 → 必须转红）见交付报告；改坏点均为**代码行**、
// 且用 `git diff --stat` 断言只改了一处。
//
// 期望值溯源（测试硬约束 #6）：
// - 前置必须进判定入参         → ADR-0219 §2.3 触底行 + ADR-0219 §2.3
// - 视口不得固化在 setup        → ADR-0219 §2.3 竞态防护（旋转/分屏）
// - 拿不到视口高要 warn + 保守侧 → 测试硬约束 #3 禁静默降级 + ADR-0219 §2.3
// - 「为何不用停留时长」的理由必须在 → ADR-0219 §2.3（防后人重复发明同一道被否决的方案）
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf-8")

/** 从 `anchor` 处切到下一个顶层 `function `/`async function ` 边界之间的函数体 */
const bodyFrom = (s: string, anchor: string): string => {
  const start = s.indexOf(anchor)
  expect(start, `锚点「${anchor}」未命中 ⇒ 本守卫已失效（不是通过，是没检查到）`).toBeGreaterThan(-1)
  const end = s.indexOf("\nfunction ", start + 1)
  const endAsync = s.indexOf("\nasync function ", start + 1)
  const cands = [end, endAsync].filter((n) => n !== -1)
  const stop = cands.length > 0 ? Math.min(...cands) : s.length
  return s.slice(start, stop)
}

const NOVEL_DETAIL = "../src/pages/NovelDetail.vue"

describe("接线面：前置条件真的进了完成判定（ADR-0219 §2.3 / ADR-0219 §2.3）", () => {
  it("📌 判定入参里带着几何前置 —— 删掉这一行 ⇒ 前置形同不存在", () => {
    const body = bodyFrom(src(NOVEL_DETAIL), "function applyCompletionDecision(")
    // 反事实：把 `contentExceedsViewport: bodyExceedsViewport(),` 这行删掉 ⇒ 转红
    expect(
      body,
      "判定入参缺 contentExceedsViewport ⇒ 一屏放得下仍会当场软删，ADR-0219 §2.3 缺陷复发",
    ).toMatch(/contentExceedsViewport:\s*bodyExceedsViewport\(\)/)
    // 反向钉住：前置喂的是**解算结果**，不是就地写死的 true
    expect(body).not.toMatch(/contentExceedsViewport:\s*true\b/)
  })

  it("📌 前置的唯一来源是几何解算（不是把 measured 当成可滚）", () => {
    const body = bodyFrom(src(NOVEL_DETAIL), "function bodyExceedsViewport(")
    // ⚠️ **必须钉「赋值自一次调用」，不能只钉标识符出现过**（反事实实证）：
    //   把 `resolveNovelContentGeometry({...})` 换成自造对象、只把函数名留在
    //   `as ReturnType<typeof resolveNovelContentGeometry>` 这类**类型标注**里，
    //   「函数名出现过」这条断言照样绿 —— 那正是本仓连续三次栽的形态
    //   （守卫对着死代码恒绿）。故这里匹配的是 `= resolveNovelContentGeometry({`。
    expect(
      body,
      "前置未走几何解算调用 ⇒ 内容高与视口高没在同一基准上比较（换算错也无人发现）",
    ).toMatch(/=\s*resolveNovelContentGeometry\(\{/)
    // 返回的必须是解算出的那一项，不是自行拼的判断
    expect(body).toContain("return geometry.contentExceedsViewport")
    // 两个入参都来自真实状态：正文段数 + 中位段高（且确实传进了那次调用）
    expect(body).toMatch(/paragraphCount:\s*paragraphs\.value\.length/)
    expect(body).toMatch(/avgParagraphHeightPx:\s*estimatedHeightPx\.value/)
  })
})

describe("接线面：视口高不得固化在 setup（ADR-0219 §2.3 竞态防护）", () => {
  it("📌 每次判定前都重拉内容区尺寸（旋转/分屏 ⇒ 契约无推送，只能重拉）", () => {
    const s = src(NOVEL_DETAIL)
    // 锚点是**重拉函数本身**而非标识符出现
    const refresh = bodyFrom(s, "function refreshViewportSize(")
    expect(
      refresh,
      "重拉函数未真正订阅契约（refreshViewportSize 变成空壳）",
    ).toContain("subscribeViewportSize(")
    expect(refresh, "新尺寸落地后未回调调用方 ⇒ 旋转后前置停在旧视口").toMatch(/after\(\)/)
    // 判定入口必须调它（两个判定时机：触底 + 坐标落地后）
    const evaluate = bodyFrom(s, "function evaluateCompletion(")
    expect(
      evaluate,
      "完成判定不再重拉视口 ⇒ 旋转/分屏后前置条件不更新（竞态防护硬约束 #3）",
    ).toContain("refreshViewportSize(")
  })

  it("📌 尺寸存 ref 而非 setup 期 const（固化即竞态）", () => {
    const s = src(NOVEL_DETAIL)
    // 📌 锚点是**完整声明语句**（含 `ref<`）：把它改成普通 const / 一次性快照，
    //   这条精确匹配就落空 ⇒ 上面的 toBeGreaterThan(-1) 直接转红。
    //   （不再另写一条「不得是 const」的正则反证：`/const\s+X\s*=\s*(?!ref<)/` 这类
    //    负向断言会因 `\s*` 回溯而匹配到它自己描述的那一行，是自指的假红。）
    const i = s.indexOf("const viewportSize = ref<ViewportContentSize | null>(null)")
    expect(i, "视口尺寸不再存 ref（被拍平成 setup 期常量 ⇒ 旋转后不更新）").toBeGreaterThan(-1)
    // 前置读的是 .value（每次判定重新求值）
    const body = bodyFrom(s, "function bodyExceedsViewport(")
    expect(
      body,
      "前置未读 viewportSize.value ⇒ 尺寸被固化在 setup，旋转后不更新",
    ).toContain("viewportSize.value")
  })

  it("📌 onMounted 首拉一次（首帧 scrolltolower 早于任何用户滚动，尺寸得先在手）", () => {
    const s = src(NOVEL_DETAIL)
    const i = s.indexOf("onMounted(() => {\n  void loadNovel()")
    expect(i, "锚点 onMounted 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const end = s.indexOf("})", i)
    const body = s.slice(i, end)
    expect(body, "首拉缺失 ⇒ 首帧判定时尺寸还在飞，降级为保守侧（漏完成）").toContain(
      "refreshViewportSize(",
    )
  })
})

describe("接线面：拿不到视口高不得静默（测试硬约束 #3 / ADR-0219 §2.3）", () => {
  it("📌 降级显式 warn 一次，且措辞点明保守侧（条目保留、不标记完成）", () => {
    const body = bodyFrom(src(NOVEL_DETAIL), "function bodyExceedsViewport(")
    // 反事实：删掉这段 warn ⇒ 转红（降级变成静默，测试硬约束 #3）
    expect(body, "视口高不可得时未 warn ⇒ 静默降级（测试硬约束 #3）").toContain("console.warn(")
    // 模块前缀约定：warn 必带模块前缀
    expect(body).toMatch(/console\.warn\(\s*'\[novel-detail\]/)
    // 必须写明取了哪一侧 + 为什么（否则后人无从判断这是有意降级还是漏判）
    expect(body).toMatch(/不标记完成|保留在继续读列表/)
  })

  it("📌 降级侧是「不完成」—— 断言在纯函数面（保守侧 ⇒ contentExceedsViewport=false）", () => {
    // 本条只做交叉引用钉住：具体断言在 novelContentFitsViewport.test.ts 的
    // 「降级：两者皆无 ⇒ viewportHeightPx=null + measured=false + 取保守侧 false」。
    // 这里钉住降级的**去重**：warn 一本只吵一次（否则每次判定都刷屏）
    const body = bodyFrom(src(NOVEL_DETAIL), "function bodyExceedsViewport(")
    expect(body, "warn 未去重 ⇒ 每次判定都刷屏").toContain("viewportHeightWarned")
  })
})

describe("决策留痕：为何不用停留时长（ADR-0219 §2.3，防重复发明）", () => {
  it("📌 理由句必须写在判定函数上（删掉 ⇒ 后人会把被否决的方案再发明一次）", () => {
    const s = src("../src/stores/continueReadingStore.ts")
    const i = s.indexOf("/**\n * 完成判定（")
    expect(i, "锚点 完成判定 文档注释未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const end = s.indexOf("\nexport function decideNovelCompletion", i)
    const doc = s.slice(i, end)
    expect(
      doc,
      "判定函数上丢了「为何不用停留时长」的理由 ⇒ 最小停留时长常量会被当先例重新提案",
    ).toContain("为何不用停留时长")
    // 理由要落在「客观事实 vs 任意阈值」这层区别上，不只是提一句「不用」
    expect(doc).toMatch(/任意阈值|客观事实/)
  })

  it("📌 展开版留痕在几何模块上，且**点名**被引为先例的那个常量（防后人找不到出处）", () => {
    const s = src("../src/primitives/novelContentFitsViewport.ts")
    expect(s, "几何模块头注丢了「为何不用停留时长」的展开版").toContain("为何不用停留时长")
    // 点名先例常量：只写「有先例」不写是哪个，后来人无从查证、只会凭印象重提
    expect(
      s,
      "展开版未点名先例常量名 ⇒ 「确有先例」这句话不可查证",
    ).toContain("WATCHLIST_PROMPT_MIN_DWELL_MS")
    // 还要写清否决的理由（任意阈值 / 客观事实这层区别）
    expect(s).toMatch(/任意阈值|客观事实/)
  })

  it("📌 入参面仍不得出现停留时长 / 滚动百分比（ADR-0219 §2.3 沿用 #928 的反例守卫口径）", () => {
    const s = src("../src/stores/continueReadingStore.ts")
    const iStart = s.indexOf("export interface NovelCompletionInput {")
    expect(iStart, "锚点 NovelCompletionInput 未命中 ⇒ 本守卫已失效").toBeGreaterThan(-1)
    const iEnd = s.indexOf("\n}", iStart)
    expect(iEnd, "未能匹配 NovelCompletionInput 的闭合").toBeGreaterThan(iStart)
    const body = s.slice(iStart, iEnd)
    // ⚠️ 新前置字段名不得含这些词：contentExceedsViewport 是「内容 vs 视口」，不是「段内进度」
    expect(body, "完成判定入参出现段内信号字段").not.toMatch(
      /dwell|elapsed|scrollPct|scrollRatio|progress|percent|readSeconds/i,
    )
    // 反向钉住：前置字段真的在入参里
    expect(body).toContain("contentExceedsViewport: boolean")
  })
})

describe("本票不引入 i18n 文案 ⇒ 两侧 locale 不得被顺手改动", () => {
  it("📌 完成判定全程静默（无新增用户可见文案）——出现新键反而说明有人加了提示", () => {
    // 期望值溯源：ADR-0219 §2.3 的修法只收紧判定口径，不新增任何面向用户的提示。
    // 反事实：有人在降级路径上塞一句 t('…') 提示 ⇒ 本守卫转红（那需要走 i18n 评审 + 两侧 locale）
    const s = src(NOVEL_DETAIL)
    const body = bodyFrom(s, "function bodyExceedsViewport(")
    expect(body, "前置路径引入了 i18n 文案（本票不新增文案）").not.toMatch(/\bt\(['"]/)
  })
})
