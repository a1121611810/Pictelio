// ─── 沉浸态系统栏联动（#889 / ADR-0213 决策 4、5、6）───
//
// 只测**外部行为**（可观察的原生调用序列与持久键写入情况）：
// 何时隐藏、何时恢复、恢复成什么值、是否写了持久键。不测内部实现。
//
// 期望值出处（Oracle 溯源，禁从被测实现反推）：
// - 「进入沉浸 ⇒ 隐藏系统栏」= ADR-0213 决策 4；
// - 「退出 ⇒ 回落到用户当前的全屏模式设定，而非硬编码 false」= ADR-0213 决策 4
//   （硬编码会在用户开着全屏模式时静默改掉其持久设定）；
// - 「沉浸路径严禁写持久键」= ADR-0213 决策 6 的硬规则
//   （写了 = 每次冷启动直接进沉浸）；
// - 「四层复位：单一所有权 / 卸载 / 返回守卫 / 进程外兜底」= ADR-0213 决策 5；
// - 「第四层刻意留空（无进程外兜底）」= 同上；已真机实测 P3 探针**阳性**
//   （进程被杀后重启，原生由持久化键在 onCreate 尾部重设，系统栏正确恢复）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setSystemBarsHidden = vi.fn()
const prefsSet = vi.fn().mockResolvedValue(undefined)
const setFullscreenMode = vi.fn()

// 用可变间接层，让「用户开着全屏模式」「原生方法缺失」这两个关键分支可被测试驱动
let settingsFullscreen = false
let currentApp: unknown = { setSystemBarsHidden }

vi.mock('../api/client', () => ({
  isNativeMode: () => true,
  getNativeModules: () => ({ PictelioApp: currentApp }),
}))
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({
    setFullscreenMode,
    get fullscreenMode() {
      return settingsFullscreen
    },
  }),
}))

import { useImmersiveSystemBars } from './useImmersiveSystemBars'

/** 取某次原生调用的 [hidden, 回调] */
function calls(): boolean[] {
  return setSystemBarsHidden.mock.calls.map((c) => c[0] as boolean)
}

describe('沉浸态 · 系统栏联动（#889）', () => {
  beforeEach(() => {
    setSystemBarsHidden.mockClear()
    prefsSet.mockClear()
    setFullscreenMode.mockClear()
  })

  it('进入沉浸 ⇒ 原生隐藏系统栏', () => {
    const { onImmersiveEnter } = useImmersiveSystemBars()
    onImmersiveEnter()
    expect(calls()).toEqual([true])
  })

  it('退出沉浸 ⇒ 原生恢复（用户全屏模式关着时回落为 false）', () => {
    const { onImmersiveEnter, onImmersiveExit } = useImmersiveSystemBars()
    onImmersiveEnter()
    onImmersiveExit()
    expect(calls()).toEqual([true, false])
  })

  it('⚠️ 用户开着全屏模式时退出沉浸 ⇒ 系统栏应**仍隐藏**（不得硬编码 false）', () => {
    // 这是决策 4 的关键判别点：硬编码 false 会静默改掉用户的全局偏好。
    // 该用例的判别力靠「mock 的 fullscreenMode 改成 true」建立 —— 见下方 describe。
    settingsFullscreen = true
    const { onImmersiveEnter, onImmersiveExit } = useImmersiveSystemBars()
    onImmersiveEnter()
    onImmersiveExit()
    expect(calls()).toEqual([true, true])
    settingsFullscreen = false
  })

  it('沉浸路径严禁写持久键（写了 = 下次冷启动直接进沉浸且无从退出）', () => {
    const { onImmersiveEnter, onImmersiveExit } = useImmersiveSystemBars()
    onImmersiveEnter()
    onImmersiveExit()
    // 决策 6 的硬规则：沉浸只能调原生，不能碰 prefs
    expect(setFullscreenMode).not.toHaveBeenCalled()
    expect(prefsSet).not.toHaveBeenCalled()
  })

  it('原生方法缺失 ⇒ 必须 warn，不得静默（硬约束 #3）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prev = currentApp
    currentApp = undefined
    const { onImmersiveEnter } = useImmersiveSystemBars()
    onImmersiveEnter()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    currentApp = prev
  })
})
