// ─── 更新检查状态与启动编排（app-lynx） ───
// 只做自动检查、不做手动入口（用户决策）：启动后延迟检查，发现新版本
// 直接打开强制更新页（无中间提示层）。更新页无法返回——进入时 replace +
// 清空历史栈（无处可回），返回键由路由 backBehavior: 'exit' 兜底为退出应用。
// 页面不直接接触原生桥与 URL 细节：下载/退出动作全部收敛在本模块。
// Pinia 化（ADR-0139 / spec #337）：setup store——state/actions 移入 defineStore
// 闭包，逻辑逐字不变（纯重构约束）。
// 模块级 _updateCheckDisabled / setUpdateCheckDisabledForTest / isUpdateCheckDisabled
// 仍保留——它们是测试钩子与跨 setup 实例的开关，不属于响应式状态（spec 明示）。
import { ref } from "vue"
import { defineStore } from "pinia"
import { checkForUpdate, type CheckResult, type FetchLike } from "@pictelio/update-check"
import { requestFetch } from "../utils/fetchWrapper"
import { navigate, resetHistory } from "../router"
import { getNativeModules, isNativeMode } from "../api/client"

/** 启动后检查更新的延迟（ms）：先让首帧渲染/交互就绪，与主 app STARTUP_CHECK_DELAY_MS 对齐 */
const STARTUP_CHECK_DELAY_MS = 500

// ─── 启动更新检查开关（.env PICTELIO_DISABLE_UPDATE_CHECK=true） ───
// 编译期由 lynx.config.ts 注入默认值；模块级可变 + setter 便于单测断言 true 分支。
let _updateCheckDisabled = __DISABLE_UPDATE_CHECK__

/** 测试专用：覆盖开关状态（默认来自 .env 编译期注入；测试后需重置） */
export function setUpdateCheckDisabledForTest(disabled: boolean): void {
  _updateCheckDisabled = disabled
}

/** 当前开关状态：true = 强制跳过启动更新检查 */
export function isUpdateCheckDisabled(): boolean {
  return _updateCheckDisabled
}

export const useUpdateStore = defineStore("update", () => {
  // state（私有 ref，不暴露给消费者直接写——通过 actions 改）
  const _isChecking = ref(false)
  const _result = ref<CheckResult | null>(null)

  /**
   * 检查更新的网络层适配（FetchLike seam）。
   * 原生 Lynx JS 运行时无 fetch（fetchWrapper 实测仅 web-core 可用）——
   * 原生模式经 PictelioApp.httpGet 走 Java OkHttp；web-core/测试走 requestFetch。
   */
  function createUpdateFetchImpl(): FetchLike {
    if (!isNativeMode()) return requestFetch
    return (input, init) =>
      new Promise<Response>((resolve, reject) => {
        const mod = getNativeModules()?.PictelioApp as
          | { httpGet?: (url: string, cb: (status: number, body: string) => void) => void }
          | undefined
        if (!mod?.httpGet) {
          reject(new Error("原生桥 httpGet 不可用（web-core 预览属预期）"))
          return
        }
        let settled = false
        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true
            fn()
          }
        }
        // JS 侧 10s 超时兜底：Java 侧 callTimeout 同值，双保险
        init?.signal?.addEventListener("abort", () => settle(() => reject(new Error("aborted"))))
        mod.httpGet(String(input), (status, body) => {
          if (status === 0) {
            settle(() => reject(new Error(body)))
            return
          }
          settle(() =>
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json: () => {
                try {
                  return Promise.resolve(JSON.parse(body))
                } catch (err) {
                  return Promise.reject(err)
                }
              },
            } as unknown as Response),
          )
        })
      })
  }

  /** 启动自动检查（App.vue onMounted 调用；内部自带延迟，不阻塞首帧） */
  function runStartupUpdateCheck(): void {
    // 开发调试开关（.env PICTELIO_DISABLE_UPDATE_CHECK=true）：强制跳过启动更新检查，
    // 不走 checkForUpdate / 不进强制更新页。用于 dev 预览场景避免误锁死在更新页。
    // 显式 warn 而非静默跳过（禁止静默降级约定）。
    if (isUpdateCheckDisabled()) {
      console.warn("[updateStore] PICTELIO_DISABLE_UPDATE_CHECK=true，已跳过启动更新检查（dev 调试）")
      return
    }
    if (_isChecking.value) return
    _isChecking.value = true
    setTimeout(() => {
      void (async () => {
        try {
          // 本地版本用 __APP_VERSION__（构建时从 app 包注入，与 APK 版本单一事实源一致）；
          // fetchImpl 按环境适配：原生走 PictelioApp.httpGet，web-core 走 requestFetch
          const result = await checkForUpdate(__APP_VERSION__, createUpdateFetchImpl())
          _result.value = result
          // 导航条件含 latestReleaseUrl：无 release 页时进更新页会把用户锁死在无出口页面
          if (result.hasUpdate && result.latestVersion && result.latestReleaseUrl) {
            // 强制更新页：replace + 清空历史栈，无返回路径（backBehavior: 'exit' 兜底）
            resetHistory()
            void navigate("/update", { replace: true })
          }
        } catch (err) {
          // checkForUpdate 已内部兜底，此处仅防御未来改动（禁止静默降级）
          console.warn("[updateStore] 启动更新检查异常:", err)
        } finally {
          _isChecking.value = false
        }
      })()
    }, STARTUP_CHECK_DELAY_MS)
  }

  /**
   * 「下载新版本」：经原生桥 openUrl 用系统浏览器强制打开 release 页
   * （独立 task，无法返回 app 内）。原生桥缺失（web-core 预览）或失败时
   * console.warn（禁止静默降级）。
   */
  function openReleasePage(): void {
    const url = _result.value?.latestReleaseUrl
    if (!url) {
      console.warn("[updateStore] 打开 release 页失败: 无 latestReleaseUrl")
      return
    }
    const module = getNativeModules()?.PictelioApp as
      | { openUrl?: (url: string, cb?: (err: string | null) => void) => void }
      | undefined
    if (!module?.openUrl) {
      console.warn("[updateStore] 原生桥 openUrl 不可用（web-core 预览属预期），release: " + url)
      return
    }
    module.openUrl(url, (err) => {
      if (err) console.warn("[updateStore] 打开 release 页失败:", err)
    })
  }

  /** 「退出应用」（更新页顶部原"返回"位置 + 返回键兜底）：关闭 Lynx 宿主 Activity */
  function exitUpdatePage(): void {
    const module = getNativeModules()?.PictelioApp as
      | { exitApp?: (cb: (err: string | null) => void) => void }
      | undefined
    if (!module?.exitApp) {
      console.warn("[updateStore] 原生桥 exitApp 不可用（web-core 预览属预期）")
      return
    }
    // lynx NativeModule 约定 Callback 必传（模拟器实测：无参调用报
    // "expected: 1, but got 0"）；回调参数可忽略
    module.exitApp(() => {})
  }

  return {
    // getters（公开 ref，模板/脚本仍可 .value 解包）
    isCheckingUpdate: _isChecking,
    updateResult: _result,
    // actions
    runStartupUpdateCheck,
    openReleasePage,
    exitUpdatePage,
    createUpdateFetchImpl,
  }
})
