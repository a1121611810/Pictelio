// ─── authStore 401 处理器：内存态回落持久层（#815）────────────────────────────
//
// 背景（issue #815 实测时序，logcat 19:52:28-29）：
//   28.419 useApiQuery health 请求发出 → 28.430 getItem.refresh_token 发出
//   → 28.465 loginWithRefreshToken 发出（异步 OAuth 交换在飞）
//   → 29.835 401 ×2：此时 authStore 内存 `_refreshToken` 仍为 null
//      → 旧实现直接 warn「登录态已丢失」跳过刷新 → 一次性 401 升级为**永久失效**
//      → 上报会话失效 → 弹全屏 /error，requiresAuth 路由被弹回
// 而持久层（Keystore/IndexedDB）此时**确实有** token（实测 shared_prefs 密文存在），
// 故修复为「内存空 ⇒ 回落读持久层」。
//
// oracle 溯源（非从实现反推）：判别口径 = authStore.ts 内注释「内存态优先，为空时回落到
// 持久层」；失败路径 = 「内存与持久层均无 refresh_token，跳过刷新」（真未登录，不自愈）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const loadRefreshToken = vi.fn<() => Promise<string | null>>()
const saveRefreshToken = vi.fn<() => Promise<void>>()
const clearRefreshToken = vi.fn<() => Promise<void>>()
const setAccessToken = vi.fn()
const setOnUnauthorized = vi.fn()
const setAuthPermanentFailure = vi.fn()
const reportSessionError = vi.fn()
const performRefreshInner = vi.fn<() => Promise<boolean>>()

vi.mock("../utils/tokenStorage", () => ({
  loadRefreshToken: () => loadRefreshToken(),
  saveRefreshToken: () => saveRefreshToken(),
  clearRefreshToken: () => clearRefreshToken(),
}))
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>()
  return {
    ...actual,
    setAccessToken: (t: string) => setAccessToken(t),
    setAuthPermanentFailure: (v: boolean) => setAuthPermanentFailure(v),
    setOnUnauthorized: (fn: () => Promise<void>) => setOnUnauthorized(fn),
    isNativeMode: () => true,
  }
})
vi.mock("../utils/errorPresentation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/errorPresentation")>()
  return {
    ...actual,
    reportSessionError: (e: unknown) => reportSessionError(e),
  }
})
// 原生模式 performRefresh 走的是 `getNativeModules().PictelioAuth.loginWithRefreshToken` 的
// **回调式**通道（access_token 零知），不是 `../api/auth` 的 Promise 包装——mock 挂错模块
// 会让 performRefresh 直接因「原生认证模块不可用」返回 false，内存态永不落地。
// oracle 溯源 = authStore.ts performRefresh 原生分支的回调签名
// (userInfoJson: string, err: string) 与 JSON.parse 字段清单。
const nativeAuth = {
  loginWithRefreshToken: (
    token: string,
    cb: (userInfoJson: string, err: string) => void,
  ): void => {
    performRefreshInner(token)
      .then(() =>
        cb(
          JSON.stringify({
            userId: 12345,
            userName: "e2e-user",
            userAccount: "e2e",
            refreshToken: token,
          }),
          "",
        ),
      )
      .catch(() => cb("", "OAuth 交换失败"));
  },
  clearTokens: (): void => {},
}

/** 从 client 抓到的 401 回调（setOnUnauthorized 的入参） */
let unauthorizedHandler: (() => Promise<void>) | null = null

async function loadStore() {
  vi.stubGlobal("NativeModules", { PictelioAuth: nativeAuth })
  const mod = await import("./authStore")
  // Pinia setup store 需要 active pinia；用 createPinia + setActivePinia 建一次性实例
  const { createPinia, setActivePinia } = await import("pinia")
  setActivePinia(createPinia())
  return mod.useAuthStore()
}

beforeEach(() => {
  unauthorizedHandler = null
  loadRefreshToken.mockReset()
  saveRefreshToken.mockReset().mockResolvedValue(undefined)
  clearRefreshToken.mockReset().mockResolvedValue(undefined)
  setAccessToken.mockReset()
  reportSessionError.mockReset()
  performRefreshInner.mockReset().mockResolvedValue(true)
  setOnUnauthorized.mockReset().mockImplementation((fn: () => Promise<void>) => {
    unauthorizedHandler = fn
  })
  setAuthPermanentFailure.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("authStore 401 处理器 — 内存空时回落持久层（#815）", () => {
  it("持久层有 token + 内存空 → 回落读取并完成刷新（登录态自愈）", async () => {
    loadRefreshToken.mockResolvedValue("persisted-refresh-token")
    const store = await loadStore()
    store.registerUnauthorizedHandler()

    expect(unauthorizedHandler).toBeTypeOf("function")
    // 401 发生：内存无 token，但持久层有
    await unauthorizedHandler!()

    // 关键：回落读取被调用（而不是直接放弃）
    expect(loadRefreshToken).toHaveBeenCalledTimes(1)
  })

  it("内存与持久层均无 token → 不自愈、不上报会话失效（真未登录，静默返回）", async () => {
    loadRefreshToken.mockResolvedValue(null)
    const store = await loadStore()
    store.registerUnauthorizedHandler()

    await unauthorizedHandler!()

    expect(loadRefreshToken).toHaveBeenCalledTimes(1)
    // 真未登录：不应把用户踢到全屏错误页
    expect(reportSessionError).not.toHaveBeenCalled()
  })

  it("持久层读取抛错（storage 异常）→ 视为无 token，不上报会话失效（禁崩溃）", async () => {
    loadRefreshToken.mockRejectedValue(new Error("Keystore 解密失败"))
    const store = await loadStore()
    store.registerUnauthorizedHandler()

    await expect(unauthorizedHandler!()).resolves.toBeUndefined()
    expect(reportSessionError).not.toHaveBeenCalled()
  })

  it("内存已有 token → 不回落读持久层（内存优先，避免每次 401 都打存储）", async () => {
    // 先登录一次把内存态填上（performRefresh 成功 → _refreshToken 落地）
    loadRefreshToken.mockResolvedValue("persisted-refresh-token")
    const store = await loadStore()
    store.registerUnauthorizedHandler()
    await unauthorizedHandler!() // 第一次：内存空 → 回落读取并自愈
    expect(loadRefreshToken).toHaveBeenCalledTimes(1)

    // 第二次 401：此时内存已有 token → 不应再回落读存储
    loadRefreshToken.mockClear()
    await unauthorizedHandler!()
    expect(loadRefreshToken).not.toHaveBeenCalled()
  })
})
