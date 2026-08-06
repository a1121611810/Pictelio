// ─── 路由匹配纯逻辑（无组件依赖，可单测） ───
export interface RouteDefCore {
  path: string
  name: string
}

/** 系统返回决策（ADR-0066）：JS 侧根据路由历史与双击窗口决定返回行为。 */
export type SystemBackDecision = "navigate" | "hint" | "exit"

/** 根路由双击退出窗口（ms），与 webview client backGestureService 的 EXIT_DOUBLE_TAP_MS 对齐 */
export const SYSTEM_BACK_EXIT_WINDOW_MS = 2000

/**
 * 纯函数：给定路由历史长度与上次「提示」时间，返回系统返回应执行的行为。
 * - 有历史（非根路由）→ navigate（返回上一页）
 * - 无历史且在上次提示 2s 内 → exit（退出应用）
 * - 无历史且超窗/首次 → hint（显示「再按一次退出应用」）
 */
export function evaluateSystemBack(
  historyLength: number,
  lastBackAt: number,
  now: number,
): SystemBackDecision {
  if (historyLength > 0) return "navigate"
  if (lastBackAt > 0 && now - lastBackAt < SYSTEM_BACK_EXIT_WINDOW_MS) return "exit"
  return "hint"
}

/** 路径模板匹配：/illust/:id → params { id } */
export function matchRoute<T extends RouteDefCore>(
  routes: T[],
  path: string,
): { route: T; params: Record<string, string> } | null {
  for (const route of routes) {
    const segs = route.path.split('/').filter(Boolean)
    const pathSegs = path.split('/').filter(Boolean)
    if (segs.length !== pathSegs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.startsWith(':')) {
        params[s.slice(1)] = decodeURIComponent(pathSegs[i])
      } else if (s !== pathSegs[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}
