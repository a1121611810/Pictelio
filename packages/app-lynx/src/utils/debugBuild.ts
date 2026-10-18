// ─── debug 构建判定（#1035）：dev 播种读侧闸门的构建类型来源 ───
//
// 为什么**不用** `__DEV__`：它在 NODE_ENV=production 恒 false，**debug APK 亦然**
// （lynx.config.ts 的 `_isDev` 双条件；同款记录见 rspeedy-env.d.ts 与 router.ts
// 的 `__BENCH_NAV__` 段）。拿它当闸门会得到「单测全绿、真机全死」的假绿——
// vitest 配置把 `__DEV__` 注入成 true，测试环境与真机行为不一致。
//
// 契约：**fail closed**。非原生环境（web-core 预览）、方法缺失、同步抛错一律 false。
// 判据是「确认是 debug 构建」，不是「不是 debug 构建」——证明不了就当 release。
// 理由是后果不对称（#1035）：误判为 debug ⇒ debug 播种的受限正文外发授权在 release
// 生效；误判为 release ⇒ 只是 dev 通道暂时不可用。
import { isNativeMode, getNativeModules } from "../api/client"

type DebugBuildApp = {
  isDebugBuild?: (cb: (isDebug: boolean) => void) => void
}

/**
 * 进程内记忆化。`BuildConfig.DEBUG` 是**每 APK 的编译期常量**，同一进程内不会变，
 * 故缓存不引入陈旧读——这与「读用户设置」类缓存有本质区别。
 * 顺带把每次 `loadSettings` 的两次桥接调用收敛成一次。
 */
let cached: boolean | undefined

/**
 * 解析当前是否 debug 构建。
 *
 * ⚠️ **已知失效面（登记，非缺陷）**：本方法返回的 Promise 只由原生回调或同步抛错沉降。
 * 原生侧实现是同步 `invoke`，但若桥中断 / 模块未注册 / `Callback` 被吞，回调永不落 ⇒
 * Promise 永不着陆。**本方法不设超时兜底**——「探测超时 + 兜底」在本仓是登记在案的
 * 反模式（见 `packages/app-lynx/CONTEXT.md`「三态 cache adapter」词条的 _Avoid_：
 * 真机上 setTimeout 不可靠，会造出「看起来在工作」的假象）。
 *
 * 该挂起面**不是本改动引入的新风险类**：同一条 `loadSettings` 上每个 `prefs().get()`
 * 都是同一形状（`new Promise(resolve => mod.prefsGet(key, cb))`），且 `loadSettings`
 * 在冷启动路由初始化里被 await。判据是「原生回调会送达」这一既有契约，对所有读点一致。
 *
 * ⚠️ 另一条失效面（两条 fail-closed 分支的恢复语义**不同**，刻意如此）：
 * - **方法缺失**判 false 后**记忆化**，本进程不再复问 ⇒ 不能自愈。可达路径不止
 *   「版本漂移」：`isNativeMode()` 只要 `PictelioAuth` / `PictelioApi` /
 *   `PictelioSecureStorage` 之一在就算 true，此时 `PictelioApp` 缺失仍会走到这里。
 *   故该分支的 warn 文案说的是「按非 debug 处理」，不是「一定是版本漂移」。
 * - **调用抛错**判 false 但**不**记忆化 ⇒ 下次会重试。桥挂通常是瞬时的，把一次抖动
 *   固化成整进程的 false 才是真正的毒化。
 */
export function resolveDebugBuild(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached)
  if (!isNativeMode()) return Promise.resolve(false)
  const app = getNativeModules()?.PictelioApp as DebugBuildApp | undefined
  if (!app || typeof app.isDebugBuild !== "function") {
    // 同样记忆化：NativeModules 的形状在进程内不变，判定不会变。
    // 不缓存会让每次 loadSettings 都重复 warn 同一条「版本漂移异常」，把真告警淹掉
    // （dev 通道未被使用的用例也会刷屏）。
    // ⚠️ 代价见失效面登记：这条判 false 后**本进程不再复问**，故不能自愈。
    console.warn("[debugBuild] 原生 isDebugBuild 缺失，dev 通道按非 debug 处理（版本漂移异常）")
    return Promise.resolve((cached = false))
  }
  return new Promise<boolean>((resolve) => {
    try {
      app.isDebugBuild?.((isDebug) => resolve((cached = isDebug === true)))
    } catch (e) {
      // 抛错**不**缓存：桥挂是瞬时故障，把它记成永久 false 会让一次抖动毒化整个进程。
      console.warn("[debugBuild] 原生 isDebugBuild 抛错，dev 通道按非 debug 处理", e)
      resolve(false)
    }
  })
}

/** 仅供单测重置记忆化；生产路径无调用点。 */
export function resetDebugBuildCacheForTest(): void {
  cached = undefined
}
