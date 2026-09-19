// ─── 系统栏 JS↔Java 契约测试（spec docs/specs/lynx-systembars.md §4.3）───
// 模式 = backupRulesConsistency.test.ts（Java 源码字面量提取，任一侧漂移即红灯）。
// oracle = spec §4.3 契约锚点：事件名 / 载荷顺序 / 拉取方法 / 设置键。
// Java 侧由 LynxSystemBarsTest.contractConstants_matchSpecAnchors 钉同一组字面量。
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
const SAFE_AREA = readFileSync(new URL('./safeArea.ts', import.meta.url), 'utf8')
const APP_VUE = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

describe('系统栏 JS↔Java 契约锚点', () => {
  it('事件名 pictelioInsets：Java 发送 ⇄ JS 订阅', () => {
    expect(LYNX_ACTIVITY).toContain('EVENT_INSETS = "pictelioInsets"')
    expect(LYNX_ACTIVITY).toContain('sendGlobalEvent(EVENT_INSETS')
    expect(SAFE_AREA).toContain("addListener('pictelioInsets'")
  })

  it('拉取方法 getSafeAreaInsets：Java 提供 ⇄ JS 调用', () => {
    expect(APP_MODULE).toContain('public void getSafeAreaInsets(Callback callback)')
    expect(SAFE_AREA).toContain('getSafeAreaInsets')
  })

  it('全屏键 settings_fullscreen_mode：Java 读取（T3 的 settingsStore 写同键）', () => {
    expect(LYNX_ACTIVITY).toContain('KEY_FULLSCREEN_MODE = "settings_fullscreen_mode"')
    expect(LYNX_ACTIVITY).toContain('SYSTEMBARS_PREFS = "CapacitorStorage"')
  })

  it('载荷契约：Java 数值双参 ⇄ JS 双参数消费', () => {
    // Java：JavaOnlyArray.of(top, bottom) 顺序
    expect(LYNX_ACTIVITY).toMatch(/sendGlobalEvent\(EVENT_INSETS,\s*JavaOnlyArray\.of\(sInsetTop,\s*sInsetBottom\)\)/)
    // JS：args[0]/args[1] 双参消费
    expect(SAFE_AREA).toContain('Number(args[0])')
    expect(SAFE_AREA).toContain('Number(args[1])')
  })

  it('Root 安全区消费：App.vue 根容器 padding 绑定 safeTop/safeBottom', () => {
    expect(APP_VUE).toContain('paddingTop: safeTop')
    expect(APP_VUE).toContain('paddingBottom: safeBottom')
    expect(APP_VUE).toContain('initSafeArea()')
  })

  it('底部弹层家族安全区 spacer（spec §4.2 清单）：每个底部面板必须消费 safeBottom', () => {
    const SHEETS = [
      'SearchSheet',
      'CommentOverlay',
      'NovelExportSheet',
      'NovelCaptionSheet',
      'PagePickerSheet',
      'BookmarkPanel', // top-[20vh]+h-[80vh] 与 bottom-0 贴底等价（ADR-0123 正向锚点），同族消费方
    ] as const
    for (const name of SHEETS) {
      const src = readFileSync(new URL(`../components/${name}.vue`, import.meta.url), 'utf8')
      expect(src, `${name}.vue 缺 safeBottom 导入`).toContain("from '../utils/safeArea'")
      expect(src, `${name}.vue 缺安全区 spacer`).toContain("{ height: safeBottom + 'px' }")
    }
  })

  it('WatchlistPromptDialog 不消费 safeBottom（居中 Dialog 不触底，spec 清单的显式偏离）', () => {
    const src = readFileSync(
      new URL('../components/WatchlistPromptDialog.vue', import.meta.url),
      'utf8',
    )
    expect(src).not.toContain('safeBottom')
  })
})
