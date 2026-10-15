/**
 * `placeholder-color` 平台约束的两道机器防线（issue #693）。
 *
 * ## 为什么需要这个文件
 *
 * `placeholder-color` 是 Lynx 平台属性，**不解析 `var()`** —— 取值只能以字面量手抄进
 * `lynxPlatformColors.ts`，与 tokens.css 之间**没有任何编译期联系**。现有门禁都够不着：
 * `palettes-drift.test.ts` 只锁「生成脚本 ↔ tokens.css 自动生成段」，
 * `mdTokenRefs.test.ts` 只管 `var(--md-*)` 引用，而 `hardcodeColorGate.test.ts:177`
 * 对本文件是**文件级豁免**（直接 `continue`），文件内任何 hex 都不进 offenders。
 *
 * ⇒ 本文件同时守两件事：
 *   ① **取值正确性** —— 暗色表逐项 ≡ tokens.css 生成产物（oracle 溯源，禁实现反推）；
 *   ② **接线完整性** —— 9 处消费点全都绑 composable（挡住「改回静态常量」这类静默回退）。
 *
 * ## 已知失效面（门禁纪律：必须显式登记）
 *
 * 1. **① 扫空集 ⇒ 静默恒真**：若 tokens.css 选择器形态改动（`.theme-x.dark {` → 别写法），
 *    正则可能一条抽不到，而「逐项相等」会因两侧同时为空而通过。
 *    ⇒ 用 `expect(实际抽到.size).toBe(7)` 把抽取面钉死。
 * 2. **① 只验字面量一致**：不验「on-surface-variant 是语义上正确的角色」——口径选错照样绿。
 * 3. **① 亮色侧不在守值范围**：亮色基座在 `page, .theme-sky` 段（非 `.dark`），抽取路径不同；
 *    亮色单值由 `expect(INPUT_PLACEHOLDER_COLOR).toBe('#41474e')` 守住。
 * 4. **② 只扫 `placeholder-color` 这个属性名**：若将来改用别的写法（如 `<input>` 上写
 *    `placeholderColor` prop 或经子组件透传），本扫描会扫空集。
 *    ⇒ 用 `expect(消费点数).toBe(9)` 把扫描面钉死，空集必红。
 *    扫描只认带 `=` 的绑定行，`.vue` 注释里对该属性名的说明性提及不计入。
 * 5. **② 不验运行时**：只看源码文本，不证明原生输入框真按此色渲染 —— 像素验收走 #1014 走查矩阵。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR_IDS } from './themeColor'
import { INPUT_PLACEHOLDER_COLOR, INPUT_PLACEHOLDER_DARK_COLOR } from './lynxPlatformColors'

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))

/** 消费点声明式清单：主题化后每一处 `placeholder-color` 绑定都必须是它。 */
const EXPECTED_PLACEHOLDER_BINDINGS = 9

/** tokens.css 自动生成段里每个暗色色板的选择器形态（`.theme-sky.dark {` … `.theme-bili.dark {`）。 */
const DARK_PANEL_RE = /\.theme-([a-z]+)\.dark\s*\{([^}]*)\}/g
const ON_SURFACE_VARIANT_RE = /--md-on-surface-variant:\s*(#[0-9a-fA-F]{3,8})/

/** 从 tokens.css 抽出「主题 id → 暗色 --md-on-surface-variant」。不取 `page, .theme-sky` 亮色基座段。 */
function readDarkOnSurfaceVariant(): Map<string, string> {
  const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
  const out = new Map<string, string>()
  for (const m of css.matchAll(DARK_PANEL_RE)) {
    const themeId = m[1]
    if (themeId === undefined) continue
    const token = ON_SURFACE_VARIANT_RE.exec(m[2] ?? '')?.[1]
    if (token !== undefined) out.set(themeId, token.toLowerCase())
  }
  return out
}

/** 递归收集 `src/**` 下的 `.vue` 文件。 */
function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...vueFiles(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

describe('① INPUT_PLACEHOLDER_DARK_COLOR ≡ tokens.css 暗色段（issue #693）', () => {
  const actual = readDarkOnSurfaceVariant()

  it('抽取面本身有效：一条都没抽到时必须红（下界 = 主题档数）', () => {
    // 写死 7（= THEME_COLOR_IDS.length）而非字面量，加主题时是「抽取面跟着长」，
    // 而不是「抽取器静默失效」。
    expect(actual.size).toBe(THEME_COLOR_IDS.length)
    expect(THEME_COLOR_IDS.length).toBe(7)
  })

  it('抽取器不会漏主题：tokens.css 抽到的 id 集合 ≡ THEME_COLOR_IDS', () => {
    expect([...actual.keys()].sort()).toEqual([...THEME_COLOR_IDS].sort())
  })

  it('逐主题守值：常量表 ≡ tokens.css `.theme-*.dark --md-on-surface-variant`', () => {
    for (const themeId of THEME_COLOR_IDS) {
      const fromTokens = actual.get(themeId)
      expect(fromTokens, `tokens.css 缺少 .theme-${themeId}.dark 的 --md-on-surface-variant`).toBeDefined()
      expect(INPUT_PLACEHOLDER_DARK_COLOR[themeId], `主题 ${themeId} 的占位符常量与 tokens.css 漂移`).toBe(fromTokens)
    }
  })

  it('常量表的 key 集合 ≡ THEME_COLOR_IDS（多一项 / 少一项都要红）', () => {
    expect(Object.keys(INPUT_PLACEHOLDER_DARK_COLOR).sort()).toEqual([...THEME_COLOR_IDS].sort())
  })

  it('暗色值不得复用亮色基线值（否则等于没修：#41474e 在暗底上仅 1.31:1）', () => {
    for (const themeId of THEME_COLOR_IDS) {
      expect(INPUT_PLACEHOLDER_DARK_COLOR[themeId]).not.toBe(INPUT_PLACEHOLDER_COLOR)
    }
  })

  it('亮色维持单值 #41474e（不逐主题化的理由见 lynxPlatformColors.ts 注释 / spec §4.3）', () => {
    expect(INPUT_PLACEHOLDER_COLOR).toBe('#41474e')
  })
})

describe('② 9 处消费点全部绑 composable（issue #693）', () => {
  /** 每处 `placeholder-color` **属性绑定**的相对路径 + 行号（新增/移除消费点须同步本清单）。
   *
   * 只认带 `=` 的绑定行：`.vue` 注释里多处提到该属性名（如 `Login.vue` / `CommentInputBar.vue`
   * 记录“placeholder-color 已撤下”、`BookmarkPanel.vue` 记录平台约束），
   * 那些是**说明性文字**不是消费点，计入会把清单撑成假数。
   */
  const bindings = vueFiles(SRC_DIR)
    .flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      return lines.flatMap((line, i) =>
        line.includes('placeholder-color=')
          ? [{ file: file.slice(SRC_DIR.length), line: i + 1, text: line.trim() }]
          : [],
      )
    })

  it('扫描面本身有效：`placeholder-color` 一处都没扫到时必须红', () => {
    expect(bindings.length).toBe(EXPECTED_PLACEHOLDER_BINDINGS)
  })

  it('每一处都绑 placeholderColor（挡「改回静态常量」的静默回退）', () => {
    for (const b of bindings) {
      expect(b.text, `${b.file}:${b.line} 未绑 composable：${b.text}`).toContain(
        ':placeholder-color="placeholderColor"',
      )
    }
  })

  it('模板内零裸字面量（`placeholder-color="#..."` 一律红）', () => {
    for (const b of bindings) {
      expect(b.text, `${b.file}:${b.line} 散写了十六进制字面量`).not.toContain('placeholder-color="#')
    }
  })

  it('每个含绑定的文件都真的引入了 composable（避免「绑了但没引」的运行期未定义）', () => {
    const files = [...new Set(bindings.map((b) => b.file))]
    expect(files.length).toBeGreaterThan(0)
    for (const rel of files) {
      const source = readFileSync(`${SRC_DIR}${rel}`, 'utf8')
      expect(source, `${rel} 用了 placeholderColor 但未引入 useInputPlaceholderColor`).toContain(
        'useInputPlaceholderColor',
      )
    }
  })

  it('没有组件绕过 composable 直接用暗色表（暗色值只能经 composable 的三态归一）', () => {
    for (const rel of vueFiles(SRC_DIR)) {
      const source = readFileSync(rel, 'utf8')
      expect(source, `${rel.slice(SRC_DIR.length)} 直接引用了 INPUT_PLACEHOLDER_DARK_COLOR`).not.toContain(
        'INPUT_PLACEHOLDER_DARK_COLOR',
      )
    }
  })
})
