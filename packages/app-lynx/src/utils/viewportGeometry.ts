// 逻辑屏高（vw）推导的纯几何逻辑（app-lynx，ADR-0131 决策 2/3）。
// 语义：放射导航 FAB 底部几何的纵向基准 = LynxView 内容区高度——内容区撇除系统导航条
// inset（全屏物理尺寸 SystemInfo 会把 FAB 底边推出内容区，模拟器实测被裁剩圆弧，见 ADR-0131）。
// 优先级（与 ADR-0131 一致）：内容区尺寸 > SystemInfo（全屏物理尺寸按像素密度换算）> web-core 兜底 216.4vw。
// 与「深模块可测」惯例一致（同 utils/coverImage.ts、coverDisplay.ts）：无 Vue/无原生模块依赖、
// node 可测；组件只做薄接线（契约 IO 边界另见 utils/viewportSizeBridge，本模块不做查询）。

/** 原生内容区尺寸（ADR-0131）：LynxView 实际渲染区域，物理 px；未布局/异常回传 -1×-1（契约哨兵）。 */
export interface ViewportContentSize {
  w: number
  h: number
}

/** SystemInfo（lynx 全局）：全屏物理尺寸与像素密度；字段与 GlobalFab 的 declare const 对齐。 */
export interface ViewportSystemInfo {
  pixelWidth: number
  pixelHeight?: number
  pixelRatio: number
}

/** 尺寸有效：number、有限、> 0（NaN / Infinity / <=0 均无效——含原生未布局哨兵 -1×-1） */
function isPositiveSize(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * 逻辑屏高（vw）：100vw = 屏宽，屏高按 `(h / w) × 100` 折算为「按屏宽的 vw 数」（ADR-0108 vw 几何）。
 * 三路径（ADR-0131 决策 2）：
 * 1. contentSize 有效（w > 0 && h > 0）→ `(h / w) × 100`（内容区为准，已撇除系统条 inset）；
 * 2. 否则 systemInfo 存在 → 先 /pixelRatio 转逻辑 px 再 `(h / w) × 100`；pixelHeight 缺失时
 *    按逻辑宽 × 844 / 390 回退（390×844 设计基准，与 web-core 兜底同源）；
 * 3. 兜底 216.4vw（web-core 无 SystemInfo，按 390×844 估，≈ (844/390)×100 取整）。
 * 纯函数：不打印日志、不查询全局；退化路径（回退 SystemInfo / 兜底）属 ADR 规定的公开契约，非静默降级。
 */
export function screenHeightVw(
  contentSize: ViewportContentSize | null,
  systemInfo: ViewportSystemInfo | undefined,
): number {
  if (contentSize && isPositiveSize(contentSize.w) && isPositiveSize(contentSize.h)) {
    return (contentSize.h / contentSize.w) * 100
  }
  if (systemInfo) {
    const w = systemInfo.pixelWidth / systemInfo.pixelRatio
    const h = systemInfo.pixelHeight
      ? systemInfo.pixelHeight / systemInfo.pixelRatio
      : (w * 844) / 390
    return (h / w) * 100
  }
  return 216.4
}
