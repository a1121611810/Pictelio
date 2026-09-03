// ─── Pinia 单例 seam（ADR-0139 决策 3） ───
// index.ts 的 app.use(pinia) 与所有非组件上下文（router 守卫、测试）共用同一实例：
// 若各 createPinia() 会生成两个实例 → 两个 store 空间，状态互不同步。
// 本 seam 是全迁移的「第一行代码」，先于任何 store 改造落地。
//
// 模块加载期时序契约（ADR-0139 决策 4，实测结论 2026-09-03）：
// router.ts 模块顶层 void router.replace(RECOMMENDED_PATH) 触发首导航，beforeEach 守卫
// 经 promise 链在 microtask 执行（纯 vue-router 行为，node 实测：push 同步返回后 0 tick
// 内守卫才执行），而 index.ts 的 app.use(pinia) 与 import { router } 同属当前同步栈、
// 先于 microtask —— 因此守卫执行时 pinia 必然已安装，无需 setActivePinia 兜底。
// 这是时序实证而非原理保证：若未来 router 顶层 replace 改为 await 或守卫改为模块顶层
// 直接调用 useXStore()（同步执行），契约破坏，届时必须恢复 setActivePinia(pinia) 兜底。
import { createPinia } from "pinia"

export const pinia = createPinia()
