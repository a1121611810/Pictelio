// ─── 更新检查状态与启动编排（app-lynx） ───
// 只做自动检查、不做手动入口（用户决策）：启动后延迟检查，发现新版本
// 直接打开强制更新页（无中间提示层）。更新页无法返回——进入时 replace +
// 清空历史栈（无处可回），返回键由路由 backBehavior: 'exit' 兜底为退出应用。
// 页面不直接接触原生桥与 URL 细节：下载/退出动作全部收敛在本模块。
import { ref } from "vue"
import { checkForUpdate, type CheckResult } from "@pictelio/update-check"
import { requestFetch } from "../utils/fetchWrapper"
import { navigate, resetHistory } from "../router"
import { getNativeModules } from "../api/client"

/** 启动后检查更新的延迟（ms）：先让首帧渲染/交互就绪，与主 app STARTUP_CHECK_DELAY_MS 对齐 */
const STARTUP_CHECK_DELAY_MS = 500

const _isChecking = ref(false)
const _result = ref<CheckResult | null>(null)

export const isCheckingUpdate = _isChecking
export const updateResult = _result

/** 启动自动检查（App.vue onMounted 调用；内部自带延迟，不阻塞首帧） */
export function runStartupUpdateCheck(): void {
  if (_isChecking.value) return
  _isChecking.value = true
  setTimeout(() => {
    void (async () => {
      try {
        // 本地版本用 __APP_VERSION__（构建时从 app 包注入，与 APK 版本单一事实源一致）；
        // fetchImpl 必须传 requestFetch——web-core 模块作用域内裸 fetch 为 undefined
        // （fetchWrapper.ts 实测），原生 LynxView 走 Lynx Http Service。
        const result = await checkForUpdate(__APP_VERSION__, requestFetch)
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
export function openReleasePage(): void {
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
export function exitUpdatePage(): void {
  const module = getNativeModules()?.PictelioApp as
    | { exitApp?: (cb?: (err: string | null) => void) => void }
    | undefined
  if (!module?.exitApp) {
    console.warn("[updateStore] 原生桥 exitApp 不可用（web-core 预览属预期）")
    return
  }
  module.exitApp()
}
