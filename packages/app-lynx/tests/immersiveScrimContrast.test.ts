// 沉浸卡 scrim 的文字对比度判据（issue #891）。
//
// ── 这条门禁在防什么 ──────────────────────────────────────────────────────
// 沉浸卡（推荐页作品卡 / 排行榜入口卡 / 小说介绍页）把文字叠在**不可预测**的作品图上。
// #891 实测：白字在标题行只有 **1.56:1**、作者行 **2.17:1**（远低于 AA 4.5），
// 肉眼判为「接近不可读」。
//
// ── 为什么判据必须**绝对** ────────────────────────────────────────────────
// 作品图每张不同 ⇒ 「渐变在该处有多深」不可能对所有图同时成立。
// 所以判据**不能**写成「比当前底色深多少」这类相对断言：底色接近某值时相对断言退化成恒真，
// 看上去有门槛、实际抓不到任何东西。这里一律断言**绝对下界 AA = 4.5**（WCAG 2.1 §1.4.3）。
//
// ── 与 Python 探针的关系 ──────────────────────────────────────────────────
// `scripts/scrim-contrast.py` 是**真机测量**工具（读截图、须先过校准锚点）；
// 本文件是**常驻门禁**（不碰设备、直接从 tokens.css 重算）。两者各司其职，
// 公式同为 WCAG 相对亮度；数值不一致时以本文件为准（它才是拦住回归的那道）。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
// #1003：底色块抽取改用结构化标签扫描（与 routeTransitionGate 共用一份实现）。
import {
  extractOpeningTags,
  extractTagContaining,
  readClassAttr,
  stripComments,
  templateBlock,
} from './helpers/vueTagScan'
// #1006：遍历扫描面与列表交错契约门禁共用一份实现（防止两份扫描面各自漂移）；
// 路径归一化同样共用一份，否则登记键与集合比对会漂成两种写法。
import { srcKey, walkProductionVue } from './helpers/walkProductionVue'

/** 沉浸卡源码树根（#1004 全仓发现的扫描根）。 */
const SRC_ROOT = path.resolve(__dirname, '../src')

/**
 * 真实沉浸卡的源码，原样读自实际消费点，用作 #1004 合成夹具的素材。
 *
 * ⚠️ 必须用**真实样例**，不能手写「自洽」的 class/style 串（测试硬约束 #2）。
 *    手写串会自洽地满足判据，却不代表仓里真有人这么写 —— 那样的夹具证明不了
 *    发现逻辑认的是真实形态。真实写法是 `style="background: var(--md-scrim-overlay)"`
 *    （渐变定义在令牌里，页面侧不套 linear-gradient），与手写猜测的形状并不相同。
 */
const REAL_CARD_SRC = fs.readFileSync(path.join(SRC_ROOT, 'pages/Recommended.vue'), 'utf-8')

/** WCAG 2.1 AA 通用门槛（取严的正文 4.5，而非大字 3.0）。 */
const AA = 4.5

type Rgb = readonly [number, number, number]

// ── WCAG 相对亮度（WCAG 2.1 §Relative luminance） ──────────────────────────

function lin(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** source-over 合成：`fg` 以 `alpha` 叠在**不透明** `bg` 上（作品图与页面底都是不透明底）。 */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, alpha))
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
}

// ── 令牌事实源：直接读 tokens.css，不抄副本 ────────────────────────────────
// ⚠️ 抄副本 = 同义反复（断言 A==B 而 B 是 A 的抄本）。这里现读真源。

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../src/styles/tokens.css'), 'utf-8')

type Palette = {
  selector: string
  inverseSurface: Rgb
  inverseOnSurface: Rgb
  /** 色板内全部 `--md-*` 令牌，用于把 .vue 里的 class **解析回**具体色值。 */
  tokens: Map<string, Rgb>
  /** ⚠️ 可为 undefined：只有默认块（page, .theme-sky）与 7 个 `.dark` 块**显式**声明
   *  `--md-scrim-overlay`，其余 6 套亮色板靠 CSS 层叠从 `page` 继承。少这一条不算错，
   *  但也别把它当「14 套色板都有」——那是把继承当声明。 */
  scrimOverlay?: string
}

function parseHex(raw: string): Rgb {
  const h = raw.trim().replace('#', '')
  if (h.length !== 6) throw new Error(`只支持 6 位 hex，实际 ${raw}`)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const PALETTES: Palette[] = (() => {
  const out: Palette[] = []
  // 主题块形如 `selector[, selector] {` … `}`（page + .theme-x / .theme-x.dark）
  const re = /^((?:page,\s*)?\.[\w.-]+(?:\s*,\s*\n\s*\.[\w.-]+)*)\s*\{([\s\S]*?)^\}/gm
  for (const [, selector, body] of TOKENS.matchAll(re)) {
    const inv = /--md-inverse-surface:\s*([^;]+);/.exec(body)
    const on = /--md-inverse-on-surface:\s*([^;]+);/.exec(body)
    const grad = /--md-scrim-overlay:\s*([^;]+);/.exec(body)
    if (inv && on) {
      const tokens = new Map<string, Rgb>()
      for (const t of body.matchAll(/--md-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
        tokens.set(t[1], parseHex(t[2]))
      }
      out.push({
        selector: selector.replace(/\s+/g, ' ').trim(),
        inverseSurface: parseHex(inv[1]),
        inverseOnSurface: parseHex(on[1]),
        tokens,
        scrimOverlay: grad ? grad[1].trim() : undefined,
      })
    }
  }
  return out
})()

// ── 渐变模型（记录**现状**并解释「为什么百分比渐变治不了」） ────────────────

type Stop = { pos: number; rgb: Rgb; alpha: number }
type RawStop = { pos: number | null; rgb: Rgb; alpha: number }

/** 按**顶层**逗号切色标 —— 不能直接 `split(',')`：`rgba(0, 0, 0, 0.82)` 自己就带逗号，
 *  直接切会把它撕成 `rgba(0` / ` 0` / ` 0` / ` 0.82)` 四段，然后解析失败。 */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseStops(css: string): Stop[] {
  const m = /linear-gradient\(\s*to\s+(\w+)\s*,([\s\S]*)\)\s*$/.exec(css.trim())
  if (!m) throw new Error(`不是 linear-gradient：${css}`)
  // 本仓三处 scrim 全是 to top（0% 在**下边**）；方向不认识就抛，别猜。
  if (m[1] !== 'top') throw new Error(`只支持 to top，实际 ${m[1]}`)
  const raw = splitTopLevel(m[2]).map((part): RawStop => {
    const pm = /([\d.]+)%\s*$/.exec(part)
    const rest = pm ? part.slice(0, pm.index).trim() : part
    const cm = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(rest)
    if (!cm) throw new Error(`色标解析不了：${part}`)
    return {
      pos: pm ? Number(pm[1]) / 100 : null,
      rgb: [Number(cm[1]), Number(cm[2]), Number(cm[3])] as Rgb,
      alpha: cm[4] === undefined ? 1 : Number(cm[4]),
    }
  })
  if (raw.length === 0) throw new Error('色标为空')
  return fillPositions(raw)
}

/** 补齐省略百分比的色标位置（CSS 语义：省略位置在相邻已声明位置间**均分**；
 *  首个省略 → 0%，末个省略 → 100%）。
 *
 * ⚠️ 把省略位置一律当 0% 会让渐变**顶端**那一档塌到盒子下沿：alpha 算得比真实值小
 * （标题处 0.089 而非 0.189），而**错的方向恰好是「更容易达标」**——于是依赖它的
 * 「现状不达标」断言照样绿，成为一条自己骗自己的绿。必须按 CSS 语义补齐。 */
function fillPositions(raw: RawStop[]): Stop[] {
  const n = raw.length
  const pos: (number | null)[] = raw.map((r) => r.pos)
  if (pos.every((p) => p === null)) {
    const step = 1 / Math.max(1, n - 1)
    return raw.map((r, i) => ({ pos: i * step, rgb: r.rgb, alpha: r.alpha }))
  }
  if (pos[n - 1] === null) pos[n - 1] = 1
  if (pos[0] === null) pos[0] = 0
  for (let pass = 0; pass < n; pass++) {
    for (let i = 1; i < n - 1; i++) {
      if (pos[i] === null && pos[i - 1] !== null && pos[i + 1] !== null) {
        pos[i] = ((pos[i - 1] as number) + (pos[i + 1] as number)) / 2
      }
    }
  }
  if (pos.some((p) => p === null)) throw new Error('存在无法确定位置的色标')
  return raw.map((r, i) => ({ pos: pos[i] as number, rgb: r.rgb, alpha: r.alpha }))
}

/** pos：0 = 盒子下沿，1 = 上沿。段外沿用最近端点。 */
function stopAt(stops: Stop[], pos: number): { rgb: Rgb; alpha: number } {
  const pts = [...stops].sort((a, b) => a.pos - b.pos)
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (pos <= first.pos) return { rgb: first.rgb, alpha: first.alpha }
  if (pos >= last.pos) return { rgb: last.rgb, alpha: last.alpha }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (a.pos <= pos && pos <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
      return {
        rgb: [
          Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
          Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
          Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
        ],
        alpha: a.alpha + (b.alpha - a.alpha) * t,
      }
    }
  }
  throw new Error('unreachable')
}

// ── 代表性底色组（含**纯白**这个最坏情况） ────────────────────────────────
// 纯白是最坏情况：任何黑色 scrim 叠在纯白上都最浅。
// 刻意包含非灰的色 —— alpha 合成逐通道进行，不能只测灰度。
const BASES: { name: string; rgb: Rgb }[] = [
  { name: '纯白（最坏情况）', rgb: [255, 255, 255] },
  { name: '近白米色', rgb: [250, 246, 236] },
  { name: '浅肤色', rgb: [242, 224, 210] },
  { name: '亮黄', rgb: [252, 240, 120] },
  { name: '中灰', rgb: [128, 128, 128] },
  { name: '暗部', rgb: [40, 44, 58] },
  { name: '纯黑', rgb: [0, 0, 0] },
]

// ── 三个消费点：门禁要确认它们**真的用上**了稳定底色 ────────────────────────
//
// ⚠️ 这里**不能**用 `toContain('bg-inverse-surface')`：三个文件里都还有**别的**、
//    与 scrim 无关的 inverse 元素（NovelIntro 的导出面板就在用），`toContain`
//    会被那些无关命中满足掉 —— 删掉 scrim 底色照样绿。
//    判据必须是结构性的：**底色块出现在标题元素之前**。

const CONSUMERS = [
  {
    name: '推荐页作品卡',
    rel: '../src/pages/Recommended.vue',
    // 标题元素的类串（本身已含 text-inverse-on-surface，故同时验证文字色走了配对）
    titleMarker: 'text-title-large font-semibold text-inverse-on-surface',
  },
  {
    name: '排行榜入口卡',
    rel: '../src/components/RankingEntryCard.vue',
    titleMarker: 'text-title-medium font-medium text-inverse-on-surface',
  },
  {
    name: '小说介绍页',
    rel: '../src/pages/NovelIntro.vue',
    titleMarker: 'text-title-large font-semibold text-inverse-on-surface',
  },
] as const

/**
 * 抽出全部「稳定底色块」的 class 值（#1003）。
 *
 * ⚠️ 按标签整体解析，**不按行取**。旧实现是 `<view\s+class="([^"]*)"`，它同时要求
 *    三条成立：标签名是 `<view` / class 是**第一个属性** / 引号是双引号。任一不成立
 *    ⇒ 底色块抽不到 ⇒ 报「找不到稳定底色块」，**报错指向错误根因**（底色块明明在，
 *    只是写法没被认出来）。三格真实失效面（已实测）：
 *      ① 单引号 `class='…'`；② `class` 前有其它属性；③ 非 `<view>` 标签。
 *    危害是 **fail-closed 误诊**，不是静默漏过：抽不到时消费点断言必红。
 *
 * 底色块的形状约定（**不可放宽**）：**同一个元素**的 class 里同时出现
 * `bg-inverse-surface` 与 `rounded-lg`。
 * ⚠️ 不能只找 bg-inverse-surface：三个消费点里都还有**别的**、与 scrim 无关的
 *    inverse 元素（NovelIntro 的导出面板就带 rounded-[var(--md-shape-medium)] +
 *    bg-inverse-surface），只找颜色会被那些无关命中满足掉 —— 删掉 scrim 底色照样绿。
 *    rounded-lg 是引入底色块时一并落的形状，正好把两者区分开。
 *
 * 形参暴露成「任意源码 → 抽到的 class 数组」，验收用例据此注入变异，不落盘、不改真文件。
 */
function extractPlates(src: string): string[] {
  return extractOpeningTags(src)
    .map((t) => t.class)
    .filter((cls) => cls.includes('bg-inverse-surface') && cls.includes('rounded-lg'))
}

/**
 * 单块底色块的 alpha 违规判定（#897 的真防线；#1003 提成共享函数）。
 *
 * **返回**违规描述；**没有违规返回 undefined** —— 用 `toBeUndefined()` 断言，
 * 失败时 vitest 直接打印违规描述（含实际类串），无需自己拼消息。
 *
 * ⚠️ 提成函数而不是内联正则的原因：验收组要验「三格写法抽到的底色块**能被点名 `/70`**」，
 *    若验收组自己抄一份正则，被验的就成了**副本**——真门禁那条判据删掉也不影响验收组变红
 *    （code-review 阻塞项）。共用一份 ⇒ 改坏哪边两边都红。
 */
function plateAlphaViolation(consumer: string, plate: string): string | undefined {
  const bgClass = plate.match(/bg-inverse-surface(?:\/\S+)?/)?.[0]
  if (bgClass === undefined) {
    return `${consumer} 底色块的 bg-inverse-surface 提取异常：${plate}`
  }
  if (bgClass !== 'bg-inverse-surface') {
    return (
      `${consumer}：底色块带了 alpha 修饰符 ${bgClass}（提取到的类串：${plate}）` +
      ` ⇒ 绝对下界判据的前提失效，须写成不带 /alpha 的 bg-inverse-surface`
    )
  }
  return undefined
}

/**
 * **交互态**变体前缀（#1005 轮 review F6 实测后新增）。
 *
 * ⚠️ 它们**不改变静息颜色** —— 未激活时该元素上唯一生效的就是静态类。因此
 *    `hover:text-primary` **不构成**「叠了两种颜色」的歧义；改动前把它计入，会让诊断
 *    宣称「谁胜出取决于 Tailwind 产物顺序」而**该说法不成立**，且 AGENTS.md「有意偏离 MD3」
 *    第 4 条已拍板「`hover` 在纯触屏判定为不适用」⇒ 纯触屏设备上更是纯粹误诊。
 *    实测改动前：标题追加 `hover:text-primary` ⇒ 判红，文案却是「无法取任一个」。属
 *    **本票新引入的 fail-closed 误诊面**，与 `missingPlateMessage` / `shadowNotState` 同族。
 *
 * ⚠️ **模式类前缀（`dark:` / `md:` 等）故意不在此列、仍要计入**：它们在某个条件下
 *    **确实**改变静息颜色，而本门禁的判据是**绝对下界**（逐 14 套色板算）⇒ 跨模式换色
 *    会让该下界失效。这类形态是**真**违规，不该被本条豁免。
 */
const STATE_VARIANT_CHAIN =
  /^(?:(?:hover|focus|focus-visible|focus-within|active|visited|disabled|checked):)+/

/**
 * **模式 / 响应式**变体前缀（`dark:` `md:` …）—— 与上面的交互态**相反**：
 * 它们在某个条件下**确实改变静息颜色**（`text-inverse-on-surface dark:text-primary`
 * 在暗色下就是 `primary`），而本门禁的判据是**逐 14 套色板算的绝对下界** ⇒ 漏判会产出
 * **假绿**（按亮色那对颜色算完就宣布暗色也达标）。故剥掉前缀后**照常计入**歧义判定。
 *
 * ⚠️ 宁可误判红也不可漏判红：前者会被人看一眼就改，后者是本仓反复消灭的那类**静默绿**。
 */
const MODE_VARIANT_PREFIX = /^(?:(?:dark|light|sm|md|lg|xl|2xl):)+/

/**
 * 从类串里筛出「**确实是颜色令牌**」的 `<prefix>-*` 名字（#1005/#1012 提成的共享内核）。
 *
 * ⚠️ 为什么必须按**令牌存在性**筛，而不是直接取第一个匹配：
 *    `text-title-large` 是**排版**档位（tailwind.config.ts 里注册的字面字号 `44rpx`，
 *    不是 `var(--md-*)` 令牌），不筛的话首个命中会是排版档位而非 `text-inverse-on-surface`。
 *
 * ⚠️ 这里**只筛、不选**（返回数组）：选哪一个由调用方按「恰好一个」的判据决定，
 *    理由见 `colourTokenViolation`。分开是为了让「筛选」这一步也能被验收组直接复用。
 *
 * ⚠️ `/<alpha>` 修饰符必须在**切分时截掉**：`bg-inverse-surface/70` 若整串当令牌名去查，
 *    `inverse-surface/70` 不是令牌 ⇒ 会被**整块滤掉** ⇒ 「零个」判红会抢在 #897 的
 *    `plateAlphaViolation` 之前触发，诊断指错根因（旧正则 `[\w-]+` 天然在 `/` 处截断）。
 */
function colourTokenNames(cls: string, prefix: 'bg' | 'text', ref: Palette): string[] {
  const names: string[] = []
  for (const raw of cls.split(/\s+/)) {
    if (raw === '') continue
    // 顺序要紧：**先**剥模式类前缀，**再**判交互态 —— 否则 `dark:hover:text-primary`
    // 这类混合链会因为 STATE 的 `^` 锚点匹配不上而被整体跳过。
    const bare = raw.replace(MODE_VARIANT_PREFIX, '')
    // ⚠️ 带**交互态**变体前缀的（`hover:text-primary` 等）**整体跳过**、不计入歧义：
    //    未激活时该元素上唯一生效的就是静态类，它们不构成「叠了两种颜色」。
    //    ⚠️ 不是「剥掉前缀后计入」—— 那等于把同一个歧义换个名字重新数一遍。
    if (STATE_VARIANT_CHAIN.test(bare)) continue
    if (!bare.startsWith(`${prefix}-`)) continue
    const name = bare.slice(prefix.length + 1).replace(/\/.*$/, '')
    if (ref.tokens.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 单个元素的颜色令牌**歧义**判定（#1012 洞 1）。
 *
 * **返回** undefined = 合规（恰好一个颜色令牌）；返回字符串 = 违规描述（含实际类串与
 * 全部命中），vitest 直接打印，无需自己拼消息。形状与 `plateAlphaViolation` 一致。
 *
 * ⚠️ 为什么判据是「**恰好一个**」而不是「取第一个」（本仓反复消灭的那类**恒真**）：
 *    一个元素上叠了**两个**颜色 utility 时，谁在真实渲染里胜出取决于 **Tailwind 产物的
 *    样式表顺序**，**不取决于**属性里的书写顺序 ⇒ 取任意一个，都是在算一个**未必被渲染**
 *    的对比度数字，而判据还会**照常全绿**。
 *    实测（#1012，两侧各一）：往 NovelIntro 标题追加 `text-primary`、往稳定底色块追加
 *    `bg-surface-container`，本文件 **50 个用例全部照样绿**，对比度数字纹丝不动。
 *    ⇒ 正确处置是**报歧义判红**，不是「挑一个算」。渲染顺序不可判定这一点，
 *      正是判红的理由，而不是放过它的理由。
 *
 * ⚠️ 提成共享函数而不内联正则，原因与 `plateAlphaViolation` 同：验收组若自己抄一份
 *    正则，被验的就成了**副本** —— 真门禁那条判据删掉也不影响验收组变红。
 */
function colourTokenViolation(
  consumer: string,
  role: string,
  cls: string,
  prefix: 'bg' | 'text',
  ref: Palette,
): string | undefined {
  const names = colourTokenNames(cls, prefix, ref)
  if (names.length === 1) return undefined
  const found = names.length === 0 ? '零个' : `${names.length} 个（${names.join('、')}）`

  return (
    `${consumer} ${role}的 ${prefix}-* 颜色令牌必须**恰好一个**` +
    `（渲染时哪个胜出取决于 Tailwind 产物顺序、不取决于书写顺序，故无法取任一个），` +
    `实际抽到 ${found}：${cls}`
  )
}

/**
 * 标题标签的**实写** class（#1012 洞 2；提成共享函数）。
 *
 * `titleMarker` 在此**只用于定位**，不作解析输入 —— 它是 `CONSUMERS` 里的**期望值**，
 * 而非源文件实写内容。此前 `resolve(c.titleMarker, 'text')` 把它直接当输入 ⇒ 文字色一侧
 * 对源文件改动**零反应**：needle 只要还是连续子串，追加在它后面的任何类名都判不到。
 *
 * **返回** undefined = needle 未能定位到一个开标签（调用方据此判红）。
 * 返回空串 = 标签在、但没有 class 属性 ⇒ 下游 `colourTokenViolation` 会以「零个」判红。
 *
 * ⚠️ 提成函数而不让调用方各自拼 `extractTagContaining` + `readClassAttr`：验收组要验的
 *    正是这条**组合路径**，两处各拼一遍的话，真门禁把其中一步删掉验收组仍会绿。
 *
 * ⚠️⚠️ **必须先 `templateBlock` 收窄到 `<template>` 块**（#1005 轮 review 实测，S5）：
 *    `extractTagContaining` 内部只 `stripComments`，**不剥 `<script>` 块**。三个消费点的
 *    SFC 布局都是 `<script>` 在第 1 行、`<template>` 在后（NovelIntro 1 / 337、
 *    Recommended 1 / 360、RankingEntryCard 1 / 109）⇒ **script 里的同 needle 字面量必然排在
 *    真标签之前**。
 *    实测：往 `<script setup>` 里塞一行同 needle 的标签字面量，再给真标题追加第二个颜色类
 *    ⇒ **本函数返回 script 字面量里那个标签**，两条颜色判据**一条都没红**，唯一红的是旧顺序
 *    断言且**根因指错**（`idx 58` = script 内的 needle）。
 *    ⇒ 这正是 #1003 已经踩死并修好的那一族（`templateBlock` 注释里逐条记着「两种配对方式
 *      都错在没先把 script 摘出去」）。**新路径不得绕开它。**
 */
function titleTagClassOf(src: string, titleMarker: string): string | undefined {
  const tag = extractTagContaining(templateBlock(src), titleMarker)
  return tag === undefined ? undefined : readClassAttr(tag)
}

/** `CONSUMERS` 单项的类型（该常量是 `as const`，故由 typeof 派生而非手写一份）。 */
type Consumer = (typeof CONSUMERS)[number]

/** 单个消费点的颜色判定结果（#1012）。 */
interface ConsumerColours {
  /** 标题标签的实写 class（needle 定位失败时为空串）。 */
  titleClass: string
  /**
   * 标题 needle 在 **`templateBlock(src)` 作用域内**的下标。
   * ⚠️ 必须与底色块下标**同一坐标系**（都取自 `templateBlock(src)`）—— 否则 `<script>`
   *    里的同 needle 字面量会让标题下标指到 script 内、结构断言误诊（#1005 轮 review F7）。
   */
  titleIdx: number
  /** 标题的颜色令牌（判定合规时恰有一个）。 */
  titleToken: string | undefined
  /** 与 `extractPlates(src)` 逐块对齐的底色令牌。 */
  plateTokens: (string | undefined)[]
  /** 全部违规描述以「；」拼接；**空串 = 合规**。 */
  violation: string
}

/**
 * 判定一个消费点的「标题 + 各底色块，颜色令牌是否恰好一个」（#1012 洞 1 + 洞 2）。
 *
 * ⚠️⚠️ **提成函数的全部理由**（#1005 轮 code-review 实测，阻塞项 F1）：此前真门禁在
 *    describe 内**内联**调 `colourTokenViolation`，验收组也**直接**调它 ⇒ 两者共享的只是
 *    **函数**、不是**接线**。实测三种破坏性变异 —— ① 删掉真门禁两处颜色判定的
 *    `expect(...).toBeUndefined()`；② 只删 bg 侧那处；③ 把标题退回读 `CONSUMERS` 常量
 *    （即 #1012 洞 2 的**修复前**行为）—— **全部 57/57 照样全绿**。即「洞 1 / 洞 2 已修复」
 *    这件事**没有任何机器防线**，与本文件 `:337-339`、`:730-731` 自己立的规矩直接冲突。
 *    ⇒ 现在真门禁**只经由本函数**取得颜色判定，验收组也调本函数；再由验收组一条
 *      **接线自检**（source-scan 断言真门禁 describe 真的调用了它）堵住「函数还在、接线被删」。
 */
function judgeConsumerColours(src: string, c: Consumer): ConsumerColours {
  const ref = PALETTES[0]
  const violations: string[] = []

  const foundTitleClass = titleTagClassOf(src, c.titleMarker)
  if (foundTitleClass === undefined) {
    violations.push(`${c.name} needle 未能定位到标题标签的 class`)
  }
  const titleClass = foundTitleClass ?? ''

  const titleViolation = colourTokenViolation(c.name, '标题', titleClass, 'text', ref)
  if (titleViolation !== undefined) violations.push(titleViolation)

  const plates = extractPlates(src)
  for (const [i, plate] of plates.entries()) {
    const v = colourTokenViolation(c.name, `底色块 #${i + 1}`, plate, 'bg', ref)
    if (v !== undefined) violations.push(v)
  }

  return {
    titleClass,
    titleIdx: templateBlock(src).indexOf(c.titleMarker),
    titleToken: colourTokenNames(titleClass, 'text', ref)[0],
    plateTokens: plates.map((p) => colourTokenNames(p, 'bg', ref)[0]),
    violation: violations.join('；'),
  }
}

/**
 * 剥掉 HTML 注释与整行 `//` 注释（**不剥** CSS 块注释）。
 *
 * ⚠️ **底色块抽取路径刻意不用 `vueTagScan.stripComments`**（code-review 建议项后的显式登记）：
 *    两处语义不同，混用会出错 ——
 *    ① 本函数**不剥** CSS 块注释（`slash-star` … `star-slash`）；② 替换成 `''` 而非 `' '`，
 *    是为了让后面 `src.indexOf(...)` 的 idx 与剥注释后的 `src` **同一来源、自洽**。
 *    共享模块那份服务于「跟引号扫描标签」，需要保行号、且必须先剥 CSS 注释。
 *    ⇒ 属**语义不同**，不是「同族不同源」；收拢成一个函数会让其中一处判据变形。
 *
 * ⚠️ 但**发现判据**（`isImmersiveCardSource`）用的是 `stripComments` 那份，与本函数
 *    分道扬镳：它做纯文本搜索、不依赖 idx 对齐，因而要剥全三种注释（含 CSS 块），
 *    否则 `.vue` 的 `<style>` 里提一句令牌就被算成候选。两条路径各取所需，不是重复。
 *
 * 理由（剥注释的必要性）：这几个 .vue 写了大量解释「为什么不用 /85」的注释，
 * 注释里出现的 `text-inverse-on-surface/85` 会让死类名守卫**自己打自己**。
 */
function stripVueComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 底色块抽不到时的判红消息（#1003）。
 *
 * ⚠️ 提成具名函数不是为了好看，而是为了让**诊断区分本身可测**：
 *    此前这段三元写在 `expect(...)` 里，验收用例只能重算一遍同样的 `&&` 表达式
 *    来"验证"它 —— 断言对象与被测实现零耦合，把真门禁整段删掉该用例仍绿
 *    （code-review 阻塞项）。提成函数后，用例可以直接断言**消息文本**，改坏分支必红。
 *
 * 区分两种原因：真的没写底色块，还是写了但认不出来。只报前者 ⇒ 解析器自身的退化
 * 会永远伪装成「设计违规」，把下一个人引向错误的排查方向。
 */
function missingPlateMessage(name: string, src: string, plates: readonly string[]): string {
  if (plates.length > 0) return `${name}：底色块已找到（不应走到本分支）`
  const bothClassesPresent = src.includes('bg-inverse-surface') && src.includes('rounded-lg')
  return bothClassesPresent
    ? `${name}：源文件里 bg-inverse-surface 与 rounded-lg 都出现了，但没有任何一个元素同时带这两个类` +
        ` ⇒ 底色块存在却被抽取器漏读（抽取器退化），不是「没写底色块」`
    : `${name} 找不到稳定底色块（rounded-lg + bg-inverse-surface）`
}

// ── #1004：沉浸卡自发现 ──────────────────────────────────────────────────

/**
 * 沉浸卡的发现判据：源码（**已剥注释**）里用了 scrim 渐变令牌。
 *
 * ⚠️ 用的是 `vueTagScan.stripComments`，不是本文件自己的 `stripVueComments`。后者
 *    **只剥 HTML 与 `//`、不剥 CSS 块注释**，其理由原是「本文件的判据只跑在 .vue 源上，
 *    没有 CSS 块」——而本判据恰恰是扫**整个文件**做纯文本搜索，`.vue` 带 `<style>` 是
 *    常态，该理由已失效。实测：`<style>` 里提一句令牌会被算成候选 ⇒ 集合相等判红并点名
 *    一个根本没写沉浸卡的文件。底色块抽取仍用本文件那份（依赖 `src.indexOf` 与剥后文本
 *    同源），两条路径语义不同，各取所需，不合并。
 *
 * ⚠️ **已知失效面：行尾 `//` 注释仍会被误判为候选。** `stripComments` 的行注释正则是
 *    `^[ \t]*\/\/.*$`，只吃**行首**（含缩进）；`const a = 1 // var(--md-scrim-overlay)`
 *    ⇒ 判为候选。方向是 fail-closed 误诊（假红），仓内零例。
 *    **刻意不修**：改成 `//.*$` 会连带剥掉字符串字面量里的内容（如 `"http://…"`），
 *    把误诊换成**静默漏判**（假绿）——而假绿正是本门禁（#1004）要消灭的东西。
 *    要彻底解决需真正的 JS 词法分析，代价与收益不成比例。该失效面由下方
 *    「行尾注释」characterization 用例钉住，使它可执行、可见，而非只写在散文里。
 */
function isImmersiveCardSource(src: string): boolean {
  return stripComments(src).includes('var(--md-scrim-overlay)')
}

/**
 * 全仓扫描结果 vs 登记清单的**双向**相等诊断（#1004）。
 *
 * 相等返回 undefined；不等返回一条点名具体文件的消息。用 toBeUndefined() 断言，
 * 失败时 vitest 直接打印消息，无需再拼。
 *
 * 提成具名函数而非内联表达式，原因同 missingPlateMessage：判据的**诊断区分本身
 * 必须可测**，否则验收组只能重算一遍同样的表达式来「验证」它——断言对象与被测
 * 实现零耦合，把真断言整段删掉用例仍绿。
 *
 * ⚠️ 退化分支必须排在集合比较**之前**：扫到 0 个时，若先做集合差，
 *    得到的诊断是「登记项都不存在了」，会把人引向「清单过期」这个错误根因——
 *    而真因是扫描面塌了。两者在输出上同形，必须先分流。
 */
function consumerSetDiagnosis(
  discovered: readonly string[],
  registered: readonly string[],
): string | undefined {
  if (discovered.length === 0) {
    return (
      `沉浸卡候选扫描到 0 个 ⇒ 扫描面退化（遍历路径写错，或遍历策略被收窄）。` +
      `「什么都没扫到」与「仓里真的没有」在输出上完全同形，本断言不得在此状态下通过。`
    )
  }
  const found = new Set(discovered)
  const known = new Set(registered)
  const unregistered = discovered.filter((f) => !known.has(f)).sort()
  const missing = registered.filter((r) => !found.has(r)).sort()
  if (unregistered.length === 0 && missing.length === 0) return undefined
  const parts: string[] = []
  if (unregistered.length > 0) {
    parts.push(`未入判（用了 scrim 渐变但不在登记里）：${unregistered.join('、')}`)
  }
  if (missing.length > 0) {
    parts.push(`登记里已失效（文件不存在，或不再使用 scrim 渐变）：${missing.join('、')}`)
  }
  return `沉浸卡候选集合与登记清单不相等 ⇒ ${parts.join('；')}`
}

/**
 * 「遍历 + 发现」流水线（#1004）：遍历 `root` 下的生产 `.vue`，返回其中使用
 * scrim 渐变的候选键，已排序。
 *
 * ⚠️ 真实门禁与合成树验收组**共用这一份**。写两遍的话，两侧的扫描面与键
 *    归一化会各自漂移，而两边的测试各自绿——漂移只在其中一侧真正生效时才暴露。
 */
function discoverImmersiveCards(root: string): string[] {
  return [...walkProductionVue(root, '[immersiveScrimGate]')]
    .filter((abs) => isImmersiveCardSource(fs.readFileSync(abs, 'utf-8')))
    .map((abs) => srcKey(root, abs))
    .sort()
}

/** 登记清单归一为与候选同构的键。 */
function registeredKeys(): string[] {
  return CONSUMERS.map((c) => srcKey(SRC_ROOT, path.resolve(__dirname, c.rel))).sort()
}

describe('#891 沉浸卡 scrim 文字对比度判据', () => {
  it('tokens.css 里 7 亮 + 7 暗 = 14 套色板全部自带 inverse 配对（门禁自身的前置条件）', () => {
    expect(PALETTES).toHaveLength(14)
    expect(PALETTES.filter((p) => p.selector.includes('.dark'))).toHaveLength(7)
  })

  it('--md-scrim-overlay 只在默认块与 7 个 .dark 块显式声明，其余 6 套亮色板靠层叠继承', () => {
    // 记录**当前事实**而非假设：若哪天色板生成脚本改成每块都写，这里会红，
    // 那时需要把下面两处 `PALETTES[0].scrimOverlay` 换成按色板取值。
    expect(PALETTES.filter((p) => p.scrimOverlay !== undefined)).toHaveLength(8)
    expect(PALETTES[0].selector).toContain('page')
    expect(PALETTES[0].scrimOverlay).toBeDefined()
  })

  describe('绝对下界：叠加后的文字对比度 ≥ AA 4.5', () => {
    for (const p of PALETTES) {
      it(`${p.selector}：底色遍历（含纯白）均达标`, () => {
        for (const base of BASES) {
          // 文字不透明地压在**不透明**稳定底色上 ⇒ 底图对最终对比度**零贡献**。
          // 这正是本判据能「分开所有图片情况」的原因，也是它敢写成绝对下界的前提。
          const c = contrast(p.inverseOnSurface, p.inverseSurface)
          expect(
            c,
            `${p.selector} / ${base.name}：inverse-on-surface on inverse-surface = ${c.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(AA)
          // ⚠️ 这里曾有一条 `expect(over(p.inverseOnSurface, 1, base.rgb)).toEqual(...)`，
          //    注释声称「把『底色被完全盖掉』钉死」——**它是恒真的**（#897）：
          //    `over` 的定义是 `fg*a + bg*(1-a)`，取 a=1 时 bg 被乘以 0、**完全消失**，
          //    结果恒等于 fg，与 base 无关 ⇒ 对任意底色恒真，且 `base` 从未参与任何断言
          //    （外层遍历形同虚设）。它拦不住任何回归，却一直冒充防线计入门禁台账。
          //    已删除。「底色不许带 alpha 修饰符」的真防线在下方消费点 describe 里
          //    （源级 class 形态断言）——纯数学断言在原理上做不到，因为「不透明」是
          //    一个 class 形态的事实，不是颜色数值的事实。
          //    ⚠️ base 仍用于上面那条对比度断言的错误信息（逐底色板的可读诊断），
          //    但**判据本身与 base 无关**是事实：若要让 base 真正参与判据，
          //    必须改为「把底色板实际合成进结果后仍达标」，那是另一种门禁形态（见 #897）。
        }
      })
    }
  })

  describe('阳性对照：判据必须有能力判红，否则就是恒真门禁', () => {
    it('同一判据对「纯白底 + 只靠渐变」判红，且给出具体数值', () => {
      // 复原 #891 的现状：白字只叠 --md-scrim-overlay，没有稳定底色。
      const white: Rgb = [255, 255, 255]
      const grad = PALETTES[0].scrimOverlay
      // 标题落在盒高 0.48、作者 0.37（真机实测反推：标题底 rgb 207 ⇒ alpha 0.189，
      // 与模型 0.189 吻合；作者底 rgb 176 ⇒ alpha 0.310，对应盒高约 0.30 而非 0.37）
      for (const pos of [0.3, 0.37, 0.48]) {
        const s = stopAt(parseStops(grad), pos)
        const c = contrast(white, over(s.rgb, s.alpha, white))
        expect(c >= AA, `pos=${pos} 处白字/纯白底 = ${c.toFixed(2)}，应判红`).toBe(false)
        expect(c).toBeLessThan(AA)
      }
    })

    it('模型 alpha 与真机实测底色对得上（pos 0.48 处实测 rgb207 ⇒ alpha 0.189）', () => {
      // 这条把「模型」与「真机截图」对上一次账，防止两边各自漂移。
      const grad = PALETTES[0].scrimOverlay
      const s = stopAt(parseStops(grad), 0.48)
      expect(s.alpha).toBeCloseTo(0.189, 2)
      const bg = over(s.rgb, s.alpha, [255, 255, 255] as Rgb)
      // 真机 emulator-5554 标题行右侧同高背景实测 q_rgb = [207,207,207]
      expect(Math.round(bg[0])).toBeGreaterThanOrEqual(200)
      expect(Math.round(bg[0])).toBeLessThanOrEqual(210)
    })

    it('同一判据对达标组合判绿（证明上一条不是恒假）', () => {
      const p = PALETTES[0]
      expect(contrast(p.inverseOnSurface, p.inverseSurface) >= AA).toBe(true)
    })

    it('换成同亮度的彩色底仍判红（相对断言在这里会漏）', () => {
      // 判据比的是**绝对比值**，不是「比底色深多少」。这里先由目标亮度**反解**出
      // 等亮度灰（不要手挑一个「看起来差不多」的灰——上面那次就挑错了，差 0.09），
      // 再验证彩色底与等亮度灰给出同一个比值：只要底色够亮，两者都判红。
      const white: Rgb = [255, 255, 255]
      const yellow: Rgb = [252, 240, 120]
      const target = luminance(yellow)
      // 由 L 反解 8 位灰：lin^-1(v) = 1.055 * v^(1/2.4) - 0.055
      const v = 1.055 * target ** (1 / 2.4) - 0.055
      const grey: Rgb = [
        Math.round(v * 255),
        Math.round(v * 255),
        Math.round(v * 255),
      ]
      // 彩色底与它的等亮度灰落在同一个比值上（量化到整数通道，容忍 1 级误差）
      expect(contrast(white, yellow)).toBeCloseTo(contrast(white, grey), 2)
      expect(contrast(white, yellow) >= AA).toBe(false)
    })
  })

  describe('现状记录：为什么单靠渐变撑不住（此组转红 = 渐变被改，先重算再决定方案）', () => {
    it('--md-scrim-overlay 在文字所在的盒高区间内，叠纯白底后达不到 AA', () => {
      const white: Rgb = [255, 255, 255]
      const stops = parseStops(PALETTES[0].scrimOverlay)
      for (const pos of [0.3, 0.37, 0.48, 0.6]) {
        const s = stopAt(stops, pos)
        expect(
          contrast(white, over(s.rgb, s.alpha, white)) >= AA,
          `pos=${pos} 渐变 alpha=${s.alpha.toFixed(3)} 已达 AA —— 若真是如此，应改用渐变方案并重写本判据`,
        ).toBe(false)
      }
    })

    it('同一张卡内各行「过没过线」取决于落在盒高哪一段（排行榜入口卡实测）', () => {
      // 排行榜入口卡的信息块：渐变罩 h-[36vw]=135dp，bottom-3 起步，按档位行高算中心距卡底
      // 徽章行 33dp / 标题 23dp / 作者 10dp ⇒ pos 0.244 / 0.170 / 0.074。
      const white: Rgb = [255, 255, 255]
      const stops = parseStops(PALETTES[0].scrimOverlay)
      const at = (dp: number) => {
        const s = stopAt(stops, dp / 135)
        return contrast(white, over(s.rgb, s.alpha, white))
      }
      const badge = at(33)
      const title = at(23)
      const author = at(10)
      // 徽章行真的不达线（= 本卡真正的破口），标题过线但余量很薄，作者很宽裕
      expect(badge).toBeCloseTo(3.75, 1)
      expect(title).toBeCloseTo(5.43, 1)
      expect(author).toBeCloseTo(9.16, 1)
      expect(badge >= AA).toBe(false)
      expect(title >= AA).toBe(true)
      // 三行余量相差 5 倍 ⇒ 「渐变够不够」是**位置**的函数，不是卡片属性的函数
      expect(author / badge).toBeGreaterThan(2)
    })

    it('--md-scrim（0.5 黑）单层差一点到 AA（≈3.98 < 4.5），不能拿来当稳定底色', () => {
      const white: Rgb = [255, 255, 255]
      const c = contrast(white, over([0, 0, 0], 0.5, white))
      expect(c).toBeCloseTo(3.977, 2)
      expect(c >= AA).toBe(false)
    })
  })

  describe('三个消费点确实用上了稳定底色（防「只改令牌不改页面」）', () => {
    for (const c of CONSUMERS) {
      it(`${c.name}：标题落在 stable 底色块之内，且渐变仍在`, () => {
        const raw = fs.readFileSync(path.resolve(__dirname, c.rel), 'utf-8')
        // ⚠️ 必须先剥注释再断言（理由见 stripVueComments）
        const src = stripVueComments(raw)

        // 渐变**不能**被顺手删掉：它是「与作品图融合」的唯一手段，删了会变成硬边色块。
        expect(src, `${c.name} 丢了渐变 var(--md-scrim-overlay)`).toContain('var(--md-scrim-overlay)')

        const plates = extractPlates(src)

        expect(plates, missingPlateMessage(c.name, src, plates)).not.toHaveLength(0)

        // 颜色判定**只经由共享接线 `judgeConsumerColours`**（#1012 洞 1 + 洞 2）。
        // ⚠️ 禁止在本 describe 内再直接调 `colourTokenViolation` / `colourTokenNames`：
        //    此前正是「真门禁内联调、验收组也直接调」导致共享的只是**函数**、不是**接线**，
        //    拔掉真门禁那两处判红或退回读常量，验收组 57/57 照样全绿（code-review 阻塞 F1）。
        //    验收组的「接线自检」用 source-scan 钉住本行确实存在。
        const colours = judgeConsumerColours(src, c)
        expect(colours.violation || undefined, '颜色令牌判定（#1012 洞 1 / 洞 2）').toBeUndefined()

        // 结构性判据：底色块必须**开在标题之前**——否则标题又落回渐变上。
        // ⚠️ 两个下标必须取自**同一作用域**（都走 templateBlock），否则 `<script>` 里的同
        //    needle 字面量会让标题下标指到 script 内、本断言以「底色块在标题之后」误诊。
        const plateIdx = templateBlock(src).indexOf(plates[0]!)
        const titleIdx = colours.titleIdx
        expect(
          plateIdx,
          `${c.name}：底色块出现在标题之后（idx ${plateIdx} >= ${titleIdx}），文字没被底色兜住`,
        ).toBeLessThan(titleIdx)

        // ── 把 .vue 里**实际写的**颜色 class 解析回令牌，再算对比度 ──────────
        // 没有这一步，上面的「找到了底色块」与前面的对比度计算是**两件不相干的事**：
        // 把底色换成任意一个别的深色 class 也能过「有底色块」，而对比度数字纹丝不动。
        // 这一步让门禁真正咬住标记本身。
        //
        // ⚠️ 两侧的输入**必须同源**（#1012 洞 2）：底色块读 `extractPlates(src)` 的实写
        //    类串，标题读标题标签的实写 class。**不得**再拿 `CONSUMERS` 里的 `titleMarker`
        //    常量当解析输入 —— 它是**期望值**，needle 之后追加的任何类名对它不可见，
        //    文字色一侧对源文件改动等于零反应（实测：追加 `text-primary` 后 50 用例全绿）。
        //
        // ⚠️ 颜色令牌必须**恰好一个**（#1012 洞 1，判据与理由见 `colourTokenViolation`）：
        //    叠了多个颜色 utility 时，真实渲染里哪个胜出取决于 Tailwind 产物顺序，
        //    取任一个都是在算一个**未必被渲染**的数字 ⇒ **判歧义，不挑一个算**。
        //
        // ⚠️ 「本仓类串约定颜色在末尾」是**错误的不变式**，已随 #1005 从注释里删除。
        //    三个消费点当前恰好颜色在末尾，那是巧合不是保证。正确理由是「排版档位不是
        //    颜色令牌、被令牌存在性滤掉，故剩下那唯一一个命中才是颜色」。
        const plateBg = colours.plateTokens[0]!
        const plateFg = colours.titleToken!
        for (const p of PALETTES) {
          const bg = p.tokens.get(plateBg!)
          const fg = p.tokens.get(plateFg!)
          expect(bg, `${p.selector} 找不到底色令牌 --md-${plateBg}`).toBeDefined()
          expect(fg, `${p.selector} 找不到文字令牌 --md-${plateFg}`).toBeDefined()
          const c2 = contrast(fg!, bg!)
          expect(
            c2,
            `${c.name} / ${p.selector}：${plateFg} on ${plateBg} = ${c2.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(AA)
        }

        // ⚠️ inverse 令牌的 alpha 变体是**死类名**：颜色档位是裸 var()、无 <alpha-value>
        // （tailwind.config.ts），`text-inverse-on-surface/85` 不产出任何规则 ⇒ 静默无样式。
        // 实测（tailwindcss 3.4.19 产物）：text-inverse-on-surface/85 → 0 条规则；
        // 而 text-white/85 → 1 条（white 是字面量）——**别把这两者混为一谈**。
        // 层级因此只能由字号/字重承担（MD3 对 on-surface 的本意）。
        expect(src, `${c.name} 出现 text-inverse-on-surface 的 alpha 变体（死类名）`).not.toMatch(
          /text-inverse-on-surface\/\d+/,
        )

        // ── 稳定底色**不许带 alpha 修饰符**（#897 修法）────────────────────────
        // 上一条只守住了 text- 侧的**死类名**；底色侧是完全不同的失效机制，且**恒绿**：
        //  1. 上面的 `colourTokenNames()` 用 `bg-([\w-]+)` 提取令牌名，`\w` **不含 `/`**，
        //     故 `bg-inverse-surface/70` 会被静默截成 `inverse-surface` ⇒ plateBg 不变
        //     ⇒ 对比度数字**纹丝不动** ⇒ 上游所有断言照常全绿。
        //  2. 与 text- 侧相反，底色的 `/70` **不是死类名**：Tailwind 对裸 var() 颜色档
        //     同样接受 alpha 修饰符，会正常产出规则 ⇒ 真实渲染为半透明，无任何构建期报错。
        //     即：这是**视觉静默回归**，不是死类名，运行时表现与意图一致地错。
        //  为什么必须禁：绝对下界判据（上面 `for (const base of BASES)`）的全部有效性
        //     建立在「文字不透明地压在**不透明**稳定底色上」这一前提上。底色一旦半透明，
        //     作品图就会透过底色参与合成，`base` 重新变得相关，而门禁对 base 的实际影响
        //     恒为零 ⇒ 整道门宣称覆盖的底色范围**从未被真正验证过**。
        //
        // 实测（变异验证）：把 RankingEntryCard.vue:141 的底色改成
        // `bg-inverse-surface/70` 后，本文件 26 个用例**全绿**。
        // 改动后同一变异会让本断言判红。
        //
        // 判据只针对**稳定底色块**（上面的 plates），不扫全文件：
        // NovelIntro / Recommended 里另有与 scrim 无关的 inverse 元素，且本仓有
        // 刻意使用 alpha 的状态层（bg-layer-pressed/16 等），全文件禁 `/` 会误伤。
        for (const [plateIdxInPlates, plate] of plates.entries()) {
          // 判定走**共享函数**，不内联复制正则 —— 验收组必须打到与真门禁同一份判据，
          // 否则删掉这个循环（#897 的判红能力）新增用例仍全绿（code-review 阻塞项）。
          expect(plateAlphaViolation(c.name, plate)).toBeUndefined()
        }
      })
    }
  })

  // ── #1005/#1012 验收：颜色令牌解析面（变异注入，不落盘）──────────────────
  //
  // ⚠️ 与 #1003 那一组同纪律：反事实必须**编码进产物**，不能只写在注释里。若只写「旧实现会
  //    取错」，谁都无法复核。旧解析内核原样落成 `OLD_RESOLVE`，下方逐形态断言它**一律返回
  //    看似合理的 token 名**（即恒真），而新判定会点名。双侧从此永久可复核。
  describe('#1005/#1012 验收：颜色令牌解析面（变异注入，不落盘）', () => {
    const ref = PALETTES[0]
    /**
     * 标题 needle 形态。**从 `CONSUMERS` 派生而非手抄**（测试硬约束 #2）：
     * 手抄一份的后果是 `CONSUMERS` 改了夹具不跟，两边悄悄不同形而**无人发现** ——
     * 那正是本文件头自己写着的「不能手写『自洽』的 class/style 串」。
     */
    const NEEDLE = CONSUMERS[0].titleMarker
    /**
     * 合法底色块：**取自真实源文件**（同上，硬约束 #2 的真实样例要求）。
     * 叠了第二个颜色类的形态由它派生，保证两者只差一个类。
     */
    const PLATE_OK = extractPlates(
      stripVueComments(fs.readFileSync(path.resolve(__dirname, CONSUMERS[0].rel), 'utf-8')),
    )[0]!
    const PLATE_BAD = `${PLATE_OK} bg-surface-container`

    /**
     * #1012 修复前的解析内核，原样保留（`git show HEAD:…` 可核对）：
     * 按令牌存在性筛出命中项后**取第一个**。
     *
     * ⚠️ 它对「叠第二个颜色类」「元素换色」一律**不报错**，都吐得出一个 token 名 ——
     *    这就是它的恒真性所在。下面对三种形态逐条把这个「不报错」钉死。
     */
    const OLD_RESOLVE = (cls: string, prefix: 'bg' | 'text'): string | undefined => {
      const names = [...cls.matchAll(new RegExp(`${prefix}-([\\w-]+)`, 'g'))]
        .map((m) => m[1])
        .filter((n) => ref.tokens.has(n))
      return names[0]
    }

    /** 把 .vue 源码 + needle 送进**真门禁那条组合路径**（共享函数，非副本）。 */
    const judgeTitle = (src: string, needle = NEEDLE): string | undefined =>
      colourTokenViolation('夹具', '标题', titleTagClassOf(src, needle) ?? '', 'text', ref)

    const judgePlate = (plate: string): string | undefined =>
      colourTokenViolation('夹具', '底色块', plate, 'bg', ref)

    it('接线自检：真门禁的**消费点 describe 必须真的调用**共享判定（F1 闭合）', () => {
      // 为什么需要这条（#1005 轮 review 实测的阻塞项）：共享**函数**挡不住「调用点被删」。
      // 实测三种变异 —— ① 删掉真门禁两处颜色判定；② 只删 bg 侧那处；③ 把标题退回读
      // `CONSUMERS` 常量（#1012 洞 2 的修复前行为）—— 验收组 **57/57 照样全绿**。
      // 本条用 source-scan 把「真门禁真的接上了」变成产物自证的断言。
      const file = fs.readFileSync(path.resolve(__dirname, 'immersiveScrimContrast.test.ts'), 'utf-8')
      const gateStart = file.indexOf("describe('三个消费点确实用上了稳定底色")
      expect(gateStart, '消费点 describe 必须存在').toBeGreaterThan(-1)
      // 本验收组的 describe 排在真门禁**之后**，用它当右边界 ⇒ 切出的正是真门禁那段。
      const gateEnd = file.indexOf("describe('#1005/#1012 验收", gateStart)
      expect(gateEnd, '验收组 describe 必须排在真门禁之后').toBeGreaterThan(gateStart)
      const gateBody = file.slice(gateStart, gateEnd)
      expect(
        gateBody,
        '真门禁必须经由共享接线 judgeConsumerColours 取颜色判定（不得内联调 colourTokenViolation）',
      ).toContain('judgeConsumerColours(')
      expect(
        gateBody,
        '真门禁**禁止**再内联调 colourTokenViolation（否则「接线」又退回各自一份）',
      ).not.toContain('colourTokenViolation(')
    })

    it('洞 1 的**判红文案**点名两个令牌（不是只报「有歧义」）', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      expect(judgeTitle(src)).toContain('2 个（inverse-on-surface、primary）')
    })

    it('洞 2 的「定位不到」是产物自证的（不是只活在注释里）', () => {
      // #1005 轮 review F10：此前这条「正是定位不到暴露了旧路径没读过源文件」只写在注释里。
      expect(
        titleTagClassOf(NEEDLE, NEEDLE),
        'needle 在**裸类串**（非源码）里定位不到标签 —— 这正是旧路径压根没读源文件的证据',
      ).toBeUndefined()
    })

    it('交互态变体前缀**不计入**颜色歧义（F6：hover 不改变静息颜色）', () => {
      // 改动前这一格会判红，且文案宣称「谁胜出取决于产物顺序」—— 该说法对 hover **不成立**，
      // 且 AGENTS.md「有意偏离 MD3」第 4 条已拍板 hover 在纯触屏判定为不适用。
      for (const variant of ['hover:', 'active:', 'focus-visible:']) {
        const src = `<template><text class="${NEEDLE} ${variant}text-primary">标题</text></template>`
        expect(judgeTitle(src), `${variant}text-primary 不应被判为第二个颜色令牌`).toBeUndefined()
      }
      // ⚠️ 模式类前缀**仍要计入**：`dark:` 在某条件下确实改变静息颜色，而本判据是绝对下界。
      const dark = `<template><text class="${NEEDLE} dark:text-primary">标题</text></template>`
      expect(judgeTitle(dark), 'dark:text-primary 确实改变静息颜色，必须计入').toContain('2 个')
    })

    it('`/alpha` 修饰符不会让底色块被判成「零个」（#897 判红能力不得被抢跑）', () => {
      // `colourTokenNames` 改成按空白切分后，`<alpha>` 必须仍被截掉 ——
      // 否则 `inverse-surface/70` 查不到令牌 ⇒ 「零个」判红会抢在 `plateAlphaViolation` 之前。
      const v = judgePlate('bg-inverse-surface/70 rounded-lg')
      expect(v, '带 /alpha 的底色块仍抽得到唯一令牌，不该报「零个」').toBeUndefined()
    })

    it('反事实：旧内核对三类叠加形态**一律不报错**（它的恒真性在此被钉死）', () => {
      // ① text 侧、needle **之后**追加第二个颜色类
      expect(OLD_RESOLVE(`${NEEDLE} text-primary`, 'text')).toBe('inverse-on-surface')
      // ② bg 侧、合法底色**之后**追加
      expect(OLD_RESOLVE(PLATE_BAD, 'bg')).toBe('inverse-surface')
      // ③ bg 侧、合法底色**之前**插入
      expect(OLD_RESOLVE(`bg-surface-container ${PLATE_OK}`, 'bg')).toBe('surface-container')
      // ⚠️ ② 与 ③ 的结论**不同，但都不是「歧义判红」** —— 这一点务必分清（#1005 轮 review 实测）：
      //    ② 改前**静默全绿**（fail-open 漏过）：`resolve` 取首个命中的 `inverse-surface`，
      //      数字纹丝不动。
      //    ③ 改前**判红，但报的是错根因**（fail-closed 误诊）：bg 侧读的是**源文件**，
      //      `resolve` 取到了新插入的 `surface-container` ⇒ 对比度按错底色算成 1.03，
      //      诊断指向「底色不达标」而非「底色块上叠了两个颜色类」。
      //    ⇒ 两侧都需要「恰好一个」判据，但**病因不同**：text 侧是**读常量**（看不见源文件），
      //      bg 侧是**取首个**（看得见但挑错）。⚠️ 曾把 ③ 误记为「改前也全绿」并据此推出
      //      「与读不读源文件无关」—— 该推论**已被实测否掉**（③ 正是 bg 侧读源文件才会红）。
    })

    it('洞 1 · text 侧：needle 之后叠加第二个颜色类 ⇒ 判红并点名两个令牌', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      expect(judgeTitle(src)).toContain('2 个')
      expect(judgeTitle(src)).toContain('inverse-on-surface、primary')
    })

    it('洞 1 · bg 侧：**前置与后置**叠加第二个颜色类都判红（只验一种会漏掉另一种）', () => {
      expect(judgePlate(PLATE_BAD), '后置').toContain('2 个')
      expect(judgePlate(`bg-surface-container ${PLATE_OK}`), '前置').toContain('2 个')
    })

    it('洞 2 · 文字色必须从**源文件实写**解析：常量合规而源文件违规时必须判红', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      // 旧实现的喂法 = **直接把 `CONSUMERS` 里的期望常量当类串判**。该常量本身恰好一个颜色
      // 令牌 ⇒ 合规 ⇒ 旧路径对同一处源文件违规**判不出任何东西**。
      // ⚠️ 此处刻意**不走** `titleTagClassOf`：常量不是源码，needle 在其中定位不到标签。
      //    正是这一「定位不到」暴露了旧路径压根没读过源文件。
      expect(
        colourTokenViolation('夹具', '标题', NEEDLE, 'text', ref),
        '期望常量本身应判为合规',
      ).toBeUndefined()
      expect(OLD_RESOLVE(NEEDLE, 'text'), '旧内核对常量照常吐得出值').toBe('inverse-on-surface')
      // 新实现的输入是源文件实写 class。**同一份 needle**，源文件违规 ⇒ 必须判红。
      expect(judgeTitle(src), '源文件实写 class 违规时必须判红').toContain('2 个')
    })

    it('零个颜色令牌同样判红（不是「取不到就跳过」）', () => {
      const src = '<template><text class="text-title-large">标题</text></template>'
      expect(judgeTitle(src, 'text-title-large')).toContain('零个')
    })

    it('反向对照：合法形态不得判红（含 needle 定位抽取的三格形态）', () => {
      for (const tag of [
        `<text class="${NEEDLE}">标题</text>`,
        `<text :aria-label="t" class="${NEEDLE}">标题</text>`,
        `<text class='${NEEDLE}'>标题</text>`,
        `<text\n  class="${NEEDLE}">标题</text>`,
      ]) {
        const src = `<template>${tag}</template>`
        expect(titleTagClassOf(src, NEEDLE), `needle 应定位到标签：${tag}`).toBe(NEEDLE)
        expect(judgeTitle(src), `合法形态不应判红：${tag}`).toBeUndefined()
      }
      expect(judgePlate(PLATE_OK), '合法底色块不应判红').toBeUndefined()
    })

    it('三个真消费点的标题与底色块**恰好各一个**颜色令牌（真门禁的输入本身合规）', () => {
      for (const c of CONSUMERS) {
        const src = stripVueComments(fs.readFileSync(path.resolve(__dirname, c.rel), 'utf-8'))
        const titleClass = titleTagClassOf(src, c.titleMarker) ?? ''
        expect(colourTokenNames(titleClass, 'text', ref), `${c.name} 标题的颜色令牌`).toHaveLength(
          1,
        )
        for (const plate of extractPlates(src)) {
          expect(
            colourTokenNames(plate, 'bg', ref),
            `${c.name} 底色块的 bg- 颜色令牌：${plate}`,
          ).toHaveLength(1)
        }
      }
    })
  })

  // ── #1004：全仓候选集合与登记清单双向相等 ──────────────────────────────
  //
  // 此前本文件只对三个硬编码文件名断言，**不扫描发现、也无集合相等夹逼**：
  // 新增第 4 个沉浸卡时这条断言恒绿地不覆盖它，也不报任何提示。本组把
  // 「新增即入判」交给机器。
  //
  // 遍历面与列表交错契约门禁共用一份实现（#1006）：扫描面是隐含的范围承诺，
  // 两道门禁各写各的就会漂。
  describe('沉浸卡自发现：全仓候选与登记清单双向相等（防「新卡静默漏判」）', () => {
    const DISCOVERED = discoverImmersiveCards(SRC_ROOT)
    const REGISTERED = registeredKeys()

    it('扫描结果与登记清单相等（漏网与过期双向暴露）', () => {
      expect(consumerSetDiagnosis(DISCOVERED, REGISTERED)).toBeUndefined()
    })

    it('登记清单非空（防「清单被清空 ⇒ 全称断言恒真」）', () => {
      expect(REGISTERED.length, '登记被清空时集合相等会空对空通过，必须单独拦').toBeGreaterThan(0)
    })

    // ⚠️ 有意窄覆盖（不得默默不覆盖）：本判据认的是**纯文本**里出现
    //    `var(--md-scrim-overlay)` 字面量。已登记**两处**抓不到什么：
    //
    //    ① 一张压在作品图上、却**没有**渐变的卡（纯硬边色块）不会被自动发现 ——
    //       而按本门禁的既定定义，没有渐变就不算「与作品图融合」的沉浸卡，
    //       它本就该被现有断言（渐变不可删）在**已登记**的消费点上拦住。
    //    ② **判据看不见经 `:style` / composable 间接注入的渐变**。若新卡写成
    //       `:style="{ background: scrimGradient }"`、渐变常量定义在 composable 里，
    //       该 `.vue` 内没有令牌字面量 ⇒ 不入候选 ⇒ 集合相等恒绿。**② 与 ① 是不同
    //       的情形**：① 是「根本没有渐变」，② 是「有渐变但判据看不见」，后者更隐蔽。
    //       登记若只写 ①，读的人会误以为没有缺口。实测当前仓**零例**（全仓含该字面量
    //       的仅三个消费点 `.vue` 与两个 `.ts` 夹具），属**潜伏**而非现存漏判。
    //
    //    为何两处都不补兜底判据：① 要在类串层面表达「压在作品图上」需读布局属性，
    //    机器数不出来；② 要追 composable 的间接引用，等于把发现判据从「与概念同义」
    //    退化成「追数据流」，只会引入误抓。写明是为了让它们成为**已登记的决定**而非疏漏。
  })

  // ── #1003 验收：抽取面真实失效面 = 三格，全部按变异验证 ──────────────────
  //
  // 纪律：**不接受「读代码觉得没问题」**。每一格都把违规写法**喂进同一个抽取器**，
  // 要求它抽到那个带 `/70` 的底色块；抽不到即判红。
  //
  // ⚠️ 为什么这组与 #1001 的方向相反：#1001 要求「跨行写法要能抽到」，
  //    那是**基于一个被否掉的前提**（实测：旧正则的 `\s` 与 `[^"]` 都匹配换行，
  //    跨行今天就能抽到）。照 #1001 写会得到一条**恒真的判别力自检**——
  //    它在改动前也绿、抓不到任何东西。本组把跨行写成**回归守卫**（钉住
  //    「重写没把这个本来能过的形态弄丢」），而不是新的判红能力。
  //
  // 期望值出处（oracle 溯源）：三格形态来自 #1003 票面逐条实测的变异矩阵。
  //
  // ⚠️「反事实」必须**编码进产物**，不能只写在注释里（code-review 发现）：此前本组声称
  //    「在旧实现上复现旧 0 / 新 1 的双向对照」，但旧正则只作为字符串出现在注释中，
  //    **产物不自证** —— 谁都无法复核那个 0。于是 `OLD_PLATE_RE` 把旧实现原样落成常量，
  //    下方「反事实」一条对它逐形态断言 0 命中：反事实从此永久可复核。
  describe('#1003 验收：底色块抽取面（变异注入，不落盘）', () => {
    /**
     * #1003 修复前的抽取器，原样保留（`git show HEAD:…` 可核对）。
     *
     * 它的存在只为让「旧实现抽不到、新实现抽得到」这个反事实**可复核** ——
     * 三格形态各断言它 0 命中、跨行形态断言它 1 命中（后者是 #1001 错误前提的实证）。
     */
    const OLD_PLATE_RE = /<view\s+class="([^"]*)"/g
    /** 用旧抽取器抽底色块（与 `extractPlates` 的过滤条件保持一致） */
    const oldPlates = (src: string): string[] =>
      [...src.matchAll(OLD_PLATE_RE)]
        .map((m) => m[1]!)
        .filter((cls) => cls.includes('bg-inverse-surface') && cls.includes('rounded-lg'))

    /** 底色块的**违规**形态：带 alpha 修饰符，`/70` 必须能被下游断言点名 */
    const PLATE_BAD = 'bg-inverse-surface/70 rounded-lg'
    /** 底色块的**合法**形态（反向对照用） */
    const PLATE_OK = 'bg-inverse-surface rounded-lg'

    it('反事实：旧抽取器对三格形态**一律抽不到**（#1001 的错误前提在此被否）', () => {
      // 这条是本组「判别力」的地基：没有它，下面三格「旧 0 / 新 1」只是注释里的说法。
      for (const src of [
        `<view class='${PLATE_BAD}'>x</view>`,
        `<view v-if="visible" class="${PLATE_BAD}">x</view>`,
        `<text class="${PLATE_BAD}">x</text>`,
      ]) {
        expect(oldPlates(src), `旧实现应抽不到：${JSON.stringify(src)}`).toHaveLength(0)
        expect(extractPlates(src), `新实现应抽得到：${JSON.stringify(src)}`).toHaveLength(1)
      }
      // ⚠️ 跨行是**唯一**旧实现也能过的形态 —— #1001 把「跨行抽不到」当核心前提是错的。
      //    这条同时钉住跨行是回归守卫、不是新判红能力（见下方「回归守卫」用例）。
      const multiline = `<view\n  class="${PLATE_BAD}">x</view>`
      expect(oldPlates(multiline), '旧实现对跨行**抽得到** ⇒ #1001 前提被否').toHaveLength(1)
      expect(extractPlates(multiline), '新实现对跨行也应抽得到').toHaveLength(1)
    })

    it('失效面 ①：单引号 class 抽得到，且能被真门禁点名 /70', () => {
      const src = `<view class='${PLATE_BAD}'>标题</view>`
      expect(extractPlates(src), '单引号写法的底色块应被抽出').toHaveLength(1)
      // 验收 1 的完整要求是「判红且**点名 /70**」⇒ 走真门禁那条共享判定，
      // 不是自己抄一份正则（抄副本 = 验的不是真门禁，见 plateAlphaViolation 注释）。
      expect(plateAlphaViolation('单引号', extractPlates(src)[0]!)).toContain('/70')
      // 反向对照：同一形态但合法底色（无 /70）时，**下游 alpha 断言不得判红**
      const ok = extractPlates(`<view class='${PLATE_OK}'>标题</view>`)
      expect(ok).toHaveLength(1)
      expect(plateAlphaViolation('单引号合法', ok[0]!)).toBeUndefined()
    })

    it('失效面 ②：class 不是第一个属性 抽得到，且能被真门禁点名 /70', () => {
      // 背景类刻意**不放在标签首位**，避免新实现「见标签就红」的假阳性混进来
      const src = `<view v-if="visible" class="${PLATE_BAD}">标题</view>`
      expect(extractPlates(src), 'class 前有属性时底色块应被抽出').toHaveLength(1)
      expect(plateAlphaViolation('class 非首属性', extractPlates(src)[0]!)).toContain('/70')
      // v-for / :key 形态（runner 卡就是这种顺序）
      const keyed = extractPlates(
        `<view v-for="x in list" :key="x.id" class="${PLATE_BAD}">标题</view>`,
      )
      expect(keyed, 'v-for + :key + class 形态应被抽出').toHaveLength(1)
      expect(plateAlphaViolation('v-for+key', keyed[0]!)).toContain('/70')
    })

    it('失效面 ③：非 <view> 标签 抽得到，且能被真门禁点名 /70', () => {
      for (const tag of ['text', 'image']) {
        const plates = extractPlates(
          `<${tag} class="${PLATE_BAD}"${tag === 'image' ? ' /' : ''}>标题</${tag}>`,
        )
        expect(plates, `${tag} 标签应被抽出`).toHaveLength(1)
        expect(plateAlphaViolation(tag, plates[0]!), `${tag} 标签应点名 /70`).toContain('/70')
      }
    })

    it('反向对照：以上三格的**合法**写法（无 /70）不得被当成违规', () => {
      // 证明新抽取器不是「见标签就红」的假阳性源：不含 /70 时下游断言必须放过。
      for (const src of [
        `<view class='${PLATE_OK}'>标题</view>`,
        `<view v-if="visible" class="${PLATE_OK}">标题</view>`,
        `<text class="${PLATE_OK}">标题</text>`,
      ]) {
        const plates = extractPlates(src)
        expect(plates, `合法写法应被抽出：${src}`).toHaveLength(1)
        expect(plateAlphaViolation('合法写法', plates[0]!), `合法写法不应判红：${src}`).toBeUndefined()
      }
    })

    it('反向对照：只有颜色没有圆角的元素不算底色块（形状约定未被放宽）', () => {
      // ⚠️ 这是**刻意不放宽**的一条：NovelIntro 的导出面板带 bg-inverse-surface
      //    + rounded-[var(--md-shape-medium)]，若只按颜色抽会被它满足掉。
      expect(
        extractPlates('<view class="bg-inverse-surface rounded-[var(--md-shape-medium)]">x</view>'),
        '无 rounded-lg 的 inverse 元素不应算底色块',
      ).toHaveLength(0)
    })

    it('回归守卫：跨行 class 本来就能抽到，重写**不能**把它弄丢', () => {
      // 这一格旧实现也过（`\s` 与 `[^"]` 都匹配换行）。它的作用是钉住「重写无退化」，
      // 断言它不是新的判红能力 —— 若哪天有人改回按行取，这里会红。
      //
      // ⚠️ brief checkbox 5 要求的不止「still extract」，还有「**still name `/70`**」
      //    ⇒ 两条都断言：抽到，且真门禁那条判定点名 `/70`。
      const cases = [
        `<view\n  class="${PLATE_BAD}">标题</view>`,
        `<view class="bg-inverse-surface/70\n  rounded-lg">标题</view>`,
      ]
      for (const src of cases) {
        const plates = extractPlates(src)
        expect(plates, `跨行写法应被抽出：${JSON.stringify(src)}`).toHaveLength(1)
        expect(
          plateAlphaViolation('跨行', plates[0]!),
          `跨行写法应仍被点名 /70：${JSON.stringify(src)}`,
        ).toContain('/70')
      }
    })

    it('HTML 注释里的底色块不算（负向：剥注释必须生效）', () => {
      // 这几个 .vue 写了大量解释「为什么不用 /85」的注释，注释里的命中会让
      // 死类名守卫自己打自己 ⇒ 抽取必须先剥注释。
      expect(
        extractPlates(`<!-- <view class="${PLATE_BAD}">注释里的反面示例</view> -->`),
        'HTML 注释里的底色块不应被抽出',
      ).toHaveLength(0)
    })

    it('<script> 块里的字符串字面量不算标签（只扫 template 块）', () => {
      // ⚠️ #1003 实施期自查发现的**新引入**失效面：`<script setup>` 里常有字符串字面量
      //    含尖括号（泛型 / 比较运算 / 测试夹具里的反例）。全文件扫标签会把它们当成
      //    真标签 ⇒ **凭空多出一块底色块**（方向 fail-open：误判红，不是漏过）。
      //    实测反例：`const s = "<view class='bg-inverse-surface/70 rounded-lg'>"`。
      const src = [
        `<script setup lang="ts">`,
        `const m = new Map<string, number>()`,
        `if (a < b && c > d) {}`,
        `const s = "<view class='${PLATE_BAD}'>"`,
        `</script>`,
        `<template><view class="${PLATE_OK}">真底板</view></template>`,
      ].join('\n')
      const plates = extractPlates(src)
      expect(plates, 'script 里的字面量不应被抽成底色块').toHaveLength(1)
      expect(plates[0], '只应抽到 template 块里那块').toBe(PLATE_OK)
      // 反向对照：script 里有字面量但 template 块里**真没有**底色块 ⇒ 抽不到
      const onlyScript = `<script>const s = "<view class='${PLATE_BAD}'>"</script><template><view>x</view></template>`
      expect(extractPlates(onlyScript), 'script 里的假底色块不应满足判据').toHaveLength(0)
    })

    it('诊断必须区分「压根没写底色块」与「写了但抽取器认不出」', () => {
      // ⚠️ 这条曾是个**恒真**用例：它重算一遍与被测实现同形的 `&&` 表达式来"验证"
      //    自己，而输入恰好不含 bg-inverse-surface ⇒ 无论真门禁怎么改都绿。
      //    现在 `missingPlateMessage` 已提成具名函数，用例直接断言**消息文本**。
      const noPlateAtAll = '<view class="rounded-lg">标题</view>'
      expect(extractPlates(noPlateAtAll)).toHaveLength(0)
      expect(missingPlateMessage('X', noPlateAtAll, [])).toContain('找不到稳定底色块')

      // 底色块存在、但两个类**分处两个元素**（抽取器认不出「同一个元素」的约定）⇒ 走「抽取器漏读」
      const splitAcross = `<view class="bg-inverse-surface"><view class="rounded-lg">标题</view>`
      expect(extractPlates(splitAcross)).toHaveLength(0)
      expect(missingPlateMessage('X', splitAcross, [])).toContain('被抽取器漏读')
      expect(missingPlateMessage('X', splitAcross, [])).not.toContain('找不到稳定底色块')
    })

    it('<script> 内含 <template> 字面量时也不能把 script 尾部扫进来', () => {
      // ⚠️ code-review 阻塞项：`templateBlock` 若用「首个开标签 + lastIndexOf 闭合」，
      //    起点会落在 script 内的 `"<template>…"` 字面量上、终点是真 template 闭合
      //    ⇒ script 尾部整段被并进扫描面，假底色块重现（实测抽出 2 块）。
      const src = [
        `<script setup lang="ts">`,
        `const doc = "<template>片段</template>"`,
        `const t = "<view class='${PLATE_BAD}'>"`,
        `</script>`,
        `<template><view class="${PLATE_OK}">真底板</view></template>`,
      ].join('\n')
      const plates = extractPlates(src)
      expect(plates, 'script 内的 <template> 字面量不得把 script 尾部并进扫描面').toHaveLength(1)
      expect(plates[0], '只应抽到 template 块里那块').toBe(PLATE_OK)
    })
  })

  // ── #1004：沉浸卡自发现（原「只认三个硬编码文件名」） ────────────────────
  //
  // 本组验的是**发现判据**与**双向集合夹逼**两件事的纯函数形态（缝二）。
  // 遍历层（哪些文件会被喂进来）在 walkProductionVue 自身的测试里下针（缝一）。
  //
  // ⚠️ 发现判据为什么认「用了 scrim 渐变令牌」而不是底色块形状
  //    （bg-inverse-surface + rounded-lg）：形状档位会变，全仓在用 5 种
  //    rounded-*，而 scrim 令牌的既定用途就是「与作品图融合」——它与
  //    「什么算一张沉浸卡」同源，与门禁自身「渐变不能被删」的断言也不会打架。
  describe('沉浸卡自发现：发现判据认的是 scrim 渐变，不是底色块形状', () => {
    it('真实沉浸卡源码 ⇒ 是候选（oracle：样例本身确实带该令牌）', () => {
      expect(REAL_CARD_SRC, '真实样例必须自带该令牌，否则夹具证明不了任何事').toContain(
        'var(--md-scrim-overlay)',
      )
      expect(isImmersiveCardSource(REAL_CARD_SRC)).toBe(true)
    })

    it('只有底色块形状、无 scrim 渐变 ⇒ 不是候选（形状档位会变，不能当发现判据）', () => {
      expect(isImmersiveCardSource('<view class="bg-inverse-surface rounded-lg">标题</view>')).toBe(false)
    })

    it('注释里提到 scrim 令牌 ⇒ 不是候选（判据必须落在代码本文上）', () => {
      // 三种注释形态都要剥：HTML 注释、`//` 行注释、**CSS 块注释**。
      // ⚠️ CSS 块注释是 code-review 实测补上的：原来的剥法不剥块注释，而 `.vue`
      //    的 `<style>` 里只要提一句「旧写法：var(--md-scrim-overlay)」，该文件就会
      //    被算成候选 ⇒ 集合相等判红并点名一个**根本没写沉浸卡**的文件（fail-closed 误诊）。
      const SLASH_STAR = '/' + '*'
      const STAR_SLASH = '*' + '/'
      for (const src of [
        '<!-- 这里记得写 var(--md-scrim-overlay) -->\n<view />',
        '// var(--md-scrim-overlay)\n<view />',
        `<style>${SLASH_STAR} 旧写法：var(--md-scrim-overlay) ${STAR_SLASH}</style>\n<template><view /></template>`,
        `<style scoped>\n${SLASH_STAR} var(--md-scrim-overlay) ${STAR_SLASH}\n.x { color: red }\n</style>`,
      ]) {
        expect(isImmersiveCardSource(src), `注释形态不该入候选：${src.slice(0, 40)}`).toBe(false)
      }
    })

    // ⚠️ characterization（钉住**已知失效面**，不是 specification）：下面断言的是
    //    「当前**会**误判」这一事实，不是「应该这样」。它存在的意义是让
    //    「行尾 // 注释不被识别」这条登记**可执行、可观察**，而不是只躺在散文里；
    //    将来有人扩了剥法，这条会红 —— 那正是应该发生的事（届时请同步删掉上方
    //    的失效面登记并说明新判据为何不再 fail-closed）。
    //    断言方向写死为 true，故只描述现状、不隐含改进承诺。
    it('【characterization·已知失效面】行尾 // 注释仍会被误判为候选', () => {
      expect(isImmersiveCardSource('const a = 1 // var(--md-scrim-overlay)\n<view />')).toBe(
        true,
      )
    })
  })

  describe('沉浸卡自发现：清单与扫描结果双向相等（漏网 / 过期都暴露）', () => {
    const REGISTERED = ['pages/Recommended.vue', 'pages/NovelIntro.vue']
    const REAL = '<view style="background:linear-gradient(var(--md-scrim-overlay))" />'

    it('两侧相等 ⇒ 无诊断', () => {
      expect(consumerSetDiagnosis(REGISTERED, REGISTERED)).toBeUndefined()
    })

    it('漏网侧：扫描出的文件不在清单里 ⇒ 点名该文件', () => {
      const msg = consumerSetDiagnosis([...REGISTERED, 'pages/NewCard.vue'], REGISTERED)
      expect(msg, '漏网必须判红').toBeDefined()
      expect(msg).toContain('pages/NewCard.vue')
      expect(msg).toContain('未入判')
    })

    it('过期侧：清单里的文件扫描不到 ⇒ 点名该清单项', () => {
      const msg = consumerSetDiagnosis(['pages/Recommended.vue'], REGISTERED)
      expect(msg, '清单过期必须判红').toBeDefined()
      expect(msg).toContain('pages/NovelIntro.vue')
      expect(msg).toContain('清单')
    })

    it('扫描到 0 个候选 ⇒ 报「扫描面退化」而不是谎报「清单过期」', () => {
      const msg = consumerSetDiagnosis([], REGISTERED)
      expect(msg).toBeDefined()
      expect(msg).toContain('退化')
      expect(msg).not.toContain('清单')
    })

    it('两侧同时为空 ⇒ 仍判红（「什么都没扫到」与「仓里真的没有」同形）', () => {
      const msg = consumerSetDiagnosis([], [])
      expect(msg, '空对空是最典型的恒真陷阱，必须拦').toBeDefined()
      expect(msg).toContain('退化')
    })
  })

  // ── 缝一：遍历层（合成树）。纯函数缝证得了逻辑，证不了「真实遍历有没有把
  //    对的文件喂进来」——而后者正是 #1004 的失效面本身。合成树用真实卡源码。
  describe('沉浸卡自发现：遍历层（合成树，#1004）', () => {
    /** 在临时目录造一棵源码树，返回「遍历 + 发现」给出的候选键。 */
    function candidatesOf(files: Record<string, string>): string[] {
      const root = fs.mkdtempSync(path.join(tmpdir(), 'immersive-discovery-'))
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content, 'utf-8')
      }
      return discoverImmersiveCards(root)
    }

    it('新卡被发现；.ts 夹具与 errorPrototype 原型页不入候选', () => {
      expect(
        candidatesOf({
          'pages/NewCard.vue': REAL_CARD_SRC,
          // src 下真实存在这类夹具（*.template.test.ts），它们也含该令牌。
          // 遍历不过滤扩展名 ⇒ 凭空多出候选，集合相等当场判红。实测曾真会如此。
          'pages/NewCard.template.test.ts': REAL_CARD_SRC,
          'errorPrototype/ErrorPagePreview.vue': REAL_CARD_SRC,
          'components/Plain.vue': '<template><view /></template>',
        }),
      ).toEqual(['pages/NewCard.vue'])
    })

    it('合成树里出现的新卡 ⇒ 端到端判红并点名（判别力自检）', () => {
      const msg = consumerSetDiagnosis(
        candidatesOf({ 'pages/NewCard.vue': REAL_CARD_SRC }),
        registeredKeys(),
      )
      expect(msg, '新卡不入判 ⇒ 门禁必须判红，否则本组与整个 #1004 都是恒真的').toBeDefined()
      expect(msg).toContain('pages/NewCard.vue')
    })
  })
})
