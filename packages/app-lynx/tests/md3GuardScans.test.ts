// ─── MD3 形态回流门禁（T15 / issue #863）───
//
// 与 `md3ConfigTokens.test.ts` 的分工（**不重叠**）：
//   md3ConfigTokens = 「配置与令牌表里的**取值**是不是官方值」（tailwind.config.ts + tokens.css 两文件）
//   本文件            = 「`.vue` 消费层**有没有把违规形态写回来**」（src/** 全量源码扫描）
// 后者判据是**文本形态**而不是数值，所以不能用构建产物接缝（helper 那边已注明理由）。
//
// ── 本文件的四条设计纪律（每条都对应一次已被本仓抓到过的假绿）───
//
// 1. **每条规则至少认两种书写形态**（issue #863 的核心要求）。
//    上一轮的门只认 `["run","name"]` 数组字面量，把同一调用改成字符串拼接后全绿 ——
//    单形态门禁 = fail-open。本文件每条规则的 `it('反事实')` 都喂**两种**换皮形态，
//    两种都必须转红。举例：
//      · 缓动：包裹式 `cubic-bezier(0.4,0,0.2,1)` **与** 裸值式
//        `transition-timing-function: 0.4, 0, 0.2, 1`（CSS 允许省略函数名）
//      · 圆角：任意值式 `rounded-[0.65vw]` **与** 方向类挂非档位后缀 `rounded-t-2xl`
//      · 旧色别名：`var(--colorX)` / Tailwind 任意值类 `text-[var(--colorX)]` /
//        字符串键 `'--colorX'`
//
// 2. **抽取器集合非空 + 数量下界**（`mdTokenRefs.test.ts` 同款，见该文件头注）。
//    全称断言最常见的假绿是「正则失效 ⇒ 抽取到空集合 ⇒ 空集合没有违规 ⇒ 全绿」。
//    每条规则都有一道 `it('抽取器自身有效')`：对**构造正样本**断言命中非空且 ≥ 下界；
//    对**真实仓库**额外断言「当前存量命中数 ≥ 下界」（存量被清零时这条会提示更新下界，
//    而不是让全称断言无声变成空断言）。下界写死在测试里，不从当前值反推。
//
// 3. **白名单结构化 + 逐条带理由 + 只放行「文件 × 具体形态」三元组**。
//    沿用既有 `hardcode-whitelist*.json` 的 JSON 惯例，但升级为 `(rule, path, form)` 精确匹配：
//    同文件里换一种形态不豁免，换个文件用同一形态也不豁免。
//    每条 `reason` 必填且不得是纯占位（见 `白名单自身纪律` 用例）。
//    ⛔ **生成产物也不例外：豁免只到「单份形态」为止。**
//    `Rule.exempt`（整文件）只留给「该文件按定义必须出现该形态」的定义现场
//    （tokens.css 的 22 条旧色别名就是这种：删掉就断掉消费面）。
//    规则 8 的 icon-font.css 走 `allowOnce`（**只吃第 1 个** @font-face），第 2 个照常判红 ——
//    整文件豁免会让「往产物里再塞一份坏 @font-face」隐形（反事实已实跑：命中恒为 0），
//    而那正是规则 8 存在的理由（相对 `url()` ⇒ 图标豆腐块 ⊠）。
//
// 4. **反事实常驻、不落盘**：把违规形态塞回去确认转红，全部通过「向抽取器传构造字符串」实现，
//    本文件不写磁盘、不改任何生产文件 —— 门禁的改动权只有测试与白名单两份。
//
// ── Oracle 纪律（禁自证）───
// 期望值全部来自**独立来源**，不抄当前产物：
//   · MD2 legacy 曲线 = material-web v0.192 `_md-sys-motion.scss` 的 `easing-legacy`
//   · 6 档 M3 shape 档位名 = tailwind.config.ts `theme.borderRadius`（ADR-0207 决策 1）
//   · 15 档排版档位名 = ADR-0206 决策 1 的官方表
//   · 状态层四态 opacity = material-web v0.192 `_md-sys-state.scss`
// 唯一「抄当前值」的地方是**档位名清单本身**（`RADIUS_TIERS` / `TYPE_TIERS`）：
// 门禁要回答的是「你用的名字在不在档位表里」，抄名字不构成自证 —— 值仍由
// `md3ConfigTokens.test.ts` 独立核对官方数值。
//
// ── 已知的判定口径分歧（有意为之，勿当 bug 修）───
// ⚠️ 任务书写「`rounded-t-lg` 会被解析成独立类、产不出声明 ⇒ 死类名」，**实测不成立**：
//   Tailwind 3.4.19 对 `rounded-t-lg` 产出
//   `.rounded-t-lg { border-top-left-radius: var(--md-shape-large); … }`
//   （`lg` 是已登记档位）。真正产不出声明的是**未登记后缀**：`rounded-t-md` /
//   `rounded-t-2xl` / `rounded-t-3xl` 三个探针在产物里**完全不存在**。
//   故本门禁按实测口径实现：**方向类 + 非档位后缀**才判红，档位后缀（lg/sm/xs/xl/full）放行。
//
// ── 扫描口径的三个刻意取舍（review 要核的就是这三条）───
// ① 规则 4 只扫 `src/**`，不扫 `tailwind.config.ts`：那 4 条 `var(--md-state-pressed-*)`
//    是**预计算实色到 Tailwind 颜色档位的映射表本体**（pressed-primary / pressed-on-surface /
//    pressed-error / pressed-surface），删掉就断掉 24 处 `bg-state-pressed-*`
//    存量；tokens.css 自己也写明「保留它的唯一理由是 Lynx 伪类受限时的兜底」。
//    ⚠️ 数字以实跑为准（原文写的「6 条」是漂移，实测 4）：grep -c 'var(--md-state-pressed-' \
//       tailwind.config.ts → 4；24 处消费面 grep -ro 'bg-state-pressed-[a-z]*' src --include='*.vue' → 24。
// ② 规则 4 只判 `var()` 消费，**不判 Tailwind 类名**：`md3ConfigTokens.test.ts` 已把
//    `bg-state-pressed-*` 写成「存量写法不回归」的断言，本门禁若也判红，两道门禁互相矛盾。
// ③ 规则 7 只扫 `.vue` 的 `<template>` 区：`.ts` 里的 `utils/iconMap.ts` / `navTabs.ts`
//    是 ADR-0208 决策 2 的**名称↔码点映射源**本身，不是裸字形消费；i18n 词条里的
//    `→` 之类是文案不是图标。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// ═══════════════════════════ 路径与文件收集 ═══════════════════════════

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(PKG, 'src')
const TAILWIND_CONFIG = join(PKG, 'tailwind.config.ts')
/** tokens.css 是 `--color*` 旧别名的**定义现场**（兼容层必须存在），故单独豁免 */
const TOKENS_CSS_REL = 'src/styles/tokens.css'
/** icon-font.css 是 `generate-icon-subset.py` 的产物（全站唯一一份全局 @font-face） */
const ICON_FONT_CSS_REL = 'src/styles/icon-font.css'

interface ScannedFile {
  /** 相对包根、posix 分隔 —— 白名单里写的就是这个 */
  readonly rel: string
  readonly abs: string
  readonly text: string
}

/**
 * 收集被扫描的文件。
 * 排除 `*.test.ts` / `*.spec.ts`：**负向断言必须把坏字面量写在测试里**，
 * 把测试文件纳入扫描会让每道门禁自证红（mdTokenRefs.test.ts 同款取舍）。
 */
function collectFiles(): ScannedFile[] {
  const out: ScannedFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) {
        walk(abs)
        continue
      }
      if (!/\.(vue|ts|css)$/.test(entry)) continue
      if (/\.(test|spec)\.ts$/.test(entry)) continue
      out.push({ rel: relative(PKG, abs).split('\\').join('/'), abs, text: readFileSync(abs, 'utf8') })
    }
  }
  walk(SRC)
  const cfgText = readFileSync(TAILWIND_CONFIG, 'utf8')
  out.push({ rel: 'tailwind.config.ts', abs: TAILWIND_CONFIG, text: cfgText })
  return out
}

const FILES = collectFiles()
const VUE_FILES = FILES.filter((f) => f.rel.endsWith('.vue'))

// ═══════════════════════════ 注释剥离 ═══════════════════════════

/**
 * 剥注释。**刻意不剥 `//` 行注释的通用形态** —— `.vue` 模板里的 `https://` 会把它当注释起点，
 * 整行连模板一起吃掉（这正是 md3ConfigTokens 只在 `.ts` 上剥行注释的原因）。
 * 这里的口径：CSS 块注释与 HTML 注释全局剥；`//` 只在 `.ts` 整篇与 `.vue` 的 `<script>` 块内剥
 * （后者那里 `://` 不会出现）。
 */
function stripComments(source: string, isVue = false): string {
  const lineComments = /^\s*\/\/.*$/gm
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  if (!isVue) return withoutBlocks.replace(lineComments, '')
  return withoutBlocks.replace(
    /(<script[^>]*>)([\s\S]*?)(<\/script>)/g,
    (_all, open: string, body: string, close: string) => open + body.replace(lineComments, '') + close,
  )
}

const CLEAN = new Map(
  FILES.map((f) => [f.rel, stripComments(f.text, f.rel.endsWith('.vue')) as string]),
)

/**
 * 把命中区间替换成**等长空白**（保留换行与总长度）—— 与 `renderedRegions` 里
 * `s.replace(...)` 掩码插值/标签是同一手法。
 */
function maskRanges(source: string, re: RegExp): string {
  return source.replace(re, (s) => s.replace(/[^\n]/g, ' '))
}

/**
 * 只取 `<template>` 区的**渲染面**，但**用掩码而不是删除**。
 *
 * ⚠️ 为什么不能删：删掉 `<script>` / `<style>` 整块后，后面每个字符的偏移都变了，
 * `lineOf` 报出的行号就相对「被剥过的文本」——而本仓 SFC 约定是 `<script setup>` 在前
 * （`EmptyState.vue` 等皆如此），于是**文本节点的行号系统性偏小**（反事实已实跑：
 * 真实第 9 行报成第 5 行）。属性区 region 之所以正确，是因为它的 `index` 仍是真偏移
 * 且属性通常落在剥完仍对齐的位置 —— 这种「一半对一半错」比全错更难查。
 * 掩码保住了总长度与换行 ⇒ `lineOf` 的参照系就是**原文件**。
 * 掩码与删除的**检出集合完全相同**（注释/脚本/样式区两侧都不含字形），
 * 只修行号，不改判红判绿。
 */
function templateOf(source: string): string {
  return maskRanges(
    source,
    /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g,
  )
}

/** 文件第 n 行（1 起）—— 违规报告要能直接点过去 */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

// ═══════════════════════════ 违规数据结构 ═══════════════════════════

/** 一条违规。`form` 是**被命中的具体形态**，与白名单三元组里的 form 逐字相等 */
interface Violation {
  readonly rule: string
  readonly path: string
  readonly line: number
  readonly form: string
}

const fmt = (v: Violation): string => `${v.rule}｜${v.path}:${v.line}｜${v.form}`

// ═══════════════════════════ 白名单 ═══════════════════════════

interface WhitelistEntry {
  /** 规则 id（见 RULE_IDS） */
  readonly rule: string
  /** 相对包根的路径 */
  readonly path: string
  /** 被放行的具体形态（逐字匹配） */
  readonly form: string
  readonly reason: string
}

interface WhitelistFile {
  readonly entries: readonly WhitelistEntry[]
}

const WHITELIST: WhitelistFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('./md3-guard-whitelist.json', import.meta.url)), 'utf8'),
) as WhitelistFile

const whitelisted = new Set(WHITELIST.entries.map((e) => `${e.rule}\u0000${e.path}\u0000${e.form}`))
const isWhitelisted = (v: Violation): boolean => whitelisted.has(`${v.rule}\u0000${v.path}\u0000${v.form}`)

// ═══════════════════════════ 规则 1：MD2 legacy 缓动 ═══════════════════════════

/**
 * material-web v0.192 `_md-sys-motion.scss`：`easing-legacy: cubic-bezier(0.4, 0, 0.2, 1)`。
 * ⚠️ 官方事实提醒（差距分析 §8.1 记过一次误判，方向是反的）：`easing-standard` 与
 * `easing-emphasized` **同值 (0.2, 0, 0, 1)**，(0.4,0,0.2,1) 才是 MD2 遗留。
 */
const LEGACY_EASING = '.4,0,.2,1'
/** 一段「四个逗号分隔的数」的最小形态 —— 缓动函数值的骨架 */
const FOUR_NUMBERS = '-?\\d*\\.?\\d+(?:\\s*,\\s*-?\\d*\\.?\\d+){3}'
/**
 * 两种书写形态合并成一个候选正则：
 *   A 包裹式 `cubic-bezier(0.4, 0, 0.2, 1)`
 *   B 裸值式 `0.4, 0, 0.2, 1`（CSS 允许省略 cubic-bezier 函数名，常见于
 *     `transition-timing-function:` / `animation-timing-function:` 的简写）
 * 再加空白与前导 0 的换皮（`.4,0,.2,1` / `0.4 , 0 , 0.2 , 1`）由归一化吸收。
 */
const EASING_CANDIDATE = new RegExp(
  `cubic-bezier\\s*\\(\\s*(${FOUR_NUMBERS})\\s*\\)|(${FOUR_NUMBERS})`,
  'gi',
)

/** 去掉函数名包裹、全部空白、前导 0 —— 让各种换皮写法归一到同一个字符串 */
function normalizeEasing(value: string): string {
  return value
    .replace(/cubic-bezier\s*\(/gi, '')
    .replace(/\)/g, '')
    .replace(/\s+/g, '')
    .replace(/(^|[.,])0+\./g, '$1.')
}

function isLegacyEasing(value: string): boolean {
  return normalizeEasing(value) === LEGACY_EASING
}

/** tokens.css 里允许存在 legacy 取值，但**必须带 legacy 标记注释**（否则后人会当成官方曲线） */
const LEGACY_MARKER = /\blegacy\b|MD2/i

function scanLegacyEasing(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(EASING_CANDIDATE)) {
    const raw = m[0]
    if (!isLegacyEasing(raw)) continue
    out.push({ rule: 'legacy-easing', path, line: lineOf(text, m.index ?? 0), form: raw })
  }
  return out
}

/**
 * tokens.css 侧的「允许但须留痕」：每个声明了 legacy 取值的自定义属性，声明行必须带 legacy 标记。
 * 形态 ① 无标记 ② 行尾 `/* … legacy … *\/` 标记。
 */
function scanTokensLegacyMarker(text: string): Violation[] {
  const out: Violation[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const m = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/.exec(line)
    if (!m || !isLegacyEasing(m[2]!)) return
    if (LEGACY_MARKER.test(line)) return
    out.push({
      rule: 'legacy-easing-tokens-marker',
      path: TOKENS_CSS_REL,
      line: i + 1,
      form: m[0]!,
    })
  })
  return out
}

// ═══════════════════════════ 规则 2：未接令牌的圆角消费 ═══════════════════════════

/** tailwind.config.ts `theme.borderRadius` 的 6 档 + none（ADR-0207 决策 1） */
const RADIUS_TIERS = new Set(['none', 'xs', 'sm', 'lg', 'xl', 'full'])
const RADIUS_DIRECTIONS = ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']

/**
 * 合法任意值 = **整档指向 M3 shape scale 的 6 个令牌之一**。
 * 用闭集而不是 `--md-shape-[a-z-]+` 通配：`rounded-[var(--md-shape-largish)]`
 * 这种**令牌名拼错**的形态会被通配放行，而它与 `rounded-[0.65vw]` 是同一类缺陷
 * （渲染出一个不受 shape scale 保护的圆角）。shape scale 只有 6 档是 ADR-0207 决策 1 的
 * 明确口径，新增档位时这条闭集与 tailwind.config.ts 一起改，不会漏。
 */
const SHAPE_TOKENS = new Set([
  '--md-shape-extra-small',
  '--md-shape-small',
  '--md-shape-medium',
  '--md-shape-large',
  '--md-shape-extra-large',
  '--md-shape-full',
])

/** 形态 A：任意值圆角。合法值**只允许**整档指向 `--md-shape-*` 令牌 */
const RADIUS_ARBITRARY = /rounded-(\[[^\]]*\])/g
/** 形态 B：方向类 + 后缀。裸方向类（`rounded-t`）合法（取 DEFAULT = medium）；
 *  带**非档位**后缀（`rounded-t-md` / `rounded-t-2xl`）才判红 —— 那三个后缀未登记，
 *  Tailwind 3.4.19 对它们**不产出任何规则**（死类名，静默无圆角）。 */
const RADIUS_DIRECTION_SUFFIX = new RegExp(`\\brounded-(?:${RADIUS_DIRECTIONS.join('|')})-([a-z0-9]+)`, 'g')

function scanRadiusOffToken(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(RADIUS_ARBITRARY)) {
    const value = m[1]!.slice(1, -1).trim()
    const ref = /^var\((--md-shape-[a-z-]+)\)$/.exec(value)
    if (ref !== null && SHAPE_TOKENS.has(ref[1]!)) continue
    out.push({ rule: 'radius-offtoken', path, line: lineOf(text, m.index ?? 0), form: m[0]! })
  }
  for (const m of text.matchAll(RADIUS_DIRECTION_SUFFIX)) {
    if (RADIUS_TIERS.has(m[1]!)) continue
    out.push({ rule: 'radius-offtoken', path, line: lineOf(text, m.index ?? 0), form: m[0]! })
  }
  return out
}

// ═══════════════════════════ 规则 3：正文类内容上的自选行高 ═══════════════════════════

/** ADR-0206 决策 1 的 15 档语义名 + 决策 4 的 10 个旧别名（后者同样自带四元组行高） */
const TYPE_TIER = '(?:display|headline|title|body|label)-(?:large|medium|small)'
const LEGACY_SIZE_ALIAS = '(?:xs|sm|base|lg|xl|[2-6]xl)'
/** 尺寸类：语义档位 / 旧别名 / 任意值（`text-[6.4vw]` 图标字形）。`(?![\w-])` 不能写成 `\b` ——
 *  任意值以 `]` 收尾，`]` 后没有词字符，词界不成立 ⇒ 那条断言恒绿（helper 里同一个教训）。 */
const SIZE_CLASS = new RegExp(`\\btext-(?:${TYPE_TIER}|${LEGACY_SIZE_ALIAS}|\\[[^\\]]*\\])(?![\\w-])`)
const LEADING_CLASS = /\bleading-([a-z]+|\[[^\]]*\])/

/**
 * 引号字符串字面量（模板属性值 + script 里的类名字符串）。
 *
 * ⚠️ **反引号必须算进来**：同包的 `iconConsumption.test.ts:64` 已把反引号并入引号集合
 * （`QUOTE = "'\" + \``），两套口径不一致本身就是可核的缺陷；而 `<script setup>` 里
 * 用模板字符串拼类名是本仓**在用的**写法（`SearchSheet.vue:134`：
 * `` return `h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center ${tone}…` ``），
 * 只认双引号/单引号 ⇒ 模板字符串里的类名对规则 3 完全隐形。
 * 实测当前 `src/**` 的单行反引号字面量里**还没有** size+leading 同现的违规（脚本逐个枚举过，
 * 0 条），所以补反引号不会让全称断言转红 —— 这是**为下一次回流**上的闸，不是已存在的存量 bug。
 */
function quotedLiterals(text: string): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = []
  const re = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g
  for (const m of text.matchAll(re)) {
    out.push({ value: m[1] ?? m[2] ?? m[3] ?? '', index: m.index ?? 0 })
  }
  return out
}

/**
 * 同一「类名串」里同时出现尺寸类与自选行高 ⇒ 判红。
 * ⚠️ `leading-none` 也在判红范围内：它同样覆盖了档位自带的 line-height
 *（ADR-0206 决策 1「行高已由档位决定」）。图标字形那 45 处是**刻意用法**
 *（`text-[6.4vw]` 这种任意尺寸没有档位行高可继承），逐条进白名单并写明理由。
 */
function scanSelfChosenLeading(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const lit of quotedLiterals(text)) {
    const size = SIZE_CLASS.exec(lit.value)
    const leading = LEADING_CLASS.exec(lit.value)
    if (!size || !leading) continue
    out.push({
      rule: 'self-chosen-leading',
      path,
      line: lineOf(text, lit.index),
      form: `${size[0]} + ${leading[0]}`,
    })
  }
  return out
}

// ═══════════════════════════ 规则 4：状态层改用预计算实色 ═══════════════════════════

/**
 * 消费口径 = `var()` 取到预计算实色令牌（`--md-state-pressed-*` / `--md-state-disabled-*`）。
 * ⚠️ **只判 `var()` 消费**是有意的：Tailwind 类名侧（`bg-state-pressed-*`，24 处在用）
 * 由 tokens.css 自述的「Lynx 伪类受限时的兜底」保留，`md3ConfigTokens.test.ts` 已把
 * 「存量写法不回归」写成断言 —— 这里若也判红，两道门禁会互相矛盾。
 * 形态 ① 内联/`<style>` 的 CSS 值 ② Tailwind 任意值类 `bg-[var(--md-state-pressed-x)]`
 * ③ 带空白与 fallback 的 `var( --md-state-disabled-container, #eee )`。
 */
const SOLID_STATE_VAR = /var\(\s*--md-state-(?:pressed|disabled)-[a-z-]+\s*[,)]/g

function scanSolidStateLayer(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(SOLID_STATE_VAR)) {
    out.push({ rule: 'solid-state-color', path, line: lineOf(text, m.index ?? 0), form: m[0] })
  }
  return out
}

// ═══════════════════════════ 规则 5：新增旧 Fluent 语义别名 ═══════════════════════════

/** tokens.css 里的 22 条 `--color*` 兼容别名（存量只读层）。消费面一律判红。
 *  形态 ① `var(--colorOverlayForeground)` ② Tailwind 任意值类
 *  `text-[var(--colorOverlayForeground)]` ③ 字符串键 `'--colorBrandBackground'`。 */
const LEGACY_COLOR_ALIAS = /(?<![\w-])--color[A-Z][A-Za-z0-9]*/g

function scanLegacyColorAlias(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(LEGACY_COLOR_ALIAS)) {
    out.push({ rule: 'legacy-color-alias', path, line: lineOf(text, m.index ?? 0), form: m[0] })
  }
  return out
}

// ═══════════════════════════ 规则 6：裸 :focus ═══════════════════════════

/**
 * 形态 ① CSS 伪类 `:focus` 与 `:focus-visible`
 * ② Tailwind 变体类 `focus:` 与 `focus-visible:`
 *
 * ⚠️ `focus-visible` **一并拦**，不是放行。依据 ADR-0207 决策 5（真机实证后重写）：
 * 结论 1「`:focus` 与 `:focus-visible` **不写**。写出来只是死类名、**静默无样式**」。
 * 探针 B 实测 `focus-visible:bg-primary` 点按 `<input>` RGB 恒定无变化；
 * 结论 2 另给出独立理由——`:focus-visible` 语义是「焦点由键盘/D-pad 抵达」，
 * 本应用纯触屏，**无触发源**。无障碍关键路径改由 `accessibility-element` +
 * TalkBack 平台焦点环承担（结论 3），不需要 CSS 伪类。
 *
 * 本判据**曾**只拦裸 `:focus`、并有一条用例显式断言 `focus-visible` 不转红，
 * 注释还引着 ADR-0207 的号却复述被它推翻的旧措辞。那等于门禁替封闭清单第 5 条
 * 开了一个反向口子：作者读到「门禁放行 + 注释称无障碍关键路径」就会去写死类名。
 * **引了权威来源不等于读过来源** —— 判据与被引文档必须逐句对得上。
 *
 * ⚠️ 尾边界 `(?![\w-])` 挡的是「标识符续写」，而**合法的伪类续写**也以 `-` 开头：
 * 收紧成 `:focus(?:-visible)?(?![\w-])` 时，`-` 被一起挡掉 ⇒ `:focus-within` /
 * `focus-within:`（Tailwind 的**真变体**，不是臆想）整体放行 = 新的 fail-open 缺口。
 * 因此续写必须**逐个列出**：`(?:-visible|-within)?`。
 * 残留（有意披露，不假装覆盖）：将来若再出现 `:focus-<其它>` 变体，这里仍会放行 ——
 * 锁不住的就明说，别让后人以为「凡 focus 开头都拦得住」。
 */
const BARE_FOCUS_SELECTOR = /:focus(?:-visible|-within)?(?![\w-])/g
const BARE_FOCUS_VARIANT = /(?<![\w-])focus(?:-visible|-within)?:/g

function scanBareFocus(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(BARE_FOCUS_SELECTOR)) {
    out.push({ rule: 'bare-focus', path, line: lineOf(text, m.index ?? 0), form: m[0] })
  }
  for (const m of text.matchAll(BARE_FOCUS_VARIANT)) {
    out.push({ rule: 'bare-focus', path, line: lineOf(text, m.index ?? 0), form: m[0] })
  }
  return out
}

// ═══════════════════════════ 规则 7：模板内裸图标字形 ═══════════════════════════

/**
 * 图标字形的码位区间（ADR-0208 决策 1/2 的替代面：unicode 字形 ⇒ Material Symbols 子集字体）。
 * 三种书写形态各对应一个区间：符号/几何/杂项区、emoji 区、私有区（图标字体落点）。
 * ⚠️ **刻意排除** CJK 标点（U+3000–U+303F，如 `。、」「』`）、假名、全角形（U+FF00–U+FFEF）、
 * 变体选择器 1–15（U+FE00–U+FE0E，是字体修饰符不是字形）—— 把它们判红会让本门禁
 * 在任何日文文案上恒红。
 */
const ICON_RANGES: ReadonlyArray<readonly [from: number, to: number, label: string]> = [
  [0x2190, 0x21ff, 'arrows'],
  [0x25a0, 0x25ff, 'geometric'],
  [0x2600, 0x26ff, 'misc-symbols'],
  [0x2700, 0x27bf, 'dingbats'],
  [0x2b00, 0x2bff, 'misc-arrows'],
  [0x1f000, 0x1faff, 'emoji'],
  [0xe000, 0xf8ff, 'private-use'],
  [0xfe0f, 0xfe0f, 'vs16'],
]
const GLYPH_EXCLUDED: ReadonlyArray<readonly [from: number, to: number]> = [
  [0x3000, 0x303f],
  [0x3040, 0x30ff],
  [0x4e00, 0x9fff],
  [0xff00, 0xffef],
  [0xfe00, 0xfe0e],
]

function isIconGlyph(code: number): boolean {
  for (const [from, to] of GLYPH_EXCLUDED) if (code >= from && code <= to) return false
  return ICON_RANGES.some(([from, to]) => code >= from && code <= to)
}

/** 模板里的「会被渲染出来的字符」= 文本节点（剥标签、剥插值）+ 属性值 */
function renderedRegions(template: string): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = []
  const attrRe = /[\w:.-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const m of template.matchAll(attrRe)) {
    out.push({ text: m[1] ?? m[2] ?? '', index: m.index ?? 0 })
  }
  const textOnly = template.replace(/\{\{[\s\S]*?\}\}/g, (s) => ' '.repeat(s.length)).replace(/<[^>]*>/g, (s) => ' '.repeat(s.length))
  out.push({ text: textOnly, index: 0 })
  return out
}

/**
 * 抽取器**自包含**：内部自己掩码 `<script>` / `<style>` / 注释，只看 `<template>` 的渲染面。
 * 这样「直调抽取器」与「scanAll 全仓扫描」口径完全一致 —— 否则反事实用例会在
 * 另一套口径下验证，等于没验证。
 *
 * ⚠️ 因此 `scanAll` 喂给本规则的必须是**原文**而不是 `CLEAN`：`CLEAN` 里的注释是被
 * **删除**的，喂进来会让行号整体前移，`lineOf` 就对不上原文件了。掩码（而不是删除）
 * 正是为了让行号可用的那个前提。
 */
function scanIconGlyph(rawSource: string, path: string): Violation[] {
  const template = templateOf(rawSource)
  const out: Violation[] = []
  for (const region of renderedRegions(template)) {
    const chars = [...region.text]
    let offset = region.index
    for (const ch of chars) {
      if (isIconGlyph(ch.codePointAt(0) ?? 0)) {
        out.push({
          rule: 'icon-glyph',
          path,
          line: lineOf(template, offset),
          form: `U+${(ch.codePointAt(0)!).toString(16).toUpperCase().padStart(4, '0')} ${ch}`,
        })
      }
      offset += ch.length
    }
  }
  return out
}

// ═══════════════════════════ 全仓扫描 ═══════════════════════════

type Scanner = (text: string, path: string) => Violation[]

/**
 * 每条规则的**扫描口径**。口径本身就是判据的一部分，写成显式枚举而不是从文件名猜 ——
 * 「哪一类文件该被这道门看」是需要 review 能核对的决定，不是实现细节。
 *   src-and-config：src/** + tailwind.config.ts（配置里出现同样违规同样是错）
 *   src-only      ：只扫 src/**（定义现场 tailwind.config.ts 天然含旧别名/实色映射，不算违规）
 *   vue-template  ：只扫 .vue 的 <template> 区（图标字形是渲染面；.ts 里的图标映射表
 *                   是 ADR-0208 决策 2 的**映射源**本身，不是裸字形消费）
 */
type Scope = 'src-and-config' | 'src-only' | 'vue-template'

interface Rule {
  readonly id: string
  readonly scan: Scanner
  readonly scope: Scope
  /** 定义现场豁免：这些文件**按定义**必须出现该形态（兼容层的映射表），豁免是规则的一部分 */
  readonly exempt?: readonly string[]
  /**
   * **正向**限定扫描目标到这几个文件。
   *
   * ⚠️ 为什么不能用 `exempt` 做减法来表达「只扫这一个文件」：
   * `exempt` 是「豁免其余全部」，一旦那个文件被改名/移出目录，豁免集合就等于全集
   * ⇒ 扫描结果恒为 0 ⇒ 与「零违规」**完全同形**，门禁静默真空（反事实已实跑：
   * tokens.css 缺席时 exempt 覆盖 233/233 个文件）。正向写法在目标缺席时
   * 直接得到空集，由「目标非空」断言当场转红。
   */
  readonly only?: readonly string[]

  /**
   * **单份豁免**：只吃掉「该文件里的**第 1 个**这种形态」，第 2 个起照常判红。
   *
   * ⚠️ 为什么生成产物不能用 `exempt`（整文件）：`exempt` 是文件粒度，往
   * `src/styles/icon-font.css` 里再塞一份坏的 `@font-face`（相对 `url()`）会整块被跳过 ——
   * 反事实已实跑：注入后 `scanAll` 命中恒为 0、门禁不转红。而那正是规则 8 要消灭的缺陷本身，
   * 它的豁免文件恰好是缺陷最容易藏身的地方。
   * `allowOnce` 的语义被接线断言补齐成完整闭环：**份数**由它锁（只允许 1 份），
   * **那唯一一份的内容**由「接线断言」锁（必须是 base64 内联，见规则 8）。
   */
  readonly allowOnce?: {
    readonly path: string
    readonly form: string
    readonly reason: string
  }
}

/** 规则 8：组件内不得自行声明 `@font-face`（字体必须走全局 base64 内联）。
 *
 * 起因是本轮真机抓到的最大缺陷：Lynx 的 `@font-face` `url()` **只吃远程地址与
 * base64**（官方 lynxjs.org/4.0 文档），本地资源须用 `local(file://…)`；而打包器会把
 * `url('./x.ttf')` 改写成 `webpack:///static/x.<hash>.ttf`，原生端**不解析** ⇒
 * 字体不加载 ⇒ 私用区码点无字形 ⇒ **全站图标渲染成豆腐块 ⊠**。
 *
 * 之前只有 `iconMap.test.ts` 一条**文件级**断言守着 `src/styles/icon-font.css` 的
 * 内容；实测（反事实实跑）：往 `M3Switch.vue` 注入组件级 `@font-face` + 相对 `url()`，
 * 13 条测试**全绿**。守卫锁的是「某个文件的内容」，不是「这个形态不存在」——
 * 两者在「防回流」这个用途上并不等价。
 */
function scanStrayFontFace(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(/@font-face\b/g)) {
    out.push({ rule: 'stray-font-face', path, line: lineOf(text, m.index ?? 0), form: '@font-face' })
  }
  return out
}

// ═══════════════════════════ 规则 9：骨架屏零阴影（ADR-0212 决策 2 规则 1 + 决策 7）═══════════════════════════
//
// 口径：骨架屏 placeholder 是**贴面元素**，阴影上限 = 0（ADR-0212 决策 1 映射表 + 决策 2 规则 1）。
// 本规则锁两件不同形态的东西：
//   · `skeleton-shadow`            —— 页面内联骨架分支的子树内不得有任何阴影声明
//   · `skeleton-shadow-component` —— 三个**纯骨架组件**内不得有阴影（含 scoped CSS）
//
// ⚠️ **为什么按「分支」扫而不是按类名扫**：本票落地后全仓仍有 44 处
// `shadow-[var(--md-elevation-1)]` 存活（真实贴面卡 / 遮罩 / 徽标 / `GlassCard` scoped CSS /
// 按压反馈，归属 ADR-0212 决策 3 与决策 6，不在本规则范围）。只扫类名必然误伤真实卡，
// 所以判据问的是**另一个问题**：「这段渲染是不是加载态」—— 判据条件是
// **某个元素的 `v-if` / `v-else-if` 条件里出现 `'skeleton'` 字面量**，范围是它的整个子树。
// 识别方式的可信度由「反事实 A/D」与「台账棘轮」两条常驻用例承担，见各自注释。
//
// ⚠️ **为什么连显式零也判红**（`shadow-none` / `shadow-[var(--md-elevation-0)]`）：
// ADR-0212 决策 2 规则 3 要求零阴影**靠删除表达**。显式零与「无声明」渲染等价，
// 两者并存即语义含混（后人会分不清「这里归零了」与「这里本来就没阴影」），
// 允许它就等于把这条规则变成可绕过的。归零的**明确表达**另有承担者：
// 骨架分支里的 marker 注释（`SKELETON_ZERO_MARKER`），由台账棘轮单独锁。
//
// ⚠️ 解析口径的一处**已知边界（如实登记）**：`RelatedInlineSection.vue:40` 的
// 「加载中网格」不是 `'skeleton'` 分支，而是与内容并列的独立区块，**不落在本规则范围内**。
// 已核：它无任何阴影声明。若日后要把它也纳入，口径需扩到「含 `shimmer` 类的区块」，属另开决策。

/** 一个标签的解析结果。索引全部相对**原文** —— `templateOf` 是等长掩码，偏移可跨文本使用 */
interface TagHit {
  readonly name: string
  readonly start: number
  /** 属性区（`name` 之后）的绝对起点：反事实要往属性里插内容时用它换算，别拿 `attrs` 的下标当绝对偏移 */
  readonly attrsStart: number
  readonly openEnd: number
  readonly closing: boolean
  readonly selfClosing: boolean
  readonly attrs: string
}

/**
 * 标签 token。属性区用「引号内字符不终止」的口径（`[^>"']` 逐字 + 引号串），
 * 否则 `v-if="a > b"` 里的 `>` 会把标签截断、深度计数随之错位。
 * `<!-- -->` 的 `<` 后面不是字母，天然不匹配 ⇒ 注释内的伪标签不会被当成元素。
 */
const TAG_TOKEN = /<(\/?)([A-Za-z][A-Za-z0-9._-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g

function tagAt(text: string, from: number): TagHit | null {
  TAG_TOKEN.lastIndex = from
  const m = TAG_TOKEN.exec(text)
  if (!m) return null
  const attrs = m[3] ?? ''
  return {
    name: m[2]!,
    start: m.index,
    attrsStart: m.index + 1 + m[2]!.length,
    openEnd: m.index + m[0].length,
    closing: m[1] === '/',
    selfClosing: attrs.trimEnd().endsWith('/'),
    attrs,
  }
}

/** 元素子树区间（开标签末尾 → 对应闭标签开头）。self-closing / 未闭合都返回 null —— 宁可漏判也不猜 */
function elementRegion(
  text: string,
  openStart: number,
): { readonly contentStart: number; readonly contentEnd: number } | null {
  const open = tagAt(text, openStart)
  if (!open || open.selfClosing) return null
  let depth = 1
  let cursor = open.openEnd
  while (cursor < text.length) {
    const t = tagAt(text, cursor)
    if (!t) break
    if (t.closing) {
      depth--
      if (depth === 0) return { contentStart: open.openEnd, contentEnd: t.start }
    } else if (!t.selfClosing) depth++
    cursor = t.openEnd
  }
  return null
}

/** 直接子元素（深度 0 处开标签即子元素） */
function childElements(text: string, contentStart: number, contentEnd: number): TagHit[] {
  const out: TagHit[] = []
  let depth = 0
  let cursor = contentStart
  while (cursor < contentEnd) {
    const t = tagAt(text, cursor)
    if (!t || t.start >= contentEnd) break
    if (t.closing) {
      if (depth === 0) break
      depth--
    } else {
      if (depth === 0) out.push(t)
      if (!t.selfClosing) depth++
    }
    cursor = t.openEnd
  }
  return out
}

const SKELETON_COND = /(?:v-else-if|v-if)="([^"]*)"/g
/** 条件里出现带引号的 `skeleton` 字面量：`view === 'skeleton'` / `novelView === 'skeleton'` */
const isSkeletonCondition = (cond: string): boolean => /(['"`])skeleton\1/.test(cond)

interface SkeletonBranch {
  readonly cond: string
  readonly contentStart: number
  readonly contentEnd: number
  /** 直接子元素里带 `v-for` 的那些 —— 骨架「假数据行」的声明点 */
  readonly rows: readonly TagHit[]
}

function skeletonBranches(masked: string): SkeletonBranch[] {
  const out: SkeletonBranch[] = []
  for (const m of masked.matchAll(SKELETON_COND)) {
    if (!isSkeletonCondition(m[1]!)) continue
    // 条件属性所在的标签：往前找最近的 `<` + 字母
    // ⚠️ 循环条件必须是 `>= 0`：写成 `> 0` 时，**位于文本开头的骨架分支（openStart === 0）
    // 会被整段跳过** —— 而这正是「构造正样本」那条用例当初抓到的 fail-open
    // （单行构造样本里分支恰好从第 0 个字符开始，真实文件因前面有注释而侥幸没踩到）。
    let lt = masked.lastIndexOf('<', m.index)
    let openStart = -1
    while (lt >= 0) {
      if (/^<[A-Za-z]/.test(masked.slice(lt, lt + 2))) {
        openStart = lt
        break
      }
      lt = masked.lastIndexOf('<', lt - 1)
    }
    if (openStart < 0) continue
    const region = elementRegion(masked, openStart)
    if (!region) continue
    out.push({
      cond: m[1]!,
      contentStart: region.contentStart,
      contentEnd: region.contentEnd,
      rows: childElements(masked, region.contentStart, region.contentEnd).filter((t) =>
        /\bv-for=/.test(t.attrs),
      ),
    })
  }
  return out
}

/** 形态 A：Tailwind 阴影 utility。`\b` 让 `active:shadow-[...]` / `hover:shadow-lg` 同样命中 */
const SHADOW_UTIL = /\bshadow-(?:\[[^\]]*\]|[a-z0-9-]+)/g
/** 形态 B：CSS 声明。内联 `style` 与组件 scoped CSS 都吃这一条（类名扫描对 scoped CSS 是盲区） */
const SHADOW_DECL = /\bbox-shadow\s*:/g

function scanSkeletonShadow(rawSource: string, path: string): Violation[] {
  const masked = templateOf(rawSource)
  const out: Violation[] = []
  for (const branch of skeletonBranches(masked)) {
    const content = masked.slice(branch.contentStart, branch.contentEnd)
    for (const m of content.matchAll(SHADOW_UTIL)) {
      out.push({
        rule: 'skeleton-shadow',
        path,
        line: lineOf(rawSource, branch.contentStart + m.index!),
        form: m[0],
      })
    }
    for (const m of content.matchAll(SHADOW_DECL)) {
      out.push({
        rule: 'skeleton-shadow',
        path,
        line: lineOf(rawSource, branch.contentStart + m.index!),
        form: m[0],
      })
    }
  }
  return out
}

/**
 * 纯骨架组件：整个组件就是「加载态占位」，故扫描面是**全文件**而不是某个分支。
 * ⚠️ 刻意**不包含** `SkeletonImage.vue` / `CoverImage.vue` —— 它们同时服务真实内容
 * （`CoverImage` 的 `state === 'skeleton'` 是真卡上的图片级占位），把它们纳入等于把
 * 「真实卡长什么样」也管起来，越出本规则的口径。
 */
const SHARED_SKELETON_COMPONENTS: readonly string[] = [
  'src/components/SkeletonCard.vue',
  'src/components/SkeletonNovel.vue',
  'src/components/CarouselSkeleton.vue',
]

function scanSharedSkeletonShadow(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(SHADOW_UTIL)) {
    out.push({ rule: 'skeleton-shadow-component', path, line: lineOf(text, m.index!), form: m[0] })
  }
  for (const m of text.matchAll(SHADOW_DECL)) {
    out.push({ rule: 'skeleton-shadow-component', path, line: lineOf(text, m.index!), form: m[0] })
  }
  return out
}

/**
 * 归零台账（**棘轮**，方向只往下）：ADR-0212 决策 7 处置过的每一个内联骨架声明点。
 *
 * 存在的理由：门禁只能判「现在有没有错」，判不出「**这里是不是有意归零的**」——
 * 删掉阴影和从来没加过阴影，在扫描结果里完全同形（都命中 0 条）。要让「归零」与
 * 「漏改」可区分，归零处必须**留下可核的表达**：分支内一条 marker 注释 + 本台账的一条登记。
 * 两者缺一都转红（见「台账棘轮」两条用例）。
 *
 * ⚠️ 登记与 ADR 的差异（如实记录，不追认 ADR 表格）：ADR-0212 决策 7 的表列了
 * **7 个声明点 / 42 个渲染实例**，本台账是 **9 个 / 56 个** —— 扫描另外找出
 * `Ranking.vue`（n in 8）与 `TagNeighbors.vue`（n in 6）两处同形态的内联骨架行，
 * 二者形态与那 7 处完全一致（`'skeleton'` 分支 + `bg-surface-container-lowest` + `elevation-1`）。
 * 按 ADR 决策 1/2 的规则（骨架屏上限 0）它们同属本票范围，故一并归零；
 * ADR 表格的处数需按此更新（**该文件的改动权不在本票**）。
 */
const SKELETON_ZERO_SITES: readonly { readonly path: string; readonly forExpr: string }[] = [
  { path: 'src/pages/Bookmarks.vue', forExpr: 'n in 5' },
  { path: 'src/pages/FollowList.vue', forExpr: 'n in 8' },
  { path: 'src/pages/MyPixiv.vue', forExpr: 'n in 8' },
  { path: 'src/pages/NovelList.vue', forExpr: 'n in 5' },
  { path: 'src/pages/Notifications.vue', forExpr: 'n in 6' },
  { path: 'src/pages/Ranking.vue', forExpr: 'n in 8' },
  { path: 'src/pages/TagNeighbors.vue', forExpr: 'n in 6' },
  { path: 'src/pages/UserHome.vue', forExpr: 'n in 5' },
  { path: 'src/pages/Watchlist.vue', forExpr: 'n in 5' },
]

/** 归零 marker：必须同时含「归零」与「ADR-0212 决策 7」两个 token，顺序不限（写注释的人不该被顺序绑住） */
const ZERO_MARKER_DECISION = /ADR-0212[^\n>]*决策\s*7/
const ZERO_MARKER_INTENT = /归零/
const COMMENT = /<!--[\s\S]*?-->/g

/** 一段区域里带归零 marker 的注释条数（>1 也算异常，由「marker 数 == 台账条数」那条棘轮兜住） */
function zeroMarkerCount(raw: string, region: string): number {
  let n = 0
  for (const m of region.matchAll(COMMENT)) {
    if (ZERO_MARKER_DECISION.test(m[0]) && ZERO_MARKER_INTENT.test(m[0])) n++
  }
  return n
}

// ═══════════════════════════ 规则 10：贴面元素零阴影 ═══════════════════════════

/**
 * **贴面底色档**（ADR-0212 决策 1 表「贴面列表项 / 卡片（静止）」一行）。
 *
 * 必须是**完整 class token**（`Set` 精确相等），不能用 `includes` / 前缀匹配 ——
 * 前缀写法会把 `bg-surface-container-high` / `-highest`（**悬浮**档）一并吃掉，
 * 那正是 ADR 决策 1 表里「悬浮元素按上表取档、本票不动」的行 ⇒ 误伤即越权。
 * 另含 `bg-surface-container-low`：它当前是 0 消费的死令牌（ADR 背景 §四），
 * 但决策 1 表已把它钉成贴面档，日后有人用它补色阶断档（候选甲）时，贴面口径应当已经生效。
 */
const FLAT_SURFACE_BG: ReadonlySet<string> = new Set([
  'bg-surface-container-lowest',
  'bg-surface-container-low',
])

const CLASS_ATTR = /class="([^"]*)"/

/**
 * 贴面元素上的任何阴影声明（ADR-0212 决策 2 规则 1：贴面上限 = 0）。
 *
 * ⭐ **本判据刻意与规则 9 的骨架屏判据形态不同**（那一轮的教训，见 #894）：
 * 规则 9 靠「分支内一条 marker 注释 + 台账」双向对齐，marker 判据是**行级**匹配 ——
> 换行即误红。**本规则不依赖任何 marker、注释或散文关键词**，判据是纯结构化的：
 * **同一个元素**的 class token 集合里同时出现「贴面底色」与「阴影 utility」。
 *
 * 因此「归零」= 真删掉该 class。显式零写法（`shadow-[var(--md-elevation-0)]` /
 * `shadow-none`）**同样判红** —— 决策 2 规则 3 要求「降档优先删声明」，
 * 且显式零会让「归零」与「从未加过」在扫描里同形，无法区分（决策 7 订正同款理由）。
 * 也就是说：本规则的**唯一绿灯态是「这个贴面元素上确实没有阴影声明」**，不存在「写了 0 也算过」的中间态。
 */
function scanFlatSurfaceShadow(rawSource: string, path: string): Violation[] {
  const masked = templateOf(rawSource)
  const out: Violation[] = []
  let cursor = 0
  // 复用规则 7/9 的标签词法（TAG_TOKEN / tagAt），不另写一套
  while (cursor < masked.length) {
    const t = tagAt(masked, cursor)
    if (!t) break
    if (!t.closing) {
      // class 属性的值在 `t.attrs` 内的偏移（与规则 9 反事实 C 同一算法）
      const classAt = CLASS_ATTR.exec(t.attrs)
      if (classAt) {
        const value = classAt[1]!
        const valueStart = t.attrsStart + classAt.index + classAt[0].indexOf('class="') + 'class="'.length
        const isFlat = value.split(/\s+/).some((c) => FLAT_SURFACE_BG.has(c))
        if (isFlat) {
          for (const m of value.matchAll(SHADOW_UTIL)) {
            out.push({
              rule: 'flat-surface-shadow',
              path,
              line: lineOf(rawSource, valueStart + m.index!),
              form: m[0],
            })
          }
          for (const m of t.attrs.matchAll(SHADOW_DECL)) {
            out.push({ rule: 'flat-surface-shadow', path, line: lineOf(rawSource, t.attrsStart + m.index!), form: m[0] })
          }
        }
      }
    }
    cursor = t.openEnd
  }
  return out
}

const RULES: readonly Rule[] = [
  { id: 'legacy-easing', scan: scanLegacyEasing, scope: 'src-and-config' },
  { id: 'radius-offtoken', scan: scanRadiusOffToken, scope: 'src-and-config' },
  { id: 'self-chosen-leading', scan: scanSelfChosenLeading, scope: 'src-and-config' },
  { id: 'solid-state-color', scan: scanSolidStateLayer, scope: 'src-only' },
  {
    id: 'legacy-color-alias',
    scan: scanLegacyColorAlias,
    scope: 'src-only',
    // 定义现场：tokens.css 声明 22 条别名，tailwind.config.ts 把它们映射到 Tailwind 颜色档位
    exempt: [TOKENS_CSS_REL],
  },
  { id: 'bare-focus', scan: scanBareFocus, scope: 'src-and-config' },
  { id: 'icon-glyph', scan: scanIconGlyph, scope: 'vue-template' },
  {
    id: 'stray-font-face',
    scan: scanStrayFontFace,
    scope: 'src-only',
    // 定义现场：src/styles/icon-font.css 是生成脚本产出的全局 @font-face（base64 内联）。
    // ⚠️ 刻意**不写** `exempt`（整文件）：那会让「往产物里再塞一份坏 @font-face」隐形，
    // 而规则 8 要消灭的正是那个形态。单份豁免 = 只吃第 1 个；第 2 个照常判红。
    // 「那唯一一份必须是 base64 内联」由规则 8 的接线断言承担（唯一性 + 内容绑定）。
    allowOnce: {
      path: ICON_FONT_CSS_REL,
      form: '@font-face',
      reason:
        'generate-icon-subset.py 产出的全站唯一一份全局 @font-face（base64 内联）；' +
        '份数由 allowOnce 锁为 ≤1，那一份的内容由规则 8 的接线断言锁',
    },
  },
  { id: 'skeleton-shadow', scan: scanSkeletonShadow, scope: 'vue-template' },
  {
    id: 'skeleton-shadow-component',
    scan: scanSharedSkeletonShadow,
    scope: 'src-only',
    only: SHARED_SKELETON_COMPONENTS,
  },
  { id: 'flat-surface-shadow', scan: scanFlatSurfaceShadow, scope: 'vue-template' },
]

/** 某条规则**实际会喂给 scan 的文件**。
 *
 * 抽出来是为了让「扫描接线」这条断言与 `scanAll` 共用同一份口径 ——
 * 两处各算一次必然漂移，而漂移的方向恰好是「断言以为扫了、实际没扫」。
 */
function targetsOf(rule: Rule): ScannedFile[] {
  if (rule.only) {
    const want = new Set(rule.only)
    return FILES.filter((f) => want.has(f.rel))
  }
  return rule.scope === 'vue-template'
    ? VUE_FILES
    : FILES.filter((f) => rule.scope === 'src-and-config' || !f.rel.startsWith('tailwind.config.ts'))
}

/**
 * 单文件扫描 + 豁免裁定。
 *
 * 抽成独立函数是为了让 `scanAll` 与规则 8 的「塞第二份 @font-face」反事实**共用同一份口径** ——
 * 反事实若在测试里另抄一遍豁免逻辑，两处必然漂移，而漂移的方向恰好是
 * 「断言以为豁免了第 1 份、实际把 2 份都吃了」。
 */
function scanFile(rule: Rule, rel: string, text: string): Violation[] {
  const hits = rule.scan(text, rel)
  const slot = rule.allowOnce
  if (!slot || slot.path !== rel) return hits
  const at = hits.findIndex((v) => v.form === slot.form)
  return at < 0 ? hits : hits.filter((_v, i) => i !== at)
}

/**
 * 某文件在某条规则下被喂进去的**文本**。
 *
 * 抽出成具名函数是为了让「行号参照系」这条接线**可被断言**（反事实已实跑：把它改回
 * 一律喂 `CLEAN`，没有任何用例转红 —— 因为反事实都是直调 `scanIconGlyph`，
 * 走不到 `scanAll` 这条路）。
 * `CLEAN` 里的注释是**被删除**的（`stripComments` 用 `''` 替换），全仓 76 个 `.vue`
 * 的 CLEAN 行数都比原文少（`ActionButton.vue` 48 → 36 行）⇒ 喂 CLEAN 等于把行号
 * 整体前移，`lineOf` 报出的行号点过去指的不是那一行。
 */
function textFor(rule: Rule, file: ScannedFile): string {
  return rule.scope === 'vue-template' ? file.text : (CLEAN.get(file.rel) ?? file.text)
}

function scanAll(rule: Rule): Violation[] {
  const exempt = new Set(rule.exempt ?? [])
  return targetsOf(rule).flatMap((file) =>
    exempt.has(file.rel) ? [] : scanFile(rule, file.rel, textFor(rule, file)),
  )
}

/** tokens.css 的 legacy 留痕子规则：只扫 tokens.css 一个文件（用 `only` 正向限定） */
const TOKENS_LEGACY_MARKER_RULE: Rule = {
  id: 'legacy-easing-tokens-marker',
  scan: scanTokensLegacyMarker,
  scope: 'src-only',
  only: [TOKENS_CSS_REL],
}

const RULE_IDS = [...RULES.map((r) => r.id), TOKENS_LEGACY_MARKER_RULE.id]

/**
 * App.vue 引入全局字体的 `@import`。
 *
 * ⚠️ 两种等价书写都要认：`@import './x.css'` 与 `@import url('./x.css')`。
 * 只认裸字符串形态时，一次纯格式归一（oxfmt 或人工）就会让守卫误报红，而字体照常加载 ——
 * 方向是误报不是漏过，但**误报会逼人加白名单**，白名单会掩盖真缺陷，所以宁可放宽。
 * 媒体查询（`@import './x.css' screen;`）也一并容忍：出现条件仍然是「引了这一份」。
 */
const ICON_FONT_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]\.\/styles\/icon-font\.css['"]\s*\)?/

/**
 * icon-font.css 的**内容判据**：恰有 1 份 `@font-face`，且那唯一一份是 base64 内联。
 *
 * 判据问的是「**加载的那一份**是什么」，不是「文件里有没有这些东西」——
 * 只做 `toMatch(/@font-face/)` 的断言在「多塞一份坏的」之后仍然全绿（review 反事实已实跑）。
 * 返回问题清单而不是直接断言，是为了让反事实用例能在**不改产物**的前提下把判据喂成缺陷形态。
 *
 * ⚠️ 写法上有个陷阱：`url\(\s*['"]?(?!data:)` 里的 `['"]?` 是**可选**量词，
 * 正则会先尝试吃引号（失败），再尝试**不吃**——此时前瞻落在 `'` 上，
 * `'` 当然不是 `data:`，于是负向前瞻**必然成立** ⇒ 合法 data: URL 也被判红。
 * 正确写法是把整个「可选引号」整体放进前瞻：`url\((?!\s*['"]?data:)`。
 */
function fontFaceProblems(css: string): string[] {
  const problems: string[] = []
  const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1])
  if (faces.length !== 1) {
    problems.push(`@font-face 份数 = ${faces.length}（应恰有 1 份：0 = 字体无来源，≥2 = 第二份字体事实源）`)
    return problems
  }
  const only = faces[0]!
  if (!/url\(\s*['"]?data:font\/ttf;base64,/.test(only)) problems.push('唯一一份不是 base64 内联')
  if (/url\((?!\s*['"]?data:)/.test(only)) problems.push('唯一一份含非 data: 的 url()（相对路径 = 真机踩坑形态）')
  return problems
}

// ═══════════════════════════ 用例 0：抽取器自身有效 + 白名单纪律 ═══════════════════════════

describe('MD3 形态回流门禁 · 抽取器自身有效（防正则塌陷后全称断言静默恒真）', () => {
  it('文件收集本身非空且覆盖三类扩展名', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(50)
    expect(FILES.some((f) => f.rel.endsWith('.vue'))).toBe(true)
    expect(FILES.some((f) => f.rel.endsWith('.ts'))).toBe(true)
    expect(FILES.some((f) => f.rel.endsWith('.css'))).toBe(true)
    expect(FILES.some((f) => f.rel === 'tailwind.config.ts')).toBe(true)
  })

  it('注释剥离：tailwind.config.ts 的 legacy 曲线**只在注释里**，剥完必须归零', () => {
    const raw = CLEAN.get('tailwind.config.ts') ?? ''
    expect(raw).not.toMatch(/cubic-bezier\(\s*0?\.4\s*,/)
    // 反向自检：未剥离的原文确实有 4 处注释里的 legacy 曲线 ⇒ 剥离确实在干活，不是原文就没有
    const original = FILES.find((f) => f.rel === 'tailwind.config.ts')!.text
    expect(original).toMatch(/cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*0?\.2/)
  })

  it('抽取器对**构造正样本**全部非空，且命中数 ≥ 下界', () => {
    const samples: Record<string, [string, number]> = {
      'legacy-easing': ['a { transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1); }', 1],
      'radius-offtoken': ['<view class="rounded-[0.65vw] rounded-t-2xl" />', 2],
      'self-chosen-leading': ['<text class="text-body-medium leading-snug">x</text>', 1],
      'solid-state-color': ['<view style="background-color: var(--md-state-pressed-primary)" />', 1],
      'legacy-color-alias': ['<text style="color: var(--colorOverlayForeground)" />', 1],
      'bare-focus': ['<style>.a:focus { outline: none; }</style>', 1],
      'icon-glyph': ['<template><text>♥</text></template>', 1],
      'stray-font-face': ['<style>@font-face { font-family: X; src: url("./x.ttf"); }</style>', 1],
      'skeleton-shadow': [
        `<view v-if="view === 'skeleton'"><view v-for="n in 5" class="shadow-[var(--md-elevation-1)]" /></view>`,
        1,
      ],
      'skeleton-shadow-component': ['<style>.skeleton-card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }</style>', 1],
      'flat-surface-shadow': [
        '<view class="bg-surface-container-lowest shadow-[var(--md-elevation-1)]" />',
        1,
      ],
    }
    for (const rule of RULES) {
      const entry = samples[rule.id]
      expect(entry, `规则 ${rule.id} 缺构造正样本`).toBeDefined()
      const [text, floor] = entry!
      expect(stripComments(text), `规则 ${rule.id} 的正样本被剥空了`).not.toBe('')
      expect(rule.scan(stripComments(text), 'sample.vue').length, `规则 ${rule.id} 正样本命中不足 ${floor}`).toBeGreaterThanOrEqual(floor)
    }
    // 图标字形不在 RULES 里（只扫模板），单独自检
    const glyphSample = '<template><text>♥</text><text>💬</text></template>'
    expect(scanIconGlyph(glyphSample, 'sample.vue').length).toBeGreaterThanOrEqual(2)
    // tokens.css 留痕子规则自检
    expect(scanTokensLegacyMarker('  --motion-x: cubic-bezier(0.4, 0, 0.2, 1);\n').length).toBe(1)
  })

  it('扫描确实跑在真实目录上（防「扫了个空目录/常量」导致全称断言真空）', () => {
    // 这是接线断言，不是存量断言：它证明 scanAll 真的读了 src/** 的文件树。
    // 早期实现用「各规则存量 ≥ 整改前的存量数」来兼这个职，结果是**把工作做完门禁变红**
    // （见 liveFloor 字段注释）。存量护栏改由白名单台账承担（棘轮），抽取器有效性
    // 由每条规则的构造正样本用例承担，本条只管接线。
    const visited = collectFiles()
    expect(
      visited.length,
      `只扫到 ${visited.length} 个源文件，扫描范围疑似塌陷（应 ≥ 50）`,
    ).toBeGreaterThanOrEqual(50)
    const totalBytes = visited.reduce((n, f) => n + f.text.length, 0)
    expect(totalBytes, '读到的源文件总字节数过小，扫描疑似空转').toBeGreaterThanOrEqual(100_000)

    // tokens.css 留痕子规则：存量必须为 0（这是它的全部语义）
    expect(scanAll(TOKENS_LEGACY_MARKER_RULE).length).toBe(0)
  })

  it('每条规则的扫描目标集非空且含点名锚点（防 scope 过滤器塌陷成真空）', () => {
    // ⚠️ 这条是为替换掉原来那句 `expect(rule.liveFloor).toBeLessThanOrEqual(1)` ——
    // 那句是**拿字面量断言字面量，恒真**，完全不接触任何扫描结果：
    // 把 `scanAll` 改成直接 `return []`，50 条测试没有一条会红（反事实已实跑）。
    // `liveFloor` 因此是**死字段**，本条才是它本来想承担的职责。
    //
    // 为什么只断言「非空」还不够：8 条规则在当前仓库的真实命中数**全为 0**
    // （断言本就住在 `[] === []` 状态），所以「真实命中 0」与「过滤器塌陷」同形。
    // 必须配**点名锚点**才切得开。
    const ANCHORS: Record<string, string> = {
      'legacy-easing': 'src/components/GlassCard.vue',
      'radius-offtoken': 'src/components/PagePickerSheet.vue',
      'self-chosen-leading': 'src/components/PagePickerSheet.vue',
      'solid-state-color': 'src/components/GlobalFab.vue',
      'legacy-color-alias': 'src/styles/tokens.css',
      'bare-focus': 'src/components/AppIcon.vue',
      'icon-glyph': 'src/components/AppIcon.vue',
      'stray-font-face': 'src/components/AppIcon.vue',
      'legacy-easing-tokens-marker': TOKENS_CSS_REL,
      'skeleton-shadow': 'src/pages/Watchlist.vue',
      'skeleton-shadow-component': 'src/components/SkeletonCard.vue',
      'flat-surface-shadow': 'src/components/UserRow.vue',
    }
    for (const rule of [...RULES, TOKENS_LEGACY_MARKER_RULE]) {
      const targets = targetsOf(rule)
      const rels = targets.map((f) => f.rel)
      expect(rels.length, `${rule.id} 的扫描目标集为空，scope 过滤器疑似塌陷`).toBeGreaterThanOrEqual(1)
      const anchor = ANCHORS[rule.id]
      expect(anchor, `规则 ${rule.id} 缺登记锚点，新增规则时必须同时登记锚点`).toBeTruthy()
      expect(rels, `${rule.id} 的目标集里没有锚点 ${anchor}，接线已断`).toContain(anchor)
    }
  })

  it('扫描接线：vue-template 规则喂的是**原文**，不是被删过注释的 CLEAN（否则行号整体前移）', () => {
    // 这条是为「规则 7 的行号参照系」补的接线断言：反事实都是**直调** `scanIconGlyph`，
    // 走不到 `scanAll`；把它改回一律喂 CLEAN 时，没有任何用例转红（反事实已实跑）。
    const rule = RULES.find((r) => r.id === 'icon-glyph')!
    const file = FILES.find((f) => f.rel === 'src/components/ActionButton.vue')!
    // 前提：该文件确实有会被剥掉的注释（否则「喂哪个都一样」，这条断言没有判别力）
    const clean = CLEAN.get(file.rel)!
    expect(clean, '前提：该文件应含会被剥掉的注释').not.toBe(file.text)
    expect(
      clean.split('\n').length < file.text.split('\n').length,
      '前提：剥注释后行数应变少（否则行号不会前移）',
    ).toBe(true)
    expect(textFor(rule, file), 'vue-template 规则必须拿原文').toBe(file.text)
    // 其它规则相反：它们没有自包含的掩码步骤，靠 CLEAN 剥注释
    const easing = RULES.find((r) => r.id === 'legacy-easing')!
    expect(textFor(easing, file), '非 vue-template 规则仍走 CLEAN').toBe(clean)
  })

  it('每条台账条目都还命中一个真实违规（死条目会让未来的回流白吃）', () => {
    // 方向是双向的：台账是**棘轮**，只用来豁免「现在确实存在的存量」。
    // 一旦某条对应的代码被修掉了，条目就成了**死条目** —— 而死条目不会自己报错，
    // 它会安静地继续豁免同一个 `(rule, path, form)`：将来有人把这个形态**重新引入**，
    // 守卫照样放行。棘轮只往下走，不往上走，所以必须有一条断言在「条目已死」时转红。
    const raw: Violation[] = []
    for (const rule of RULES) raw.push(...scanAll(rule))
    const hit = (e: WhitelistEntry): boolean =>
      raw.some((v) => v.rule === e.rule && v.path === e.path && v.form === e.form)
    const dead = WHITELIST.entries.filter((e) => !hit(e))
    expect(
      dead.map((e) => `${e.rule}｜${e.path}｜${e.form}`),
      '台账里有条目已不再对应任何真实违规（代码已修掉）——请删除该条目，否则它会白吃未来的回流',
    ).toEqual([])
  })
})

// ═══════════════════════════ 用例 1–7：逐条规则的反事实 + 全称断言 ═══════════════════════════

describe('规则 1 · MD2 legacy 缓动不得回流', () => {
  it('反事实形态 A（包裹式，两种空白换皮都抓）', () => {
    const a = scanLegacyEasing('transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);', 'x.css')
    const aTight = scanLegacyEasing('transition: all 200ms cubic-bezier(.4,0,.2,1);', 'x.css')
    expect(a.map(fmt)).toEqual(["legacy-easing｜x.css:1｜cubic-bezier(0.4, 0, 0.2, 1)"])
    expect(aTight.map(fmt)).toEqual(['legacy-easing｜x.css:1｜cubic-bezier(.4,0,.2,1)'])
  })

  it('反事实形态 B（裸值式：CSS 允许省略 cubic-bezier 函数名）', () => {
    const b = scanLegacyEasing('transition-timing-function: 0.4, 0, 0.2, 1;', 'x.css')
    expect(b.map(fmt)).toEqual(['legacy-easing｜x.css:1｜0.4, 0, 0.2, 1'])
  })

  it('官方 M3 四条曲线不转红（尤其 standard/emphasized 同值是官方事实，不得判红）', () => {
    for (const curve of ['cubic-bezier(0.2, 0, 0, 1)', 'cubic-bezier(0.05, 0.7, 0.1, 1)', 'cubic-bezier(0.3, 0, 0.8, 0.15)']) {
      expect(scanLegacyEasing(`transition: all 200ms ${curve};`, 'x.css')).toEqual([])
    }
  })

  it('tokens.css 允许存在 legacy 取值，但声明行必须带 legacy 标记', () => {
    const unmarked = 'page {\n  --motion-x: cubic-bezier(0.4, 0, 0.2, 1);\n}\n'
    const marked = 'page {\n  --motion-x: cubic-bezier(0.4, 0, 0.2, 1); /* MD2 legacy，禁止消费 */\n}\n'
    expect(scanTokensLegacyMarker(unmarked).map(fmt)).toEqual([
      `legacy-easing-tokens-marker｜${TOKENS_CSS_REL}:2｜--motion-x: cubic-bezier(0.4, 0, 0.2, 1);`,
    ])
    expect(scanTokensLegacyMarker(marked)).toEqual([])
  })

  it('全仓：src/** 与 tailwind.config.ts 的可执行部分零 legacy 缓动', () => {
    const hits = scanAll(RULES[0]!)
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 2 · 未接令牌的圆角消费不得回流', () => {
  it('反事实形态 A（任意值指向数字/非 shape 令牌，两种换皮）', () => {
    const vw = scanRadiusOffToken('<view class="rounded-[0.65vw]" />', 'x.vue')
    const rem = scanRadiusOffToken('<view class="rounded-[0.5rem]" />', 'x.vue')
    const badToken = scanRadiusOffToken('<view class="rounded-[var(--md-shape-largish)]" />', 'x.vue')
    expect(vw.map(fmt)).toEqual(['radius-offtoken｜x.vue:1｜rounded-[0.65vw]'])
    expect(rem.map(fmt)).toEqual(['radius-offtoken｜x.vue:1｜rounded-[0.5rem]'])
    expect(badToken.map(fmt)).toEqual(['radius-offtoken｜x.vue:1｜rounded-[var(--md-shape-largish)]'])
  })

  it('反事实形态 B（方向类挂非档位后缀 = 死类名，Tailwind 产不出声明）', () => {
    for (const bad of ['rounded-t-md', 'rounded-t-2xl', 'rounded-tr-3xl', 'rounded-b-loose']) {
      expect(scanRadiusOffToken(`<view class="${bad}" />`, 'x.vue').map((v) => v.form), bad).toEqual([bad])
    }
  })

  it('档位消费与裸方向类不转红（AGENTS.md 已登记：方向类取 DEFAULT = medium）', () => {
    const ok = [
      'rounded-[var(--md-shape-medium)]',
      'rounded',
      'rounded-xs',
      'rounded-t',
      'rounded-b',
      'rounded-tr',
      'rounded-t-lg',
      'rounded-t-sm',
      'rounded-t-xl',
      'rounded-t-full',
      'rounded-b-none',
    ]
    for (const cls of ok) {
      expect(scanRadiusOffToken(`<view class="${cls}" />`, 'x.vue').map((v) => v.form), cls).toEqual([])
    }
  })

  it('全仓：白名单外零未接令牌的圆角消费', () => {
    const hits = scanAll(RULES[1]!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 3 · 正文类内容上的自选行高不得回流', () => {
  it('反事实形态 A（尺寸档位 + 具名行高档位）', () => {
    const a = scanSelfChosenLeading('<text class="text-body-medium leading-snug">x</text>', 'x.vue')
    expect(a.map(fmt)).toEqual(['self-chosen-leading｜x.vue:1｜text-body-medium + leading-snug'])
  })

  it('反事实形态 B（尺寸档位 + 任意值行高；且 script 里的类名字符串同样抓得到）', () => {
    const b = scanSelfChosenLeading('<text class="text-label-medium leading-[1.375]">x</text>', 'x.vue')
    expect(b.map(fmt)).toEqual(['self-chosen-leading｜x.vue:1｜text-label-medium + leading-[1.375]'])
    const c = scanSelfChosenLeading(
      "<script setup lang=\"ts\">\nconst cls = 'text-body-large leading-[44rpx] italic'\n</script>",
      'x.vue',
    )
    expect(c.map(fmt)).toEqual(['self-chosen-leading｜x.vue:2｜text-body-large + leading-[44rpx]'])
  })

  it('反事实形态 C（**反引号**模板字符串：三种引号口径必须一致）', () => {
    // `quotedLiterals` 曾只认双/单引号 ⇒ `<script setup>` 里的模板字符串类名隐形。
    // 同包 `iconConsumption.test.ts:64` 早就把反引号算进引号集合了，两套口径不一致。
    // 前提：三种引号对**同内容**必须给出同一条违规（否则「加个反引号就绕过」成立）
    const body = 'text-body-medium leading-tight'
    for (const [q, lit] of [
      ['双', `"${body}"`],
      ['单', `'${body}'`],
      ['反', `\`${body}\``],
    ] as const) {
      const src = `<script setup lang="ts">\nconst cls = ${lit}\n</script>`
      expect(scanSelfChosenLeading(src, 'x.vue').map(fmt), `${q}引号`).toEqual([
        'self-chosen-leading｜x.vue:2｜text-body-medium + leading-tight',
      ])
    }
  })

  it('注释里的类名提及不转红（否则门禁把说明文字也判红，无法留痕）', () => {
    const commented = '<!-- 正文条骨架：对齐真实正文 p-4 + leading-[44rpx] + mb-4 -->\n<text class="text-body-medium">x</text>'
    expect(scanSelfChosenLeading(stripComments(commented), 'x.vue')).toEqual([])
  })

  it('单独的行高不转红（无尺寸类时不存在「覆盖档位行高」）', () => {
    expect(scanSelfChosenLeading('<text class="leading-snug">x</text>', 'x.vue')).toEqual([])
    expect(scanSelfChosenLeading('<view style="line-height: 1.4" />', 'x.vue')).toEqual([])
  })

  it('全仓：白名单外零「正文类 + 自选行高」同现', () => {
    const hits = scanAll(RULES[2]!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 4 · 状态层不得改用预计算实色', () => {
  it('反事实形态 A（CSS 值位置直接 var 取实色）', () => {
    const a = scanSolidStateLayer('<style>.a { background-color: var(--md-state-pressed-primary); }</style>', 'x.vue')
    expect(a.map(fmt)).toEqual(['solid-state-color｜x.vue:1｜var(--md-state-pressed-primary)'])
  })

  it('反事实形态 B（Tailwind 任意值类里 var 取实色）', () => {
    const b = scanSolidStateLayer('<view class="active:bg-[var(--md-state-pressed-on-surface)]" />', 'x.vue')
    expect(b.map(fmt)).toEqual(['solid-state-color｜x.vue:1｜var(--md-state-pressed-on-surface)'])
  })

  it('反事实形态 C（带空白与 fallback 的 var 换皮）', () => {
    const c = scanSolidStateLayer('<view style="background-color: var( --md-state-disabled-container , #eee )" />', 'x.vue')
    expect(c.map(fmt)).toEqual(['solid-state-color｜x.vue:1｜var( --md-state-disabled-container ,'])
  })

  it('官方 alpha 叠加层令牌不转红', () => {
    expect(scanSolidStateLayer('<view class="active:bg-layer-pressed-primary" />', 'x.vue')).toEqual([])
    expect(scanSolidStateLayer('<view style="background-color: var(--md-state-layer-pressed-primary)" />', 'x.vue')).toEqual([])
  })

  it('全仓：src/** 零 var(--md-state-pressed-*) / var(--md-state-disabled-*) 消费', () => {
    const hits = scanAll(RULES[3]!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 5 · 不得新增旧 Fluent 语义别名消费', () => {
  it('反事实形态 A（CSS 值位置 var）', () => {
    const a = scanLegacyColorAlias('<view style="color: var(--colorOverlayForeground)" />', 'x.vue')
    expect(a.map(fmt)).toEqual(['legacy-color-alias｜x.vue:1｜--colorOverlayForeground'])
  })

  it('反事实形态 B（Tailwind 任意值类里 var）', () => {
    const b = scanLegacyColorAlias('<text class="text-[var(--colorBrandBackground)]" />', 'x.vue')
    expect(b.map(fmt)).toEqual(['legacy-color-alias｜x.vue:1｜--colorBrandBackground'])
  })

  it('反事实形态 C（字符串键：运行时按变量名取值）', () => {
    const c = scanLegacyColorAlias("<script setup lang=\"ts\">\nconst key = '--colorNeutralStroke1'\n</script>", 'x.vue')
    expect(c.map(fmt)).toEqual(['legacy-color-alias｜x.vue:2｜--colorNeutralStroke1'])
  })

  it('M3 语义名不转红（--md-* 与 role 名都不是旧别名）', () => {
    expect(scanLegacyColorAlias('<view style="color: var(--md-on-surface)" />', 'x.vue')).toEqual([])
    expect(scanLegacyColorAlias('<text class="text-surface-on">x</text>', 'x.vue')).toEqual([])
  })

  it('全仓：tokens.css 定义现场之外零旧别名出现', () => {
    const hits = scanAll(RULES[4]!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 6 · 不得出现裸 :focus / :focus-visible', () => {
  it('反事实形态 A（CSS 选择器裸 :focus）', () => {
    const a = scanBareFocus('<style>.a:focus { outline: none; }</style>', 'x.vue')
    expect(a.map(fmt)).toEqual(['bare-focus｜x.vue:1｜:focus'])
  })

  it('反事实形态 B（Tailwind 变体 focus:，同样落到 :focus 伪类）', () => {
    const b = scanBareFocus('<view class="focus:bg-primary" />', 'x.vue')
    expect(b.map(fmt)).toEqual(['bare-focus｜x.vue:1｜focus:'])
    const c = scanBareFocus('<view :class="{ \'focus:bg-primary\': cond }" />', 'x.vue')
    expect(c.length).toBe(1)
  })

  it('反事实形态 C：focus-visible **必须**转红（ADR-0207 决策 5 结论 1「不写」）', () => {
    // 这条用例**曾经**是反的：断言 focus-visible 不转红，注释称它是「无障碍关键路径」，
    // 而那是被 ADR-0207 决策 5 推翻的旧措辞。门禁据此放行的正是封闭清单禁止的死类名。
    expect(scanBareFocus('<style>.a:focus-visible { outline: none; }</style>', 'x.vue').map(fmt)).toEqual([
      'bare-focus｜x.vue:1｜:focus-visible',
    ])
    expect(scanBareFocus('<view class="focus-visible:bg-primary" />', 'x.vue').map(fmt)).toEqual([
      'bare-focus｜x.vue:1｜focus-visible:',
    ])
  })

  it('反事实形态 D：focus-within **必须**转红（Tailwind 的真变体，收紧判据时新开的 fail-open 缺口）', () => {
    // 收紧到 `:focus(?:-visible)?(?![\w-])` 时，尾边界把 `-` 也挡了 ⇒ `:focus-within` /
    // `focus-within:` 整体放行。它编译出的选择器与 `:focus` 同型，同样是死类名。
    expect(scanBareFocus('<style>.a:focus-within { outline: none; }</style>', 'x.vue').map(fmt)).toEqual([
      'bare-focus｜x.vue:1｜:focus-within',
    ])
    expect(scanBareFocus('<view class="focus-within:bg-primary" />', 'x.vue').map(fmt)).toEqual([
      'bare-focus｜x.vue:1｜focus-within:',
    ])
  })

  it('阳性对照：同前缀但非焦点语义的名字不得误伤', () => {
    // 判据收紧到 focus-visible/-within 后，仍不能误伤 `focusable` / `focusRing` / `autofocus`
    // 这类前缀相同的标识符——收紧判据很容易变成误报洪水，而误报会逼人加白名单，白名单会掩盖真缺陷。
    const CONTROLS = [
      // ↓ 前三个是**子串级**对照：只能挡住 `/\bfocus/` 这种朴素过宽
      '<view class="focusable" />',
      '<view class="focus-ring" />',
      '<input autofocus />',
      // ↓ 下面三个是**边界级**对照：串里确实含 `:focus` / `focus:`，只有带边界的判据才不误伤
      '<view :focusable="true" />',
      '<view class="has-focus:bg-primary" />',
      '<view class="peer-focus:bg-surface" />',
    ]
    // 一次收集**全部**误伤样本（而不是逐个断言、只看第一个就停）：判据一旦变宽，
    // 报错信息要能指出**哪几个**对照在扛事、哪几个只是摆设。
    const falsePositives = CONTROLS.flatMap((ok) =>
      scanBareFocus(ok, 'x.vue').map((v) => `${ok} ⇒ ${fmt(v)}`),
    )
    expect(falsePositives, '阳性对照被误伤').toEqual([])

    // ⚠️ 对照必须**自己证明是 load-bearing**：把判据退化成朴素的 `/:focus/` + `/focus:/`
    // （无边界），边界级对照会被误伤。若它们在朴素判据下也不红，那它们只是摆设 ——
    // 本轮 review 的老对照 4 个里 3 个就栽在这里（`focusable` / `focus-ring` / `autofocus`
    // 连冒号都没有，挡不住边界级过宽，也就是挡不住 `(?![\w-])` / `(?<![\w-])` 这两个机制）。
    const NAIVE = [/:focus/g, /focus:/g]
    const BOUNDARY_CONTROLS = ['<view :focusable="true" />', '<view class="has-focus:bg-primary" />']
    for (const ok of BOUNDARY_CONTROLS) {
      expect(
        NAIVE.some((re) => re.test(ok)),
        `${ok}：朴素判据下也应被命中 —— 不然它不构成边界对照，无法区分现行判据与过宽判据`,
      ).toBe(true)
    }
  })

  it('全仓：零裸 :focus / :focus-visible', () => {
    const hits = scanAll(RULES[5]!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 7 · 模板内不得出现裸图标字形', () => {
  it('反事实形态 A（符号/几何/杂项区码位作裸文本）', () => {
    const a = scanIconGlyph('<template><text>♥</text></template>', 'x.vue')
    expect(a.map((v) => v.form)).toEqual(['U+2665 ♥'])
    const b = scanIconGlyph('<template><text class="text-[6.4vw]">↻</text></template>', 'x.vue')
    expect(b.map((v) => v.form)).toEqual(['U+21BB ↻'])
  })

  it('反事实形态 B（emoji 区码位）', () => {
    const b = scanIconGlyph('<template><text>💬</text></template>', 'x.vue')
    expect(b.map((v) => v.form)).toEqual(['U+1F4AC 💬'])
  })

  it('反事实形态 C（私有区码位：图标字体的落点）', () => {
    const c = scanIconGlyph('<template><text>\uE000</text></template>', 'x.vue')
    expect(c.map((v) => v.form)).toEqual(['U+E000 \uE000'])
  })

  it('script 区 / 注释 / 日文标点与假名不转红（否则门禁在任何日文文案上恒红）', () => {
    expect(scanIconGlyph('<script setup lang="ts">const s = "♥"\n</script>', 'x.vue')).toEqual([])
    expect(scanIconGlyph('<template>\n  <!-- ♥ -->\n  <text>「」。、』</text>\n</template>', 'x.vue')).toEqual([])
    expect(scanIconGlyph('<template><text>ぁあア</text></template>', 'x.vue')).toEqual([])
    expect(scanIconGlyph('<template><text>Ａ１（）</text></template>', 'x.vue')).toEqual([])
  })

  it('反事实：文本节点报的行号必须等于**原文件**里的真实行号（script 在前也不能前移）', () => {
    // 本仓 SFC 约定是 `<script setup>` 在前。`templateOf` 曾把 script/style **整段删除**，
    // 于是文本节点的偏移（region.index 恒为 0）落在「剥过的文本」上，行号系统性偏小
    // （反事实已实跑：真实第 9 行报成第 5 行，改成等长掩码后报 9）。属性区恰好没暴露这个 bug，所以更隐蔽。
    const src = [
      '<script setup lang="ts">', // 1
      '// 说明注释：♥ 只是注释里的字形，不该被抓，也不该让行号前移', // 2
      'const tone = ref<string>(``)', // 3
      '</script>', // 4
      '', // 5
      '<template>', // 6
      '  <text>♥</text>', // 7 ← 人工量得：♥ 在第 7 行
      '</template>', // 8
    ].join('\n')

    // 机制前提：掩码必须保住**总长度与行数**，否则「第 7 行」无从谈起
    const masked = templateOf(src)
    expect(masked.length, '掩码改变了总长度 ⇒ 偏移与行号不再指向原文件').toBe(src.length)
    expect(masked.split('\n').length, '掩码改变了行数 ⇒ 行号参照系已错').toBe(src.split('\n').length)
    // 前提：脚本区与注释里的字形确实没被抓（抓到了就不是「文本节点行号」这个命题）
    expect(src.split('\n')[6]).toContain('♥')

    const hits = scanIconGlyph(src, 'x.vue')
    expect(hits.map((v) => [v.form, v.line])).toEqual([['U+2665 ♥', 7]])
  })

  it('全仓：白名单外零裸图标字形', () => {
    const hits = scanAll(RULES.find((r) => r.id === 'icon-glyph')!).filter((v) => !isWhitelisted(v))
    expect(hits.map(fmt)).toEqual([])
  })
})

describe('规则 8 · 组件内不得自行声明 @font-face', () => {
  const RULE = () => RULES.find((r) => r.id === 'stray-font-face')!

  it('反事实形态 A（组件 <style> 内的相对 url —— 正是真机踩坑的形态）', () => {
    // Lynx 的 @font-face url() 只吃远程地址与 base64；打包器会把 url('./x.ttf')
    // 改写成 webpack:///static/x.<hash>.ttf，原生端**不解析** ⇒ 全站图标豆腐块 ⊠。
    const a = scanStrayFontFace('<style>@font-face { src: url("./material.ttf"); }</style>', 'X.vue')
    expect(a.map((v) => v.form)).toEqual(['@font-face'])
  })

  it('反事实形态 B（base64 内联同样不许写在组件里 —— 唯一合法位置是全局 icon-font.css）', () => {
    // 只拦「相对 url」是不够的：组件内再写一份 base64 同样制造第二份字体事实源，
    // 漂移后无从发现。合法位置只有 src/styles/icon-font.css（生成脚本产物）。
    const b = scanStrayFontFace("@font-face { font-family: X; src: url('data:font/ttf;base64,AAA'); }", 'X.vue')
    expect(b.map((v) => v.form)).toEqual(['@font-face'])
  })

  it('反事实形态 C：全仓零组件级 @font-face（生成产物 styles/icon-font.css 豁免）', () => {
    const hits = scanAll(RULE()).filter((v) => !isWhitelisted(v))
    expect(
      hits.map(fmt),
      '出现组件级 @font-face ⇒ 字体可能不加载（webpack:/// 不可解析）⇒ 图标豆腐块。' +
        '正确做法：字体由 src/styles/icon-font.css 提供（generate-icon-subset.py 产出的 base64），' +
        '组件里用 <AppIcon>。',
    ).toEqual([])
  })

  it('反事实形态 D：往 icon-font.css 里塞**第二份** @font-face 必须转红（豁免是单份，不是整文件）', () => {
    // 这条是本轮 review 的 MAJOR：豁免按**文件**粒度生效时，往产物里追加
    // `@font-face { src: url("./material.ttf") }` 整块被跳过 ⇒ 命中恒为 0 ⇒ 守卫不转红，
    // 而这正是规则 8 要消灭的形态（相对 url ⇒ 私用区码点豆腐块 ⊠）。
    const rel = ICON_FONT_CSS_REL
    const real = CLEAN.get(rel) ?? ''
    // 前提 1：真实产物里恰有 1 份 —— 否则「单份豁免」无从对照
    expect(scanStrayFontFace(real, rel).length, '前提：产物里应恰有 1 份 @font-face').toBe(1)
    const injected = `${real}\n@font-face { font-family: "Broken"; src: url("./material.ttf"); }\n`
    // 前提 2：注入后**裸扫描**看到 2 份 —— 否则「豁免吃掉了 1 份」这个解释不成立
    expect(scanStrayFontFace(injected, rel).length, '前提：注入后裸扫描应看到 2 份 @font-face').toBe(2)

    const hits = scanFile(RULE(), rel, injected)
    // 期望行号是**人工算**的：注入块 = 原文 + 一个换行 + 块首行 ⇒ 原文行数 + 2
    const secondFaceLine = real.split('\n').length + 1
    expect(
      hits.map(fmt),
      '单份豁免只应吃掉第 1 份；第 2 份（相对 url = 真机踩坑形态）必须漏出来判红',
    ).toEqual([`stray-font-face｜${rel}:${secondFaceLine}｜@font-face`])
  })

  it('接线断言：全局 @font-face **恰有一份且是 base64 内联**；App.vue 的 @import 在', () => {
    // 上一条只说「组件里不许写」，若有人把**全局那一份**删掉，它照样全绿而字体不加载。
    // 规则 8 抓不到这种反向失效，所以必须单独锁住两个消费点。
    // 判据从「存在性」升为「**唯一性 + 内容绑定**」：只做 toMatch(/@font-face/) 的断言
    // 在「多塞一份坏的」之后仍然全绿（review 反事实已实跑），锁不住加载的那一份是谁。
    const css = FILES.find((f) => f.rel === ICON_FONT_CSS_REL)
    expect(css, `${ICON_FONT_CSS_REL} 不存在 ⇒ 字体无来源`).toBeDefined()
    expect(
      fontFaceProblems(css!.text),
      `${ICON_FONT_CSS_REL} 的内容判据没过：0 份 = 字体无来源；≥2 份 = 第二份字体事实源；` +
        '相对 url() 会被打包器改写成 webpack:/// ⇒ 原生端不解析 ⇒ 私用区码点豆腐块 ⊠',
    ).toEqual([])
    const app = FILES.find((f) => f.rel === 'src/App.vue')
    expect(app, 'src/App.vue 不存在').toBeDefined()
    expect(
      app!.text,
      "App.vue 没有 @import './styles/icon-font.css'（含 url(...) 包裹形态）⇒ @font-face 永不生效 ⇒ 私用区码点" +
        '回退默认字体 ⇒ 全站图标渲染成豆腐块 ⊠（真机实证过的缺陷）。',
    ).toMatch(ICON_FONT_IMPORT_RE)
  })

  it('反事实：唯一性/内容绑定必须各自被报出来（判据不是「存在性」）', () => {
    const base = "@font-face { font-family: 'M'; src: url('data:font/ttf;base64,AAA'); }"
    const second = '@font-face { font-family: "Broken"; src: url("./material.ttf"); }'
    const onlyRelative = '@font-face { font-family: "M"; src: url("./material.ttf"); }'
    // 前提：合法形态必须零问题（否则下面三条「有问题」不构成对照）
    expect(fontFaceProblems(base), '前提：合法 base64 内联必须零问题').toEqual([])
    expect(fontFaceProblems(`${base}\n${second}\n`), '多塞一份 ⇒ 必须报份数问题').not.toEqual([])
    expect(fontFaceProblems(onlyRelative), '唯一一份被换成相对 url ⇒ 必须报内容问题').not.toEqual([])
    expect(fontFaceProblems(''), '整份被删空 ⇒ 必须报 0 份').not.toEqual([])
  })

  it('反事实：@import 的两种书写形态都要认，且别的文件不算（否则格式归一就误报红）', () => {
    for (const ok of [
      "@import './styles/icon-font.css';",
      '@import "./styles/icon-font.css";',
      "@import url('./styles/icon-font.css');",
      '@import url("./styles/icon-font.css");',
      "@import url( './styles/icon-font.css' );",
      "@import './styles/icon-font.css' screen;",
    ]) {
      expect(ICON_FONT_IMPORT_RE.test(ok), ok).toBe(true)
    }
    for (const no of [
      "@import './styles/other.css';",
      "@import url('./styles/icon-font.css.map');",
      '/* @import url(./styles/icon-font.css) */',
    ]) {
      expect(ICON_FONT_IMPORT_RE.test(no), no).toBe(false)
    }
  })
})

// ═══════════════════════════ 用例 8：白名单自身纪律 ═══════════════════════════

describe('MD3 形态回流门禁 · 白名单自身纪律', () => {
  it('每条都带 rule / path / form / 非占位 reason，且 rule 是已知规则 id', () => {
    expect(WHITELIST.entries.length).toBeGreaterThanOrEqual(1)
    for (const e of WHITELIST.entries) {
      expect(RULE_IDS, `未知 rule：${e.rule}`).toContain(e.rule)
      expect(e.path, 'path 必须是相对包根的 posix 路径').toMatch(/^(src|tailwind\.config\.ts)/)
      expect(e.form, `${e.rule}｜${e.path} 缺 form`).not.toBe('')
      expect(e.reason, `${e.rule}｜${e.path}｜${e.form} 缺理由`).not.toBe('')
      expect(e.reason.length, `${e.rule}｜${e.path}｜${e.form} 的理由过短`).toBeGreaterThanOrEqual(10)
      // 纯占位理由（TODO/待补/xxx 之类）等于没写
      expect(e.reason, `${e.rule}｜${e.path}｜${e.form} 的理由是占位`).not.toMatch(/^(TODO|待补|待定|xxx|TBD)/i)
    }
  })

  it('白名单里的 path 必须真实存在（防路径漂移后整份白名单静默失效）', () => {
    const known = new Set(FILES.map((f) => f.rel))
    const missing = WHITELIST.entries.map((e) => e.path).filter((p) => !known.has(p))
    expect(missing, `白名单引用了不存在的文件：${missing.join(', ')}`).toEqual([])
  })

  it('白名单条目不重复', () => {
    const keys = WHITELIST.entries.map((e) => `${e.rule} ${e.path} ${e.form}`)
    expect(keys.length - new Set(keys).size).toBe(0)
  })

  it('白名单不放行整文件（每条都必须带 form —— 整文件豁免正是本仓反复出现的假绿）', () => {
    for (const e of WHITELIST.entries) {
      expect(e.form, `${e.rule}｜${e.path} 的 form 为空 = 整文件豁免`).not.toBe('')
    }
  })

  it('单份豁免（allowOnce）也必须带 form 与非占位 reason（否则又是一个没人看的字段）', () => {
    // `allowOnce.reason` 若没人断言，就是本轮 review 刚点名的 `liveFloor` 同款死字段 ——
    // 写着「豁免是有理由的」，实际理由写错/写空都不会有人发现。
    const slots = RULES.filter((r) => r.allowOnce !== undefined)
    expect(slots.length, '本仓当前应有单份豁免（规则 8 的 icon-font.css）；为 0 说明机制已废却还留着').toBeGreaterThanOrEqual(1)
    const known = new Set(FILES.map((f) => f.rel))
    for (const rule of slots) {
      const slot = rule.allowOnce!
      expect(known.has(slot.path), `${rule.id} 的 allowOnce.path 指向不存在的文件 ⇒ 豁免永不生效`).toBe(true)
      expect(slot.form, `${rule.id}｜${slot.path} 的 allowOnce.form 为空 = 整文件豁免`).not.toBe('')
      expect(slot.reason.length, `${rule.id}｜${slot.path} 的 allowOnce 理由过短`).toBeGreaterThanOrEqual(10)
      expect(slot.reason, `${rule.id}｜${slot.path} 的 allowOnce 理由是占位`).not.toMatch(/^(TODO|待补|待定|xxx|TBD)/i)
    }
  })
})

// ═══════════════════════════ 工具：供「白名单是精确匹配」的反事实复用 ═══════════════════════════

/** 白名单匹配是三元组精确匹配：同文件换形态不豁免、跨文件同形态不豁免（防白名单退化成整文件豁免） */
describe('MD3 形态回流门禁 · 白名单匹配粒度（精确三元组）', () => {
  const entry = WHITELIST.entries[0]!
  it('命中：三元组全等时放行', () => {
    expect(isWhitelisted({ rule: entry.rule, path: entry.path, form: entry.form, line: 1 })).toBe(true)
  })
  it('不命中：换形态不豁免', () => {
    expect(isWhitelisted({ rule: entry.rule, path: entry.path, form: `${entry.form}-换皮`, line: 1 })).toBe(false)
  })
  it('不命中：换文件不豁免', () => {
    expect(isWhitelisted({ rule: entry.rule, path: 'src/__nope__.vue', form: entry.form, line: 1 })).toBe(false)
  })
  it('不命中：换规则不豁免', () => {
    expect(isWhitelisted({ rule: '__nope__', path: entry.path, form: entry.form, line: 1 })).toBe(false)
  })
})


// ═══════════════════════════ 规则 9：骨架屏零阴影 ═══════════════════════════

describe('规则 9 · 骨架屏零阴影（ADR-0212 决策 2 规则 1 + 决策 7）', () => {
  const rel = 'src/pages/Watchlist.vue'
  const real = FILES.find((f) => f.rel === rel)!

  it('抽取器：掩码不改总长度 ⇒ 分支内报出的行号等于原文件行号（与规则 7 同一前提）', () => {
    const masked = templateOf(real.text)
    expect(masked.length, '掩码改变了总长度 ⇒ 行号参照系已错').toBe(real.text.length)
    expect(masked.split('\n').length).toBe(real.text.split('\n').length)
    // 前提：该文件确实有骨架分支，且分支落在第 170 行之后（跨过若干注释，掩码/删除两种实现才会分道扬镳）
    const branches = skeletonBranches(masked)
    expect(branches.length, '前提：Watchlist.vue 应有 1 个骨架分支').toBe(1)
    expect(real.text.split('\n')[lineOf(real.text, branches[0]!.contentStart) - 1]).toContain('skeleton')
  })

  it('反事实 A（阳性对照 · 构造形态）：内联骨架行带 elevation-1 → 必须判红', () => {
    const src = [
      '<template>',
      `  <view v-if="view === 'skeleton'">`,
      '    <view v-for="n in 5" class="bg-surface-container-lowest shadow-[var(--md-elevation-1)]" />',
      '  </view>',
      '</template>',
    ].join('\n')
    expect(scanSkeletonShadow(src, 'x.vue').map(fmt)).toEqual([
      'skeleton-shadow｜x.vue:3｜shadow-[var(--md-elevation-1)]',
    ])
  })

  it('反事实 A′：判据是**加载态分支**而非类名 —— 同一形态写在真实卡上不得转红', () => {
    // ⭐ 这是「区分骨架屏与真实卡片」的核心用例：两类元素在**判红元素之外逐字相同**，
    // 唯一区别是祖先分支的 `v-if` 条件里有没有 `'skeleton'`。
    const realCard = [
      '<template>',
      '  <view v-else>',
      '    <view v-for="item in list" class="bg-surface-container-lowest shadow-[var(--md-elevation-1)]" />',
      '  </view>',
      '</template>',
    ].join('\n')
    expect(scanSkeletonShadow(realCard, 'x.vue')).toEqual([])

    // 同一条的真实仓库版本：`UserRow.vue` 的**贴面列表行仍带 elevation-1**（票 #884 的未关闭存量），
    // 但它不在任何 `'skeleton'` 分支内 ⇒ 规则 9 必须判绿。
    // 判据能同时做到「骨架红 / 真实卡绿」，才说明它不是在扫 `elevation-1` 全文。
    //
    // ⚠️ 锚点换文件的原因（如实登记）：本条原先锚在 `Bookmarks.vue` 的真实卡上，
    // 而票 #883 已把那 34 处**贴面**卡的静止阴影全数归零（含 Bookmarks 的瀑布流卡），
    // 「同文件内骨架绿 / 真实卡红」这一形态在全仓已不复存在。换成 `UserRow.vue`
    // **不改变本条的语义**（仍是一个「不在 skeleton 分支内的真实卡带 elevation-1 ⇒ 判绿」），
    // 只是把「真实卡带 elevation-1」这个前提锚到票 #884 尚未处置的那一处。
    //
    // ⚠️ **锚点第二次迁移的原因（本条自身的设计缺陷，如实登记）**：
    // 上一次换锚的理由是「Bookmarks 的贴面卡已被 #883 归零」，换到了 `UserRow.vue`；
    // 但 `UserRow` 同样是一处**待处置的贴面欠账**（票 #884），本票把它删掉后，
    // 前提**又一次**消失 ⇒ **把反事实锚在「会变动的存量」上是设计缺陷**：
    // 每处置一处欠账就要改一次测试，改到最后只会剩下「找一个还没删的」这种反向激励。
    //
    // 正确锚点：语义稳定、**本就不该删**的一类 —— 遮罩块的浮起分层
    // （`bg-[var(--md-scrim)]` 上的 elevation 是高度语义，ADR-0212 决策 3 归 #884 的「遮罩」类，
    //  与「贴面归零」是不同裁定）。它不随任何票的推进而消失。
    const scrimCard = FILES.find((f) => f.rel === 'src/components/RestrictedNovelCard.vue')!.text
    expect(scrimCard, '前提：遮罩卡仍带 elevation-1（高度语义，语义稳定锚点）').toMatch(
      /shadow-\[var\(--md-elevation-1\)\]/,
    )
    expect(scanSkeletonShadow(scrimCard, 'src/components/RestrictedNovelCard.vue')).toEqual([])
  })

  it('反事实 B：显式零写法同样判红（决策 2 规则 3 —— 零阴影靠删除表达，不靠写 0）', () => {
    const mk = (cls: string): string =>
      `<template><view v-if="view === 'skeleton'"><view v-for="n in 5" class="${cls}" /></view></template>`
    expect(scanSkeletonShadow(mk('shadow-[var(--md-elevation-0)]'), 'x.vue').map((v) => v.form)).toEqual([
      'shadow-[var(--md-elevation-0)]',
    ])
    expect(scanSkeletonShadow(mk('shadow-none'), 'x.vue').map((v) => v.form)).toEqual(['shadow-none'])
    // 变体前缀同样命中（`active:` 态的阴影也是阴影）
    expect(scanSkeletonShadow(mk('active:shadow-[var(--md-elevation-1)]'), 'x.vue').length).toBe(1)
  })

  it('反事实 C：**往真实仓库的骨架行注入阴影**必须转红（不落盘，对象是本票刚归零的那一处）', () => {
    // ⭐ 阳性对照的仓库版本：形态 A 用构造字符串，只能证明「正则认得这个形态」；
    // 本条把**真实文件**的骨架行改回带阴影，判据必须当场转红 —— 证明它在扫真仓库、
    // 且定位到的正是本票处置的那一行。
    const branches = skeletonBranches(templateOf(real.text))
    const row = branches[0]!.rows[0]!
    const at = row.attrsStart + row.attrs.indexOf('class="') + 'class="'.length
    const injected = real.text.slice(0, at) + 'shadow-[var(--md-elevation-1)] ' + real.text.slice(at)
    expect(injected, '前提：注入必须真的改动了那一行').not.toBe(real.text)
    expect(scanSkeletonShadow(real.text, rel), '前提：未注入时必须为 0 条').toEqual([])

    const hits = scanSkeletonShadow(injected, rel)
    expect(hits.map(fmt)).toEqual([
      `skeleton-shadow｜${rel}:${lineOf(real.text, row.start)}｜shadow-[var(--md-elevation-1)]`,
    ])
  })

  it('反事实 D：注释与 script 区里的 skeleton 字样不构成骨架分支（否则门禁会漏过整类缺陷）', () => {
    const noise = [
      '<script setup lang="ts">',
      `// 历史：view === 'skeleton' 时给行加过 shadow-[var(--md-elevation-1)]`,
      "const cond = \"view === 'skeleton'\"",
      '</script>',
      '<template>',
      "  <!-- v-if=\"view === 'skeleton'\" shadow-[var(--md-elevation-1)] -->",
      '  <view v-else class="shadow-[var(--md-elevation-1)]" />',
      '</template>',
    ].join('\n')
    expect(scanSkeletonShadow(noise, 'x.vue')).toEqual([])
  })

  it('反事实 E：共享骨架组件的 scoped CSS box-shadow → 判红（类名扫描对它是盲区）', () => {
    const css = '<style>\n.card {\n  box-shadow: var(--md-elevation-1);\n}\n</style>'
    expect(scanSharedSkeletonShadow(css, 'src/components/SkeletonCard.vue').map(fmt)).toEqual([
      'skeleton-shadow-component｜src/components/SkeletonCard.vue:3｜box-shadow:',
    ])
  })

  it("反事实 F：未被 'skeleton' 条件包裹的区块不在本规则范围（口径边界，非漏网）", () => {
    // `RelatedInlineSection.vue` 的加载中网格是「与内容并列的独立区块」，不是 `'skeleton'` 分支。
    // 本条把这条边界钉成断言：口径有意不含它，日后要纳入口径得改这里，而不是让边界含糊。
    const parallel = [
      '<template>',
      '  <view v-if="list.length">',
      '    <view v-for="n in 4" class="shimmer rounded-[var(--md-shape-medium)]" />',
      '  </view>',
      '</template>',
    ].join('\n')
    expect(scanSkeletonShadow(parallel, 'x.vue')).toEqual([])
  })

  it('全仓：内联骨架分支内零阴影（规则 9 主判据）', () => {
    const hits = scanAll(RULES.find((r) => r.id === 'skeleton-shadow')!)
    expect(hits.map(fmt)).toEqual([])
  })

  it('全仓：三个纯骨架组件零阴影（含 scoped CSS 形态）', () => {
    const rule = RULES.find((r) => r.id === 'skeleton-shadow-component')!
    // 目标集必须恰是那三个（多一个 = 口径越界到真实内容共用组件上）
    expect(targetsOf(rule).map((f) => f.rel).sort()).toEqual([...SHARED_SKELETON_COMPONENTS].sort())
    expect(scanAll(rule).map(fmt)).toEqual([])
  })

  it('台账棘轮 A：9 个归零声明点逐条可解析、零阴影、且带「零阴影」明确表达', () => {
    const problems: string[] = []
    for (const site of SKELETON_ZERO_SITES) {
      const file = FILES.find((f) => f.rel === site.path)
      if (!file) {
        problems.push(`${site.path}：文件不存在，台账已死`)
        continue
      }
      const branches = skeletonBranches(templateOf(file.text))
      const rows = branches.flatMap((b) => b.rows.filter((r) => /v-for="([^"]*)"/.exec(r.attrs)?.[1] === site.forExpr))
      if (rows.length !== 1) {
        problems.push(
          `${site.path}：v-for="${site.forExpr}" 的骨架行解析到 ${rows.length} 个（应恰为 1）—— 骨架被改名/删除时必须同步台账`,
        )
        continue
      }
      const branch = branches.find((b) => b.rows.includes(rows[0]!))!
      const hits = scanSkeletonShadow(file.text, site.path)
      if (hits.length > 0) problems.push(`${site.path}：${hits.map(fmt).join(' / ')}`)
      const markers = zeroMarkerCount(file.text, file.text.slice(branch.contentStart, branch.contentEnd))
      if (markers === 0) {
        problems.push(
          `${site.path}：归零 marker 缺失（骨架分支内须留一条含「归零」与「ADR-0212 决策 7」的注释）`,
        )
      } else if (markers > 1) {
        problems.push(`${site.path}：归零 marker 重复 ${markers} 条`)
      }
    }
    expect(problems).toEqual([])
  })

  it('台账棘轮 B：全仓 marker 数 == 台账条数（多标与漏标都转红）', () => {
    // 为什么要有这条：台账 A 只保证「登记过的都归零并留痕」，管不住反向 ——
    // 有人给一个**不是**归零声明点的地方贴 marker，或把某个已归零点从台账里删掉。
    // 骨架分支带 marker 的**集合**必须与台账逐条相等，两个方向的漂移都在这里暴露。
    const marked: string[] = []
    for (const file of VUE_FILES) {
      for (const b of skeletonBranches(templateOf(file.text))) {
        if (zeroMarkerCount(file.text, file.text.slice(b.contentStart, b.contentEnd)) > 0) {
          const forExpr = b.rows.map((r) => /v-for="([^"]*)"/.exec(r.attrs)?.[1]).join('+')
          marked.push(`${file.rel}｜v-for="${forExpr}"`)
        }
      }
    }
    const expected = SKELETON_ZERO_SITES.map((s) => `${s.path}｜v-for="${s.forExpr}"`)
    expect(
      marked.sort(),
      '带归零 marker 的骨架分支与台账不一致（多标 = 有人给非声明点贴了 marker；漏标 = 台账被删了条目）',
    ).toEqual(expected.sort())
  })
})

// ═══════════════════════════ 规则 10：贴面元素零阴影 ═══════════════════════════

describe('规则 10 · 贴面元素零阴影（ADR-0212 决策 1 映射表 + 决策 2 规则 1 + 决策 3）', () => {
  const FLAT = 'bg-surface-container-lowest'

  it('阳性对照 A（构造形态）：贴面卡带 elevation-1 → 必须判红', () => {
    const src = [
      '<template>',
      `  <view class="${FLAT} rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]" />`,
      '</template>',
    ].join('\n')
    expect(scanFlatSurfaceShadow(src, 'x.vue').map(fmt)).toEqual([
      'flat-surface-shadow｜x.vue:2｜shadow-[var(--md-elevation-1)]',
    ])
  })

  it('⭐ 区分「贴面」与「悬浮」：同样带 elevation-1，底色是悬浮档则**不得**转红', () => {
    // 这是本规则的核心用例：门禁**不是**在扫 `elevation-1` 全文。
    // 悬浮档（决策 1 表：菜单项 elevation-2 / 底部弹层 / 对话框 / snackbar 允许有阴影）
    // 加上已经归零的骨架屏行，都必须保持绿 —— 否则这条门禁会逼人把正确的浮层阴影也删掉。
    const floating = [
      '<template>',
      '  <view class="bg-surface-container-high shadow-[var(--md-elevation-2)]" />',
      '  <view class="bg-surface-container-highest shadow-[var(--md-elevation-3)]" />',
      '  <view class="bg-surface-container shadow-[var(--md-elevation-3)]" />',
      '  <view class="bg-primary-container shadow-[var(--md-elevation-3)]" />',
      '  <view class="bg-inverse-surface shadow-[var(--md-elevation-3)]" />',
      '  <view class="bg-[var(--md-scrim)] shadow-[var(--md-elevation-1)]" />',
      '</template>',
    ].join('\n')
    expect(scanFlatSurfaceShadow(floating, 'x.vue')).toEqual([])

    // 真实仓库证据 + 构造的贴面正样本，**一条判据同时切得开两者**。
    //
    // ⚠️ 原先这里锚的是 `UserRow.vue` 的真实贴面行（票 #884 的未关闭欠账），
    // 该阴影已在本票收尾时删除 ⇒ 锚点消失、断言空转。
    // 改用**构造的贴面正样本**：判别力不依赖「还有哪处欠账没删」，
    // 也就不会在每次清欠账时被迫改测试（那个模式会形成「找一个还没删的」的反向激励）。
    const menu = FILES.find((f) => f.rel === 'src/components/RefreshableList.vue')!
    expect(scanFlatSurfaceShadow(menu.text, menu.rel), '悬浮菜单项不得被本规则判红').toEqual([])
    const flatRow = `<template><view class="bg-surface-container-lowest shadow-[var(--md-elevation-1)]" /></template>`
    expect(scanFlatSurfaceShadow(flatRow, 'x.vue').map((v) => v.form)).toEqual([
      'shadow-[var(--md-elevation-1)]',
    ])
  })

  it('决策 2 规则 3：贴面上的显式零写法同样判红（零阴影靠删除，不靠写 0）', () => {
    const mk = (cls: string): string => `<template><view class="${FLAT} ${cls}" /></template>`
    expect(scanFlatSurfaceShadow(mk('shadow-[var(--md-elevation-0)]'), 'x.vue').map((v) => v.form)).toEqual([
      'shadow-[var(--md-elevation-0)]',
    ])
    expect(scanFlatSurfaceShadow(mk('shadow-none'), 'x.vue').map((v) => v.form)).toEqual(['shadow-none'])
    // 变体前缀同样命中（贴面元素上的 `active:shadow-…` 也是阴影）
    expect(scanFlatSurfaceShadow(mk('active:shadow-[var(--md-elevation-1)]'), 'x.vue').length).toBe(1)
  })

  it('阳性对照 B（真实仓库注入）：往真实贴面卡注入阴影必须当场判红（不落盘）', () => {
    // ⭐ 仓库版阳性对照：形态 A 只证明「正则认得这个形态」；
    // 本条把**真实文件**的贴面卡改回带阴影，判据必须转红 —— 证明它在扫真仓库、
    // 且定位到的正是本票处置掉的那一处。
    const rel = 'src/pages/IllustList.vue'
    const real = FILES.find((f) => f.rel === rel)!
    expect(scanFlatSurfaceShadow(real.text, rel), '前提：该文件的贴面卡已归零').toEqual([])

    const at = real.text.indexOf('class="bg-surface-container-lowest')
    expect(at, '前提：该文件确有贴面卡').toBeGreaterThanOrEqual(0)
    const injected =
      real.text.slice(0, at) + 'class="bg-surface-container-lowest shadow-[var(--md-elevation-1)] ' + real.text.slice(at + 'class="'.length)
    expect(injected, '前提：注入必须真的改动了那一行').not.toBe(real.text)
    expect(scanFlatSurfaceShadow(injected, rel).map(fmt)).toEqual([
      `flat-surface-shadow｜${rel}:${lineOf(real.text, at)}｜shadow-[var(--md-elevation-1)]`,
    ])
  })

  it('本票处置的 34 处贴面卡逐条可定位且已归零（防止「删了别处、漏了这里」）', () => {
    // 不用「marker + 台账」那套（#894 登记的脆弱面：marker 是行级匹配，换行即误红）。
    // 改用**机器可数的结构化断言**：枚举全仓每个贴面元素，断言带阴影的那些**全部命中白名单**
    // （即白名单外一个都不剩）。「这 34 处曾经有过阴影」由 git diff 证明；门禁只守「现在没有」这一面。
    const flatElements: string[] = []
    let elements = 0
    for (const file of VUE_FILES) {
      const masked = templateOf(file.text)
      let cursor = 0
      while (cursor < masked.length) {
        const t = tagAt(masked, cursor)
        if (!t) break
        if (!t.closing) {
          const classAt = CLASS_ATTR.exec(t.attrs)
          if (classAt && classAt[1]!.split(/\s+/).some((c) => FLAT_SURFACE_BG.has(c))) {
            elements++
            for (const m of classAt[1]!.matchAll(SHADOW_UTIL)) {
              const v: Violation = {
                rule: 'flat-surface-shadow',
                path: file.rel,
                line: lineOf(file.text, t.start),
                form: m[0],
              }
              if (!isWhitelisted(v)) flatElements.push(fmt(v))
            }
          }
        }
        cursor = t.openEnd
      }
    }
    // 前提：全仓确有大量贴面元素（否则本规则是空跑 ⇒ 这条断言恒真）
    expect(elements, '前提：全仓确有大量贴面元素（实测 64 个 <view> 带贴面底色）').toBeGreaterThanOrEqual(50)
    expect(flatElements, '仍有贴面元素带阴影，且未登记进白名单（票 #883 的处置漏了这里）').toEqual([])
  })

  it('反事实：注释区 / script 区 / 子元素的阴影都不构成「贴面元素自带阴影」', () => {
    // templateOf 已把 script / style / 注释整块掩码 ⇒ 注释里写完整 class 也不该判红。
    const noise = [
      '<script setup lang="ts">',
      `const c = '${FLAT} shadow-[var(--md-elevation-1)]'`,
      '</script>',
      '<template>',
      `  <!-- <view class="${FLAT} shadow-[var(--md-elevation-1)]" /> -->`,
      '  <view :class="rowClass" />',
      '</template>',
    ].join('\n')
    expect(scanFlatSurfaceShadow(noise, 'x.vue')).toEqual([])
  })

  it('全仓：贴面元素零阴影（规则 10 主判据，白名单外）', () => {
    const hits = scanAll(RULES.find((r) => r.id === 'flat-surface-shadow')!).filter(
      (v) => !isWhitelisted(v),
    )
    expect(hits.map(fmt)).toEqual([])
  })

  it('边界成对：内联 `style="box-shadow: …"` 同样判红（类名扫描对它是盲区）', () => {
    const src = `<template><view class="${FLAT}" style="box-shadow: var(--md-elevation-1);" /></template>`
    expect(scanFlatSurfaceShadow(src, 'x.vue').map(fmt)).toEqual([
      'flat-surface-shadow｜x.vue:1｜box-shadow:',
    ])
  })

  it('接线断言：scoped CSS 里的贴面 `box-shadow` 是**已知盲区**，本规则不覆盖（ADR 复核判据 3 记录）', () => {
    // 刻意**不**在此条转红：`<style>` 块被 templateOf 掩码掉了，贴面卡在 scoped CSS 里
    // 声明 box-shadow 本规则看不见（GlassCard.vue 那种形态）。把这条钉成断言，
    // 是为了防止后人误以为「贴面零阴影已全站覆盖」而漏掉这条通道 ——
    // 真要覆盖需要另一条独立规则（与规则 9 的 skeleton-shadow-component 同款形态）。
    const src = `<template><view class="${FLAT}" /></template>\n<style>\n.a { box-shadow: var(--md-elevation-1); }\n</style>`
    expect(scanFlatSurfaceShadow(src, 'x.vue')).toEqual([])
  })
})
