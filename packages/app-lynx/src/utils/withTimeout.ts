// 请求超时工具：Promise.race 实现，防止网络请求挂起时骨架屏/loading 无限期显示（issue #128）。
// 超时后 reject，调用方已有的 catch 分支会捕获并展示 errorMsg 兜底（loading 提前结束）。
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // 超时 Promise：到点即 reject（永不 resolve，只作为竞速对手）
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message ?? '请求超时')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    // 竞速已出结果：清除定时器防泄漏（race 只 settle 一次，晚到的 resolve/reject 会被忽略）
    if (timer) clearTimeout(timer)
  })
}
