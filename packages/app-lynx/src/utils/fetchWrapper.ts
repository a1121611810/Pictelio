// ─── fetch 抽象（vue-lynx 环境适配） ───
// 问题：web-core 通过 Function(...) 构造器执行 bundle 时，将 fetch 作为形参注入，
// 但 webpack 模块作用域内的裸 fetch 解析为 undefined（实测）。globalThis.fetch 可用。
// 原生 Lynx 环境（LynxView，T7）走 Lynx Http Service，此处预留 fallback 链。
export function requestFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const g = globalThis as unknown as { fetch?: typeof fetch }
  const f = g.fetch ?? (typeof fetch !== "undefined" ? fetch : null)
  if (!f) {
    throw new Error("fetch 不可用（当前环境无网络能力）")
  }
  return f(input, init)
}
