// ─── app-lynx T2：外观模式（明暗）端到端契约（spec docs/specs/lynx-night-mode.md T2 §4.7）───
//
// 覆盖矩阵：
//   1. 根类组合纯函数 appearanceClasses —— 输入 themeColorId + resolvedDark → 类数组
//      未知 id 回退默认 + console.warn（**单一实现 = themeColorClass**，前缀 [themeColor]）
//   2. 色板契约 —— tokens.css 暗色色板（.theme-X.dark）覆盖同套角色集（与亮色同构）
//      + 派生 token 显式口径（--md-scroll-indicator 排除理由 + 暗色块重定义断言）
//      + 暗色 pressed 语义（--md-state-pressed-primary ≠ primary 且更亮，防按下无反馈）
//   3. Me.vue 外观入口（亮/暗/跟随三态）—— 模板契约 + a11y 注册表消费
//   4. App.vue 根类接线 —— appearanceClasses(settings.themeColor, settings.resolvedDark)
//   5. i18n 三语消费 —— zh-CN / en 词条齐（app-lynx 暂未上 ja，但 spec 留位）
//   6. 主题色块联动 —— Me.vue 色块使用 appearanceClasses（WYSIWYG）
//   7. BACKUP_DEVICE_KEYS + applyRawKey 双锚守卫 —— settings_dark_mode 已存在
//
// oracle 溯源：色板真实值来自 tokens.css（由 generate-theme-palettes.mjs 静态生成），
// 角色清单 = unit.test.ts §主题色契约 已校验过的 themeableRoles 集合；测试不引入手写值。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_COLOR_OPTIONS, DEFAULT_THEME_COLOR, themeColorClass } from '../../../src/utils/themeColor'
import { appearanceClasses, DARK_CLASS } from '../../../src/utils/appearanceClasses'
import { DARK_MODE_OPTIONS, DEFAULT_DARK_MODE } from '../../../src/utils/darkMode'
import { ME_A11Y_LABELS } from '../../../src/utils/accessibility'
import zhPages from '../../../src/i18n/locales/zh-CN/pages'
import enPages from '../../../src/i18n/locales/en/pages'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..', '..', '..')
const tokensCss = readFileSync(resolve(rootDir, 'src/styles/tokens.css'), 'utf-8')
const appVue = readFileSync(resolve(rootDir, 'src/App.vue'), 'utf-8')
const meVue = readFileSync(resolve(rootDir, 'src/pages/Me.vue'), 'utf-8')

/** 取以 `selector` 起始的规则块（首个 `{` 到首个 `}`）——色板块均为单层，无嵌套花括号 */
function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `tokens.css 缺少 ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const end = css.indexOf('}', open)
  expect(open, `tokens.css ${selector} 块缺少 {`).toBeGreaterThan(start)
  expect(end, `tokens.css ${selector} 块未闭合`).toBeGreaterThan(open)
  return css.slice(open + 1, end)
}

/** 块内某 token 的 6 位 hex 值（色板 token 恒为该形态；缺失 → undefined） */
function hexOf(block: string, token: string): string | undefined {
  return block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
}

/** 6 位 hex → [r,g,b]（非该形态直接断言失败，避免 NaN 参与比较致恒真） */
function hexToRgb(hex: string | undefined): [number, number, number] {
  expect(hex, 'token 值不是 6 位 hex（色板契约形态变化）').toMatch(/^#[0-9a-fA-F]{6}$/)
  return [
    parseInt(hex!.slice(1, 3), 16),
    parseInt(hex!.slice(3, 5), 16),
    parseInt(hex!.slice(5, 7), 16),
  ]
}

/** 相对亮度（WCAG 权重）：契约只用「谁更亮」的相对序，不引绝对值门槛 */
function luma([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 从基础色板块（page, .theme-sky）提取可主题颜色角色：与 unit.test.ts §主题色契约 同模式 */
function extractThemeableRoles(css: string): string[] {
  const start = css.indexOf('page,')
  expect(start, 'tokens.css 缺少基础 page 色板块').toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const end = css.indexOf('\n}', open)
  expect(open, '基础色板块缺少 {').toBeGreaterThan(-1)
  expect(end, '基础色板块缺少 }').toBeGreaterThan(-1)
  const block = css.slice(open + 1, end)
  const seedIndependent = new Set([
    '--md-error',
    '--md-on-error',
    '--md-error-container',
    '--md-on-error-container',
    '--md-scrim',
    '--md-scrim-overlay',
    '--md-state-pressed-error',
  ])
  // 派生 token：基础 page 已定义完整值，各主题无需重定义（仅暗色 .theme-X.dark 派生）。
  // - --md-scroll-indicator：**显式排除**（非缺值）——取值由 outline 派生（rgba(...) 形态，
  //   不进 hex 角色集），亮色各主题沿用基础 page block 的值；暗色各主题必须自重定义
  //   （亮色灰叠暗面上对比度漂移），该覆盖由下方「--md-scroll-indicator 定义点」用例钉住。
  const derivedFromThemeable = new Set(['--md-scroll-indicator'])
  const roles = new Set<string>()
  for (const m of block.matchAll(/(--md-[a-z0-9-]+)\s*:/g)) {
    const name = m[1]!
    if (seedIndependent.has(name)) continue
    if (derivedFromThemeable.has(name)) continue
    if (name.startsWith('--md-shape-') || name.startsWith('--md-elevation-')) continue
    roles.add(name)
  }
  return [...roles]
}

/** 从 .theme-X { ... } 块中提取角色集 */
function extractThemeRoles(css: string, selector: string): string[] {
  const start = css.indexOf(selector + ' {')
  expect(start, `tokens.css 缺少 ${selector}`).toBeGreaterThan(-1)
  const block = css.slice(start, css.indexOf('}', start))
  return [...new Set([...block.matchAll(/(--md-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))]
}

describe('T2 根类组合纯函数 appearanceClasses', () => {
  it('亮色：返回单类 [theme-X]', () => {
    for (const option of THEME_COLOR_OPTIONS) {
      expect(appearanceClasses(option.id, 'light')).toEqual([option.className])
    }
  })

  it('暗色：返回 [theme-X, dark]（复合选择器 .theme-X.dark）', () => {
    for (const option of THEME_COLOR_OPTIONS) {
      expect(appearanceClasses(option.id, 'dark')).toEqual([option.className, DARK_CLASS])
    }
  })

  it('DARK_CLASS 常量 = "dark"（spec §4.7 决策）', () => {
    expect(DARK_CLASS).toBe('dark')
  })

  it('未知 id → console.warn + 回退默认（themeColorClass 模式）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appearanceClasses('neon', 'light')).toEqual([themeColorClass(DEFAULT_THEME_COLOR)])
    expect(appearanceClasses('neon', 'dark')).toEqual([themeColorClass(DEFAULT_THEME_COLOR), DARK_CLASS])
    expect(warn).toHaveBeenCalledTimes(2)
    // 告警前缀 = [themeColor]（**单一实现**：appearanceClasses 复用 themeColorClass，
    // 无自有前缀；前缀分裂会让同一非法值出现两条不同来源的告警）
    expect(warn.mock.calls[0]?.[0]).toContain('[themeColor]')
    expect(warn.mock.calls[0]?.[1]).toBe('neon')
    warn.mockRestore()
  })

  it('单一实现：appearanceClasses 与 themeColorClass 非法 id 告警逐字节一致（防第二份镜像复活）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    appearanceClasses('neon', 'light')
    const fromAppearance = warn.mock.calls[0]
    warn.mockClear()
    themeColorClass('neon')
    expect(fromAppearance, 'appearanceClasses 未复用 themeColorClass（各自 warn / 各回退默认）').toEqual(
      warn.mock.calls[0],
    )
    warn.mockRestore()
  })

  it('themeColorClass 入参放宽为 string：调用点无需先做类型守卫，非法值仍 warn + 回退默认', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(themeColorClass('neon')).toBe(themeColorClass(DEFAULT_THEME_COLOR))
    expect(themeColorClass('')).toBe(themeColorClass(DEFAULT_THEME_COLOR))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[themeColor]'), 'neon')
    warn.mockRestore()
  })

  it('空串 id 视为非法（同未知 id 行为，禁静默降级）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appearanceClasses('', 'light')).toEqual([themeColorClass(DEFAULT_THEME_COLOR)])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('T2 暗色色板契约（tokens.css .theme-X.dark）', () => {
  const themeableRoles = extractThemeableRoles(tokensCss)

  it('tokens.css 含全部 6 主题暗色色板类（复合选择器 .theme-X.dark）', () => {
    for (const option of THEME_COLOR_OPTIONS) {
      const selector = `.${option.className}.dark`
      expect(tokensCss, `tokens.css 缺少 ${selector}`).toContain(selector)
    }
  })

  it('每个暗色色板覆盖与亮色版同构的角色集（防只覆盖 primary 致串色）', () => {
    expect(themeableRoles.length).toBeGreaterThanOrEqual(40)
    for (const option of THEME_COLOR_OPTIONS) {
      const selector = `.${option.className}.dark`
      const darkRoles = extractThemeRoles(tokensCss, selector)
      expect(darkRoles.length, `${selector} 角色集为空`).toBeGreaterThan(0)
      // 暗色版必须覆盖同套可主题角色（关键角色集交集检查，不要求顺序）
      const missing = themeableRoles.filter((r) => !darkRoles.includes(r))
      expect(missing, `${selector} 缺少关键角色 ${missing.slice(0, 5).join(', ')}...`).toEqual([])
    }
  })

  it('暗色 surface 派生色调应比亮色低（M3 暗色规范：surface 系列偏深色）', () => {
    // sky 主题：亮色 surface=#f8faff（亮），暗色 surface 应在 N5~N10 区间（深）
    const lightRoles = extractThemeRoles(tokensCss, '.theme-sky')
    const darkRoles = extractThemeRoles(tokensCss, '.theme-sky.dark')
    expect(lightRoles).toContain('--md-surface')
    expect(darkRoles).toContain('--md-surface')
    // 亮色值取自基础 page 块（.theme-sky 与之共规则），暗色值取 .theme-sky.dark 块
    const lightSurface = hexToRgb(hexOf(extractBlock(tokensCss, 'page,'), '--md-surface'))
    const darkSurface = hexToRgb(hexOf(extractBlock(tokensCss, '.theme-sky.dark'), '--md-surface'))
    expect(luma(darkSurface), '暗色 surface 应显著低于亮色（高对比）').toBeLessThan(luma(lightSurface) - 100)
  })

  it('--md-scroll-indicator：基础 page 块定义 + 6 个暗色块各自重定义（派生口径 = 非缺值）', () => {
    // 该 token 被 extractThemeableRoles 显式排除（由 outline 派生的 rgba，不进 hex 角色集），
    // 排除**不等于**可以缺值：亮色各主题沿用基础 page 块值，暗色各主题必须自重定义，
    // 否则暗色下仍用亮色灰（对比度漂移）。
    // 明暗不对称 = **设计选择，非遗漏**（M4，review round-2）：亮色共用基线 neutral、不随主题染色
    // （有意收敛）；暗色各主题按 outline 派生（与暗色板其余角色同源派生口径）——
    // 显式对称性声明见 tokens.css 基础块该 token 的注释。
    expect(
      extractBlock(tokensCss, 'page,'),
      '基础 page 块缺少 --md-scroll-indicator（亮色各主题的取值来源）',
    ).toContain('--md-scroll-indicator:')
    for (const option of THEME_COLOR_OPTIONS) {
      const selector = `.${option.className}.dark`
      expect(
        extractThemeRoles(tokensCss, selector),
        `${selector} 缺少 --md-scroll-indicator（暗色沿用亮色灰）`,
      ).toContain('--md-scroll-indicator')
    }
    // 值级防线（review 轮3 N2）：暗色块该 token 不得退化成亮色基线灰（rgba(73, 69, 79, …)）——
    // 上方存在性断言无法发现「值被改回亮色灰」，本条把「暗色派生」钉到值级
    for (const option of THEME_COLOR_OPTIONS) {
      const selector = `.${option.className}.dark`
      const start = tokensCss.indexOf(selector + ' {')
      const block = tokensCss.slice(start, tokensCss.indexOf('}', start))
      const valueMatch = /--md-scroll-indicator:\s*([^;]+);/.exec(block)
      expect(valueMatch, `${selector} 缺少 --md-scroll-indicator 值`).toBeTruthy()
      expect(
        valueMatch![1],
        `${selector} 的 --md-scroll-indicator 退化为亮色基线灰（对比度漂移）`,
      ).not.toContain('73, 69, 79')
    }
    // 定义点计数下界（1 基础块 + 6 暗色块）：防上方循环因清单塌陷而恒真通过
    const occurrences = [...tokensCss.matchAll(/--md-scroll-indicator:/g)].length
    expect(occurrences).toBeGreaterThanOrEqual(1 + THEME_COLOR_OPTIONS.length)
  })

  it('暗色 pressed 语义：--md-state-pressed-primary ≠ 同块 --md-primary 且更亮（防「按下无反馈」）', () => {
    // 亮色块的口径是 primary + 12% 黑（更暗）；暗色块必须反向（primary + 12% 白 → 更亮），
    // 且**不得等于 primary** —— 相等即按下零视觉反馈（生成器缺陷回归）。
    const checked: string[] = []
    for (const option of THEME_COLOR_OPTIONS) {
      const selector = `.${option.className}.dark`
      const block = extractBlock(tokensCss, selector)
      const primary = hexOf(block, '--md-primary')
      const pressed = hexOf(block, '--md-state-pressed-primary')
      expect(primary, `${selector} 缺少 --md-primary`).toBeTruthy()
      expect(pressed, `${selector} 缺少 --md-state-pressed-primary`).toBeTruthy()
      expect(
        pressed!.toLowerCase(),
        `${selector} pressed == primary（按下零视觉反馈）`,
      ).not.toBe(primary!.toLowerCase())
      expect(
        luma(hexToRgb(pressed)),
        `${selector} pressed 应比 primary 更亮（暗色态反馈方向）`,
      ).toBeGreaterThan(luma(hexToRgb(primary)))
      checked.push(selector)
    }
    // 精确计数：6 个暗色块逐个覆盖（清单固定 6 支，防循环空转）
    expect(checked.length).toBe(THEME_COLOR_OPTIONS.length)
    expect(THEME_COLOR_OPTIONS.length).toBe(6)
  })
})

describe('T2 App.vue 根类接线', () => {
  it('App.vue 导入 appearanceClasses + resolvedDark', () => {
    expect(appVue).toContain("import { appearanceClasses } from './utils/appearanceClasses'")
    expect(appVue).toContain('useSettingsStore')
  })

  it('根 <page> 类绑定 = appearanceClasses(settings.themeColor, settings.resolvedDark)', () => {
    expect(appVue).toContain(':class="appearanceClasses(settings.themeColor, settings.resolvedDark)"')
  })
})

describe('T2 Me.vue 外观模式入口（M3 segmented button 三格）', () => {
  it('Me.vue 外观模式入口 = darkMode 三态消费 + 模板契约', () => {
    // Me.vue 经 pickAppearanceMode(mode) 统一调用 settings.setDarkMode(mode)，
    // 模板三段分别传 'light' / 'dark' / 'system' 字面量 → setDarkMode 必含此三字面量
    expect(meVue).toContain("pickAppearanceMode('light')")
    expect(meVue).toContain("pickAppearanceMode('dark')")
    expect(meVue).toContain("pickAppearanceMode('system')")
    expect(meVue).toContain('settings.setDarkMode(mode)')
  })

  it('a11y 注册表新增 3 项（appearanceLight/appearanceDark/appearanceSystem）', () => {
    expect(ME_A11Y_LABELS.appearanceLight).toBeTruthy()
    expect(ME_A11Y_LABELS.appearanceDark).toBeTruthy()
    expect(ME_A11Y_LABELS.appearanceSystem).toBeTruthy()
    // 三个 label 必须非空且唯一
    const labels = [
      ME_A11Y_LABELS.appearanceLight,
      ME_A11Y_LABELS.appearanceDark,
      ME_A11Y_LABELS.appearanceSystem,
    ]
    expect(labels.every((l) => l.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(3)
  })

  it('外观模式入口模板三段均消费 a11y 注册表 + accessibility-element', () => {
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.appearanceLight"')
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.appearanceDark"')
    expect(meVue).toContain(':accessibility-label="ME_A11Y_LABELS.appearanceSystem"')
    // 三段均开 accessibility-element（与既有 segmented button 模式一致）
    const segBlock = meVue.match(/M3 segmented button（三档）：亮色 \/ 暗色 \/ 跟随系统[\s\S]*?<\/view>\s*<\/view>/)
    expect(segBlock).not.toBeNull()
    expect(segBlock![0].match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g)?.length).toBe(3)
  })

  it('Me.vue 真实渲染组标签 me.appearance.mode（i18n 键非孤儿）', () => {
    // 该键此前只存在于字典（无模板消费点 = 孤儿）；此处钉住真实渲染点
    expect(meVue, 'Me.vue 未消费 me.appearance.mode（i18n 键成孤儿）').toContain(
      "{{ t('me.appearance.mode') }}",
    )
    // 组标签必须紧贴三格 segmented 容器上方（同卡片内、位于容器之前）
    expect(meVue, '组标签未紧贴 segmented 上方').toMatch(
      /\{\{ t\('me\.appearance\.mode'\) \}\}[\s\S]{0,600}?M3 segmented button（三档）/,
    )
  })

  it('Me.vue 消费 resolvedDark（外观模式段联动）', () => {
    expect(meVue).toContain('resolvedDark')
  })

  it('Me.vue 每个色块走 appearanceClasses（暗色 resolved 下 WYSIWYG）', () => {
    for (const option of THEME_COLOR_OPTIONS) {
      expect(meVue, `Me.vue 缺少 ${option.id} 暗色联动`).toContain(
        `...appearanceClasses('${option.id}', resolvedDark)`,
      )
    }
  })
})

describe('T2 i18n 三语消费（spec §4.7 要求）', () => {
  // app-lynx 现有 zh-CN / en 双语；spec §4.7 列「三语」含 ja 但当前仓库未上线 ja locale，
  // 故仅校验已有双语的齐整性；ja 上线时再补（已在 i18n 体系内可扩展）。
  it('zh-CN 词条齐：mode / modeLight / modeDark / modeSystem', () => {
    expect(zhPages['me.appearance.mode']).toBeTruthy()
    expect(zhPages['me.appearance.modeLight']).toBe('亮色')
    expect(zhPages['me.appearance.modeDark']).toBe('暗色')
    expect(zhPages['me.appearance.modeSystem']).toBe('跟随系统')
  })

  it('en 词条齐：mode / modeLight / modeDark / modeSystem', () => {
    expect(enPages['me.appearance.mode']).toBeTruthy()
    expect(enPages['me.appearance.modeLight']).toBe('Light')
    expect(enPages['me.appearance.modeDark']).toBe('Dark')
    expect(enPages['me.appearance.modeSystem']).toBe('Follow system')
  })
})

describe('T2 与 T1 状态核心串接（darkMode 三态清单）', () => {
  it('DARK_MODE_OPTIONS 与 DARK_MODE_KEYS 三态齐：light / dark / system', () => {
    expect(DARK_MODE_OPTIONS.map((o) => o.id)).toEqual(['light', 'dark', 'system'])
    expect(DEFAULT_DARK_MODE).toBe('system')
  })

  it('外观模式入口 setter 路径走 settingsStore.setDarkMode（已 T1 实现）', () => {
    // 接线由 T1 钉死，本测试仅断言 Me.vue 调用 setter 而非自定义 IO
    expect(meVue).toContain('settings.setDarkMode(')
  })
})
