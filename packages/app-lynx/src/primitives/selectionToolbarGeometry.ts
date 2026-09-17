// 选中操作菜单的定位纯函数（spec docs/specs/app-lynx-novel-text-selection.md §ID 5）。
//
// 输入单位一律 **vw**（1 = 1% 内容宽）：dp→vw 换算在适配器层（utils/lynxSelectionEngine.ts）完成，
// 纯核永不接触 dp/px/density —— 实证踩过「用 px 宽换算 → 菜单落在屏幕上部」
// （docs/research/lynx-text-selection-device-probe.md 坑 5）。
//
// 定位规则（spec）：水平居中于选区 → 左侧夹取防贴边；优先置于选区**上方**；
// 上方空间不足（顶部越界）→ 翻转到**下方**；`style` 为 left/top vw + translate，
// 锚点语义 = 最近 view 祖先 (0,0)（ADR-0123/0131；组件只加胶囊，不铺全屏层）。
export interface VwRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 浮层尺寸（vw）——**布局单一事实源**：组件（TextSelectionToolbar）用这些常量渲染，
 * 几何函数用它们算位置（「量=画」同源；改一处不会漂移）。取值来自视觉原型方案 E
 * （docs/prototypes/lynx-novel-text-selection-toolbar.html，132px 条目 @1080 宽 ≈ 12.2vw）。
 */
export const TOOLBAR_ITEM_VW = 12.2
/** 条目间距（vw） */
export const TOOLBAR_ITEM_GAP_VW = 0.4
/** 浮层左右内边距（vw） */
export const TOOLBAR_PADDING_H_VW = 1.5
/** 浮层上下内边距（vw） */
export const TOOLBAR_PADDING_V_VW = 1.3
/** 浮层总宽（vw）= 两条目 + 间距 + 左右内边距 */
export const TOOLBAR_WIDTH_VW = TOOLBAR_ITEM_VW * 2 + TOOLBAR_ITEM_GAP_VW + TOOLBAR_PADDING_H_VW * 2
/** 浮层总高（vw）= 条目 + 上下内边距 */
export const TOOLBAR_HEIGHT_VW = TOOLBAR_ITEM_VW + TOOLBAR_PADDING_V_VW * 2
/** 浮层与选区（手柄上沿）的间隙（vw） */
export const TOOLBAR_OFFSET_GAP_VW = 1.6

export interface ToolbarGeometryInput {
  /** 选中范围的内容区矩形（vw） */
  rectVw: VwRect
  toolbarWidthVw?: number
  toolbarHeightVw?: number
  gapVw?: number
}

export interface ToolbarGeometry {
  placement: 'above' | 'below'
  leftVw: number
  topVw: number
  /** 直接可绑的 :style 对象（vw 串 + translate） */
  style: Record<string, string>
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export function selectionToolbarGeometry(input: ToolbarGeometryInput): ToolbarGeometry {
  const width = input.toolbarWidthVw ?? TOOLBAR_WIDTH_VW
  const height = input.toolbarHeightVw ?? TOOLBAR_HEIGHT_VW
  const gap = input.gapVw ?? TOOLBAR_OFFSET_GAP_VW

  const center = input.rectVw.left + input.rectVw.width / 2
  const leftVw = clamp(center - width / 2, 0, Math.max(0, 100 - width))
  const fitsAbove = input.rectVw.top - gap - height >= 0
  const placement: 'above' | 'below' = fitsAbove ? 'above' : 'below'
  const topVw = fitsAbove ? input.rectVw.top - gap : input.rectVw.top + input.rectVw.height + gap

  return {
    placement,
    leftVw,
    topVw,
    style: {
      left: `${leftVw}vw`,
      top: `${topVw}vw`,
      // above：定位到选区上沿，再整块上移自身高度；below：直接落到选区下沿
      transform: fitsAbove ? 'translate(0, -100%)' : 'translate(0, 0)',
    },
  }
}
