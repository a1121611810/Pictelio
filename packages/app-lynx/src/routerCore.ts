// ─── 路由匹配纯逻辑（无组件依赖，可单测） ───
export interface RouteDefCore {
  path: string
  name: string
  /**
   * 返回键行为（可选）：'exit' = 返回键直接退出应用。
   * 用于强制更新页等不可返回场景——跳过历史栈与双击窗口逻辑（ADR-0066 扩展）。
   */
  backBehavior?: "exit"
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

/**
 * 扩展裁决（更新页等不可返回场景）：路由声明 `backBehavior: 'exit'` 时
 * 返回键恒为 exit（退出应用），不依赖历史栈与双击窗口；
 * 未声明时走既有 evaluateSystemBack 逻辑，行为不变。
 */
export function evaluateBackWithBehavior(
  behavior: RouteDefCore["backBehavior"],
  historyLength: number,
  lastBackAt: number,
  now: number,
): SystemBackDecision {
  if (behavior === "exit") return "exit"
  return evaluateSystemBack(historyLength, lastBackAt, now)
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

// ─── 返回守卫（back-guard，spec app-lynx-novel-series-watchlist §US3，issue #222） ───
// 页面级返回拦截：守卫返回 true = 本次返回已被页面消费（如打开追更询问弹窗），
// 路由层不得再 pop 历史栈。裁决顺序：modalStack → backGuard → backBehavior/history。
// 守卫注册表与裁决逻辑全部在本模块（纯逻辑、node 可单测）；router.ts 只做薄接线。

/** 返回守卫：返回 true 表示已拦截本次返回（路由层放行给消费者自己处理） */
export type BackGuard = () => boolean

/**
 * 顺序执行守卫，任一返回 true 即拦截（短路，后续守卫不再执行）。
 * 守卫抛错不阻断返回：console.warn 记录并视为未拦截（fail-open，守卫 bug 不应卡死返回键）。
 */
export function runBackGuards(guards: readonly BackGuard[]): boolean {
  for (const guard of guards) {
    let intercepted = false
    try {
      intercepted = guard()
    } catch (err) {
      console.warn('[router] back-guard 执行抛错，按未拦截处理', err)
    }
    if (intercepted) return true
  }
  return false
}

/** 守卫注册表（createModalStack 同款形态：register 返回注销函数） */
export interface BackGuardRegistry {
  /** 注册守卫；返回注销函数（页面卸载/停用时调用，重复注销安全） */
  register(guard: BackGuard): () => void
  /** 当前生效守卫（注册序 = 执行序） */
  guards(): readonly BackGuard[]
}

/** 创建守卫注册表（router.ts 持有模块级单例；测试各自 new 隔离实例） */
export function createBackGuardRegistry(): BackGuardRegistry {
  const guards: BackGuard[] = []
  return {
    register(guard) {
      guards.push(guard)
      return () => {
        const idx = guards.indexOf(guard)
        if (idx !== -1) guards.splice(idx, 1)
      }
    },
    guards() {
      return guards
    },
  }
}

/** 系统返回完整路由裁决（含弹层/守卫两级拦截）：ADR-0066 决策之上叠加 §US3 拦截层 */
export type BackRouteAction = "close-modal" | "intercepted" | SystemBackDecision

/**
 * 纯函数：系统返回的完整裁决顺序——
 * ① 有打开弹层（modalStack）→ close-modal（返回键优先关弹层，不动守卫/历史栈）；
 * ② 否则跑 back-guard（懒执行：仅在本层才调用 runGuards）→ intercepted（守卫消费，不动历史栈）；
 * ③ 否则走既有 evaluateBackWithBehavior（backBehavior/history/双击退出窗口）。
 */
export function evaluateBackRoute(opts: {
  hasOpenModal: boolean
  /** 守卫执行入口（惰性）：仅当无弹层时才应被调用 */
  runGuards: () => boolean
  behavior: RouteDefCore["backBehavior"] | undefined
  historyLength: number
  lastBackAt: number
  now: number
}): BackRouteAction {
  if (opts.hasOpenModal) return "close-modal"
  if (opts.runGuards()) return "intercepted"
  return evaluateBackWithBehavior(opts.behavior, opts.historyLength, opts.lastBackAt, opts.now)
}
