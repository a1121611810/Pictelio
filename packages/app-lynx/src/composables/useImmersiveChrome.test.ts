// ─── useImmersiveChrome 状态机单测（#887 / ADR-0213 决策 1、3、9）───
//
// 只测**外部行为**（用户可观测的结果）：当前是否处于沉浸态、a11y 标签读到什么、
// 浮层是否被打开。不断言内部实现（不数函数被调了几次、不碰模块级 token 本身）。
//
// 期望值出处（Oracle 溯源，禁止从被测实现反推）：
// - 「单击切换、再次点 = 退出」= ADR-0213 决策 3「必须保留的非可见路径」第 2 条
//   + spec user story 1/2；
// - 「浮层打开 ⇒ 强制退出沉浸」= ADR-0213 决策 3「浮层优先级」（理由：沉浸态下打开
//   会得到一个「没有关闭按钮的模态」）+ user story 24；
// - 「新 owner 接管前先强制旧 owner 幂等复位」= ADR-0213 决策 1「单一所有权」
//   （明确点名要解决「A 页进沉浸 → push B 页 → B 页 pop → A 页标志仍为 true」）；
// - 两态 a11y 标签 + 多图带「第 n / N 张」= ADR-0213 决策 9「无障碍」
//   + P5 行（角标隐藏后位置信息不能从视觉与朗读双通道一起丢）；
// - 双语文案 = ADR-0213 R6「实施时须给这两段文案提供双语来源，不得只加中文」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../i18n'
import { useImmersiveChrome, chromeSuppressed } from './useImmersiveChrome'

afterEach(() => {
  setLocale('zh-CN')
})

describe('单击切换（ADR-0213 决策 1/3：仅手动切换，再点 = 退出）', () => {
  it('初始不沉浸；单击进入、再次单击退出', () => {
    const { chromeHidden, toggleChrome } = useImmersiveChrome()
    expect(chromeHidden.value).toBe(false)

    toggleChrome()
    expect(chromeHidden.value).toBe(true)

    toggleChrome()
    expect(chromeHidden.value).toBe(false)
  })

  it('切换不引入定时器：无自动隐藏超时，状态只在用户点击时变化', () => {
    vi.useFakeTimers()
    try {
      const { chromeHidden, toggleChrome } = useImmersiveChrome()
      toggleChrome()
      expect(chromeHidden.value).toBe(true)
      // 决策 1 明确否决自动隐藏：推进任意时长都不得自行改变状态（否则用户面对
      // 一个没有任何入口的界面）。这条同时钉住「不得引入 setTimeout/setInterval」。
      vi.advanceTimersByTime(60_000)
      expect(chromeHidden.value).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('浮层打开强制退出沉浸（决策 3）', () => {
  it('沉浸态下打开浮层：先复位再打开（浮层打开的瞬间已不沉浸）', () => {
    const { chromeHidden, toggleChrome, openOverlay } = useImmersiveChrome()
    toggleChrome()
    expect(chromeHidden.value).toBe(true)

    const hiddenWhenOpened: boolean[] = []
    let opened = false
    openOverlay(() => {
      hiddenWhenOpened.push(chromeHidden.value)
      opened = true
    })

    expect(opened).toBe(true)
    // 顺序也是行为的一部分：若先打开后复位，模态会先以「无 chrome」态渲染一帧
    expect(hiddenWhenOpened).toEqual([false])
    expect(chromeHidden.value).toBe(false)
  })

  it('非沉浸态下打开浮层不改变沉浸态（浮层开关与沉浸互不污染）', () => {
    const { chromeHidden, openOverlay } = useImmersiveChrome()
    let opened = false
    openOverlay(() => {
      opened = true
    })
    expect(opened).toBe(true)
    expect(chromeHidden.value).toBe(false)
  })

  it('三个浮层入口走同一形态：关闭浮层后可再次进入沉浸（user story 25）', () => {
    // 浮层是「退出沉浸」的同一动作，不留下「永久退出」副作用
    const { chromeHidden, toggleChrome, openOverlay } = useImmersiveChrome()
    toggleChrome()
    openOverlay(() => undefined)

    toggleChrome()
    expect(chromeHidden.value).toBe(true)
  })
})

describe('单一所有权（决策 1：模块级 token，新 owner 接管前强制旧 owner 幂等复位）', () => {
  it('新 owner 申请时旧 owner 被强制复位（修「A 进沉浸 → B 接管 → A 标志仍为 true」）', () => {
    const a = useImmersiveChrome()
    a.toggleChrome()
    expect(a.chromeHidden.value).toBe(true)

    const b = useImmersiveChrome()
    b.toggleChrome()

    expect(a.chromeHidden.value).toBe(false)
    expect(b.chromeHidden.value).toBe(true)
  })

  it('重复进入不叠加：同一 owner 再次进入不被自己复位', () => {
    const a = useImmersiveChrome()
    a.toggleChrome()
    a.toggleChrome()
    a.toggleChrome()
    expect(a.chromeHidden.value).toBe(true)
  })

  it('旧 owner 的迟到复位不影响新 owner（所有权按身份交接，非按布尔量清空）', () => {
    const a = useImmersiveChrome()
    a.toggleChrome()
    const b = useImmersiveChrome()
    b.toggleChrome()

    // A 在被接管后才卸载，其复位不得把 B 拽出沉浸
    a.exit()
    expect(b.chromeHidden.value).toBe(true)
  })

  it('exit 幂等：重复复位不抛错、状态稳定', () => {
    const { chromeHidden, toggleChrome, exit } = useImmersiveChrome()
    toggleChrome()
    exit()
    exit()
    expect(chromeHidden.value).toBe(false)
  })
})

describe('图片容器 a11y 标签（决策 9：两态动态标签，多图带「第 n / N 张」）', () => {
  it('两态给出不同的进入 / 退出文案（屏幕阅读器据此知道这是开关）', () => {
    const { chromeHidden, toggleChrome, immersiveA11yLabel } = useImmersiveChrome()
    // 措辞 oracle = ADR-0213 决策 9 点名的两段文案，不从实现反推
    expect(immersiveA11yLabel()).toBe('进入沉浸模式')
    toggleChrome()
    expect(immersiveA11yLabel()).toBe('退出沉浸模式')
  })

  it('多图分支标签带「第 n / N 张」（角标隐藏后位置信息仍可朗读）', () => {
    const { toggleChrome, immersiveA11yLabel } = useImmersiveChrome()
    expect(immersiveA11yLabel({ n: 2, total: 5 })).toBe('第 2 / 5 张，进入沉浸模式')
    toggleChrome()
    expect(immersiveA11yLabel({ n: 2, total: 5 })).toBe('第 2 / 5 张，退出沉浸模式')
  })

  it('两语种都有来源（不得只加中文，ADR-0213 R6）', () => {
    const { toggleChrome, immersiveA11yLabel } = useImmersiveChrome()

    setLocale('en')
    expect(immersiveA11yLabel()).toBe('Enter immersive mode')
    expect(immersiveA11yLabel({ n: 3, total: 7 })).toBe('Image 3 of 7, enter immersive mode')
    toggleChrome()
    expect(immersiveA11yLabel({ n: 3, total: 7 })).toBe('Image 3 of 7, exit immersive mode')

    setLocale('zh-CN')
    expect(immersiveA11yLabel({ n: 3, total: 7 })).toBe('第 3 / 7 张，退出沉浸模式')
  })

  it('切换语言后标签即时跟随（不残留上一语种文案）', () => {
    const { immersiveA11yLabel } = useImmersiveChrome()
    setLocale('en')
    expect(immersiveA11yLabel({ n: 1, total: 4 })).toContain('Image 1 of 4')
    setLocale('zh-CN')
    expect(immersiveA11yLabel({ n: 1, total: 4 })).toContain('第 1 / 4 张')
  })
})


// ─── 全局 chrome 抑制标志（#887 真机验证发现的缺口）───
//
// 缺口来源：真机（emulator-5554）进入沉浸态后，**全局搜索 FAB 仍悬浮在图上**。
// 根因：`chromeHidden` 是页面本地 ref（决策 1 的形态），挂在 App.vue KeepAlive 之外的
// 全局 chrome 组件（GlobalFab）拿不到它 ⇒ 违反决策 3「隐藏态不留任何可见 chrome」。
//
// 期望值出处（Oracle 溯源，禁从被测实现反推）：
// - 「沉浸态 ⇒ 全局 chrome 一并隐藏」= ADR-0213 决策 3「隐藏态不留任何可见 chrome」；
// - 「新 owner 接管 ⇒ 旧 owner 复位 ⇒ 全局标志随之复位」= 决策 1 单一所有权的直接推论
//   （所有权已交出而标志仍为 true，正是决策 1 要解决的那一类泄漏）。
describe('全局 chrome 抑制标志（chromeSuppressed）', () => {
  // 模块级所有权是**跨用例的全局状态**：前面的用例调用 enter() 后若不归位，
  // 会让本组用例的起始前置条件不成立（这正是本组第一版红测的真实失败原因，
  // 而非断言写错）。归位手法借用「接管」语义：新实例 toggleChrome() 会先强制
  // 旧 owner 复位再取得所有权，随后本实例 exit() 即把全局状态清干净。
  beforeEach(() => {
    const tmp = useImmersiveChrome()
    tmp.toggleChrome()
    tmp.exit()
  })

  it('默认不抑制；进入沉浸后抑制；退出后恢复', () => {
    const { toggleChrome } = useImmersiveChrome()
    expect(chromeSuppressed.value).toBe(false)
    toggleChrome()
    expect(chromeSuppressed.value).toBe(true)
    toggleChrome()
    expect(chromeSuppressed.value).toBe(false)
  })

  it('新 owner 接管时旧 owner 被强制复位，全局标志不得滞留为 true', () => {
    const a = useImmersiveChrome()
    a.toggleChrome()
    expect(chromeSuppressed.value).toBe(true)
    const b = useImmersiveChrome()
    b.toggleChrome()
    expect(a.chromeHidden.value).toBe(false)
    expect(b.chromeHidden.value).toBe(true)
    b.exit()
    expect(chromeSuppressed.value).toBe(false)
  })

  it('浮层打开时强制退出沉浸，全局抑制标志同步解除', () => {
    const { toggleChrome, openOverlay } = useImmersiveChrome()
    toggleChrome()
    expect(chromeSuppressed.value).toBe(true)
    openOverlay(() => {})
    expect(chromeSuppressed.value).toBe(false)
  })
})
