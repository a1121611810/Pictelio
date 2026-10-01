// ─── 沉浸看图状态机（issue #887 / ADR-0213 决策 1、3、9）───
//
// 「单击插画 = 进入 / 退出沉浸」的唯一状态持有者。**本票只做应用内 chrome 显隐**，
// 不碰原生系统栏（决策 4/5/6 属后续票）。
//
// ── 状态形态（决策 1）───
// `chromeHidden` 是**页面本地 ref**，不进 Pinia：它是「当前查看状态」而非跨页共享数据
// （对应仓库「数据层分流」硬约束）。**禁在多处各写一份布尔量**。
//
// ── 单一所有权 token（决策 1 / 复核判据 6 的 L1）───
// 模块级 `activeOwner` 是所有权的**唯一事实源**，存「当前 owner 的复位动作」：
// 新 owner 申请时若已有 owner，**先强制旧 owner 幂等复位再接管**。
// 这解决「A 页进沉浸 → push B 页 → B 页 pop → A 页已卸载但标志仍为 true」这一类泄漏。
// ⚠️ **L2 已在本文件前移接线**（见下方 `onUnmounted`）：宿主组件卸载即释放所有权。
// 剩余的 L3（返回守卫内复位）属**后续票 #889**，调用点同为 `exit()`。
// ⚠️ **KeepAlive 语义（本文件最容易失效的前提）**：`onUnmounted` 只在**真正卸载**时触发。
// 若日后把宿主页加入 `<KeepAlive :include>`，卸载变成「停用」，本钩子**不再触发**，
// 泄漏会从「当前页显示错」升级为「全站 chrome 永久消失」。届时必须补 `onDeactivated`，
// 或改用「本文件从未进入 KeepAlive」作为显式契约写进 ADR。当前唯一宿主 `IllustDetail`
// **不在** App.vue 的 KeepAlive 白名单内（实测 2026-10-01），故本前提成立。
//
// ── 无定时器（决策 1）───
// 触发**仅**手动单击切换，没有自动隐藏超时 ⇒ 不存在「定时器未清除」这一类泄漏。
//
// ── 浮层优先级（决策 3）───
// 评论 / 选页 / 收藏面板都是**需要 chrome 的模态**，沉浸态下打开会得到「一个没有关闭
// 按钮的模态」⇒ `openOverlay` 统一走一次「先退出沉浸 + 再打开」的复合动作。
// 刻意**不在浮层组件里反向感知沉浸**（避免反向依赖）。
//
// ── 减弱动效（决策 9）───
// 本状态机的切换是 `v-if` 条件渲染 ⇒ **结构上不存在任何过渡类**，这比「按偏好条件挂载
// transition-*」是更强的 R1 形态（偏好开启时要求的就是「瞬切」）。
// 因此此处**不消费** useReducedMotion：没有需要条件挂载的动效类，读它只会造出
// 「恒返回空串」的假接口。若将来要给沉浸切换加过渡动画，**必须**改为类级条件挂载并
// **只读** `useReducedMotion`（全仓唯一偏好事实源，**禁自建 matchMedia**）。
//
// ── 无障碍（决策 9）───
// 图片容器按 `chromeHidden` 挂**动态** `accessibility-label`（进入 / 退出沉浸模式），
// 否则屏幕阅读器用户「点得到图，但没人告诉他这是开关」= 无法退出沉浸。
// 多图分支的标签另带「第 n / N 张」：沉浸态角标已隐藏，位置信息不能从视觉与朗读
// 双通道一起丢。
// 文案走 i18n 字典（`illustDetail.a11y.immersive*`）：**双语来源的唯一事实源**，
// 两语种由 `satisfies Record<ZhPagesKey, string>` 编译期配平（缺一即 tsc 报错），
// 切换语言即时跟随（`t()` 内读 locale ref，模板中调用即建立响应依赖）。
// ⚠️ 本仓 src 内禁硬编码中文（tests/hardcode-gate.test.ts），故文案不能写在本文件里。
// ⚠️ **不确定性（P5，真机未取证）**：引擎上 `accessibility-label` 的**动态插值**是否生效
// 尚无实证（本仓既有插值绑定全部指向注册表常量，**没有一处**随响应式状态切换）。
// 阴性时本路径**不可达**（屏幕阅读器用户无退出路径，等级为可达性阻塞），届时须改走
// ADR-0213 P5 行指定的回退动作：常驻一个**常量 label** 的最小退出控件。
// 此刻**不预建**该控件——决策 3 要求隐藏态不留任何可见 chrome，探针未出结论前先加
// 等于凭空改产品形态。代码按决策 9 的要求落地 + 此处留痕不确定性。
import { computed, onUnmounted, ref, shallowRef, type Ref } from 'vue'
import { t } from '../i18n'

/** 多图位置信息（角标隐藏后由 a11y 标签补回「第 n / N 张」） */
export interface ImmersivePageInfo {
  /** 1 起（与角标 `{{ i + 1 }} / {{ length }}` 同一口径） */
  n: number
  total: number
}

/** 所有权 token 存的是「当前 owner 的复位动作」（函数引用 = 身份，天然幂等） */
type ImmersiveRelease = () => void

/** 当前 owner 的复位动作；`null` = 无沉浸 owner。**响应式**，是全局抑制标志的唯一事实源 */
const activeOwnerRef = shallowRef<ImmersiveRelease | null>(null)

/**
 * 全局 chrome 抑制标志（#887 真机验证发现的缺口，ADR-0213 决策 3「隐藏态不留任何可见 chrome」）。
 *
 * ⚠️ **刻意做成「从所有权派生」而非另维护一份布尔量**：若另写一个 `isImmersive` 并在
 * `enter`/`exit` 里同步维护，就多出**第二个必须与所有权同步的状态** —— 一旦某条路径
 * 改了所有权忘了改标志，就复现决策 1 要根治的那一类泄漏。派生式让它**结构上不可能脱同步**。
 *
 * 消费方：挂在 `App.vue` KeepAlive 之外的全局 chrome 组件（`GlobalFab`）——它们拿不到
 * 页面本地的 `chromeHidden`，只能读这个模块级导出。
 */
export const chromeSuppressed = computed(() => activeOwnerRef.value !== null)

export interface UseImmersiveChromeReturn {
  /** 沉浸态（应用内 chrome 隐藏中）。页面本地 ref，模板中直接用（顶层 ref 自动解包） */
  chromeHidden: Ref<boolean>
  /** 单击切换（决策 1：仅手动触发，无自动隐藏超时） */
  toggleChrome: () => void
  /** 退出沉浸并让出所有权。幂等；后续票的 L2/L3 复位接线亦走此函数 */
  exit: () => void
  /** 浮层入口统一形态：先退出沉浸，再打开（决策 3；不反向依赖浮层组件） */
  openOverlay: (open: () => void) => void
  /** 图片容器的动态 a11y 标签；`page` 仅多图分支传（带「第 n / N 张」） */
  immersiveA11yLabel: (page?: ImmersivePageInfo) => string
}

export function useImmersiveChrome(): UseImmersiveChromeReturn {
  const chromeHidden = ref(false)

  /** 幂等复位：重复调用只把状态压回「不沉浸」，所有权按身份清（防旧 owner 误清新 owner） */
  function exit(): void {
    chromeHidden.value = false
    if (activeOwnerRef.value === exit) activeOwnerRef.value = null
  }

  function enter(): void {
    // 重复进入不叠加（同一 owner 再次申请不自我复位）
    const current = activeOwnerRef.value
    if (current !== null && current !== exit) current()
    activeOwnerRef.value = exit
    chromeHidden.value = true
  }

  function toggleChrome(): void {
    if (chromeHidden.value) exit()
    else enter()
  }

  function openOverlay(open: () => void): void {
    exit()
    open()
  }

  // ── 所有权随宿主组件卸载自动释放（#887 真机验证后补）──
  //
  // 为什么必须有：`chromeSuppressed` 是**模块级**的，一旦残留为 true，影响面是
  // **之后每一个页面**（全局 chrome 全部隐藏），不再是「当前页显示错」而是全站级故障。
  // 决策 1 的所有权 token 原本只解决「A → push B → pop 回 A」的**页间**泄漏，
  // **没有**覆盖「owner 组件被销毁」这一条 —— 那正是 ADR-0213 决策 5 的 L2。
  // 这里把 L2 前移接线：宿主组件卸载即释放，不再依赖调用方记得手动 `exit()`。
  //
  // ⚠️ 只在**组件 setup 内**调用时生效（本 composable 的生产用法即是组件内）。
  // 单测在组件外调用时该钩子不触发，故单测需自行归位（见测试文件的 beforeEach）。
  onUnmounted(() => {
    exit()
  })

  function immersiveA11yLabel(page?: ImmersivePageInfo): string {
    if (page) {
      const vars = { n: page.n, total: page.total }
      return t(
        chromeHidden.value ? 'illustDetail.a11y.immersiveExitPage' : 'illustDetail.a11y.immersiveEnterPage',
        vars,
      )
    }
    return t(
      chromeHidden.value ? 'illustDetail.a11y.immersiveExit' : 'illustDetail.a11y.immersiveEnter',
    )
  }

  return { chromeHidden, toggleChrome, exit, openOverlay, immersiveA11yLabel }
}
