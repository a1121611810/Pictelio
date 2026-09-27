// ─── 限流退避（429 backoff）纯函数与配置（ADR-0199） ───
// 配方：capped exponential + full jitter（AWS）——
//   delay = random(0, min(maxDelayMs, baseDelayMs × 2^attempt))
// 倍率恒 2、jitter 恒 full：算法类参数不进设置页（ADR-0199 D3，业界调研 §5——
// 误配算法参数会直接导致重试风暴）；设置页只暴露效果类四参数（D4）。
// 术语口径见 docs/adr/glossary-app-lynx-rate-limit-backoff.md：
// 「重试上限」不含首次请求（maxRetries=3 → 最多 4 次尝试）。
import { ApiErrorType, type ApiError } from "./types"

export interface RateLimitBackoffConfig {
  /** 总开关：false = 429 立即抛出零重试（回到退避功能上线前的行为） */
  enabled: boolean
  /** 重试上限（不含首次请求；总尝试次数 = maxRetries + 1） */
  maxRetries: number
  /** 初始延迟基数 ms（attempt=0 的名义等待） */
  baseDelayMs: number
  /** 名义等待封顶 ms（指数增长在此打住） */
  maxDelayMs: number
}

/** 默认参数（ADR-0199 D3：初始 1s / 封顶 30s / 重试 3 次——Octokit/Azure 惯例；gallery-dl 的 60s 对移动端过保守） */
export const DEFAULT_RATE_LIMIT_BACKOFF_CONFIG: RateLimitBackoffConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}

/** 设置页离散档位（ADR-0199 D4；maxDelay 档位集恒 ≥ base 档位集，不存在倒挂配置） */
export const RATE_LIMIT_MAX_RETRIES_OPTIONS = [0, 1, 2, 3, 4, 5] as const
export const RATE_LIMIT_BASE_DELAY_MS_OPTIONS = [500, 1000, 2000, 5000] as const
export const RATE_LIMIT_MAX_DELAY_MS_OPTIONS = [10000, 30000, 60000] as const

/**
 * 第 attempt 次重试（从 0 计）的实际等待 ms。
 * full jitter：[0, min(maxDelayMs, baseDelayMs × 2^attempt)) 均匀分布——
 * 把重试时点打散，防多请求齐步撞限流（AWS 配方）。随机源注入可测。
 */
export function computeRateLimitBackoffDelayMs(
  attempt: number,
  config: RateLimitBackoffConfig,
  random: () => number = Math.random,
): number {
  const nominal = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt)
  return Math.floor(random() * nominal)
}

export interface RateLimitBackoffRunOptions {
  /** 退避等待期取消 → 立即中止不再重试（调用方生命周期优先） */
  signal?: AbortSignal
  /** 等待实现注入（测试用）；默认 setTimeout + abort 监听 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 每次退避重试前回调（留痕/观测）；attempt 从 1 计（第 1 次 = 首次重试） */
  onRetry?: (attempt: number, delayMs: number) => void
}

/** abort 拒因：优先透传 signal.reason（对齐 fetch abort 语义）；参数宽容 undefined（onAbort 闭包内无外层 narrowing） */
function abortRejectReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new Error("aborted")
}

/** 默认等待：setTimeout + abort 监听双通道，取消时清理定时器并立即拒绝 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortRejectReason(signal))
      return
    }
    const onAbort = () => {
      cleanup()
      reject(abortRejectReason(signal))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }
    signal?.addEventListener("abort", onAbort)
  })
}

function isRateLimitError(err: unknown): err is ApiError {
  return (err as ApiError | undefined)?.type === ApiErrorType.RATE_LIMIT
}

/**
 * 以限流退避策略执行 fn（ADR-0199 D5）：
 * - 仅当 fn 抛 429 限流错误（ApiErrorType.RATE_LIMIT）且开关开启时，按 full jitter
 *   延迟等待后重试，最多 maxRetries 次（总尝试 = maxRetries + 1）；其他错误原样抛出。
 * - enabled=false 或 maxRetries=0 → 限流错误立即抛出（零重试，行为与上线前一致）。
 * - 重试耗尽：抛出的限流错误带 params.attempts = 实际重试次数（终态可观测；
 *   不可变展开，不改写原错误对象）。首次即失败（attempt=0）不附加。
 * - signal 在等待期取消 → 以 abort 拒因立即拒绝，不再重试。
 */
export async function runWithRateLimitBackoff<T>(
  fn: () => Promise<T>,
  config: RateLimitBackoffConfig,
  options: RateLimitBackoffRunOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep
  const maxRetries = config.enabled ? Math.max(0, Math.floor(config.maxRetries)) : 0
  let retriesUsed = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimitError(err) || retriesUsed >= maxRetries) {
        // 限流重试耗尽（且确实重试过）→ 终态附加实际重试次数
        if (isRateLimitError(err) && retriesUsed > 0) {
          throw { ...err, params: { ...err.params, attempts: retriesUsed } }
        }
        throw err
      }
      const delayMs = computeRateLimitBackoffDelayMs(retriesUsed, config)
      options.onRetry?.(retriesUsed + 1, delayMs)
      retriesUsed += 1
      await sleep(delayMs, options.signal)
    }
  }
}
