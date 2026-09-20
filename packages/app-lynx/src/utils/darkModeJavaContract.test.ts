// ─── 暗色外观 JS↔Java 契约测试（spec docs/specs/lynx-night-mode.md T1 §4.3）───
// 模式 = safeAreaJavaContract.test.ts（Java 源码字面量提取，任一侧漂移即红灯）。
// oracle = spec §4.3 契约锚点：事件名 / 载荷格式 / 拉取方法名。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LYNX_ACTIVITY = readFileSync(
  new URL(
    '../../../app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java',
    import.meta.url,
  ),
  'utf8',
)
const APP_MODULE = readFileSync(
  new URL(
    '../../../app/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java',
    import.meta.url,
  ),
  'utf8',
)
const DARK_MODE = readFileSync(new URL('./darkMode.ts', import.meta.url), 'utf8')

describe('暗色外观 JS↔Java 契约锚点', () => {
  it('事件名 pictelioDarkMode：Java 发送 ⇄ JS 订阅', () => {
    expect(LYNX_ACTIVITY).toContain('EVENT_DARK_MODE = "pictelioDarkMode"')
    expect(LYNX_ACTIVITY).toContain('sendGlobalEvent(EVENT_DARK_MODE')
    expect(DARK_MODE).toContain("addListener('pictelioDarkMode'")
  })

  it('拉取方法 getDarkMode：Java 提供 ⇄ JS 调用', () => {
    expect(APP_MODULE).toContain('public void getDarkMode(Callback callback)')
    expect(DARK_MODE).toContain('getDarkMode')
  })

  it('载荷契约：Java JSON 字符串（{"mode":...}）⇄ JS 双路径解析', () => {
    // Java：JavaOnlyArray.of 包裹 JSON 字符串（载荷 = {"mode":"..."}）
    expect(LYNX_ACTIVITY).toContain('sendGlobalEvent(EVENT_DARK_MODE, JavaOnlyArray.of(')
    expect(LYNX_ACTIVITY).toContain('{"mode":"')
    // JS：parseNativePayload 同时容忍 JSON 与裸字符串
    expect(DARK_MODE).toContain('parseNativePayload')
    expect(DARK_MODE).toContain('JSON.parse(raw)')
  })

  it('三态 id 字面量（light/dark/system）与 Java currentDarkMode 纯函数契约一致', () => {
    // JS：值域 light/dark/system
    expect(DARK_MODE).toContain('DARK_MODE_OPTIONS')
    expect(DARK_MODE).toContain("'light'")
    expect(DARK_MODE).toContain("'dark'")
    expect(DARK_MODE).toContain("'system'")
    // Java：currentDarkMode 仅返回 "light" / "dark"（system 在 JS 侧由 settingsStore 三态派生）
    expect(LYNX_ACTIVITY).toMatch(/static String currentDarkMode\(int uiMode\)/)
    expect(LYNX_ACTIVITY).toContain('"dark"')
    expect(LYNX_ACTIVITY).toContain('"light"')
  })

  it('配置变化回调 onConfigurationChanged 钉字面量：与 manifest configChanges 一致', () => {
    // manifest configChanges 已包含 uiMode（spec 决策 3）
    // Java 端通过 override onConfigurationChanged 接收 uiMode 翻转
    expect(LYNX_ACTIVITY).toContain('public void onConfigurationChanged(Configuration newConfig)')
    expect(LYNX_ACTIVITY).toContain('Configuration.UI_MODE_NIGHT_MASK')
  })

  it('onResume 兜底补发：spec 决策 3 后台翻转兜底契约', () => {
    // onResume 内必须比对 sLastUiMode 与当前 uiMode，变化则补发事件
    expect(LYNX_ACTIVITY).toMatch(/protected void onResume\(\)/)
    expect(LYNX_ACTIVITY).toContain('onResume 兜底补发')
    expect(LYNX_ACTIVITY).toContain('sendDarkModeEvent()')
  })
})
