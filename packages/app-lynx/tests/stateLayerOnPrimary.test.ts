// ─── 状态层 `on-primary` 档（issue #866）───
//
// 缺陷：`active:bg-layer-pressed-on-primary` 是**死类名** —— 组件里写了 2 处
// （SettingsEndpoint.vue / TranslateButton.vue 的实心 primary 按钮），但 Tailwind 产物里
// **零规则**，两个按钮的按压反馈完全静默失效。根因有两层，缺一不可：
//   (a) `tailwind.config.ts` 登记了状态层四态 × 四色（primary / on-surface / error / surface），
//       **唯独没有 `on-primary`** ⇒ utility 名不存在；
//   (b) `tokens.css` 里 `--md-state-layer-*-on-primary` 令牌一条都没有（对照
//       `--md-state-layer-*-on-surface`：**语义 56 条** = 14 色板 × 4 态；
//       `grep -c` 出来是 **62 行**，因为 6 个亮色板在自己的块里重复声明了与基础块
//       同值的 pressed-on-surface（14→20）—— 两个数都对，引用时要说清是哪个口径）
//       ⇒ 即便登记了也只是指向未定义变量。
// 两者都补齐才可能变绿，这也是本文件分 A/B 两段各自设门的原因。
//
// 接缝（tdd 纪律）：唯一接缝 = **Tailwind 构建产物**，「某个 class 是否产出规则」。
// 复用 `tests/helpers/md3TailwindArtifact.ts`（加载真实 tailwind.config.ts → 走 Tailwind
// 自己的 postcss 插件 → 从 postcss AST 取声明），不自造构建管线。
// ⚠️ 关键区分：合成 content 只能证明「配置登记了」，**证明不了**「代码里写的那个类名真的有
// 规则」—— 后者必须 `content: 'project'` 打真实 `src/`。本文件 A1 段走的正是这一条。
// ⚠️ 但 A1 的**判据形态**在 #867 之后改过（理由就地写在 A1 的 it 注释里），从「必须有消费方」
// 改成「有消费方就必须有规则」——前者把「有人用」当成了正确性。
//
// ✅ **#867 已修复：`on-primary` 档现为预合成不透明色，两处消费已恢复。**
// 原缺陷：`--md-state-layer-*` 是半透明 alpha，而 Tailwind 的 `bg-*` 直接**替换**
// `background-color`、不与容器色合成 ⇒ 实心按钮一按底色变成 12% 半透明白、白卡片透上来，
// 填色整个消失。emulator-5556 真机实测（1080×2160，保存按钮）：静止 RGB (26,111,168)
// = --md-primary，按住 **(249,251,255)** ≈ 页面色。修法与依据见 #867 与 ADR-0207 决策 8。
// ⚠️ 早先此处记的是 HSV 饱和度「sat 64.22 → 0.00」，**已撤**：#1a6fa8 的 sat 实为 84.52、
//    (249,251,255) 的 sat 实为 2.35，两数都对不上；且它与模型 ΔE 64.33 过于接近，
//    反向提示是把模型量误记成了设备量。设备观测一律用 RGB 三元组。
//
// ⚠️ 修复**只覆盖 `on-primary` 档**（实心底色 + 浅色层这一组合），其余 4 档仍保持 alpha ——
// 判据 C1 钉住这条范围封闭性。另两个引擎事实同样来自真机：Lynx **不渲染 `color-mix()`**；
// Lynx 的 **`hover-class` 不产生视觉切换**（⇒ 只有 `active:` 变体可用，见 #868 与 C4）。
//
// 真机复验（emulator-5556，1080×2160，保存按钮 `SettingsEndpoint` 的 onSave）：
//   · 表单有效（enabled）时长按 → `(26,111,168)` → **`(53,128,178)`**，
//     精确命中 tokens.css 的预合成值 `#3580b2`（修复前同一按钮是 `(249,251,255)` 近白）
//   · 该值可复算：`mix(#1a6fa8, #ffffff, 0.12)` = `#3580b2` —— 与真机像素逐位相同。
//     这是**独立算得**的，不是抄产物：算式来自 B2 的 oracle（块内 primary +
//     块内 on-primary + 官方 opacity），真机像素是第三方观测，两者互不依赖。
//   · 表单无效（disabled）时长按 → 静止与按住**逐位相同** ⇒ 禁用态不叠加按压反馈。
//     ⚠️ 早先记录的绝对像素 `(137,168,189)` **已撤**：复算显示 `#1a6fa8` 以
//        `opacity-50` 叠在任何中性浅底上都得不出该值（sRGB 直混 G≈178~183、
//        线性光合成 G≈193~200，记录值 G=168）⇒ 取样点未落在填色区。
//        行为结论（无按压反馈）是**相对观察**，不依赖那个像素值，仍然成立。
//   · 产物侧：bundle 里该类名**未转义**出现 4 次（2 消费点 × 可读版+压缩版）。
//     ⚠️ 复跑 `grep -ao 'active:bg-layer-pressed-on-primary' dist/main.lynx.bundle | wc -l`。
//     写成 `active\\:bg-...`（转义）会静默返回 0 —— 那是 **Tailwind CSS 选择器**
//     产物的形态（A 段 helper 走的那条），不是 bundle 里 JS 字符串的形态。
//
// Oracle 纪律（禁自证 / 禁硬编码当前值）：
//   - 四态 opacity      → material-web v0.192 `_md-sys-state.scss`（hover .08 / focus .12 /
//                         pressed .12 / dragged .16），非本仓当前产物
//   - utility 取值形态  → ADR-0207 决策 4「bg-layer-<state>-<role> 整档指向同名 --md-* 令牌」
//   - 令牌取值的色相    → **该色板块自己的 `--md-on-primary`**（MD3 语义：primary 容器上的
//                         状态层用 on-primary 作色），逐块从 tokens.css 现读，**不抄任何 hex**
//   - 暗色 7 套互不相同  → 实测事实（脚本派生），作用是挡住「脚本退化把某几套刷成同值」
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  buildTailwindArtifact,
  projectTailwindConfig,
  ruleForSelector,
  type TailwindArtifact,
} from './helpers/md3TailwindArtifact'

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
)

// ═══════════════════════ Oracle：官方四态 opacity（一手来源） ═══════════════════════

/** material-web v0.192 `_md-sys-state.scss`：四态 opacity（focus 是 .12 不是 .10） */
const MD3_STATE_OPACITIES: ReadonlyArray<readonly [state: string, opacity: number]> = [
  ['hover', 0.08],
  ['focus', 0.12],
  ['pressed', 0.12],
  ['dragged', 0.16],
]

const STATES = MD3_STATE_OPACITIES.map(([state]) => state)

/** 本票新增的第 5 个语义色档：primary 容器上的状态层（色相 = on-primary） */
const ON_PRIMARY = 'on-primary'

// ═══════════════════════ tokens.css 色板块解析（抽取器 + 自身有效性下界） ═══════════════════════

interface Palette {
  selector: string
  body: string
}

/** 取 tokens.css 里每个色板块（`page,` / `.theme-X` / `.theme-X.dark`）的 body 文本。
 *  基础块的选择器在源码里是 `page,` 与 `.theme-sky` **两行**，故 `page,` 单独起块。 */
function paletteBlocks(css: string): Palette[] {
  const lines = css.split('\n')
  type Mutable = { selector: string; body: string[]; opened: boolean }
  const blocks: Mutable[] = []
  let current: Mutable | null = null
  for (const line of lines) {
    if (!current) {
      if (line === 'page,') {
        current = { selector: 'page,', body: [], opened: false }
        blocks.push(current)
        continue
      }
      if (/^\.theme-[a-z]+(?:\.dark)? \{\s*$/.test(line)) {
        current = { selector: line.replace(/\s*\{$/, ''), body: [], opened: true }
        blocks.push(current)
      }
      continue
    }
    if (!current.opened) {
      if (line.includes('{')) current.opened = true
      continue
    }
    if (line === '}') current = null
    else current.body.push(line)
  }
  return blocks.map((b) => ({ selector: b.selector, body: b.body.join('\n') }))
}

/** 块内某自定义属性的声明值（含行尾注释）。取不到返回 undefined —— 绝不用 '' 冒充 */
function cssVarValue(block: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}:\\s*(.+?);?\\s*(?:/\\*.*)?$`, 'm').exec(block)
  return m?.[1]?.trim()
}

/** 6 位 hex → [r,g,b] */
function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

/** base 打底、overlay 叠 weight（逐通道取整）→ `#rrggbb`。
 *  与 scripts/generate-theme-palettes.mjs 的 mixHex 同式：生成脚本与本断言必须同口径，
 *  否则暗色 7 套会被判红。 */
function mixHex(
  base: readonly [number, number, number],
  overlay: readonly [number, number, number],
  weight: number,
): string {
  return (
    '#' +
    base
      .map((c, i) => Math.round(c * (1 - weight) + overlay[i] * weight).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * 跟 `var()` 引用解到**终点**并返回其 alpha。
 * 判定「这一档是否仍是半透明层」必须看终点形态而不是字面形态 ——
 * `surface` 档字面是 `var(--md-state-layer-*-primary)`，解到终点才是 rgba(alpha<1)。
 * 6 位 hex ⇒ alpha = 1（已预合成）。形态无法识别返回 undefined，调用方须判红而非放过。
 */
function resolveLayerAlpha(block: string, name: string, depth = 0): number | undefined {
  const v = cssVarValue(block, name)
  if (v === undefined || depth > 5) return undefined
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return 1
  const rgba = /^rgba?\(([^)]*)\)$/.exec(v)
  if (rgba) {
    const parts = rgba[1].split(',').map((x) => x.trim())
    return parts.length >= 4 ? Number(parts[3]) : 1
  }
  const ref = /^var\(\s*(--md-[\w-]+)\s*\)$/.exec(v)
  if (ref) return resolveLayerAlpha(block, ref[1], depth + 1)
  return undefined
}

/** 判据统一使用的「剥注释」口径：C4 与 C6 共用，避免两处各剥各的、行为漂移。
 *  ⚠️ 三类注释都要剥，缺一类就留下一个误伤口：
 *   · 模板注释 `<!-- … -->`  （.vue 模板区）
 *   · 块注释（斜杠星 … 星斜杠）
 *   · **行注释**（双斜杠）—— 这一类最初漏了，反事实里一个只在行注释里提到
 *     类名的 `.vue` 被判成违规（正是本条想防的误伤）。`.vue` 的
 *     `<script setup>` 里双斜杠注释极常见，漏它不是理论风险。
 *  双斜杠前加 `:` 的负向断言，是为了放过 `'https://…'` 这类字符串里的双斜杠。 */
const stripComments = (s: string): string =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** sRGB 欧氏距离（够用：只用于判定「更靠近哪一端」，不是感知均匀空间） */
function dist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

const PALETTES = paletteBlocks(TOKENS_CSS)

// ═══════════════════════ A. Tailwind 产物接缝 ═══════════════════════

/** 真实 `src/` 下全部 `.vue` —— A1 用来数「谁在消费这个类名」。
 *  刻意**不过滤目录名**：多一层 `name === 'x'` 就能让整目录静默落空，
 *  而空集与「零违规」在 `toEqual([])` 上完全同形。 */
const ALL_SRC_VUE: string[] = (() => {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(root)
  return out
})()

/** 打真实 `src/` 的产物：证明「代码里写出来的类名真的有规则」 */
const realSrcArtifact: Promise<TailwindArtifact> = buildTailwindArtifact(
  ['active:bg-layer-pressed-on-primary'],
  {},
  'project',
)

/** 变体类的完整选择器（含 `:` 需转义 + 伪类后缀），只能走「按选择器取」那条 API */
const variantSelector = (variant: string): string =>
  `.${variant.replace(/([^A-Za-z0-9_-])/g, '\\$1')}:active`

/**
 * 打真实 `src/` 的**耗时看门狗**（ms）。两处都要接上，缺一即漏：
 *   ① A1 的 **vitest 单测超时**（`it()` 第三参）—— `realSrcArtifact` 在模块顶层就
 *      发起真实 Tailwind 构建，实测单跑 ~1.1s，但全量 216 文件并行抢 CPU 时
 *      实测跑到 **6.2s** ⇒ 撞 vitest 默认 **5000ms** 变成间歇性假红。
 *      ⚠️ 这不是「环境慢」，是**忘了给这条 it 传超时**；早先版本只调 spawn 看门狗、
 *      没碰 vitest 层，于是看门狗形同虚设。
 *   ② C2 / C5 的 `spawnSync` 超时（跑判据脚本）—— 防脚本真挂死。
 * 30s 与 `palettes-drift.test.ts` 的 spawn 看门狗同量级，够慢也不会掩盖真挂死。
 */
const REAL_SRC_TIMEOUT_MS = 30_000

describe('A · 状态层 on-primary 档的 utility 必须真的产出规则（#866）', () => {
  it('A1 真实 src/ 里的每个消费方都必须拿到规则（无死类名防线）', async () => {
    // ⚠️ 第三参是真构建看门狗，不是装饰：`realSrcArtifact` 打的是真实 `src/`，
    //    并行抢 CPU 时实测 6.2s > vitest 默认 5000ms ⇒ 不传就会间歇性假红。
    // ⚠️ 判据形态在本轮**改过一次**，理由就地写在本 it 下方（原写法是「见文件尾
    //    「为什么当前断言 0 个消费方」」—— 那个小节根本不存在，且「0 个消费方」
    //    在 #867 恢复 2 处消费后已过时；悬空引用 + 过时陈述一并订正）。
    // 原形态是「该类名在真实 src/ 下必须产出 ≥1 处规则」——它把「必须有人在用」
    // 当成了正确性判据，于是当 #867 撤销那 2 处用法（状态层不能当 background-color
    // 替换，真机上按压会让实心按钮的填色整个消失）时，它转红了。
    // 那不是缺陷回归，是**判据把「有消费方」误当成了「应该正确」**。
    // 正确形态是**无死类名**语义：代码里写了就必须有规则；没人写就不必产出。
    const consumers = ALL_SRC_VUE.filter((f) =>
      readFileSync(f, 'utf8').includes(`bg-layer-${'pressed'}-${ON_PRIMARY}`),
    )
    // 非空下界：#867 修完恢复了 2 处消费（SettingsEndpoint 保存按钮 / TranslateButton），
    // 且 B2/C3 的判别力依赖它们存在。**零消费方分支已删** —— 上一版写的是
    // 「若为 0 则断言 toEqual([])」，而长度刚刚判过 0，等于恒真、钉不住任何东西。
    expect(consumers.length, 'on-primary 状态层消费点为 0：C3 的判别力会失效（扫描面疑死）').toBeGreaterThan(
      0,
    )
    for (const f of consumers) {
      const rule = ruleForSelector(
        await realSrcArtifact,
        variantSelector(`active:bg-layer-pressed-${ON_PRIMARY}`),
      )
      expect(rule, `${f.split('/src/')[1]} 写了 active:bg-layer-pressed-${ON_PRIMARY} 却零规则 —— 死类名`).toBeDefined()
    }
  }, REAL_SRC_TIMEOUT_MS)

  it('A2 四态 × on-primary 在颜色档位顶层齐备（bg-layer-<state>-on-primary）', async () => {
    // 用合成 content 精确探这 8 个名字：hover/focus/dragged 在 src/ 里暂无消费方，
    // 打真实 src/ 时它们本就不该出现在产物里（那正是「无人写就无需产出」的正常态），
    // 齐备性属于**配置登记**问题，用合成探针判定才不失真。
    const probes = STATES.map((s) => `bg-layer-${s}-${ON_PRIMARY}`)
    const artifact = await buildTailwindArtifact(probes)
    for (const [state] of MD3_STATE_OPACITIES) {
      const value = ruleForSelector(
        artifact,
        `.bg-layer-${state}-${ON_PRIMARY}`,
      )?.['background-color']
      expect(value, `bg-layer-${state}-${ON_PRIMARY} 未登记或取值不对`).toBe(
        `var(--md-state-layer-${state}-${ON_PRIMARY})`,
      )
    }
  })

  it('A3 state 嵌套别名组同样补齐 on-primary（两套写法对称，不制造新的半残档位）', async () => {
    const probes = STATES.map((s) => `bg-state-layer-${s}-${ON_PRIMARY}`)
    const artifact = await buildTailwindArtifact(probes)
    for (const [state] of MD3_STATE_OPACITIES) {
      const value = ruleForSelector(
        artifact,
        `.bg-state-layer-${state}-${ON_PRIMARY}`,
      )?.['background-color']
      expect(value, `bg-state-layer-${state}-${ON_PRIMARY} 未登记或取值不对`).toBe(
        `var(--md-state-layer-${state}-${ON_PRIMARY})`,
      )
    }
  })

  it('A4 反事实：撤掉顶层 on-primary 登记 → 该类名当场退化为死类名', async () => {
    // 合成 content **显式写入该类名**：完整配置下必须有规则、撤掉登记后必须没有 ——
    // 这才是「死类名」这件事的判别力所在。阳性对照 on-surface 在两侧都必须活着。
    // ⚠️ 早先这里写的理由是「当前 0 消费方 ⇒ 真实 src/ 打不出差异」，那句话在
    //    #867 恢复 2 处消费后已不成立。合成口径**与消费方数量无关**：它验的是
    //    「配置登记 ⇒ 该名字能否产出规则」这条因果本身，比在真实 src/ 上抽样更稳。
    const real = projectTailwindConfig()
    const extend = real.theme?.extend
    const colors = { ...(extend?.colors as Record<string, unknown>) }
    delete colors[`layer-pressed-${ON_PRIMARY}`]
    const broken = await buildTailwindArtifact(
      [`active:bg-layer-pressed-${ON_PRIMARY}`, `active:bg-layer-pressed-on-surface`],
      { theme: { ...real.theme, extend: { ...extend, colors } } },
    )
    expect(
      ruleForSelector(broken, variantSelector(`active:bg-layer-pressed-${ON_PRIMARY}`)),
      '撤掉登记后仍产出规则 ⇒ 判据抓的不是死类名',
    ).toBeUndefined()
    expect(
      ruleForSelector(broken, variantSelector('active:bg-layer-pressed-on-surface')),
      '阳性对照也被打掉了 ⇒ 反事实改坏的不止目标档位',
    ).toBeDefined()
  })
})

// ═══════════════════════ B. tokens.css 令牌层 ═══════════════════════

describe('B · tokens.css 逐色板声明 --md-state-layer-*-on-primary（#866）', () => {
  it('B1 抽取器自身有效：切出 14 个色板块（基础含 sky + 6 亮 + 7 暗），每块都有 on-primary', () => {
    // 反塌陷：块数或 on-primary 抽不到时，下面那些全称断言会静默恒真
    expect(PALETTES.length).toBe(14)
    for (const palette of PALETTES) {
      expect(cssVarValue(palette.body, '--md-on-primary'), `${palette.selector} 无 on-primary`).toBeDefined()
    }
  })

  it('B2 14 块 × 四态齐备，值为「on-primary 按官方 opacity 预合成进 primary」的不透明色', () => {
    // #867 起本档语义已改：不再是 rgba(on-primary, α)，而是把 on-primary 按官方
    // opacity **预混合进 primary** 得到的**不透明**色。理由（真机实证，见 #867）：
    //   · Tailwind `bg-*` 直接替换 background-color，不与容器色合成；
    //   · Lynx 不渲染 color-mix()（按下后测得 = 容器白，声明彻底失效）；
    //   ⇒ 实心 primary 按钮按压时填色整个消失（真机 RGB (26,111,168)→(249,251,255)）。
    // 期望值走**可复算公式**（块内 primary + 块内 on-primary + 官方 opacity），
    // 不硬编码任何字面色值 —— 换色板 / 改 opacity 时本断言自动跟着走。
    const violations: string[] = []
    for (const palette of PALETTES) {
      const onPrimaryHex = cssVarValue(palette.body, '--md-on-primary')
      const primaryHex = cssVarValue(palette.body, '--md-primary')
      for (const [name, hex] of [
        ['--md-on-primary', onPrimaryHex],
        ['--md-primary', primaryHex],
      ] as const) {
        expect(hex, `${palette.selector} 的 ${name} 不是 6 位 hex`).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
      const onPrimary = hexToRgb(onPrimaryHex!.toLowerCase())
      const primary = hexToRgb(primaryHex!.toLowerCase())
      for (const [state, opacity] of MD3_STATE_OPACITIES) {
        const name = `--md-state-layer-${state}-${ON_PRIMARY}`
        const value = cssVarValue(palette.body, name)
        if (value === undefined) {
          violations.push(`${palette.selector} 缺 ${name}`)
          continue
        }
        // 预合成：primary 打底 + on-primary 叠官方 opacity。逐块逐态核对。
        const expected = mixHex(primary, onPrimary, opacity)
        if (value.toLowerCase() !== expected) {
          violations.push(`${palette.selector} 的 ${name}=${value} ≠ ${expected}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('B4 14 块 × 四态都必须是 6 位 hex（不得回退成 rgba —— 那正是 #867 的塌陷语义）', () => {
    // 与 B2 互补：B2 钉「值算得对」，本条钉「形态是预合成的实色」。
    // 混着 rgba 也能算对，但那种形态在真机上会让填色消失。
    const offenders: string[] = []
    for (const palette of PALETTES) {
      for (const [state] of MD3_STATE_OPACITIES) {
        const name = `--md-state-layer-${state}-${ON_PRIMARY}`
        const value = cssVarValue(palette.body, name)
        expect(value, `${palette.selector} 缺 ${name}`).toBeDefined()
        if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) offenders.push(`${palette.selector} 的 ${name}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('B5 预合成方向正确：结果必须比 on-primary 更靠近 primary（防 mix 两个参数写反）', () => {
    // mix(a, b, w) 若把两个参数写反，算出来是「白底叠 12% 蓝」—— 是个**更浅**的色值。
    // 早先注释写「B2 也可能照样绿」是**错的**（经复算 mix(onP,prim,0.12)=#e4eef5 ≠ B2 期望的
    // #3580b2，B2 必红）。本条仍保留：B5 守的是**方向不变量**（更靠近 primary），
    // 语义比 B2 的「值等于某个具体结果」更稳，且两者会在写反时给出不同层级的诊断。
    // 方向判据：官方 opacity 只有 .08~.16（很薄一层），所以结果必然**贴着 primary**。
    // 写反时结果会贴在 on-primary 侧，本条当场抓住。
    // ⚠️ 判据方向别搞反：这里断言的是「更靠近 primary」而非「更靠近 on-primary」——
    //    薄层语义下前者才对，断言后者会把正确值全判红（首版就踩了这个，已修正）。
    const violations: string[] = []
    for (const palette of PALETTES) {
      const primary = hexToRgb(cssVarValue(palette.body, '--md-primary')!.toLowerCase())
      const onPrimary = hexToRgb(cssVarValue(palette.body, '--md-on-primary')!.toLowerCase())
      for (const [state, opacity] of MD3_STATE_OPACITIES) {
        const value = cssVarValue(palette.body, `--md-state-layer-${state}-${ON_PRIMARY}`)!
        const got = hexToRgb(value.toLowerCase())
        const dToBase = dist(got, primary)
        const dToLayer = dist(got, onPrimary)
        if (!(dToBase < dToLayer)) {
          violations.push(
            `${palette.selector} 的 --md-state-layer-${state}-${ON_PRIMARY}=${value} ` +
              `离 primary ${dToBase.toFixed(1)} 不小于离 on-primary ${dToLayer.toFixed(1)}（方向反了？）`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('B3 暗色 7 套的 on-primary 各不相同（挡脚本退化把某几套刷成同值）', () => {
    const darks = PALETTES.filter((p) => p.selector.endsWith('.dark'))
    expect(darks.length).toBe(7)
    const rgs = darks.map((p) => {
      const token = `--md-state-layer-pressed-${ON_PRIMARY}`
      const value = cssVarValue(p.body, token)
      // ⚠️ 缺值时**不能**拿占位串凑数：7 个互不相同的占位串会让 `new Set(...).size === 7`
      // 恒真 ⇒ 令牌整段缺失时这条照样绿（实测：回退态下 B3 曾通过）。缺值直接判红。
      expect(value, `${p.selector} 缺 ${token}（B3 不得在缺值时通过）`).toBeDefined()
      return value!
    })
    // 亮色 7 套的 on-primary 全是 #ffffff（暗色必须逐套派生，不能沿用亮色值）
    expect(new Set(rgs).size, '暗色 on-primary 状态层出现同值：疑似派生退化').toBe(7)
  })
})

// ═══════════════════════ C. #867/#868：范围封闭性 + 判据自证与事实 + 消费约束 ═══════════════
// C1 其余 4 档仍是 alpha（范围封闭）· C2 判据自证（合成样本，验判别力）
// C3 on-primary 必须与 bg-primary 同元素 · C4 禁 hover-class 绑定
// C5 判据对当前 tokens 实跑：条目数无缺口 + 0 条会塌（事实门禁，钉住 ADR 判据 6）
// C6 C3「只扫 .vue」的前提由机器钉住（.ts 不得拼接该类名）
// ⚠️ C2 与 C5 分工不同、不可合并：**C2 验判据有分离能力**（对任何令牌改动恒绿），
//    **C5 钉当前事实**（令牌改动一旦引入塌陷即转红）。两者缺一，门禁要么空转要么失灵。

/** on-primary 之外的 4 个 role —— 全部画在 surface 底上，按压仍有可见反馈，
 *  真机 ΔE 最大仅 16.81（阈值 25），**必须保持 alpha**。
 *  用户 2026-09-30 拍板：只改实心底色会塌掉的那部分，不扩大化。 */
const ALPHA_ROLES = ['primary', 'on-surface', 'error', 'surface'] as const

/** C6 的唯一判定函数 —— **只在此定义一次**，扫描与判别力自检**共用同一个引用**。
 *  ⚠️ 绝不允许在自检里另写一份"等价的"判据：上一版正是这么干的 ——
 *    `.ts` 分支实际只跑连续正则（拼接启发式只挂在 `.vue` 的 script 块上），
 *    而自检断言的是一个合并了两条启发式的 `caught()`，于是**根本没走到真实逻辑
 *    却显示通过**，把一个真实缺口包装成了"已覆盖"。
 *    ⇒ 判据自检断言的对象必须与实现**同一份**，否则它保护的是空气。 */
const classifyC6 = (code: string): '连续写法' | '拼接写法' | null => {
  if (/(?:^|[^\w-])bg-layer-[\w-]+-on-primary/.test(code)) return '连续写法'
  // 拼接：同一段代码里同时出现 `bg-layer-` 与 `on-primary`。
  // 真实树上零误报（M3SegmentedButton.vue 的 script 里有 `bg-layer-pressed-on-surface`
  // 但没有 `on-primary`）。挡不住的边界见 C6 注释里「不再声称覆盖」那段。
  return /(?:^|[^\w-])bg-layer-/.test(code) && /on-primary/.test(code) ? '拼接写法' : null
}

describe('C · #867 修复范围封闭性与消费约束', () => {
  it('C1 其余 4 档必须仍是 alpha 形态（范围不得扩大化）', () => {
    // 这 4 档的 ΔE 上限 16.81 < 阈值 25，alpha 语义在真机上工作正常。
    // 有人「顺手把状态层都改成不透明色」时这条会红。
    //
    // 判据演进（三版，每版都被 review 打回）：
    //   v1 只允许 `rgba(` ⇒ 误伤 56 条（surface 档本就是 var() 别名）
    //   v2 允许 `rgba(|var(` ⇒ 漏检：写成 `var(--md-state-layer-*-on-primary)`
    //      （终点是不透明 hex）照样判绿，扩大化有了合法外观
    //   v3 跟引用解到**终点**看 alpha（resolveLayerAlpha）—— 唯一不受字面形态影响的写法。
    const offenders: string[] = []
    for (const palette of PALETTES) {
      for (const role of ALPHA_ROLES) {
        for (const [state] of MD3_STATE_OPACITIES) {
          const name = `--md-state-layer-${state}-${role}`
          const value = cssVarValue(palette.body, name)
          expect(value, `${palette.selector} 缺 ${name}`).toBeDefined()
          const alpha = resolveLayerAlpha(palette.body, name)
          expect(alpha, `${palette.selector} 的 ${name} 无法解析终点（形态未知）`).toBeDefined()
          // alpha === 1 = 终点是 6 位 hex = 已预合成 = 范围扩大化
          if (alpha !== undefined && alpha >= 1) {
            offenders.push(
              `${palette.selector} 的 ${name}=${value}（终点 alpha=${alpha}，已预合成；` +
                `只有 on-primary 档能预合成）`,
            )
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('C2 判据脚本的自证模式仍通过（证明判据能分开「塌 / 不塌」两类样本）', () => {
    // scripts/state-layer-collapse-audit.mjs --verify 用**合成样本**证明判别力，
    // 刻意不绑定当前 tokens 的数值 —— #867 修完后 on-primary 档已不塌，
    // 拿它当塌陷侧锚点会「一修复就自证失败」（判据没错，是锚点选错了，已修正）。
    // 第三个合成样本直接验 #867 的修法本身（预合成不透明色）判为不塌。
    //
    // ⚠️ **不要把 --verify 的 ΔE 与设备取样当成互相印证**（本轮 review 抓出的陈述错误）：
    //    ΔE 是 **CIELAB ΔE76**（0~100 的感知差）。早先文档里配的设备量是 **HSV 饱和度**，
    //    两者单位不同，而 64.33 / 64.22 过于接近 —— 强提示当初是把**模型量误记成设备量**，
    //    那样「两种独立量化」就是循环论证。已整列改为 **RGB 三元组**：
    //    设备测「按下去变没变：(26,111,168) → (249,251,255)」，模型测「差多远：ΔE 64.33」，
    //    两条各自可复算（后者脚本实算，前者 = composite(#ffffff,0.12,#f8faff) 逐位命中）。
    //    ⇒ 判据：**数值相近不构成互证；派生量必须给复算公式。**
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/state-layer-collapse-audit.mjs', import.meta.url)), '--verify'],
      { encoding: 'utf8', timeout: REAL_SRC_TIMEOUT_MS },
    )
    expect(r.status, `判据脚本自证失败：\n${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('PASS')
  })

  it('C3 on-primary 状态层必须与 bg-primary 同元素（预合成值隐含假设了底色）', () => {
    // #867 的修法有代价：令牌值把 primary 混进去了，所以**用在别的底色上就会算错**。
    // 令牌名不带底色信息，只有消费点能保证这一点 —— 故按元素扫真实 src/。
    // ⚠️ 只认 `active:` 变体：Lynx 的 `hover-class` 不产生视觉切换（真机实证，见 #868），
    //    写在 hover-class 里的类名既不生效也不该算「消费方」。首版把 hover-class 里的
    //    死类名当成了合法消费方，导致这条在零消费方时**假绿**。
    //
    // ⚠️ 标签正则必须同时扛住**两种截断**（都是 review 抓出来的真实绕过面）：
    //   ① `<[a-z]` 只认小写标签 ⇒ 生产模板里 99 种 PascalCase 组件标签
    //      （`AppIcon` / `GlobalFab` / `SearchSheet` …）全部落在扫描面外。
    //      Vue 里组件根节点透传 class 是常规写法，写在 `<AppIcon class=…>` 上同样绕过。
    //   ② `[^>]*` 遇到属性值里的 `>` 即停 ⇒ `:class="animSeq > 0 && !reducedMotion ? …"`
    //      会把标签后半截（正是 class 所在处）切掉。本仓已有一处这种真实形态
    //      （`BookmarkButton.vue`），只是它今天不带 on-primary 而已。
    //   ⇒ 改用「标签名 + 引号感知的属性串」：`[^>"']` 逐字符吞，遇到成对引号整段吞。
    const violations: string[] = []
    const consumers: string[] = []
    for (const file of ALL_SRC_VUE) {
      // ⚠️ 先剥注释，与 C4/C6 同口径：本仓组件注释的既定习惯就是「解释为什么不能用它」，
      //   `tokens.css:91` 已这么写。不剥的话，一旦有人贴示例标签就会**假红**，
      //   而按本仓自己的教训（第一次红 → 加白名单 → 门禁作废），假红比漏报更贵。
      const src = stripComments(readFileSync(file, 'utf8'))
      const rel = file.split('/src/')[1]
      // 逐标签扫：含 active: 变体的元素，同一元素必须带精确的 bg-primary
      for (const m of src.matchAll(/<[A-Za-z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
        const tag = m[0]
        if (!/active:bg-layer-[\w-]+-on-primary/.test(tag)) continue
        consumers.push(rel)
        if (!/(?<![\w-])bg-primary(?![\w-])/.test(tag)) {
          violations.push(`${rel}：on-primary 状态层元素缺 bg-primary 底色（预合成值会算错）`)
        }
      }
    }
    // 非空下界：0 个消费方也可能是「扫描面失效」而非「还没人用」，两者在本断言上同形。
    expect(consumers.length, 'on-primary 状态层消费点为 0：扫描面可能已失效').toBeGreaterThan(0)
    // 扫描面自身有效的第二道确认（只写下界不够：walker 被加目录过滤时数量仍可能够大）。
    expect(
      consumers.some((r) => r.startsWith('components/')),
      '消费点全在 components/ 之外：标签正则可能又退化了',
    ).toBe(true)
    expect(violations).toEqual([])
  })

  it('C4 hover-class 里不得出现状态层类名（#868：真机实证该机制不切换视觉状态）', () => {
    // 引擎层事实：Lynx 的 `hover-class` 不产生视觉切换 —— 5 个色块按住期间全部零变化，
    // 连写死不透明色的阳性对照都不变；而同一次长按确实触发了 @tap（对照块逐次 toggle），
    // 证明注入链路正常。改用 Tailwind `active:` 变体后全部按预期变色。
    // 失败方式是**静默无反馈**，比不写更危险（会让人以为按压反馈已处理）。
    // 存量已有一个拼错的死类名 `bg-layer-hovered-on-primary`（config 只注册了 `layer-hover-`），
    // 本条一并把它钉住。
    // ⚠️ 首版只判「hover-class 的**值**里含 bg-layer-」，覆盖面小于 ADR-0207 决策 9 的
    //    「禁写 hover-class」—— 写 `hover-class="bg-error"` 即可逃逸，而该属性在 Lynx 上
    //    同样不产生视觉切换（仍是死路径）。故收窄为「`.vue` 里不得出现 hover-class 绑定」。
    // 非空下界：walker 整目录落空时 offenders 恒为 []，与「零违规」在本断言上**完全同形**。
    // （同族教训见 agent memory：目录过滤型抽取器空转 ⇒ `toEqual([])` 恒绿。）
    expect(ALL_SRC_VUE.length, '.vue 扫描面为 0：walker 已失效，本条恒绿').toBeGreaterThanOrEqual(50)
    expect(
      ALL_SRC_VUE.some((f) => f.includes('/components/')),
      '扫描面不含 components/：覆盖可能已失效',
    ).toBe(true)
    const offenders: string[] = []
    for (const file of ALL_SRC_VUE) {
      const src = readFileSync(file, 'utf8')
      const rel = file.split('/src/')[1]
      // 覆盖静态 class= 与动态 :class= 两种绑定；注释里的提及不算（先剥注释）
      const code = stripComments(src)
      for (const m of code.matchAll(/(?<![\w-]):?hover-class\s*=/g)) {
        offenders.push(`${rel}：出现 hover-class 绑定（${m[0].trim()}）—— 该机制在 Lynx 上是死路径`)
      }
      if (/bg-layer-hovered-/.test(code)) {
        offenders.push(`${rel}：出现 bg-layer-hovered-* 死拼写（config 只有 layer-hover-）`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('C5 判据脚本对**当前 tokens** 实跑：全量条目无缺口、0 条会塌（把 ADR 判据 6 变成机器门禁）', () => {
    // 为什么必须有这条：C2 只验判据**有分离能力**（合成样本），它对任何令牌改动都恒绿 ——
    // 早先 review 指出「ADR 决策 8 写『修复后重跑判据 0 条会塌』，但没有任何机器门禁钉它」。
    // 本条消费 `--json`，把那句话变成可执行事实。
    // ⚠️ 阈值取脚本自报的 `data.threshold`，**不硬编码 25** —— 阈值若被复审调整，
    //    这里自动跟随，不产生第二处需要同步的魔数。
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/state-layer-collapse-audit.mjs', import.meta.url)), '--json'],
      { encoding: 'utf8', timeout: REAL_SRC_TIMEOUT_MS },
    )
    expect(r.status, `判据脚本实跑失败：\n${r.stderr}`).toBe(0)
    const data = JSON.parse(r.stdout) as { threshold: number; rows: Array<{ role: string; state: string; deltaE: number; alpha: number }> }

    // 证据面自检：条目数必须等于「色板数 × role 数 × 态数」。
    // 早先脚本静默丢 24 行时全称断言名不副实（256 ≠ 280），靠的就是这一层。
    //
    // ⚠️ 三个因子都取自**本文件自己的独立抽取器**，不是抄脚本的常量：
    //   · `PALETTES.length`  = 14  ← B1 用另一个解析器（`paletteBlocks`）数出来的
    //   · `ALPHA_ROLES.length + 1` = 5 ← 本文件自己的 role 清单（4 + on-primary）
    //   · `STATES.length`    = 4  ← material-web 官方四态
    // 这样「扫描面完整」这件事有一个**与被测脚本无关**的证据源；直接写死 280
    // 会在加色板后变成一具需要人工同步的魔数，写成 `脚本的 role 数` 则是自我印证。
    // 报错文案要覆盖**两个方向**（只写"不足"是半个真相）：新增色板会得到 308 > 280，
    // 那不是缺陷而是色板加了，文案若仍说"不足"，下一个人会照错方向排查。
    const EXPECTED_ROWS = PALETTES.length * (ALPHA_ROLES.length + 1) * STATES.length
    expect(
      data.rows.length,
      `判据条目数 = ${data.rows.length}，独立推算的理论值 = ${EXPECTED_ROWS}` +
        `（${PALETTES.length} 色板 × ${ALPHA_ROLES.length + 1} role × ${STATES.length} 态）。\n` +
        `· 偏**少** ⇒ 脚本的解析或 CSS 继承链又丢了行（禁静默降级），查它报的 skipped 计数\n` +
        `· 偏**多** ⇒ tokens.css 新增了色板，属**预期变化**：请同步本期望值与 C6/B1 的对应断言`,
    ).toBe(EXPECTED_ROWS)

    // 事实门禁：当前令牌表里 0 条会塌。
    const collapsed = data.rows.filter((x) => x.deltaE > data.threshold)
    expect(
      collapsed.map((x) => `${x.role}/${x.state} ΔE=${x.deltaE}`),
      `#867 修完后应 0 条会塌；出现塌陷条目说明状态层又被改回了塌陷形态。` +
        `另注：这是**事实断言**，判别力由 C2 的 --verify 承担，两者分工不同不要合并。`,
    ).toEqual([])

    // 证明这份 JSON 真的来自**当前 tokens.css**（而非空表 / 缓存）：on-primary 档
    // 修完是预合成的 6 位 hex ⇒ 终点 alpha = 1。C1 钉「其余 4 档保持 alpha」，
    // 两者合起来才能排除「脚本读了旧文件」。
    const onPrimary = data.rows.filter((x) => x.role === ON_PRIMARY)
    // 56 = 色板数 × 态数，同样取自独立抽取器，不写死魔数
    expect(
      onPrimary.length,
      `on-primary 档实测 ${onPrimary.length} 条，独立推算应为 ${PALETTES.length * STATES.length} 条` +
        `（${PALETTES.length} 色板 × ${STATES.length} 态）。不符 ⇒ 脚本漏扫了该 role。`,
    ).toBe(PALETTES.length * STATES.length)
    expect(
      onPrimary.every((x) => x.alpha === 1),
      'on-primary 档未预合成（终点 alpha≠1）：#867 修复疑似被回退',
    ).toBe(true)
  })

  it('C6 C3 看不见的类名构造面由机器钉住：.ts 全文 / .vue 的 <script> 块都不得造 on-primary 状态层类名', () => {
    // C3（on-primary 必须与 bg-primary 同元素）按**元素**扫 `src/**/*.vue` 的模板。
    // 它有**两个**结构性盲区，都不是"扫描面收窄"能补的，只能由本条从构造侧堵：
    //
    //   盲区 ① **`.ts` 全文**：类名在脚本里拼好、模板只写 `:class="cls"`，
    //          元素上根本没有字面类名 ⇒ C3 看不见。
    //   盲区 ② **`.vue` 自己的 `<script>` 块**（review 抓出来的**交集漏洞**）：
    //          `.vue` 既能藏字面类名（模板绑定）又能藏拼接类名（script），
    //          而 C3 只看模板、C6 v1 只看 `*.ts` —— **同一个文件类型是两条门禁的
    //          共同盲区**。v1 的注释宣称"堵住了 C3 的缺口"，实际只堵了一半。
    //
    // 扫描口径与 C4 对齐：**先剥注释**。本仓组件注释必须解释"为什么不能用它"
    // （`tokens.css:91` 已经这么写了），扫全文会让门禁第一次红 → 人加白名单 → 门禁作废。
    //
    // 两种形态都要抓：
    //   · 连续：`'active:bg-layer-pressed-on-primary'`
    //   · 拼接：`'bg-layer-' + 'pressed-' + 'on-primary'` —— 正则打不中，靠
    //     「同一 script 块内同时出现 `bg-layer-` 与 `on-primary`」兜住。
    //     该启发式在真实树上**零误报**（`M3SegmentedButton.vue` 的 script 里有
    //     `active:bg-layer-pressed-on-surface` 但没有 `on-primary` ⇒ 不触发）。
    // ⚠️ 已知的、**不再声称覆盖**的边界：`['bg','layer','pressed','on','primary'].join('-')`
    //    这类彻底拆散字面量的写法两条门禁都挡不住。静态门禁的固有边界，如实登记
    //    而不是假装堵上。
        const MSG =
      '在 C3 的扫描面之外造了 on-primary 状态层类名 —— 决策 8 的「必须与 bg-primary 同元素」' +
      '约束会被绕过且无报警。请改在 .vue 模板的 class 属性里写，让 C3 能按元素判定底色。'

    const root = fileURLToPath(new URL('../src/', import.meta.url))
    const tsFiles: string[] = []
    const vueFiles: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) tsFiles.push(p)
        else if (e.name.endsWith('.vue') && !e.name.endsWith('.test.vue')) vueFiles.push(p)
      }
    }
    walk(root)
    // 非空下界：walker 空转时下面恒绿（同族教训，见文件头 A1 的同类修复）。
    // 取值按**当前真实规模**留足余量（实测 154 个非测试 .ts / 76 个非测试 .vue）。
    expect(tsFiles.length, '.ts 扫描面过小：walker 可能已失效').toBeGreaterThanOrEqual(100)
    expect(vueFiles.length, '.vue 扫描面过小：walker 可能已失效').toBeGreaterThanOrEqual(50)
    // 目录锚点：只写数量不够 —— 有人加一层目录过滤时数量仍可能够大。
    expect(tsFiles.some((f) => f.includes('/utils/')), '.ts 扫描面不含 utils/：覆盖可能已失效').toBe(true)

    const offenders: string[] = []
    // ⚠️ 两条路径必须用**同一个** classify —— 早先 `.ts` 分支只跑 CONTIG、
    //    拼接启发式只挂在 `.vue` 上，而 `.ts` 恰恰是 C3 的盲区①（最可能用拼接）。
    //    那版的自检又用一个合并的 `caught()` 去断言，于是**对 `.ts` 路径根本没走到
    //    真实逻辑却显示通过** —— 判别力自检本身给了假保障。
    //    ⇒ 现在两条路径共用 classify()，自检也直接调用它，覆盖面与实现不再可能分叉。
    for (const f of tsFiles) {
      const why = classifyC6(stripComments(readFileSync(f, 'utf8')))
      if (why) offenders.push(`${f.split('/src/')[1]}（.ts 全文，${why}）`)
    }
    for (const f of vueFiles) {
      const code = stripComments(readFileSync(f, 'utf8'))
      for (const block of code.match(/<script[\s\S]*?<\/script>/g) ?? []) {
        const why = classifyC6(block)
        if (why) offenders.push(`${f.split('/src/')[1]}（<script> 块，${why}）`)
      }
    }
    expect(offenders, MSG).toEqual([])
  })

  it('C6 判别力自检：连续 / 拼接两种绕过形态都真的会被 classify 抓住', () => {
    // 阳性对照。没有它，上面那条可能因为正则写错而**恒绿**，
    // 而"0 违规"与"判据压根没在工作"在 `toEqual([])` 上完全同形。
    // ⚠️ 这里必须断言**真实实现用的那个函数**，不能另写一个等价的组合函数 ——
    //    上一版就是这么干的，结果 `.ts` 路径的缺口被自检掩盖成"已覆盖"。
    const CONTIG = /(?:^|[^\w-])bg-layer-[\w-]+-on-primary/
    // ⚠️ 下面每一处都调用 describe 作用域里那个 classifyC6 —— 与扫描用的是同一份。

    // 阳性：连续写法
    expect(classifyC6(`const a = 'active:bg-layer-pressed-on-primary'`)).toBe('连续写法')
    // 阳性：拼接写法 —— 连续正则**打不中**（证明是靠双提示兜住的，不是巧合）
    const joined = `const a = 'bg-layer-' + 'pressed-' + 'on-primary'`
    expect(CONTIG.test(joined), '拼接样本竟然被连续正则命中 ⇒ 该用例失去鉴别力').toBe(false)
    expect(classifyC6(joined)).toBe('拼接写法')
    // 阳性：跨行拼接
    expect(classifyC6(`const a = 'bg-layer-' +\n  'pressed-' +\n  'on-primary'`)).toBe('拼接写法')
    // 阳性：模板字符串插值
    expect(classifyC6('const a = `bg-layer-${state}-on-primary`')).toBe('拼接写法')
    // 阴性对照：另一个 role 合法存在，不得误伤（这是 M3SegmentedButton.vue 的真实形态）
    expect(classifyC6(`const base = '... active:bg-layer-pressed-on-surface'`)).toBeNull()
    // 阴性对照：只提到 --md-on-primary 令牌，不是状态层类名
    expect(classifyC6(`const t = getVar('--md-on-primary')`)).toBeNull()
  })
})

