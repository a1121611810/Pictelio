// ─── PROTOTYPE（throwaway，勿入生产）───
// 探针导航包装：系统返回桥（pictelioBack → vue-router）的可行性验证。
// [lynx:fix 实证] vue-router 4.6.4 的 memory history 无公开栈查询 API：
// history.state 恒为 {}（dist 源码：`state: {}`，栈在闭包私有 queue/position，仅 go() 可用）。
// 因此「能否返回」「栈深」必须自跟踪——生产迁移 shim 沿用本仓现有自研 `_history` 形态
// （与 _state/_history 同构：push 入栈、replace 不入栈、back 出栈、栈空回退推荐页）。
import { createRouter, createMemoryHistory } from 'vue-router'
import RouteProbeHome from './RouteProbeHome.vue'
import RouteProbeDetail from './RouteProbeDetail.vue'

export const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'probe-home', component: RouteProbeHome },
    { path: '/detail/:id', name: 'probe-detail', component: RouteProbeDetail },
  ],
})

// memory history 初始位置是 nowhere（无 URL 概念）：必须手动 push 定起点
//（官方示例在 app.mount() 前执行）——复刻生产「首帧内容化」初始即推荐页语义。
void router.push('/')

/** 自跟踪栈（镜像 vue-router 的 push/replace/back 语义；页面全部经此函数导航） */
const _stack: string[] = []

export function probeNavigate(path: string, opts?: { replace?: boolean }): Promise<unknown> {
  const cur = router.currentRoute.value.fullPath
  if (!opts?.replace && cur !== path) _stack.push(cur)
  return router.push(path)
}

/** 返回：栈空或目标无效时回退首页（生产语义：栈空回退 /recommended） */
export function probeBack(): void {
  const prev = _stack.pop()
  if (prev) {
    void router.back()
    return
  }
  void router.replace('/')
}

export function probeHasHistory(): boolean {
  return _stack.length > 0
}

/** 取证用（logcat 打印栈深） */
export function probeStackLength(): number {
  return _stack.length
}
