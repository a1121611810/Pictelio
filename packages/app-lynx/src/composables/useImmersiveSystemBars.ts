// ─── 沉浸态系统栏联动（#889 / ADR-0213 决策 4、5、6）───
//
// 与 `useImmersiveChrome` 分离：前者管**应用内 chrome 的显隐**（页面本地状态），
// 本模块管**原生系统栏**（跨进程、跨 Activity 的宿主状态）。二者生命周期不同，
// 合成一个 composable 会让「页面状态」与「宿主状态」的复位时机互相污染。
//
// ── 决策 4：退出时回落到「用户当前的全屏模式设定」，不是硬编码 false ──
// 硬编码 false 会在用户**开着**全屏模式时退出沉浸，顺手把其持久设定改成关闭 ——
// 一次沉浸看图静默改掉用户的全局偏好。
//
// ── 决策 6：沉浸路径**严禁写持久键** ──
// 写了 = 用户下次冷启动直接进沉浸，且没有任何 chrome 可点（进入路径只有单击图片），
// 表现为「应用一打开就是黑的，什么都点不了」。原生侧的恢复由
// **持久化的全屏模式键**在 `LynxActivity.onCreate` 尾部驱动（真机实测 P3 探针阳性：
// 进程被杀后重启系统栏正确恢复），不依赖本模块。
//
// ── 决策 5：四层复位，其中第四层刻意留空 ──
// ① 单一所有权（`useImmersiveChrome` 的 `activeOwnerRef`）—— 新 owner 接管前强制旧 owner 复位
// ② `onUnmounted` —— 宿主组件销毁即释放（该页不在 App.vue 的 KeepAlive 白名单，真机已核）
// ③ 返回守卫 —— 属 #889 同批的接线点，见下
// ④ **进程外兜底：刻意不实现**。真机实测（P3）：进程被杀后原生侧由持久化键自愈，
//    不需要 JS 侧兜底；为一个「已验证不会发生」的场景写代码是 Speculative Generality。
//    ⚠️ 若日后实测出现自愈失败，**不得**靠补第 ④ 层掩盖，须回头查原生 onCreate 读键链路。
import { isNativeMode, getNativeModules } from '../api/client'
import { useSettingsStore } from '../stores/settingsStore'

type SystemBarsApp = {
  setSystemBarsHidden?: (hidden: boolean, cb: (err: string | null) => void) => void
}

/** 下发系统栏显隐。非原生 / 方法缺失一律 warn（硬约束 #3 禁静默降级）。 */
function applySystemBars(hidden: boolean): void {
  const app = getNativeModules()?.PictelioApp as SystemBarsApp | undefined
  if (!isNativeMode()) {
    console.debug('[immersiveSystemBars] 系统栏联动跳过（非原生环境）')
    return
  }
  if (!app || typeof app.setSystemBarsHidden !== 'function') {
    console.warn('[immersiveSystemBars] 原生模块或方法缺失，系统栏联动未生效（版本漂移异常）')
    return
  }
  app.setSystemBarsHidden(hidden, (err) => {
    if (err) console.warn('[immersiveSystemBars] 系统栏切换失败', err)
  })
}

export interface UseImmersiveSystemBarsReturn {
  /** 宿主组件进入沉浸时调用：隐藏系统栏 */
  onImmersiveEnter: () => void
  /** 宿主组件退出沉浸时调用：回落到用户当前的全屏模式设定 */
  onImmersiveExit: () => void
}

export function useImmersiveSystemBars(): UseImmersiveSystemBarsReturn {
  function onImmersiveEnter(): void {
    applySystemBars(true)
  }

  function onImmersiveExit(): void {
    // ⚠️ 回落而非硬编码：用户开着全屏模式时，退出沉浸后系统栏应**仍隐藏**
    applySystemBars(Boolean(useSettingsStore().fullscreenMode))
  }

  return { onImmersiveEnter, onImmersiveExit }
}
