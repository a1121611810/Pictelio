// 正文选中会话（深模块；spec docs/specs/app-lynx-novel-text-selection.md §Implementation Decisions）。
//
// 一个模块吃掉：引擎事件解析 → 索引切片 → 异步测矩（含代际防竞态）→ 定位 → 五条收起路径
// → 动作执行（复制 / 搜索）与反馈。**框架无关**：不 import Vue / Pinia / lynx 全局，
// 全部依赖注入（房屋先例 createWatchlistPrompt / createBookmarkToggle），node 直接可测。
//
// 关键不变式（spec §ID 不变式 1-10，违反即回归）：
//   1 索引即身份：start/end 是该段**渲染文本**的字符索引（**按码点计数**——设备实证：emoji
//     段落里引擎给的是码点下标，直接用 String.slice（UTF-16 码元）会劈开代理对，
//     剪贴板里得到半个字符 → 必须 Array.from 后切片）
//   2 动作前校验：执行动作时段落文本必须未变，否则收起（防回收重建后复制错段）
//   3 定位先于显示：测矩失败保持隐藏，不猜位置
//   4 单位：端口只讲 vw，dp 换算在适配器层
//   5 异步结果按 (nodeId, start, end, generation) 落地
//   6 可见性 ⇔ modalStack 注册；search 先收起自己再开弹层
//   7 复制无乐观态
//   8 onScroll 隐藏态零成本早退（60Hz 信号）
//   9 冻结 + 宽限窗（点菜单时引擎可能先派发 start === -1）
//  10 清选尽力而为（适配器 warn once）
import { selectionToolbarGeometry, type VwRect } from './selectionToolbarGeometry'
import { truncateForSearch } from './truncateForSearch'

/** 引擎 :bindselectionchange 载荷（设备实证形状：target.id + detail.{start,end,direction}） */
export interface SelectionChangeEvent {
  target?: { id?: string }
  detail?: { start?: number; end?: number; direction?: string }
}

export type MeasureFailReason = 'no-engine' | 'bad-range' | 'timeout' | 'bad-calibration'

export type MeasureOutcome = { ok: true; rectVw: VwRect } | { ok: false; reason: MeasureFailReason }

/** 引擎端口（跨线程 selector query；生产 createLynxSelectionEngine，测试注入假件） */
export interface SelectionEnginePort {
  /** 选中范围的 **vw** 矩形（1 = 1% 内容宽）；失败必须分类返回，禁止估算 */
  measureRange(nodeId: string, range: { start: number; end: number }): Promise<MeasureOutcome>
  /** 尽力清除引擎侧选区；false = 本引擎无清除通道（调用方只 warn once） */
  clearRange(nodeId: string): Promise<boolean>
}

/** 剪贴板端口（JSBridge → Java 模块；缺模块 reject，禁假成功） */
export interface ClipboardPort {
  writeText(text: string): Promise<void>
}

/** 搜索端口（全局搜索弹层；适配器收编 openSearch 幂等吞词怪癖） */
export interface SearchPort {
  openWithKeyword(keyword: string): void
}

export type CopyState = 'idle' | 'copied' | 'failed'

export interface ToolbarItem {
  key: 'copy' | 'search'
  label: string
  state: 'idle' | 'done' | 'error'
}

/** 视图模型（模板只读；visible=false 时组件不渲染任何元素） */
export interface TextSelectionView {
  visible: boolean
  style: Record<string, string> | null
  items: readonly ToolbarItem[]
  copyState: CopyState
}

export interface TextSelectionLabels {
  copy: string
  search: string
  copied: string
  copyFailed: string
}

export interface TextSelectionDeps {
  /** 段落文本查表（'p-3' → 文本）；非段落 id / 越界 → null */
  getParagraphText(nodeId: string): string | null
  engine: SelectionEnginePort
  clipboard: ClipboardPort
  search: SearchPort
  /** 返回键登记（页面传 useModalStack().registerModal）；注册/注销时机由本模块独占 */
  registerModal(close: () => void): () => void
  labels: TextSelectionLabels
  /** 「已复制」原位反馈存活时长，到点整条收起（spec §ID 9） */
  feedbackTtlMs?: number
  /** 宽限窗：清空事件延后处理，避免「点菜单时引擎先清选」把载荷打没（spec 不变式 9） */
  graceMs?: number
  /**
   * `onTapAway` 的长按保护窗（ms）：设备实测——**长按抬手的 release 会被引擎判为 tap**，
   * 若不保护，菜单刚出来就被自己这次长按的抬手收掉。宿主在容器上绑 `@longpress` 打标
   * （同 `useLongPress.consumeLongPress` 惯例），窗口内的一次 tap 视为该次长按的抬手。
   */
  tapGuardMs?: number
  /** 定时器注入（测试用假时钟）；默认 setTimeout */
  schedule?(fn: () => void, ms: number): () => void
}

export interface TextSelection {
  getView(): TextSelectionView
  /** 视图变化订阅（Vue 薄绑定用；返回取消函数） */
  subscribe(listener: () => void): () => void
  onSelectionChange(event: SelectionChangeEvent): void
  /** 列表滚动信号（per-frame；隐藏态零成本早退） */
  onScroll(): void
  /**
   * 菜单外点击（页面/列表级 @tap 转发）：设备实测**点空白不派发清空事件**，
   * 故需宿主转发 tap 来收起。长按后的一次 tap（= 本次长按的抬手）被消费忽略。
   */
  onTapAway(): void
  /** 宿主容器 @longpress 转发：为「抬手 tap」打标（同 useLongPress 的消费惯例） */
  notifyLongPress(): void
  copy(): void
  search(): void
  dismiss(): void
  dispose(): void
}

interface Snapshot {
  nodeId: string
  start: number
  end: number
  text: string
  /** 捕获时的整段文本（动作前校验基准，spec 不变式 2） */
  paragraphText: string
}

/**
 * 段落的码点数组（引擎索引单位；设备实证：含 emoji 的段落用 `String.slice` 会劈开代理对，
 * 复制出半个字符——粘贴显示为 ◇?）。
 */
function codePointsOf(text: string): string[] {
  return Array.from(text)
}

const DEFAULT_FEEDBACK_TTL_MS = 2000
const DEFAULT_GRACE_MS = 150
/** 菜单显示后忽略外部 tap 的窗口（长按抬手保护） */
const DEFAULT_TAP_GUARD_MS = 1200

export function createTextSelection(deps: TextSelectionDeps): TextSelection {
  const feedbackTtlMs = deps.feedbackTtlMs ?? DEFAULT_FEEDBACK_TTL_MS
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS
  const tapGuardMs = deps.tapGuardMs ?? DEFAULT_TAP_GUARD_MS
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as () => void)

  let snapshot: Snapshot | null = null
  let style: Record<string, string> | null = null
  let copyState: CopyState = 'idle'
  /** 长按打标：窗口内的一次 tap 视为该次长按的抬手（不收起菜单） */
  let longPressAt = 0
  /** 代际：任何新选中/收起都递增 → 在飞测量与动作回调按代落地 */
  let generation = 0
  let unregisterModal: (() => void) | null = null
  let cancelFeedback: (() => void) | null = null
  let cancelGrace: (() => void) | null = null
  let disposed = false

  const listeners = new Set<() => void>()
  const warned = new Set<string>()

  function notify(): void {
    for (const listener of listeners) listener()
  }

  /** 视图变化订阅（Vue 薄绑定用；返回取消函数） */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * 显式 warn（禁静默降级）；同一 key 只 warn 一次（滚动/拖手柄会高频触发）。
   * 返回 true 时调用方**直接** console.warn（字面量落在 console 参数位，供硬编码门禁识别为诊断串）。
   */
  function shouldWarn(key: string): boolean {
    if (warned.has(key)) return false
    warned.add(key)
    return true
  }

  function clearTimers(): void {
    cancelFeedback?.()
    cancelFeedback = null
    cancelGrace?.()
    cancelGrace = null
  }

  function releaseModal(): void {
    unregisterModal?.()
    unregisterModal = null
  }

  function ensureModal(): void {
    if (unregisterModal !== null) return
    // 返回键三级语义（spec §ID 8③）：先关菜单 → 再清选 → 再返回页面
    unregisterModal = deps.registerModal(() => dismiss())
  }

  function getView(): TextSelectionView {
    const visible = snapshot !== null && style !== null
    const copyLabel = copyState === 'copied' ? deps.labels.copied : copyState === 'failed' ? deps.labels.copyFailed : deps.labels.copy
    const copyItemState: ToolbarItem['state'] = copyState === 'copied' ? 'done' : copyState === 'failed' ? 'error' : 'idle'
    return {
      visible,
      style: visible ? style : null,
      copyState,
      items: [
        { key: 'copy', label: copyLabel, state: copyItemState },
        { key: 'search', label: deps.labels.search, state: 'idle' },
      ],
    }
  }

  /** 统一收起（spec §ID 8）：四条触发器 + 动作完成 + 卸载都走这里；幂等 */
  function dismiss(): void {
    generation++
    longPressAt = 0
    clearTimers()
    releaseModal()
    const target = snapshot?.nodeId ?? null
    const hadSelection = snapshot !== null
    snapshot = null
    style = null
    copyState = 'idle'
    notify()
    if (hadSelection && target !== null) {
      // 尽力清选（适配器 warn once）；失败不改本模块语义
      void deps.engine.clearRange(target)
    }
  }

  function scheduleGraceDismiss(): void {
    // 无选中可收 → 清空事件是引擎对「已收起的菜单」的迟到回声（也可能是我们自己 clearRange 的回声）
    if (snapshot === null) return
    cancelGrace?.()
    cancelGrace = schedule(() => {
      cancelGrace = null
      dismiss()
    }, graceMs)
  }

  function scheduleFeedbackDismiss(): void {
    cancelFeedback?.()
    cancelFeedback = schedule(() => {
      cancelFeedback = null
      dismiss()
    }, feedbackTtlMs)
  }

  /** 动作前校验（spec 不变式 2）：段落文本未变才允许执行 */
  function snapshotStillValid(snap: Snapshot): boolean {
    const current = deps.getParagraphText(snap.nodeId)
    if (current === null || current !== snap.paragraphText) {
      if (shouldWarn('stale-paragraph')) {
        console.warn('[textSelection] 段落内容已变化，动作取消', snap.nodeId)
      }
      dismiss()
      return false
    }
    return true
  }

  async function applyMeasure(expected: Snapshot, gen: number): Promise<void> {
    const outcome = await deps.engine.measureRange(expected.nodeId, { start: expected.start, end: expected.end })
    if (disposed || gen !== generation || snapshot !== expected) return
    if (!outcome.ok) {
      if (shouldWarn('measure-' + outcome.reason)) {
        console.warn('[textSelection] 选中范围测量失败，菜单不显示', outcome.reason)
      }
      return
    }
    style = selectionToolbarGeometry({ rectVw: outcome.rectVw }).style
    ensureModal()
    notify()
  }

  function onSelectionChange(event: SelectionChangeEvent): void {
    if (disposed) return
    const nodeId = event?.target?.id
    const detail = event?.detail ?? {}
    const start = typeof detail.start === 'number' ? detail.start : -1
    const end = typeof detail.end === 'number' ? detail.end : -1

    if (!nodeId || start < 0 || end <= start) {
      // 清空路径（start === -1 是正常清空，不 warn）；宽限窗内延后，防动作载荷被清掉
      scheduleGraceDismiss()
      return
    }

    const paragraphText = deps.getParagraphText(nodeId)
    if (paragraphText === null) {
      if (shouldWarn('unknown-node')) {
        console.warn('[textSelection] 未知段落节点，忽略选中事件', nodeId)
      }
      return
    }
    const chars = codePointsOf(paragraphText)
    if (end > chars.length) {
      if (shouldWarn('range-out-of-bounds')) {
        console.warn('[textSelection] 选中范围越界，忽略', nodeId, start, end, chars.length)
      }
      return
    }
    const text = chars.slice(start, end).join('')
    if (text.trim().length === 0) {
      if (shouldWarn('blank-selection')) {
        console.warn('[textSelection] 选中内容为空白，忽略', nodeId)
      }
      return
    }

    cancelGrace?.()
    cancelGrace = null
    cancelFeedback?.()
    cancelFeedback = null

    const next: Snapshot = { nodeId, start, end, text, paragraphText }
    snapshot = next
    style = null
    copyState = 'idle'
    const gen = ++generation
    notify()
    void applyMeasure(next, gen)
  }

  function onScroll(): void {
    // 隐藏态零成本早退（本信号 60Hz 常驻；spec 不变式 8）
    if (disposed || snapshot === null) return
    dismiss()
  }

  function notifyLongPress(): void {
    longPressAt = Date.now()
  }

  function onTapAway(): void {
    if (disposed || snapshot === null) return
    // 长按抬手保护：长按后窗口内的第一次 tap 是这次长按的 release，不是「点别处」
    if (longPressAt > 0 && Date.now() - longPressAt <= tapGuardMs) {
      longPressAt = 0
      return
    }
    dismiss()
  }

  function copy(): void {
    if (disposed) return
    const snap = snapshot
    if (snap === null) return
    if (!snapshotStillValid(snap)) return
    const gen = generation
    copyState = 'idle'
    notify()
    void deps.clipboard.writeText(snap.text).then(
      () => {
        if (disposed || gen !== generation || snapshot !== snap) return
        copyState = 'copied'
        notify()
        scheduleFeedbackDismiss()
      },
      () => {
        if (disposed || gen !== generation || snapshot !== snap) return
        // 失败可见且常驻（禁假成功，#568 教训）
        copyState = 'failed'
        notify()
      },
    )
  }

  function search(): void {
    if (disposed) return
    const snap = snapshot
    if (snap === null) return
    if (!snapshotStillValid(snap)) return
    const keyword = truncateForSearch(snap.text)
    // 先收起自己再开弹层：弹层注册落后进先出 → 返回键先关弹层（spec 不变式 6）
    dismiss()
    if (keyword.length === 0) {
      if (shouldWarn('empty-keyword')) {
        console.warn('[textSelection] 搜索关键词为空，忽略')
      }
      return
    }
    deps.search.openWithKeyword(keyword)
  }

  function dispose(): void {
    if (disposed) return
    generation++
    disposed = true
    clearTimers()
    releaseModal()
    snapshot = null
    style = null
    copyState = 'idle'
    listeners.clear()
  }

  return { getView, subscribe, onSelectionChange, onScroll, onTapAway, notifyLongPress, copy, search, dismiss, dispose }
}
