// ─── 代际闸（generation gate）[维度重构 2026-10-03 新增] ───
//
// 【解决什么】AGENTS.md「即时导航硬约束」第 3 条：组件内所有异步数据请求必须用
// generation-gate / AbortController 或等效机制防护，**防止请求参数变化后旧响应覆盖新数据**
// （违反视为架构违规）。本原语是仓内「生成→废弃」范式的可复用落点：
// 既有先例 `src/pages/MyPixiv.vue:95` 的 `if (seq !== fetchSeq) return` 是**内联手写**，
// 每页重写一遍；本次把它收成一个纯状态机，好处是：
//   ① 真并发语义可单测（见 generationGate.test.ts 的「慢的旧请求不得覆盖快的新请求」），
//      源码扫描式断言只能证明"有个比较符号"，证不了"比较的是对的代数"；
//   ② 两个聚合页共用同一形状（顺带缓解 Duplicated Code）。
//
// 【为什么不直接用 AbortController】本仓数据层走 Lynx 原生模块网关，signal 的透传面
// 尚未在 app-lynx 全量验证；且 signal 取消的是"请求"，代际闸拦的是"**结果**"——
// 请求取消与否都可能有响应落地（已到达 socket 的部分）。两者互补，本仓现取代际闸。
//
// 【语义】后发者胜：任何在更早一代发起、却更晚落地的响应必须被丢弃。
// 这是并发场景下唯一与用户直觉一致的口径（最后一次意图优先）。
export interface GenerationGate {
  /** 取当前代并推进。返回的 token 须在异步结果落地前交 isCurrent 校验。 */
  next(): number
  /** 落地前校验：token 非当前代 ⇒ 该响应已作废，调用方必须丢弃结果。 */
  isCurrent(token: number | undefined): boolean
  /** 立即作废所有在飞代（组件卸载 / 切换数据源 / 主动取消）。 */
  invalidate(): void
}

/** 创建代际闸。初值 0，首次 next() 返回 1。 */
export function createGenerationGate(): GenerationGate {
  let generation = 0
  return {
    next(): number {
      generation += 1
      return generation
    },
    isCurrent(token: number | undefined): boolean {
      return token !== undefined && token === generation
    },
    invalidate(): void {
      // 推到下一格即可让所有既有 token 失配；不重置为 0 是为了避免「卸载后旧请求恰好
      // 拿到与新请求相同的编号」这类回绕碰撞。
      generation += 1
    },
  }
}
