// ─── 暗色外观 JS↔Java 契约测试（spec docs/specs/lynx-night-mode.md T1 §4.3 + follow-up #692）───
// 模式 = safeAreaJavaContract.test.ts（Java 源码字面量提取，任一侧漂移即红灯）。
// oracle = spec §4.3 契约锚点：事件名 / 载荷格式 / 拉取方法名；
//          #692 追加：三态设置键原生读点 / system 复位哨兵 / 状态栏闩锁接线 / 下发方法名 /
//          splash 主题名资源稳定性 / 跨语言色值（tokens.css ⇄ values-night 资源）。
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
const SETTINGS_STORE = readFileSync(new URL('../stores/settingsStore.ts', import.meta.url), 'utf8')
const TOKENS_CSS = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const VALUES_STYLES = readFileSync(
  new URL('../../../app/android/app/src/main/res/values/styles.xml', import.meta.url),
  'utf8',
)
const VALUES_NIGHT_STYLES = readFileSync(
  new URL('../../../app/android/app/src/main/res/values-night/styles.xml', import.meta.url),
  'utf8',
)

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

// ═══════════════════════════════════════════════════════════════════════════════
// follow-up #692 原生接线机器防线（JS 写入 ⇄ Java 读点 / splash 资源 / 跨语言色值）
//
// 反向守卫（本组存在的理由）：#692 之前 settings_dark_mode 的**原生侧零读点**——
// JS 写键、Java 只读系统 uiMode，手动 light/dark 完全未接线，而测试全绿（JS 侧自洽）。
// 故本组逐条钉「跨语言读点 / 资源名 / 色值」的字面量，任一侧改名或删除即红灯。
// ═══════════════════════════════════════════════════════════════════════════════

describe('#692 三态设置键的原生读点（模板 B：JS 写入 ⇄ Java 读点）', () => {
  it('LynxActivity.java 含设置键字面量 settings_dark_mode（读点存在）', () => {
    expect(LYNX_ACTIVITY).toContain('settings_dark_mode')
    // 键常量声明（唯一所有者 = Java 侧；TS 侧镜像常量写入侧，见下方 settingsStore 断言）
    expect(LYNX_ACTIVITY).toContain('KEY_DARK_MODE = "settings_dark_mode"')
    // 读取经 SharedPreferences（与 PictelioPrefsModule 同一文件 "CapacitorStorage"）
    expect(LYNX_ACTIVITY).toContain('SYSTEMBARS_PREFS = "CapacitorStorage"')
    expect(LYNX_ACTIVITY).toContain('getSharedPreferences(SYSTEMBARS_PREFS')
  })

  it('LynxActivity.java 含 Resources.ID_NULL（system 复位哨兵，禁兜底到某支手动主题）', () => {
    expect(LYNX_ACTIVITY).toContain('Resources.ID_NULL')
    // system → 0 哨兵 → ID_NULL 复位（撤销手动选择的唯一通道）
    expect(LYNX_ACTIVITY).toMatch(/splashThemeId == 0 \? Resources\.ID_NULL/)
  })

  it('LynxActivity.java 含 syncStatusBarHidden（状态栏隐藏态单一写点，B4 闩锁修复接线）', () => {
    expect(LYNX_ACTIVITY).toContain('syncStatusBarHidden')
    expect(LYNX_ACTIVITY).toMatch(/syncStatusBarHidden\(boolean hidden\)/)
    // 运行时切换必须回写闩锁（旧缺陷：只在 onCreate 写过一次 → 单向闩锁）
    expect(LYNX_ACTIVITY).toContain('((LynxActivity) activity).syncStatusBarHidden(hidden)')
  })

  it('settingsStore.ts 含与 Java 键逐字一致的写入侧常量（键名两侧同源）', () => {
    expect(SETTINGS_STORE).toContain('const DARK_MODE_KEY = "settings_dark_mode"')
  })
})

describe('#692 原生下发方法 applyDarkModePreference（Java 提供 ⇄ JS 调用）', () => {
  it('PictelioAppModule.java 提供 applyDarkModePreference + 主线程转交 Activity', () => {
    expect(APP_MODULE).toContain('applyDarkModePreference')
    expect(APP_MODULE).toMatch(/public void applyDarkModePreference\(Callback callback\)/)
    expect(APP_MODULE).toContain('activity.runOnUiThread(activity::applyDarkModePreference)')
  })

  it('LynxActivity.java 含运行时重下发实现（状态栏外观 + splash 兜底轨同轨重设）', () => {
    expect(LYNX_ACTIVITY).toMatch(/void applyDarkModePreference\(\)/)
    expect(LYNX_ACTIVITY).toContain('applySplashScreenThemeFromPref()')
  })

  it('JS 调用方存在：settingsStore.setDarkMode 下发 applyDarkModePreference(cb)', () => {
    // 仅「类型别名里出现方法名」不算接线：必须存在带回调的实调用点
    expect(SETTINGS_STORE).toMatch(/applyDarkModePreference\(\(err\)/)
    // 分支口径 = setFullscreenMode：原生判定 + 缺方法 warn（禁静默）
    expect(SETTINGS_STORE).toContain('applyDarkModePreference 不可用')
  })
})

describe('#692 splash 双轨资源（主题名跨配置稳定 + plate 接线）', () => {
  const FILES = [
    { name: 'values/styles.xml', css: VALUES_STYLES },
    { name: 'values-night/styles.xml', css: VALUES_NIGHT_STYLES },
  ] as const

  /** 声明式主题条目（`<style name="..." parent="...">`）；注释内提及不计入 */
  function styleDecls(css: string): Array<{ name: string; parent: string }> {
    return [...css.matchAll(/<style\s+name="([^"]+)"\s+parent="([^"]+)"/g)].map((m) => ({
      name: m[1]!,
      parent: m[2]!,
    }))
  }

  it('两文件各自定义 Theme.SplashScreen.Light + Dark（名稳定性：跨配置均可解析）', () => {
    for (const { name, css } of FILES) {
      const splash = styleDecls(css).filter((d) => d.name.startsWith('Theme.SplashScreen.'))
      // 精确计数：恰好两支（漏一支 → 反配置下解析失败回落 manifest 主题 = 手动覆盖失效；
      // 多写一支 → 名空间漂移），抽取器失效（如改名/格式变化）亦在此翻红
      expect(splash.map((d) => d.name).sort(), `${name} splash 主题支数`).toEqual([
        'Theme.SplashScreen.Dark',
        'Theme.SplashScreen.Light',
      ])
    }
  })

  it('两文件同名主题集合一致（名不稳定 = 反配置下解析失败）', () => {
    const names = FILES.map(({ css }) =>
      styleDecls(css)
        .map((d) => d.name)
        .filter((n) => n.startsWith('Theme.SplashScreen.'))
        .sort(),
    )
    expect(names[0]).toEqual(names[1])
  })

  it('两文件 plate 接线：两支 splash 主题父主题 = Theme.SplashScreen.IconBackground', () => {
    for (const { name, css } of FILES) {
      const pairs = styleDecls(css)
        .filter((d) => d.name.startsWith('Theme.SplashScreen.'))
        .map((d) => `${d.name}=${d.parent}`)
        .sort()
      // API 31+ IconBackground 覆写才把 platform 属性指向本 app 的 windowSplashScreenIconBackgroundColor；
      // 缺这条父链 → 下面写的 plate 色对系统 splash 完全无效（登记未生效）
      expect(pairs, `${name} 两支 splash 主题的父主题`).toEqual([
        'Theme.SplashScreen.Dark=Theme.SplashScreen.IconBackground',
        'Theme.SplashScreen.Light=Theme.SplashScreen.IconBackground',
      ])
      expect(css, `${name} 缺少 plate 项`).toContain('windowSplashScreenIconBackgroundColor')
    }
  })
})

describe('#692 跨语言色值契约（tokens.css 暗色色板 ⇄ values-night 资源）', () => {
  /** `.theme-sky.dark` 块内 `token: #rrggbb;` 抽取（跨语言色值契约的唯一 oracle 通道）。 */
  function extractSkyDarkHex(): Map<string, string> {
    const selector = '.theme-sky.dark {'
    const start = TOKENS_CSS.indexOf(selector)
    expect(start, `tokens.css 缺少 ${selector}`).toBeGreaterThan(-1)
    const end = TOKENS_CSS.indexOf('\n}', start)
    expect(end, `${selector} 块未闭合（'\\n}' 边界失效）`).toBeGreaterThan(start)
    const block = TOKENS_CSS.slice(start, end)
    const map = new Map<string, string>()
    for (const m of block.matchAll(/(--md-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      map.set(m[1]!, m[2]!)
    }
    return map
  }

  const skyDarkHex = extractSkyDarkHex()
  /** 契约锚点清单：抽取器必须**恰好**解析出这 4 项（少一项 = 正则/块边界失效，下方断言会恒真） */
  const ANCHORS = [
    '--md-surface',
    '--md-surface-container',
    '--md-primary',
    '--md-state-pressed-primary',
  ] as const

  it('抽取器自检：.theme-sky.dark 块内锚点 token 全部可解析（非空 + 精确计数）', () => {
    const found = ANCHORS.filter((t) => skyDarkHex.has(t))
    expect(found.length, `抽取器漏解析：${ANCHORS.filter((t) => !skyDarkHex.has(t)).join(', ')}`).toBe(
      ANCHORS.length,
    )
    // 全块 hex 抽取规模下界（块内除 rgba/vw/px 令牌外均为 6 位 hex）
    expect(skyDarkHex.size).toBeGreaterThan(40)
  })

  it('values-night 暗面 = .theme-sky.dark 的 --md-surface（原生 splash 底与 JS 暗面色板同源）', () => {
    const surface = skyDarkHex.get('--md-surface')!
    // 冻结锚点：#101418 既是原生 values-night 的底，也是 JS 暗色 surface —— 任一侧漂移即红灯
    expect(surface.toLowerCase(), '.theme-sky.dark --md-surface 漂移（原生暗面冻结值 #101418）').toBe(
      '#101418',
    )
    expect(VALUES_NIGHT_STYLES, `values-night/styles.xml 缺少暗面 ${surface}`).toContain(surface)
  })

  it('暗 plate #1C2024 登记于两文件且 ≠ 暗面（离底有差 → 前景圆盘可见）', () => {
    const surface = skyDarkHex.get('--md-surface')!
    const container = skyDarkHex.get('--md-surface-container')!
    // 冻结锚点：暗 plate = .theme-sky.dark 的 --md-surface-container（面上方一阶）
    expect(container.toLowerCase(), '--md-surface-container 对应 plate 冻结值 #1C2024').toBe('#1c2024')
    for (const [name, css] of [
      ['values/styles.xml', VALUES_STYLES],
      ['values-night/styles.xml', VALUES_NIGHT_STYLES],
    ] as const) {
      expect(css, `${name} 缺少暗色 plate #1C2024`).toContain('#1C2024')
    }
    // 离底有差（亮色轨 plate==底 为有意；暗色轨必须可分辨，否则前景圆盘不可见）
    expect(container.toLowerCase()).not.toBe(surface.toLowerCase())
  })
})
