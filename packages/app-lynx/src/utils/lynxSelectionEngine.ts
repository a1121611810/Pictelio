// 选中引擎适配器（spec docs/specs/app-lynx-novel-text-selection.md §ID 5 / 不变式 4）。
//
// 唯一职责：把 Lynn 引擎的 selector query 世界（内容区 **dp**）翻译成接口契约的 **vw** 世界
// （1 = 1% 内容宽），并把「内容宽校准」「失败原因分类」「尽力清选」收在这一层。
// 纯核（createTextSelection / selectionToolbarGeometry）永不接触 dp/density —— 实证踩过
// 「用 px 宽换算 → 菜单落在屏幕上部」（docs/research/lynx-text-selection-device-probe.md 坑 5）。
import { measureRects, type SelectorQuery, type SelectorQueryFactory } from '../primitives/measureRects'
import { measureTextRect } from '../primitives/measureTextRect'
import type { MeasureOutcome, SelectionEnginePort } from '../primitives/createTextSelection'

export interface LynxSelectionEngineOptions {
  /** 满内容宽元素 id（页面根 view）：vw 换算基准（ADR-0131 内容区契约的实测等价物） */
  probeId: string
  /** 查询工厂（默认取全局 lynx；测试注入假实现） */
  createQuery?: SelectorQueryFactory
}

/** 全局 lynx 取值（组件内同款写法；web-core 无 createSelectorQuery → undefined） */
function defaultQueryFactory(): SelectorQuery | undefined {
  const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  return lynxGlobal?.createSelectorQuery?.() as unknown as SelectorQuery | undefined
}

/** 清选调用超时（与测量同量级） */
const CLEAR_TIMEOUT_MS = 1500

export function createLynxSelectionEngine(options: LynxSelectionEngineOptions): SelectionEnginePort {
  const createQuery = options.createQuery ?? defaultQueryFactory
  /** 内容宽（dp）校准缓存：每控制器一次（页面根宽不变） */
  let contentWidthDp: number | null = null
  /** 清选不可用的 warn 只出一次（每帧滚动都会尝试清选，反复 warn 会刷屏） */
  let clearWarned = false

  /** 校准内容宽（dp）。'no-engine' = 引擎查询不可用（区分于「探到 0 宽」的 bad-calibration） */
  async function calibrate(): Promise<number | 'no-engine' | null> {
    if (contentWidthDp !== null) {
      return contentWidthDp
    }
    const result = await measureRects([options.probeId], createQuery)
    if (result.reason === 'no-selector-query') {
      return 'no-engine'
    }
    const width = result.rects[options.probeId]?.width ?? 0
    if (width > 0) {
      contentWidthDp = width
      return width
    }
    return null
  }

  function toVw(value: number, widthDp: number): number {
    return (value / widthDp) * 100
  }

  return {
    async measureRange(nodeId, range): Promise<MeasureOutcome> {
      const widthDp = await calibrate()
      if (widthDp === 'no-engine') {
        return { ok: false, reason: 'no-engine' }
      }
      if (widthDp === null) {
        return { ok: false, reason: 'bad-calibration' }
      }
      const result = await measureTextRect(nodeId, range.start, range.end, createQuery)
      if (!result.ok) {
        return { ok: false, reason: result.reason === 'no-selector-query' ? 'no-engine' : result.reason }
      }
      const { rect } = result
      return {
        ok: true,
        rectVw: {
          left: toVw(rect.left, widthDp),
          top: toVw(rect.top, widthDp),
          width: toVw(rect.width, widthDp),
          height: toVw(rect.height, widthDp),
        },
      }
    },

    clearRange(nodeId): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        let finished = false
        const settle = (value: boolean): void => {
          if (finished) return
          finished = true
          if (!value && !clearWarned) {
            clearWarned = true
            console.warn('[lynxSelectionEngine] 引擎侧清选调用失败（引擎可能仍显示选区）')
          }
          resolve(value)
        }
        const query = createQuery()
        if (!query) {
          settle(false)
          return
        }
        query
          .select('#' + nodeId)
          .invoke({
            // 退化为「负坐标 + 不显示手柄」= 引擎侧的清除调用（设备实验 S1 已证有效，见 ADR-0165 §8）
            method: 'setTextSelection',
            params: { startX: -1, startY: -1, endX: -1, endY: -1, showStartHandle: false, showEndHandle: false },
            success: () => settle(true),
            fail: () => settle(false),
          })
          .exec()
        setTimeout(() => settle(false), CLEAR_TIMEOUT_MS)
      })
    },
  }
}
