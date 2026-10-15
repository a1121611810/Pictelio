import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInputPlaceholderColor } from './useInputPlaceholderColor'
import { useSettingsStore } from '../stores/settingsStore'
import { THEME_COLOR_IDS, type ThemeColorId } from '../utils/themeColor'
import { currentDarkMode, DEFAULT_DARK_MODE } from '../utils/darkMode'
import {
  INPUT_PLACEHOLDER_DARK_COLOR,
  INPUT_PLACEHOLDER_LIGHT_COLOR,
} from '../utils/lynxPlatformColors'

describe('useInputPlaceholderColor（#693 暗色主题化 · #1015 亮色令牌保真）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // `currentDarkMode` 是模块级 ref（跨用例共享），显式复位避免用例间串味。
    currentDarkMode.value = 'light'
  })

  it('亮色：7 档主题逐一取亮色表值（#1015：亮色令牌保真，bili 为 clamp 值）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('light')
    const { placeholderColor } = useInputPlaceholderColor()

    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      expect(placeholderColor.value, `主题 ${themeId} 亮色下应取亮色表该档值`).toBe(
        INPUT_PLACEHOLDER_LIGHT_COLOR[themeId],
      )
    }
    // 变异守卫：若亮色分支退回单值（7 档同值），上面的逐档断言必红
    // （亮色表 7 档互异由 lynxPlatformColors.test.ts 锁定）。
  })

  it('暗色：7 档主题逐一取到自己的暗色值（14 组取值矩阵的一半）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('dark')
    const { placeholderColor } = useInputPlaceholderColor()

    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_DARK_COLOR[themeId])
    }
  })

  it('暗色值不得等于亮色表同档值（若相等，则该主题的暗色项无效）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('dark')
    const { placeholderColor } = useInputPlaceholderColor()

    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      expect(placeholderColor.value).not.toBe(INPUT_PLACEHOLDER_LIGHT_COLOR[themeId])
    }
  })

  it('手动切主题 / 切明暗后 computed 当拍重算（无需 remount）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('light')
    settings.setThemeColor('sky')
    const { placeholderColor } = useInputPlaceholderColor()
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_LIGHT_COLOR.sky)

    // 手动切暗色
    settings.setDarkMode('dark')
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_DARK_COLOR.sky)

    // 手动切主题
    settings.setThemeColor('bili')
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_DARK_COLOR.bili)

    // 切回亮色（bili 亮色 = clamp 值 #5a5f66）
    settings.setDarkMode('light')
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_LIGHT_COLOR.bili)
  })

  it('主题色逐一切换时暗色取值各不相同（防止表被填成同一个值而测试仍绿）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('dark')
    const { placeholderColor } = useInputPlaceholderColor()

    const seen: string[] = []
    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      seen.push(placeholderColor.value)
    }
    expect(new Set(seen).size).toBe(THEME_COLOR_IDS.length)
  })

  it('主题色逐一切换时亮色取值各不相同（#1015：亮色表 7 档互异的 composable 级镜像守卫）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('light')
    const { placeholderColor } = useInputPlaceholderColor()

    const seen: string[] = []
    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      seen.push(placeholderColor.value)
    }
    expect(new Set(seen).size).toBe(THEME_COLOR_IDS.length)
  })

  it('返回的是 computed（ref），不是快照值——消费方模板绑的是响应式引用', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('dark')
    const { placeholderColor } = useInputPlaceholderColor()
    // 若实现退化成普通字符串，这里取值后改 store 不会同步
    const before = placeholderColor.value
    settings.setThemeColor('orange' satisfies ThemeColorId)
    expect(placeholderColor.value).not.toBe(before)
  })
})

/**
 * `system` 三态的归一语义（issue #693 review blocking）。
 *
 * ## 为什么必须单独一组用例
 *
 * `resolvedDark` 与 `darkMode` 的差别**只在 `system` 分支**显现：
 * - `resolvedDark`：`system` 时读 `currentDarkMode`（哑桥 ref）⇒ 跟随系统
 * - `darkMode`：是三态键本身，`system` 既非 `'light'` 也非 `'dark'` ⇒ 只能落到亮色分支
 *
 * 而 **`system` 是缺省模式**（`DEFAULT_DARK_MODE`）。所以一旦实现退化成读 `darkMode`：
 * - 所有「手动切 light/dark」的用例**照样全绿**；
 * - 只有「用户跟随系统」这一条——也就是缺省路径——会静默退回亮色基线值，
 *   在暗色 system 上对比度回到 **1.31:1**，等于整个修复从未发生。
 *
 * 该用例就是用来把这个退化打红的：它把 `currentDarkMode` 设成 `dark` 而保持三态键为 `system`。
 */
describe('useInputPlaceholderColor · system 三态归一（#693 blocking 防线）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    currentDarkMode.value = 'light'
  })

  it('缺省三态就是 system —— 这是下面那组用例的赌注所在', () => {
    expect(DEFAULT_DARK_MODE).toBe('system')
  })

  it('三态键为 system、系统为暗色时，取暗色值（读 darkMode 的实现会在这里变红）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('system')
    currentDarkMode.value = 'dark'
    settings.setThemeColor('sky')

    const { placeholderColor } = useInputPlaceholderColor()
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_DARK_COLOR.sky)
  })

  it('三态键为 system、系统为亮色时，取亮色表该档值（#1015 后亮色也按主题查表）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('system')
    currentDarkMode.value = 'light'
    settings.setThemeColor('sky')

    const { placeholderColor } = useInputPlaceholderColor()
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_LIGHT_COLOR.sky)
  })

  it('手动切到 dark 后，系统态再变不影响取值（手动分支不读 currentDarkMode）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('dark')
    const { placeholderColor } = useInputPlaceholderColor()
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_DARK_COLOR.sky)

    currentDarkMode.value = 'light'
    expect(placeholderColor.value, '手动 dark 不该被系统态翻回亮色').toBe(
      INPUT_PLACEHOLDER_DARK_COLOR.sky,
    )
  })

  it('手动切到 light 后，系统态变暗也不影响取值（缺省走 system 才是本次修复的主路径）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode('light')
    const { placeholderColor } = useInputPlaceholderColor()
    expect(placeholderColor.value).toBe(INPUT_PLACEHOLDER_LIGHT_COLOR.sky)

    currentDarkMode.value = 'dark'
    expect(placeholderColor.value, '手动 light 不该被系统态翻成暗色').toBe(
      INPUT_PLACEHOLDER_LIGHT_COLOR.sky,
    )
  })

  it('7 档主题在缺省 system 路径下都取到暗色值（缺省路径不能只验一档）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode(DEFAULT_DARK_MODE)
    currentDarkMode.value = 'dark'
    const { placeholderColor } = useInputPlaceholderColor()

    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      expect(placeholderColor.value, `缺省 system 路径下主题 ${themeId} 取值错`).toBe(
        INPUT_PLACEHOLDER_DARK_COLOR[themeId],
      )
    }
  })

  it('7 档主题在缺省 system + 亮色系统路径下都取到亮色表值（#1015）', () => {
    const settings = useSettingsStore()
    settings.setDarkMode(DEFAULT_DARK_MODE)
    currentDarkMode.value = 'light'
    const { placeholderColor } = useInputPlaceholderColor()

    for (const themeId of THEME_COLOR_IDS) {
      settings.setThemeColor(themeId)
      expect(placeholderColor.value, `缺省 system 路径下主题 ${themeId} 亮色取值错`).toBe(
        INPUT_PLACEHOLDER_LIGHT_COLOR[themeId],
      )
    }
  })
})
