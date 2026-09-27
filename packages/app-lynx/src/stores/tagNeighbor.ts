// ─── 标签近邻 store（ADR-0197 D2/D5/D6/D7/D8/D13/D16 / spec docs/specs/tag-neighbors.md）───
// 职责分层（对齐 stores/notificationStore.ts 的「纯函数 + 消费面 + 状态」三段形态）：
//   - 纯函数（本文件导出，node 可单测，不触网）：
//       formatTagNeighborFailure    单条失败记录 → 可读描述（阶段 + 放宽层标签 + 原始 message）
//       summarizeTagNeighborFailures 失败列表 → 错误槽位文案（'; ' 连接；空数组 → ''）
//       buildTagNeighborRows        结果条目 → 渲染行模型（百分比 / 双值 / 来源码 / 标签截断）
//   - deps 接线（ADR-0197 D13：复用既有 API 与既有搜索核心，不自造参数拼装层）：
//       createTagNeighborDeps       作者页 → loadUserIllusts / loadNext；全站检索 → searchIllust
//   - Pinia 状态：结果集 + 阶段可解释字段 + 首载落定态；竞态防护走 generation + AbortController
//     （对齐 createMixFeed.ts:103-114 / :236-274 的在途丢弃范式）。
//
// 编排内核 collectTagNeighbors 是**纯函数**（两阶段全部分支逻辑都在里面），本 store 只做三件事：
//   ① 喂依赖（作者 id / 门控 / 取消信号）；② 把内核产出的枚举码与数值搬进状态；
//   ③ 失败显式化（console.warn + 错误槽位，AGENTS.md 硬约束 #3 禁止静默降级）。
//
// i18n 纪律：**store 零文案**。跳过原因以枚举码（TagNeighborSkipReason）存，来源以
// TagNeighborSource 码存，「文案在宿主 t() 渲染」（否则语言切换失效，标签近邻全键均受
// noDeadKeys/硬编码门禁约束）。errorMessage 是**技术错误串**（内核 message / presentError），
// 与 i18n 文案不同源。呈现口径与 Notifications.vue 一致（页脚/整页错误槽直接渲染技术
// message 原文，不经 presentError 二次包装）；仅**整页失败**这一路走 presentError。
//
// 先渲染后加载：store 初始化**不发请求**（AGENTS.md 硬约束 ①），由页面 onMounted 调 load()。
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { loadDetail, loadNext, loadUserIllusts } from '../api/illust'
import { searchIllust } from '../api/search'
import { toIllustId, toUserId } from '../api/id'
import type { PixivIllust, PixivIllustTag } from '../api/types'
import {
  collectTagNeighbors,
  type TagNeighborDeps,
  type TagNeighborEntry,
  type TagNeighborFailure,
  type TagNeighborSkipReason,
  type TagNeighborSource,
} from '../primitives/collectTagNeighbors'
import { useSettingsStore } from './settingsStore'
import { presentError } from '../utils/errorPresentation'
import { thumbUrl } from '../utils/imageUrl'

/** 页级状态机：idle（未发起）/ loading（在途）/ ready（落定，含 0 条）/ error（落定为失败） */
export type TagNeighborStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 行内可点标签上限：沿用作品详情页标签行的呈现口径（IllustDetail.vue 模板里的 `slice(0, 8)`），
 * 不自创数字——近邻卡与详情卡的标签行形态一致，读屏/视觉预期同款。
 */
export const TAG_NEIGHBOR_ROW_TAG_LIMIT = 8

// ─── 纯函数：失败信息映射（AGENTS.md 硬约束 #3 的可测部分）───

/**
 * 单条失败 → 可读描述：`phase N[ tags=[<放宽层标签>]]: <原始 message>`。
 * 阶段 2 的 layer 是定位「是哪层炸了」的唯一线索（内核注释同款理由），故并入描述。
 */
export function formatTagNeighborFailure(f: TagNeighborFailure): string {
  const layer = f.layer && f.layer.length > 0 ? ` tags=[${f.layer.join(' ')}]` : ''
  return `phase ${f.phase}${layer}: ${f.message}`
}

/**
 * 失败列表 → 错误槽位文案。空数组 → ''（无失败即无错误文案）。
 * 「无失败」不是静默：内核逐阶段收集 failures，任一失败必在此可见（并由 store console.warn）。
 */
export function summarizeTagNeighborFailures(failures: TagNeighborFailure[]): string {
  return failures.map(formatTagNeighborFailure).join('; ')
}

// ─── 纯函数：结果 → 渲染行模型 ──

export interface TagNeighborRow {
  /** list-item :key（`n-<id>`；id 全局唯一 → key 稳定唯一，Notifications 同款口径） */
  key: string
  illustId: number
  title: string
  /** 封面（经 thumbUrl 走 /pixiv-img 代理，禁直连 pximg 域） */
  thumb: string
  /** 相似度百分比 0~100 整数（spec user story 6「如 80%」；Jaccard 0~1 ×100 后取整） */
  scorePercent: number
  /** 共同标签数（user story 7 双值左值） */
  common: number
  /** 源作品标签总数（user story 7 双值右值） */
  total: number
  /** 来源码；宿主经 t() 翻成文案——store 零文案（语言切换即时生效） */
  source: TagNeighborSource
  /** 卡片上的可点标签（截断口径见 TAG_NEIGHBOR_ROW_TAG_LIMIT） */
  tags: PixivIllustTag[]
}

/** 条目 → 行模型（顺序即内核的 Jaccard 降序，spec user story 20/21；此处不再排序） */
export function buildTagNeighborRows(entries: TagNeighborEntry<PixivIllust>[]): TagNeighborRow[] {
  return entries.map((e) => ({
    key: `n-${e.illust.id}`,
    illustId: e.illust.id,
    title: e.illust.title,
    thumb: thumbUrl(e.illust.image_urls),
    scorePercent: Math.round(e.score * 100),
    common: e.commonTags,
    total: e.sourceTagCount,
    source: e.source,
    tags: e.illust.tags.slice(0, TAG_NEIGHBOR_ROW_TAG_LIMIT),
  }))
}

// ─── deps 接线（ADR-0197 D13）───

/**
 * 内核的三个注入点各接一个既有函数（不自造参数拼装层）：
 *   - fetchUserIllustsPage：首页 loadUserIllusts（type='illust'，D2 只扫插画），
 *     之后按 next_url 游标走 loadNext（app-lynx 全仓零 page/per_page 端点参数）。
 *   - searchIllustByTags：searchIllust(tagNames.join(' '), 'date_desc')——searchIllust 内部
 *     已经过 @pictelio/search-core 的 buildIllustSearchRequest，多标签自动带
 *     search_target=exact_match_for_tags（ADR-0197 D13 的真值 oracle），此处不再拼 params。
 *   - isRestricted：**三条既有门控链式合成**（ADR-0197 D16 + spec user story 27/28）：
 *     settings.isRestricted（R18/R18G 遮罩态）‖ settings.shouldHideByAi（AI 三态统一谓词，
 *     show/mask/only 语义由 settingsStore 内部收口）‖ settings.isTagMuted（静音标签，ADR-0187）。
 *     链式写在内核注入点而非内核内部，是为了让 collectTagNeighbors 保持纯逻辑（可 node 单测、
 *     门控语义只此一处）。
 *     先例更正（code-review S6）：真正同款（用 shouldHideByAi 统一 AI 三态谓词）的是
 *     pages/Recommended.vue 的内容组过滤；stores/relatedInjection.ts 用的是 isAiRestricted
 *     （仅遮罩态），与本实现口径不同，故不引为先例。
 */
export function createTagNeighborDeps(
  authorId: number,
  signal?: AbortSignal,
  onPhase2Start?: () => void,
): TagNeighborDeps<PixivIllust> {
  const settings = useSettingsStore()
  return {
    fetchUserIllustsPage: (cursor, sig) =>
      cursor === null
        ? loadUserIllusts(toUserId(authorId), 'illust', sig ?? signal)
        : loadNext(cursor, sig ?? signal),
    searchIllustByTags: (tagNames, sig) =>
      searchIllust(tagNames.join(' '), 'date_desc', sig ?? signal),
    isRestricted: (illust) =>
      settings.isRestricted(illust) || settings.shouldHideByAi(illust) || settings.isTagMuted(illust),
    // 阶段 2 启动即回调（spec user story 14 的「正在放宽…」提示需要这个中间态）
    onPhase2Start,
  }
}

/**
 * 「正在放宽标签范围…」提示行的**会话级**关闭记忆（spec user story 15 / ADR-0197 D15）。
 *
 * 内存 `Set`，**不持久化**——对齐 stores/watchlistStore.ts 的 `dismissedSeriesIds` 形态
 * （模块级单例 + Set + resetForTest），重启即清。**会话全局**而非按作品分键：
 * spec 的诉求是「不再反复出现打扰我」，故关一次即本会话不再打扰任何作品。
 * 用 Set 而非 boolean 是为与 watchlistStore 的先例保持同一形态（并为将来按来源分键留位）。
 */
const dismissedBroadeningNotices = new Set<'broadening'>()

export function isBroadeningNoticeDismissed(): boolean {
  return dismissedBroadeningNotices.has('broadening')
}

export function dismissBroadeningNotice(): void {
  dismissedBroadeningNotices.add('broadening')
}

export function resetTagNeighborSessionNoticesForTest(): void {
  dismissedBroadeningNotices.clear()
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && err.name === 'AbortError'
}

// ─── Pinia 状态 ───

export const useTagNeighborStore = defineStore('tagNeighbors', () => {
  const _entries = ref<TagNeighborEntry<PixivIllust>[]>([])
  const _status = ref<TagNeighborStatus>('idle')
  const _errorMessage = ref('')
  const _phase1SkippedReason = ref<TagNeighborSkipReason | null>(null)
  const _phase2Ran = ref(false)
  /**
   * 阶段 2 在途标志。内核 onPhase2Start **同步**点亮，编排 resolve 后**立即复位为 false**
   * （页面据此在「正在放宽…」/「已放宽到 N 个标签」之间切换）。
   * 早期版本落定后不复位，导致结果已出却仍常驻「正在…」——code-review B1 与真机走查同现。
   */
  const _phase2Running = ref(false)
  const _phase2LastLayer = ref<string[] | null>(null)
  /** 被门控（R18/AI/静音）拦下的条目数；非 0 时页面须给出可见说明（D16「不静默过滤」） */
  const _gatedCount = ref(0)
  /** 源作品共享缓存：详情页进入前写入（setSourceIllust），深链/进程恢复场景由 load() 补取 */
  const _sourceIllust = ref<PixivIllust | null>(null)

  /** 竞态代：每次 load ++，在途旧响应据此丢弃（createMixFeed 同款） */
  let generation = 0
  /** 取消闸：load 时 abort 上一轮，signal 一路透传到 apiClient（真发取消，非仅丢弃响应） */
  let currentAc: AbortController | null = null
  /** 最近一次 load 的源作品 id（retry 的重放目标） */
  let lastIllustId = 0

  function entries(): TagNeighborEntry<PixivIllust>[] {
    return _entries.value
  }
  function status(): TagNeighborStatus {
    return _status.value
  }
  function errorMessage(): string {
    return _errorMessage.value
  }
  function phase1SkippedReason(): TagNeighborSkipReason | null {
    return _phase1SkippedReason.value
  }
  function phase2Ran(): boolean {
    return _phase2Ran.value
  }
  function phase2Running(): boolean {
    return _phase2Running.value
  }
  function phase2LastLayer(): string[] | null {
    return _phase2LastLayer.value
  }
  function gatedCount(): number {
    return _gatedCount.value
  }
  function getSourceIllust(): PixivIllust | null {
    return _sourceIllust.value
  }

  /** 结果态清空（不动源作品缓存）：换源作品 / 新一轮 load / 页面卸载共用 */
  function clearResults(): void {
    _entries.value = []
    _status.value = 'idle'
    _errorMessage.value = ''
    _phase1SkippedReason.value = null
    _phase2Ran.value = false
    _phase2Running.value = false
    _phase2LastLayer.value = null
    _gatedCount.value = 0
  }

  /**
   * 详情页进入前塞源作品（AGENTS.md 数据层分流：作品对象体积大，走全局缓存不走路由参数）。
   * 顺带清结果态：源作品换了，旧近邻结果立即作废（否则新源会先闪一帧旧列表）。
   */
  function setSourceIllust(illust: PixivIllust): void {
    _sourceIllust.value = illust
    clearResults()
  }

  /**
   * 编排一次两阶段检索。
   *
   * 共享缓存优先：命中同 id 的缓存直接用（详情页入口零额外请求）；否则先 loadDetail 取源作品
   * （深链 / benchNav 直达 / 进程被杀后恢复三条路径的唯一兜底）。
   * 每个 await 之后校验 generation：旧响应整段丢弃，绝不覆盖新一轮状态。
   */
  async function load(illustId: number): Promise<void> {
    const valid = Number.isFinite(illustId) && illustId > 0
    // 竞态闸与状态清理**先于**合法性判定：否则畸形 id 的早退不会与在途旧轮互斥，
    // 且 lastIllustId 仍是旧值 → 错误态点重试会重放上一个作品（code-review 低危 5）
    const g = ++generation
    if (currentAc) currentAc.abort()
    currentAc = new AbortController()
    const signal = currentAc.signal
    clearResults()
    if (!valid) {
      // 路由参数缺失/非法：显式失败，不发一次注定失败的请求（code-review S9）。
      // 必须一并清 lastIllustId：否则错误态点重试会**重放上一个作品**（假 id 深链场景）——
      // 竞态闸前移只解决了互斥，重试目标仍会残留（code-review 终审 #2）
      lastIllustId = 0
      console.warn('[tagNeighbors] 源作品 id 非法，跳过检索', illustId)
      _errorMessage.value = presentError(new Error('invalid illust id'))
      _status.value = 'error'
      return
    }
    lastIllustId = illustId
    _status.value = 'loading'

    let source = _sourceIllust.value && _sourceIllust.value.id === illustId ? _sourceIllust.value : null
    try {
      if (!source) {
        const res = await loadDetail(toIllustId(illustId), signal)
        if (g !== generation) return
        source = res.illust
        _sourceIllust.value = res.illust
      }
      const result = await collectTagNeighbors({
        source,
        authorId: source.user.id,
        deps: createTagNeighborDeps(source.user.id, signal, () => {
          // 代校验：被取代的一轮不得点亮提示行
          if (g === generation) _phase2Running.value = true
        }),
        signal,
      })
      if (g !== generation) return
      // 阶段 2 已落定：复位在途标志，页面文案从「正在放宽…」切到「已放宽到 N 个标签」。
      // 此前漏复位，结果已出却仍常驻「正在…」——code-review B1 与真机走查同现此症状。
      _phase2Running.value = false
      for (const failure of result.failures) {
        console.warn('[tagNeighbors] 阶段检索失败（保留已产出条目）', formatTagNeighborFailure(failure))
      }
      _entries.value = result.entries
      _phase1SkippedReason.value = result.phase1SkippedReason
      _phase2Ran.value = result.phase2Ran
      _phase2LastLayer.value = result.phase2LastLayer
      _gatedCount.value = result.gatedCount
      _errorMessage.value = summarizeTagNeighborFailures(result.failures)
      // 有条目 = 用户拿到了结果（错误改由列表尾内联呈现，ADR-0104 槽位分离）；
      // 零条目且有失败 = 全阶段失败 → 整页错误态 + 重试。
      _status.value = result.entries.length > 0 || result.failures.length === 0 ? 'ready' : 'error'
    } catch (e) {
      // 竞态/取消：不动状态（新会话已接管，或页面已卸载）
      if (g !== generation) return
      if (isAbortError(e, signal)) return
      // 异常穿出内核时同样复位在途标志：否则错误态下会常驻「正在放宽标签范围…」
      // （理论路径——isRestricted 等注入谓词若抛错即可达；code-review 终审 #3）
      _phase2Running.value = false
      console.warn('[tagNeighbors] 标签近邻加载失败', e)
      _errorMessage.value = presentError(e)
      _status.value = 'error'
    }
  }

  /** 重试：重放最近一次 load 的源作品 id（页面重试按钮 / 列表尾重试同一条路） */
  async function retry(): Promise<void> {
    if (lastIllustId === 0) {
      console.warn('[tagNeighbors] retry 缺少源作品 id（页面未发起过 load）')
      return
    }
    await load(lastIllustId)
  }

  /**
   * 页面卸载即终止在途请求并清结果态（与 Notifications.vue「非 KeepAlive → 卸载即释放」一致）。
   * 保留源作品缓存：它由详情页写入，load 侧有 id 校验，不匹配的缓存对任何一轮 load 都无效。
   */
  function reset(): void {
    generation++
    if (currentAc) currentAc.abort()
    currentAc = null
    clearResults()
  }

  return {
    entries,
    status,
    errorMessage,
    phase1SkippedReason,
    phase2Ran,
    phase2Running,
    phase2LastLayer,
    gatedCount,
    setSourceIllust,
    getSourceIllust,
    load,
    retry,
    reset,
  }
})
