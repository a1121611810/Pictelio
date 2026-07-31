// ─── 路由匹配纯逻辑（无组件依赖，可单测） ───
export interface RouteDefCore {
  path: string
  name: string
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
