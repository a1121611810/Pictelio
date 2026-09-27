// ─── 标签近邻编排内核（ADR-0197 D2/D3/D4/D5/D6/D7/D8/D9/D10）───
// 深模块：两阶段的**全部**分支逻辑（阶段推进、终止条件、相似度、排序、去重、
// 门控、跳过原因）收进这一个注入依赖的纯函数，页面与 store 只喂依赖、只渲染产出。
// deps 注入（对齐 createWatchlistPrompt 风格）→ node 可单测，测试用假 deps，
// 不碰真实 API 模块（vitest environment=node，无 .vue/.api transform）。
//
// oracle：docs/adr/ADR-0197-app-lynx-tag-neighbors.md + packages/app-lynx/docs/specs/tag-neighbors.md
//   - D2 两阶段：阶段 1 作者优先一次扫完候选集（API 成本在拉列表，不在算相似度）；
//     阶段 2 全站兜底仅在阶段 1 <5 条时触发
//   - D3 降维规则：第 k 层用标签序列**原始顺序**的前 k 个（= 收掉尾部关联度最低者），
//     不做全子集枚举
//   - D4 相似度：Jaccard = 共同/并集；运算与检索**一律用 tag.name 原名**（D10）
//   - D5 阶段 1 门槛 30%、上限 20 条
//   - D6 阶段 2 终止：本页条数 ≥5（⚠️ 判据成立依赖不变量 PAGE_SIZE > 阈值，见
//     §更正记录 1 与本文件 PHASE2_ENOUGH 注释）
//   - D7 跨阶段去重 + 排除自身
//   - D8 标签数 <2 跳过阶段 1 并**产出原因说明**（不静默）
//   - D9 Jaccard 降序，同分按发布时间新→旧
//   - D16 R18/R18G 门控经注入判定，不新造
//
// 降级策略（AGENTS.md 测试硬约束 #3「禁止静默降级」）：本函数**不吞错误也不打日志**
// （保持纯函数），逐阶段的失败被收集进 `failures` 返回，由调用方 console.warn
// 并决定如何呈现。文案不进本函数（store 同样只存纯数据载荷），原因用**枚举码**表达，
// 由宿主 `t()` 渲染。
//
// 竞态：signal 由调用方注入并在每次 await 后透传；上层 store 另配 generation-gate
// （对齐 createMixFeed.ts:103-114 / createWatchlistPrompt.ts:93）。
// AbortSignal 取全局类型（tsconfig lib 含 DOM），与 api/illust.ts 等既有文件一致。

/** 最小结构类型：不 import API 层实体，保持纯函数可在 node 环境单测 */
export interface NeighborIllustLike {
  id: number
  tags: { name: string }[]
  create_date: string
  x_restrict: number
}

/** 检索/列表响应结构（实测 `/v1/search/illust`、`/v1/user/illusts` 一致） */
export interface NeighborPage<T> {
  illusts: T[]
  next_url: string | null
}

// ─── 阈值（ADR-0197 D5，均**不可配置**，ADR-0197 §阈值）───

/** 阶段 1 候选上限：作者近 ≤300 张（≈10 页；活跃画师可达数千张，不扫全量） */
export const PHASE1_CANDIDATE_CAP = 300
/** 阶段 1 相似度门槛：Jaccard ≥ 30%（低于此视为噪音） */
export const PHASE1_MIN_SCORE = 0.3
/** 阶段 1 条数上限 */
export const PHASE1_MAX_RESULTS = 20
/** 阶段 2「够数」阈值：某层达到即停止放宽 */
export const PHASE2_ENOUGH = 5

/**
 * Pixiv 检索固定页大小（实测 `/v1/search/illust` 与 `/v1/user/illusts` 均 30/页）。
 *
 * ⚠️ **D6 判据的正确性依赖本不变式**：Pixiv 检索的 `total` 字段**不存在**（响应只有
 * `illusts` / `next_url` / `search_span_limit`；`/v2/search/illust` 端点亦不存在），
 * 故「够数」只能用本页条数判。之所以可靠：满页恒为 30（≫ PHASE2_ENOUGH=5），本页 ≥5
 * 蕴含全站 ≥5；而**结果集不足一页时 `next_url` 必为 `null`**（实测 `ホビィ` 4 条 +
 * `next_url=null`、`川崎 Sera` 0 条 + `null`），此时本页即全量。
 * 证据：`docs/research/verify-tag-neighbors-api.sh`、ADR-0197 §更正记录 1。
 * **若 PHASE2_ENOUGH 被调到 ≥ PAGE_SIZE，本判据失效**，届时须改为按 next_url 累计翻页。
 */
export const SEARCH_PAGE_SIZE = 30

/**
 * 阶段 1 的翻页请求数硬闸。API 层**无通用退避**（ADR-0197 §后果：连续请求会放大
 * 对 App API 的压力），故除条目上限外再加一道请求数闸，防止页大小被改动时请求量失控。
 *
 * 30/页下 300 条恰好 10 页，本闸在当前配置下不生效——它是**页大小变更时的兜底**，
 * 故以「翻页请求数不超过该值」这一可观察行为被测试钉死，而非依赖它当前的数值。
 */
export const PHASE1_MAX_REQUESTS = 12

/** 阶段来源（结果条目的来源标注，spec user story 8 / 19） */
export type TagNeighborSource = "author" | "sitewide"

/** 跳过阶段 1 的原因码（spec user story 30：必须说明，不静默） */
export type TagNeighborSkipReason = "tooFewTags"

/** 某一阶段失败的记录（宿主据此 console.warn，AGENTS.md 硬约束 #3） */
export interface TagNeighborFailure {
  phase: 1 | 2
  /** 阶段 2 时为该层使用的标签序列（便于定位是哪层炸了） */
  layer?: string[]
  message: string
}

export interface TagNeighborEntry<T> {
  illust: T
  /** Jaccard 相似度，0~1（渲染为百分比） */
  score: number
  /** 共同标签数（与 source 作品比对） */
  commonTags: number
  /**
   * 标签并集数（Jaccard 分母）。作用是让相似度**可审计**（可反推 score = common / union）。
   * 产品侧当前**无渲染点**：store 的行模型不暴露它，仅由 store 级断言消费。
   * 保留而非删除的理由：删掉后 score / commonTags 会失去可验证的推导依据。
   */
  unionTags: number
  /** 来源作品的标签总数（渲染「共同标签数 / 源作品标签总数」双值） */
  sourceTagCount: number
  source: TagNeighborSource
}

export interface CollectTagNeighborsResult<T> {
  entries: TagNeighborEntry<T>[]
  /** 阶段 1 因 ADR-0197 D8 被跳过时的原因码；null = 阶段 1 已执行 */
  phase1SkippedReason: TagNeighborSkipReason | null
  /** 阶段 2 是否被触发（UI 据此渲染「正在放宽标签范围…」提示行，spec user story 14） */
  phase2Ran: boolean
  /** 阶段 2 实际跑到的最后一层所用标签序列（可解释性：用户能看到放宽到几个标签） */
  phase2LastLayer: string[] | null
  /** 逐层放宽的调用轨迹（每层实际使用的标签串），供 UI/测试观察放宽过程 */
  phase2Layers: string[][]
  failures: TagNeighborFailure[]
  /**
   * 被门控判定拦下的条目数（ADR-0197 D16 / spec user story 27「不静默」）。
   *
   * 内核保持纯逻辑，故只**计数**不自行呈现；由宿主渲染成可见说明。
   * 之所以必须有这个数：`isRestricted` 是注入的门控谓词（R18/R18G + AI 三态 + 静音标签
   * 三条在 store 侧链式合成），条目被它拦下时内核此前是静默 `continue` —— 用户看不到
   * 「结果里少了东西」，违反 D16「不做静默过滤」与 CONTEXT.md 的取值纪律。
   * 计数让过滤**可见**，而「可见成什么样」由 UI 决定。
   */
  gatedCount: number
}

export interface TagNeighborDeps<T extends NeighborIllustLike> {
  /**
   * 拉作者作品的一页。`cursor` 为 null 表示首页，之后传上页的 `next_url`
   * （app-lynx 分页一律走 next_url 游标：全仓零 page/per_page 端点参数）。
   */
  fetchUserIllustsPage: (cursor: string | null, signal?: AbortSignal) => Promise<NeighborPage<T>>
  /**
   * 按标签组合做全站插画检索。参数为该层使用的标签序列（调用方负责 join(' ') 并经
   * `@pictelio/search-core` 的 `buildIllustSearchRequest` 构建参数，ADR-0197 D13）。
   */
  searchIllustByTags: (tagNames: string[], signal?: AbortSignal) => Promise<NeighborPage<T>>
  /** R18/R18G 门控判定（注入既有语义，如 settingsStore.isRestricted，ADR-0197 D16） */
  isRestricted: (illust: T) => boolean
  /**
   * 阶段 2 启动瞬间的回调（可选）。编排是**单次 await 完成**的两阶段过程，宿主在结果
   * 落定前看不到任何中间态——但 spec user story 14 要求用户看到「正在放宽标签范围…」。
   * 故内核在进入阶段 2 循环前**同步**回调一次，让宿主立即把提示行亮出来；
   * 内核本身不感知 UI（不返回进度、不持有文案）。
   * 不提供时全部断言照旧（可选注入点，故 12 条断言不因此变化）。
   */
  onPhase2Start?: () => void
}

export interface CollectTagNeighborsInput<T extends NeighborIllustLike> {
  /** 当前作品（相似度基准） */
  source: T
  /** 当前作品的作者 id（阶段 1 用） */
  authorId: number
  deps: TagNeighborDeps<T>
  signal?: AbortSignal
}

/**
 * Jaccard 相似度 = |共同标签| / |标签并集|。
 *
 * oracle：Jaccard 的集合定义（ADR-0197 D4 引为标准口径）。选它而非「共同标签数」/
 * 「包含率」的理由见 ADR-0197 D4 与其否决表——前两者对标签集合规模敏感或失真。
 *
 * 标签按**原名精确匹配**（D4/D10：日英分属不同命名空间，混算会漏配，取舍已接受）。
 */
export function jaccardTagSimilarity(a: string[], b: string[]): {
  score: number
  common: number
  union: number
} {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return { score: 0, common: 0, union: 0 }
  let common = 0
  for (const tag of setA) if (setB.has(tag)) common++
  const union = setA.size + setB.size - common
  // 两边皆空已在上面返回；此处 union=0 仅可能来自「一方空且另一方非空」以外的退化输入，
  // 显式守卫避免除零产出 NaN（NaN 会静默让所有比较为 false，是最坏的失败形态）
  if (union === 0) return { score: 0, common: 0, union: 0 }
  return { score: common / union, common, union }
}

/** 取作品标签的原名序列（D4/D10：不用 translated_name，实测大量为 null） */
function tagNamesOf(illust: NeighborIllustLike): string[] {
  return illust.tags.map((tag) => tag.name)
}

/**
 * 编排两阶段检索，产出合并排序后的近邻列表。
 *
 * 全程不抛业务错误（逐阶段失败进 `failures`），只有 `signal` 中止会向上抛
 * （由调用方 generation-gate 吞掉陈旧响应）。
 */
export async function collectTagNeighbors<T extends NeighborIllustLike>(
  input: CollectTagNeighborsInput<T>,
): Promise<CollectTagNeighborsResult<T>> {
  const { source, authorId, deps, signal } = input
  const sourceTags = tagNamesOf(source)
  const failures: TagNeighborFailure[] = []
  /** 跨阶段去重的 id 集合（D7）；先记入源作品自身，保证「排除自身」在任何阶段都生效 */
  const seen = new Set<number>([source.id])
  /** 被门控拦下的条目数（B2：过滤必须可见，不静默 continue） */
  let gatedCount = 0

  const entries: TagNeighborEntry<T>[] = []
  let phase1SkippedReason: TagNeighborSkipReason | null = null
  let phase2Ran = false
  let phase2LastLayer: string[] | null = null
  const phase2Layers: string[][] = []

  // ─── 阶段 1 · 作者优先（D2/D5/D8）───
  // D8：标签数 <2 时 Jaccard 几乎必然全低分（并集规模主导分值），无区分度 → 跳过并说明
  let authorPool: T[] = []
  if (sourceTags.length < 2) {
    phase1SkippedReason = "tooFewTags"
  } else {
    try {
      authorPool = await collectAuthorPool(deps, authorId, signal)
    } catch (err) {
      if (isAbort(err, signal)) throw err
      failures.push({ phase: 1, message: errMessage(err) })
    }
  }

  if (authorPool.length > 0) {
    const scored: TagNeighborEntry<T>[] = []
    for (const illust of authorPool) {
      // 池内去重：游标翻页期间新投稿会让同一 id 落在两页，不去重会产出重复条目 +
      // 重复 list key。门控拦下的条目同样入 seen（见阶段 2 侧同款处理），两侧口径一致
      if (seen.has(illust.id)) continue
      seen.add(illust.id)
      if (deps.isRestricted(illust)) {
        gatedCount++
        continue
      }
      const { score, common, union } = jaccardTagSimilarity(sourceTags, tagNamesOf(illust))
      // D5：门槛 30%
      if (score < PHASE1_MIN_SCORE) continue
      scored.push({
        illust,
        score,
        commonTags: common,
        unionTags: union,
        sourceTagCount: sourceTags.length,
        source: "author",
      })
    }
    scored.sort(compareEntries)
    // D5：上限 20
    // 池内已在门控前逐条 seen.add，此处无需再 add（code-review 终审 #4：原为死语句）
    for (const entry of scored.slice(0, PHASE1_MAX_RESULTS)) {
      entries.push(entry)
    }
  }

  // ─── 阶段 2 · 全站兜底（D2/D3/D6/D9）───
  // 仅当阶段 1 产出不足 PHASE2_ENOUGH 条才触发
  if (entries.length < PHASE2_ENOUGH) {
    phase2Ran = true
    // 同步回调：让宿主立刻亮出「正在放宽标签范围…」（spec user story 14）。
    // 放在 phase2Ran 之后、任何 await 之前——保证回调必在首个检索请求发出前到达。
    deps.onPhase2Start?.()
    // D3：逐层放宽，每层一个组合。标签序列保持接口原序（实测即关联度降序），不重排。
    // 标签数 <2 已被 D8 挡在阶段 1，此处 n≥2；n=1 时只跑第 1 层后无处可收。
    for (let size = sourceTags.length; size >= 1; size--) {
      const layer = sourceTags.slice(0, size)
      phase2Layers.push(layer)
      let page: NeighborPage<T>
      try {
        page = await deps.searchIllustByTags(layer, signal)
      } catch (err) {
        // 失败层**不**记为 lastLayer：否则全层失败时 UI 会谎报「已放宽到 N 个标签」
        if (isAbort(err, signal)) throw err
        failures.push({ phase: 2, layer, message: errMessage(err) })
        continue
      }
      // 成功取回才推进「最后有效层」
      phase2LastLayer = layer
      for (const illust of page.illusts) {
        // D7：跨阶段去重 + 排除自身
        if (seen.has(illust.id)) continue
        // 被门控拦下的也要入 seen：否则同一受限作品命中相邻两层会被计两次，
        // 用户可见的 gatedCount 偏大（code-review 低危 3）
        seen.add(illust.id)
        if (deps.isRestricted(illust)) {
          gatedCount++
          continue
        }
        const { score, common, union } = jaccardTagSimilarity(sourceTags, tagNamesOf(illust))
        seen.add(illust.id)
        entries.push({
          illust,
          score,
          commonTags: common,
          unionTags: union,
          sourceTagCount: sourceTags.length,
          source: "sitewide",
        })
      }
      // D6：够数即停。⚠️ 口径依赖 SEARCH_PAGE_SIZE > PHASE2_ENOUGH 这一不变式，
      // 详见 SEARCH_PAGE_SIZE 注释与 ADR-0197 §更正记录 1。
      if (page.illusts.length >= PHASE2_ENOUGH) break
    }
  }

  // D9：跨阶段统一排序（Jaccard 降序，同分时间新→旧）
  entries.sort(compareEntries)

  return {
    entries,
    phase1SkippedReason,
    phase2Ran,
    phase2LastLayer,
    phase2Layers,
    failures,
    gatedCount,
  }
}

/**
 * 阶段 1 候选集：沿 `next_url` 游标翻页，累积到 PHASE1_CANDIDATE_CAP 即止。
 *
 * 三重终止条件：条目够 300 / `next_url` 为 null（到底）/ 触及请求数硬闸。
 * 另防「next_url 原地打转」导致死循环（游标去重）。
 */
async function collectAuthorPool<T extends NeighborIllustLike>(
  deps: TagNeighborDeps<T>,
  authorId: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const pool: T[] = []
  const visitedCursors = new Set<string>()
  let cursor: string | null = null
  let requests = 0
  while (pool.length < PHASE1_CANDIDATE_CAP && requests < PHASE1_MAX_REQUESTS) {
    if (cursor !== null) {
      if (visitedCursors.has(cursor)) break
      visitedCursors.add(cursor)
    }
    requests++
    const page = await deps.fetchUserIllustsPage(cursor, signal)
    pool.push(...page.illusts)
    if (page.next_url === null) break
    cursor = page.next_url
  }
  return pool.slice(0, PHASE1_CANDIDATE_CAP)
}

/** D9：Jaccard 降序；同分按发布时间新→旧（create_date 为 ISO 字符串，字典序即时间序） */
function compareEntries<T extends NeighborIllustLike>(
  a: TagNeighborEntry<T>,
  b: TagNeighborEntry<T>,
): number {
  if (b.score !== a.score) return b.score - a.score
  if (a.illust.create_date !== b.illust.create_date) {
    return a.illust.create_date < b.illust.create_date ? 1 : -1
  }
  // 稳定兜底：同分同时间按 id 升序，保证排序全序（避免依赖引擎稳定性的隐式行为）
  return a.illust.id - b.illust.id
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && err.name === "AbortError"
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
