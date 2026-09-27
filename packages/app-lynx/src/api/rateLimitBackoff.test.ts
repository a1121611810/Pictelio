// ─── 限流退避纯函数单元测试（ADR-0199 D3/D5 契约基座） ───
// oracle 溯源（AGENTS.md 测试硬约束 6）：断言期望值全部独立来源于 ADR-0199 D3 公式
//   delay = floor(random() × min(maxDelayMs, baseDelayMs × 2^attempt))   [full jitter]
// 而非实现反推：用注入 random 的已知端点值（0 / 1-Number.EPSILON）提取分布两端，
// 用 base×2^attempt 手工计算名义序列。sleep / random 全注入 → 不依赖 fake timers、零真实等待。
// 术语口径（docs/adr/glossary-app-lynx-rate-limit-backoff.md）：「重试上限」不含首次请求。
import { describe, it, expect, vi, afterEach } from "vitest"
import { computeRateLimitBackoffDelayMs, runWithRateLimitBackoff, type RateLimitBackoffConfig } from "./rateLimitBackoff"
import { ApiErrorType, type ApiError } from "./types"

/** 测试配置：base=100ms 便于核对倍增序列；max 足够大避免提前封顶干扰 */
const CFG: RateLimitBackoffConfig = { enabled: true, maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 }

/** 构造 429 限流错误（形状对齐 client.classifyError 的 RATE_LIMIT 分支：type/message/status） */
function rateLimitError(): ApiError {
  return { type: ApiErrorType.RATE_LIMIT, message: "x", status: 429 }
}

afterEach(() => {
  // 恢复被 spyOn 的 Math.random，防跨用例污染（vi.fn 本身无状态需清理）
  vi.restoreAllMocks()
})

describe("computeRateLimitBackoffDelayMs（ADR-0199 D3 公式 oracle）", () => {
  it("random()=0 → 延迟 0（full jitter 下界）", () => {
    expect(computeRateLimitBackoffDelayMs(0, CFG, () => 0)).toBe(0)
  })

  it("random()=1-Number.EPSILON → 名义值-1（full jitter 上界，[0, nominal) 开区间）", () => {
    expect(computeRateLimitBackoffDelayMs(0, CFG, () => 1 - Number.EPSILON)).toBe(CFG.baseDelayMs - 1)
  })

  it("attempt 0/1/2 名义序列 = base×1 / ×2 / ×4（注入上界 random 提取）", () => {
    const cfg: RateLimitBackoffConfig = { enabled: true, maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 1_000_000 }
    const upper = () => 1 - Number.EPSILON
    expect(computeRateLimitBackoffDelayMs(0, cfg, upper)).toBe(1000 * 1 - 1)
    expect(computeRateLimitBackoffDelayMs(1, cfg, upper)).toBe(1000 * 2 - 1)
    expect(computeRateLimitBackoffDelayMs(2, cfg, upper)).toBe(1000 * 4 - 1)
  })

  it("maxDelayMs 封顶：base 5000、attempt 3 名义应为 40000，上界实为 maxDelay-1（封顶生效）", () => {
    const cfg: RateLimitBackoffConfig = { enabled: true, maxRetries: 5, baseDelayMs: 5000, maxDelayMs: 30_000 }
    // 未封顶应为 40000-1；封顶后 = min(30000, 40000)-1
    expect(computeRateLimitBackoffDelayMs(3, cfg, () => 1 - Number.EPSILON)).toBe(30_000 - 1)
  })
})

describe("runWithRateLimitBackoff（sleep/onRetry 注入，429 触发口径）", () => {
  it("首次成功：fn 调 1 次、零等待、无 onRetry", async () => {
    const fn = vi.fn(async (): Promise<string> => "ok")
    const sleep = vi.fn(async () => {})
    const onRetry = vi.fn()
    await expect(runWithRateLimitBackoff(fn, CFG, { sleep, onRetry })).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("429→429→成功：fn 3 次、sleep 2 次、onRetry(1,d1)/(2,d2)，delay 按 D3 公式可算", async () => {
    // random 钉 0.5 → delay = floor(0.5 × min(10000, 100×2^attempt)) = 50 / 100（公式手算，非实现反推）
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const err = rateLimitError()
    const fn = vi.fn(async (): Promise<string> => "done")
    fn.mockRejectedValueOnce(err).mockRejectedValueOnce({ ...err })
    const sleep = vi.fn(async () => {})
    const onRetry = vi.fn()
    await expect(runWithRateLimitBackoff(fn, CFG, { sleep, onRetry })).resolves.toBe("done")
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 50)
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 100)
  })

  it("一直 429（maxRetries=3）→ 耗尽 reject 带 params.attempts=3，fn 共 4 次（首次+3 重试）", async () => {
    const fn = vi.fn(async (): Promise<string> => "never", )
    fn.mockRejectedValue(rateLimitError())
    const sleep = vi.fn(async () => {})
    const onRetry = vi.fn()
    await expect(runWithRateLimitBackoff(fn, CFG, { sleep, onRetry })).rejects.toMatchObject({
      type: ApiErrorType.RATE_LIMIT,
      params: { attempts: 3 },
    })
    expect(fn).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(3)
  })

  it("enabled=false → 零重试立即抛原错误（无 attempts 附加）", async () => {
    const cfg: RateLimitBackoffConfig = { enabled: false, maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 }
    const fn = vi.fn(async (): Promise<string> => "never")
    fn.mockRejectedValue(rateLimitError())
    const sleep = vi.fn(async () => {})
    const caught = await runWithRateLimitBackoff(fn, cfg, { sleep }).then(
      () => null,
      (e: unknown) => e,
    )
    // 原样抛出（形状 = 注入错误本身，无附加字段）
    expect(caught).toEqual({ type: ApiErrorType.RATE_LIMIT, message: "x", status: 429 })
    expect((caught as ApiError).params).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("maxRetries=0 → 同 enabled=false：立即抛、零重试、无 attempts", async () => {
    const cfg: RateLimitBackoffConfig = { enabled: true, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 10_000 }
    const fn = vi.fn(async (): Promise<string> => "never")
    fn.mockRejectedValue(rateLimitError())
    const sleep = vi.fn(async () => {})
    const caught = await runWithRateLimitBackoff(fn, cfg, { sleep }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(caught).toEqual({ type: ApiErrorType.RATE_LIMIT, message: "x", status: 429 })
    expect((caught as ApiError).params).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("非 429（SERVER）→ 立即原样抛（同一错误对象，不进退避）", async () => {
    const serverErr: ApiError = { type: ApiErrorType.SERVER, message: "boom", status: 500 }
    const fn = vi.fn(async (): Promise<string> => "never")
    fn.mockRejectedValue(serverErr)
    const sleep = vi.fn(async () => {})
    await expect(runWithRateLimitBackoff(fn, CFG, { sleep })).rejects.toBe(serverErr)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("首次即 429 且 maxRetries=0 → 抛原错误对象且原对象未被改写（不可变展开）", async () => {
    const cfg: RateLimitBackoffConfig = { enabled: true, maxRetries: 0, baseDelayMs: 100, maxDelayMs: 10_000 }
    const err = rateLimitError()
    const fn = vi.fn(async (): Promise<string> => "never")
    fn.mockRejectedValue(err)
    await expect(runWithRateLimitBackoff(fn, cfg, { sleep: vi.fn(async () => {}) })).rejects.toBe(err)
    // 首次即失败（retriesUsed=0）不附加 attempts，原错误对象保持纯净
    expect(err.params).toBeUndefined()
  })

  it("sleep 拒绝（模拟 signal 取消）→ 拒因向上传播且 fn 不再被调", async () => {
    const abortErr = new Error("aborted")
    const fn = vi.fn(async (): Promise<string> => "never")
    fn.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce("reached-after-sleep")
    const sleep = vi.fn(async () => {
      throw abortErr
    })
    await expect(runWithRateLimitBackoff(fn, CFG, { sleep })).rejects.toBe(abortErr)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
