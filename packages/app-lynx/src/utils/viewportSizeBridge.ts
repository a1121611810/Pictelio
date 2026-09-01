// 原生内容区契约接线（app-lynx，ADR-0131）：GlobalFab 挂载后经 PictelioApp.getViewportSize
// 查询 LynxView 内容区尺寸，按哨兵裁决后写回。与 viewportGeometry（纯几何）分层：
// 本模块是「契约 IO 边界 + 哨兵裁决」，组件只做「探测 NativeModules → 订阅 → 存 ref」的薄接线
// （同 utils/tokenStorage.ts 的 nativeModule() 探测模式，node 可测——AGENTS.md 测试硬约束 #1）。
import { type ViewportContentSize } from './viewportGeometry'

/** 原生模块访问点（组件的 NativeModules 探测经此注入，测试可控） */
type NativeModulesAccessor = () =>
  | {
      PictelioApp?: {
        getViewportSize?: (cb: (w: number, h: number) => void) => void
      }
    }
  | undefined

/** 尺寸有效：number、有限、> 0（NaN / Infinity / <=0 均无效——含原生未布局哨兵 -1×-1） */
function isPositiveSize(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * 订阅内容区尺寸契约（ADR-0131）：契约回调 → 哨兵裁决 → apply。
 * - 原生契约存在（getViewportSize 为函数）→ 注册回调；有效尺寸 apply({w,h})；
 *   哨兵/非法（-1×-1 / NaN / 0）→ apply(null)——消费者据此回退 SystemInfo；
 *   契约为一次性查询（无推送通道），null 只在首查未布局时出现，无「有效→哨兵」时序;
 * - 无 NativeModules（web-core）或接口缺失 → no-op（保持 SystemInfo/兜底路径）。
 * 纯函数/无 DOM 依赖：在 node 中以注入 accessor 测成功/降级全路径。
 */
export function subscribeViewportSize(
  nativeModules: NativeModulesAccessor,
  apply: (size: ViewportContentSize | null) => void,
): void {
  const api = nativeModules()?.PictelioApp?.getViewportSize
  if (typeof api !== 'function') return
  api((w, h) => {
    apply(isPositiveSize(w) && isPositiveSize(h) ? { w, h } : null)
  })
}
