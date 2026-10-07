// ─── 遮挡带（水平轴）静态门禁 · 债务登记（ADR-0221 §7 第 2 条 / 票 #956）───
//
// ## 这道门禁在守什么
//
// 票 #932：`/continue` 行尾「移除」药丸有 **97% 宽度**落在 GlobalFab 的**遮挡带**
// `[80.8, 95.73]vw` 内，点它开的是搜索弹层而不是删除（真机像素 + 点按双重取证）。
// ADR-0221 决策：**行内动作不得落在行的尾部**，一律置行首（40dp 圆形图标按钮）。
//
// 本门禁是那道决策的**机器防线**：任何行级交互控件回到行尾 ⇒ 红。
//
// ## 为什么必须住在 CI 内（不是 E2E）
//
// ① 本仓**模拟器 E2E 不进 CI**（AGENTS.md「门禁边界」/ ADR-0084）⇒ 只写 E2E 断言等于没有防线；
// ② 该缺陷是**行为性**的（点击被谁吃掉），静态单测本来就推不出来 ⇒ 反过来也不能用静态单测**替代**
//    真机点按取证，只能当**前置防线**：布局改回行尾时，先被这道门禁拦住，别等到走查才发现。
//
// ## 为什么是「宽扫 + 债务登记」而不是白名单
//
// ADR-0221 §4 明确登记了**刻意不处理**的站点（非破坏性 toggle / 折叠 / 导航 chip），
// 它们需要独立评估票。⇒ 门禁不是「这些文件不看」，而是：
//
//   **扫描照做（全仓 82 个 `.vue`），命中的站点必须逐个登记，且登记必须带票号。**
//   登记的豁免在**站点消失时自动作废并转红**（见下方「票的活性」）——
//   这正是本仓反复在消灭的「白名单静默腐烂」：豁免活得比它的理由久。
//
// ## 票的活性：为什么是「站点活性」而不是读 GitHub
//
// ⚠️ **GitHub issue 状态无法离线核验**（CI 单测无网络、不调 `gh`；票只存在于 GitHub，
//    仓库里**没有任何**本地票状态台账 —— 实测 `grep '#950'` 全仓 0 命中）。
// ⇒ 活性用**代理判据**表达，共三条转红路径，任一命中即要求移除登记：
//
//   1. 登记的站点**不再被扫描命中** ⇒ 缺陷已修（票该关了）⇒ 豁免无对象，红；
//   2. 登记的**站点标记在该文件里消失**（改了处理器名 / 搬了位置）⇒ 登记已名不副实，红；
//   3. ADR-0221 §4 的「刻意不处理」表**不再列该站点** ⇒ 豁免的书面依据没了，红。
//
// 已知失效面（显式登记，防下一个人把「全绿」读成「这类问题不存在」）：
//
// - **1. 读不到票的开关状态**：票被人在 GitHub 上直接关掉、但站点还没修时，本门禁**不会**红
//   （豁免仍然对应着一个真实存在的缺陷）。修完站点后下一次扫描必然转红 ⇒ 关闭动作最迟在修复时
//   被抓到，不会无限期腐烂。
// - **2. 只认静态 `class="…"`**：`:class` 里的**动态拼接**类名不解析
//   （本仓唯一的动态 spacing 拼接是 DOM node id，不是 class，见 md3GuardScans.test.ts 同款取舍）。
// - **3. 只看模板区**（`<template>` 之后）：组件间布局关系不追。行由父组件包一层容器不影响行内位置。
// - **4. 几何是「行内容盒」级估算**，不是渲染判据：命中面宽度按 `w-[…vw]` 或
//   `h-[…vw] + 2×px` 估算，取**行内容盒**（比动作本身宽）作为保守上界 ——
//   宁可多判一条进「须登记」，不可漏判。行内容右缘确实落在带左侧时**判为清白**（见 A2）。
// - **5. 等价写法**：`justify-between` 把动作推到行尾、`ml-auto`、绝对定位 `right-*`
//   都认；但**若将来用 `justify-between` 且前面没有增长兄弟**（改写行结构），
//   本判据会漏 —— 已由 D 组「四处已修站点」+ 债务配平共同兜底（漏判 ⇒ 登记配平立刻转红）。
// - **6. 「行尾但不是卡片行」的药丸不判**（实测边界，写下来免得下一个人当成零缺陷）：
//   `IllustDetail.vue:663` 的「查看下载」chip 形态与已登记的 #951 关注 pill **同形**
//   （定长、`rounded-full`、行末、位于滚动流内），但它所在的 `p-4 bg-surface-container-lowest`
//   区块**没有形状档位**、且它前面没有增长兄弟 ⇒ 「行尾」判据不成立，不进命中集合。
//   ⚠️ 这是**当前规则的真实边界**，不是「已确认安全」：真机上该 chip 是否与搜索 FAB 抢点击
//   未经点按取证（本仓 E2E 不进 CI）。若将来要为它定性，正确的做法是**先取证、再决定**
//   扩规则或登记成债务 —— 不要直接把它算成「门禁已覆盖」。
//
// ## 期望值出处（oracle 溯源，禁从被测实现反推）
//
// 带的两个边界**不在本文件出现**，一律 `import` 自 `src/utils/fabGeometry.ts`
// （由 `FAB_EDGE_VW` / `FAB_SIZE_VW` 导出，票 #952）。间距档位**从 `tailwind.config.ts` 现读**，
// 本文件不抄任何 vw 字面量 ⇒ 改 FAB 尺寸或 spacing 档位时门禁自动跟随（ADR-0221 §7 的前提）。
// 带边界本身的真机像素锚点（872px / 1033px）由 `tests/fabGeometry.test.ts` 承担，本文件不重复。

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAB_BAND_LEFT_VW, FAB_BAND_RIGHT_VW } from '../src/utils/fabGeometry'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(PKG, 'src')

/** 从 cwd 向上找仓库根（对调用位置免疫：`pnpm --filter` 下 cwd = 包目录） */
function findRepoRoot(start: string): string {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('repo root not found (AGENTS.md + pnpm-workspace.yaml)')
    dir = parent
  }
}
const REPO_ROOT = findRepoRoot(process.cwd())
const readPkg = (rel: string): string => readFileSync(join(PKG, rel), 'utf8')
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8')

// ═══════════════ 间距档位：从 tailwind.config.ts 现读（不抄字面量） ═══════════════
//
// 为什么现读：行内容右缘 = `100vw − Σ(左右对称内缩)`，而内缩写在 spacing 档位里
// （`mx-3` / `p-3.5` / `px-4` …）。抄字面量 = 第二事实源，改档位时门禁静默失真
// —— 这正是 `fabGeometry.ts` 开篇点名要消灭的形态（「两边各自硬编码」）。

/** 档位键 → vw 值（如 `3` → `3.200`）。只取 `spacing` 块内、带 `vw` 单位的定义行。 */
const SPACING_VW: Map<number, number> = (() => {
  const raw = readPkg('tailwind.config.ts')
  const block = raw.match(/\n\s*spacing:\s*\{([\s\S]*?)\n\s*\}/)
  if (!block?.[1]) throw new Error('tailwind.config.ts 的 spacing 块解析失败 —— 判据输入无效')
  const out = new Map<number, number>()
  for (const m of block[1].matchAll(/^\s*([\d.]+)\s*:\s*'([\d.]+)vw'/gm)) {
    out.set(Number(m[1]), Number(m[2]))
  }
  if (out.size === 0) throw new Error('spacing 块里没解析出任何 vw 档位 —— 判据输入无效')
  return out
})()

/** 某个 spacing 档位键（`'3'` / `'3.5'`）的 vw 值；未登记则返回 0（不猜、不报错：静态判据追不进的写法不参与估算）。 */
const spacingVw = (key: string): number => SPACING_VW.get(Number(key)) ?? 0

// ═══════════════ 模板解析（判据基座） ═══════════════

/** 剥注释。⚠️ 必须剥：本文件与四道已修组件的头注里都写着带边界、`rounded-full`、
 *  `text-error` 等字样，不剥会把注释当命中（AGENTS.md：「判据报错先怀疑判据」）。 */
const stripComments = (src: string): string =>
  src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const VOID_TAGS = new Set(['image', 'input', 'br', 'img', 'meta', 'link'])

interface TagNode {
  name: string
  attrs: string
  children: TagNode[]
  parent: TagNode | null
}

/** 只取 `<template>` 区。找不到 ⇒ 判据输入无效，直接抛（不退化成全文扫描，
 *  否则位置判据会命中 import 行 —— `bottomOcclusionAllowance.test.ts` 已因同类回退栽过一次）。 */
function templateOf(src: string): string {
  const clean = stripComments(src)
  const i = clean.indexOf('<template>')
  if (i === -1) throw new Error('未找到 <template> 区')
  return clean.slice(i)
}

function buildTree(src: string): TagNode {
  const root: TagNode = { name: '#root', attrs: '', children: [], parent: null }
  const stack: TagNode[] = [root]
  const re = /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const [, closing, name, inner, selfClose] = m
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1]!.name === name) stack.pop()
      else {
        let i = stack.length - 1
        while (i > 0 && stack[i]!.name !== name) i--
        if (i > 0) stack.length = i
      }
      continue
    }
    const node: TagNode = { name: name!, attrs: inner ?? '', children: [], parent: stack[stack.length - 1]! }
    stack[stack.length - 1]!.children.push(node)
    if (selfClose !== '/' && !VOID_TAGS.has(name!)) stack.push(node)
  }
  return root
}

// ── class / 属性谓词 ──

const classesOf = (node: TagNode): string[] => {
  const m = /(^|\s)class\s*=\s*"([^"]*)"/.exec(node.attrs)
  return m?.[2] ? m[2].split(/\s+/).filter(Boolean) : []
}

/** 该元素的 tap 类处理器表达式（`@tap` / `@tap.stop` / `@long-press` …），无则 null。 */
const tapHandlerOf = (node: TagNode): string | null => {
  const m = /@[\w.-]*?(?:tap|press)(?:\.[\w.-]+)*\s*=\s*"([^"]*)"/.exec(node.attrs)
  return m?.[1]?.trim() ?? null
}
const isHitSurface = (node: TagNode): boolean => /@[\w.-]*?(?:tap|press)(?:\.[\w.-]+)*\s*=/.test(node.attrs)

/** 自身尺寸由 vw 档位治理（`w-[10.667vw]` / `h-[8vw]` / `min-h-[9vw]` …）。 */
const hasVwBox = (node: TagNode): boolean =>
  classesOf(node).some((c) => /^(?:min-)?[wh]-\[[\d.]+vw\]$/.test(c))

/** 会横向铺满 / 吃掉剩余空间的元素：行面本身、对话框按钮组，不是「定长动作」。 */
const grows = (node: TagNode): boolean =>
  classesOf(node).some((c) => c === 'flex-1' || c === 'grow' || c === 'w-full' || c.startsWith('flex-grow'))

const isFlexRow = (node: TagNode): boolean => {
  const c = classesOf(node)
  return c.includes('flex') && c.includes('flex-row')
}
/** 带形状档位（`rounded-full` / `rounded-[var(--md-shape-medium)]` / `rounded-t-[…]` …）。
 *  ⚠️ 判据是**「首段为 rounded」**而不是枚举具体形态：枚举会把 `rounded-full`、
 *  `rounded-[var(--md-shape-*)]` 全部漏掉（第一版就这么栽了，三处站点一起消失）——
 *  形状档位名会随 MD3 档位表增长，枚举即腐烂。 */
const isShaped = (node: TagNode): boolean => classesOf(node).some((c) => /^rounded(-|$)/.test(c))
const wraps = (node: TagNode): boolean => classesOf(node).includes('flex-wrap')

/** 全屏浮层：`hasOpenModal` 会把 GlobalFab 强制成 `hidden` ⇒ 浮层内的命中面不可能与它抢点击
 *  （ADR-0221 §4 对 `SearchSheet.vue:438` 的原话）。这是**平台事实**，不是白名单。 */
const isFullScreenLayer = (node: TagNode): boolean => {
  const c = classesOf(node)
  return (
    (c.includes('absolute') || c.includes('fixed')) &&
    (c.includes('inset-0') || (c.includes('w-full') && c.includes('h-full')))
  )
}

/** 该元素的**左右对称**水平内缩（vw）。`ml-*` / `pr-*` 这类单侧值不算 ——
 *  它们把内容挪窄，不改变行内容盒的右缘。 */
const symmetricInsetVw = (node: TagNode): number => {
  let sum = 0
  for (const c of classesOf(node)) {
    const m = /^(?:m|mx|p|px)-([\d.]+)$/.exec(c)
    if (m) sum += spacingVw(m[1]!)
  }
  return sum
}

/** 元素自身的右侧间距（vw）：`mr-*` / `pr-*`。 */
const rightGapVw = (node: TagNode): number => {
  let sum = 0
  for (const c of classesOf(node)) {
    const m = /^(?:m|mr|p|pr)-([\d.]+)$/.exec(c)
    if (m) sum += spacingVw(m[1]!)
  }
  return sum
}

// ═══════════════ 检测器 ═══════════════

export type RejectReason =
  | 'not-hit-surface'
  | 'no-vw-box'
  | 'grows'
  | 'overlay'
  | 'not-trailing'
  | 'no-row-context'
  | 'clear-of-band'

export interface RowAction {
  /** 相对包根、posix 分隔 */
  file: string
  /** 行内动作的处理器表达式（登记与配平都用它当站点标识） */
  handler: string
  /** 命中的「行尾」判据 */
  trailing: 'ml-auto' | 'absolute-right' | 'last-after-grow-sibling' | 'last-in-card-row'
  /** 命中面在屏幕上的水平区间（vw） */
  left: number
  right: number
}

export interface ScanResult {
  actions: RowAction[]
  /** 每条判据在**真实文件**上淘汰了多少个元素（反空洞证据，见 B2） */
  rejected: Record<RejectReason, number>
  /** 参与扫描的文件数（含 `<template>` 的） */
  filesScanned: number
}

/** 该元素的祖先链（含自身，从近到远）。 */
function chainOf(node: TagNode): TagNode[] {
  const out: TagNode[] = []
  for (let p: TagNode | null = node; p && p.name !== '#root'; p = p.parent) out.push(p)
  return out
}

/** 该文件模板区内的 `<list>` / `<scroll-view>` 节点。 */
function scrollContainersOf(root: TagNode): TagNode[] {
  const out: TagNode[] = []
  ;(function walk(n: TagNode): void {
    for (const c of n.children) {
      if (c.name === 'list' || c.name === 'scroll-view') out.push(c)
      walk(c)
    }
  })(root)
  return out
}

/**
 * 命中面的水平区间（vw）。
 *
 * 绝对定位（`absolute` + `right-*`）：右缘 = `100 − 右距`，左缘 = 右缘 − 估算宽。
 * 弹性行尾（`ml-auto` / 行末子节点）：落在**行内容盒**内 —— 盒右缘 = `100 − Σ对称内缩 − 自身右间距`，
 * 盒左缘 = `Σ对称内缩`。用行内容盒而不是动作本身是**保守**的（盒更宽 ⇒ 更易判为带内），
 * 对「安全向」的门禁方向正确；真要更精确就得渲染判据，本文件做不到（见已知失效面 4）。
 *
 * ⚠️ 宽度**估不出来**时不得把左缘顶到右缘上（那等于宣称这是个零宽命中面 ⇒ 只要右缘越过带右缘
 *    就会被「左缘 ≥ 带右缘」判清白 —— 假绿的方向恰好是安全向的反面）。宽度未知 ⇒ 取最大伸展。
 */
function horizontalBox(node: TagNode, chain: TagNode[], absolute: boolean, rightOffsetVw: number): { left: number; right: number } {
  if (absolute) {
    const right = 100 - rightOffsetVw - rightGapVw(node)
    const wToken = classesOf(node).find((c) => /^w-\[([\d.]+)vw\]$/.exec(c))
    const width = wToken
      ? Number(/^w-\[([\d.]+)vw\]$/.exec(wToken)![1])
      : estimateWidthVw(node)
    return { left: width > 0 ? right - width : 0, right }
  }
  const inset = chain.slice(1).reduce((sum, a) => sum + symmetricInsetVw(a), 0)
  return { left: inset, right: 100 - inset - rightGapVw(node) }
}

/** 动作宽度的保守估算：`w-[…vw]` 优先，否则 `h-[…vw] + 2×水平内边距`。都没有 ⇒ 0。 */
function estimateWidthVw(node: TagNode): number {
  const hToken = classesOf(node).find((c) => /^h-\[([\d.]+)vw\]$/.exec(c))
  const h = hToken ? Number(/^h-\[([\d.]+)vw\]$/.exec(hToken)![1]) : 0
  let px = 0
  for (const c of classesOf(node)) {
    const m = /^px-([\d.]+)$/.exec(c)
    if (m) px += 2 * spacingVw(m[1]!)
  }
  return h + px
}

/** 行**首**命中面的水平区间（vw）：贴着行内容盒左缘排布，右缘 = 左缘 + 估算宽 + 自身右间距。
 *  D 组用它把「行首动作确实让开了带」变成**可算的断言**，而不是靠「没被列进命中」间接推断。 */
function leadingBox(node: TagNode, chain: TagNode[]): { left: number; right: number } {
  const inset = chain.slice(1).reduce((sum, a) => sum + symmetricInsetVw(a), 0)
  const left = inset
  return { left, right: left + estimateWidthVw(node) + rightGapVw(node) }
}

/** 在模板片段里按处理器表达式定位一个命中面（连同它的祖先链）。找不到 ⇒ null。 */
export function findActionNode(
  tpl: string,
  marker: string,
): { node: TagNode; chain: TagNode[] } | null {
  const root = buildTree(tpl)
  let found: { node: TagNode; chain: TagNode[] } | null = null
  ;(function walk(n: TagNode): void {
    for (const c of n.children) {
      if (found === null && isHitSurface(c) && tapHandlerOf(c) === marker) {
        found = { node: c, chain: chainOf(c) }
      }
      walk(c)
    }
  })(root)
  return found
}

/** 扫描一个模板片段。返回带内行尾动作 + 每条判据的淘汰计数。 */
export function scanTemplate(tpl: string, file: string): { actions: RowAction[]; rejected: Record<RejectReason, number> } {
  const rejected: Record<RejectReason, number> = {
    'not-hit-surface': 0,
    'no-vw-box': 0,
    grows: 0,
    overlay: 0,
    'not-trailing': 0,
    'no-row-context': 0,
    'clear-of-band': 0,
  }
  const root = buildTree(tpl)
  const scrolls = scrollContainersOf(root)
  const actions: RowAction[] = []

  ;(function walk(n: TagNode): void {
    for (const node of n.children) {
      if (!isHitSurface(node)) {
        rejected['not-hit-surface']!++
        walk(node)
        continue
      }
      const handler = tapHandlerOf(node)!
      const chain = chainOf(node)
      const drop = (why: RejectReason): void => {
        rejected[why]!++
      }

      // ① 定长控件：自身尺寸由 vw 档位治理，且不铺满
      if (!hasVwBox(node)) {
        drop('no-vw-box')
        walk(node)
        continue
      }
      if (grows(node)) {
        drop('grows')
        walk(node)
        continue
      }

      // ② 非全屏浮层（modal 打开 ⇒ FAB hidden，不可能重叠）
      if (chain.some(isFullScreenLayer)) {
        drop('overlay')
        walk(node)
        continue
      }

      // ③ 行尾判据（四种等价写法）
      const classes = classesOf(node)
      const parent = node.parent
      const inRow = parent != null && parent.name !== '#root' && isFlexRow(parent) && !wraps(parent)
      const isLast = inRow && parent!.children.indexOf(node) === parent!.children.length - 1
      const afterGrowSibling = isLast && parent!.children.slice(0, -1).some((sib) => grows(sib))
      // 「卡片行」= 带形状档位、且自身或直属父层有左右内缩的那一层（行卡片的既定形态）
      const boxChain = chain.slice(1)
      const inCardRow = boxChain.some((a, i) => isShaped(a) && (symmetricInsetVw(a) > 0 || symmetricInsetVw(boxChain[i + 1]!) > 0))
      const absoluteRight = classes.includes('absolute') && classes.some((c) => /^right-[\d.]+$/.test(c))
      const rightOffset = absoluteRight
        ? spacingVw(/^right-([\d.]+)$/.exec(classes.find((c) => /^right-[\d.]+$/.test(c))!)![1]!)
        : 0

      let trailing: RowAction['trailing'] | null = null
      if (classes.includes('ml-auto')) trailing = 'ml-auto'
      else if (absoluteRight) trailing = 'absolute-right'
      else if (afterGrowSibling) trailing = 'last-after-grow-sibling'
      else if (isLast && inCardRow) trailing = 'last-in-card-row'
      if (!trailing) {
        drop('not-trailing')
        walk(node)
        continue
      }

      // ④ 行上下文：必须在滚动流里，或在卡片行里
      //    （对话框 / 抽屉 / 贴底动作条既不在滚动流里，也不是卡片行）
      const inScroll = scrolls.some((s) => chain.includes(s))
      if (!inScroll && !inCardRow) {
        drop('no-row-context')
        walk(node)
        continue
      }

      // ⑤ 几何：带的两个边界只从 fabGeometry 取，本文件不写数值
      const { left, right } = horizontalBox(node, chain, absoluteRight, rightOffset)
      if (right <= FAB_BAND_LEFT_VW || left >= FAB_BAND_RIGHT_VW) {
        drop('clear-of-band')
        walk(node)
        continue
      }
      actions.push({ file, handler, trailing, left, right })
      walk(node)
    }
  })(root)

  return { actions, rejected }
}

// ═══════════════ 债务登记 ═══════════════
//
// 每条登记 = **一票多站点**。票号是豁免的**唯一凭据**：站点修掉（票关闭）后
// 配平判据立刻转红，豁免必须跟着删 —— 见文件头「票的活性」。
//
// ⚠️ 新增登记必须同时改 `DECLARED_TICKETS`（C3 钉住票集合），否则门禁会红。
//    这是刻意的双写：让「多豁免一票」变成一次有痕迹的动作，而不是悄悄往数组里塞一行。

export interface BandDebtEntry {
  /** 债务票号（GitHub issue）。豁免只在它还开着时成立。 */
  readonly ticket: number
  /** 本票覆盖的站点。`marker` = 该动作的处理器表达式（改名字即视为搬了家，须同步登记）。 */
  readonly sites: ReadonlyArray<{ readonly file: string; readonly marker: string }>
  /** 为什么不修（ADR-0221 §4 的登记理由）。非空且具体，见 C2。 */
  readonly why: string
}

const BAND_DEBT: readonly BandDebtEntry[] = [
  {
    ticket: 950,
    why:
      '关注/取关控件（UserRow，3 条路由共用）。ADR-0221 §4 登记：同带重叠但**非破坏性**、是 toggle，' +
      '失败形态是「点了没反应」而非「数据没了」。⚠️ 其 `px-4` 比 40dp 药丸更宽 ⇒ 重叠比例比已修的四处更高，' +
      '须独立评估破坏性动作失去文字后的形态，并决定是否也迁行首。',
    sites: [{ file: 'src/components/UserRow.vue', marker: 'onToggle' }],
  },
  {
    ticket: 951,
    why:
      '关注作者 pill（IllustDetail）、关注数/粉丝数 chip（UserHome）、榜单卡折叠 ✕（RankingEntryCard）。' +
      'ADR-0221 §4 登记：三者同带重叠但**非破坏性**（pill/chip 是导航与 toggle，折叠是本次会话内收起），' +
      '不能与「破坏性动作必须有行首 40dp 错误色按钮」的迁移同批处理；' +
      '其中 RankingEntryCard 的 ✕ 已有 `active:opacity-80` 状态层。',
    sites: [
      { file: 'src/pages/IllustDetail.vue', marker: 'toggleFollowAuthor' },
      { file: 'src/pages/UserHome.vue', marker: 'openFollowers' },
      { file: 'src/components/RankingEntryCard.vue', marker: 'dismissed = true' },
    ],
  },
]

/** C3 钉住：当前登记的债务票集合。任何增删都必须改这一行（双写 = 有痕迹）。 */
const DECLARED_TICKETS: readonly number[] = [950, 951]

// ═══════════════ 全仓扫描 ═══════════════

function collectVueFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) {
        walk(abs)
        continue
      }
      if (entry.endsWith('.vue')) out.push(abs)
    }
  }
  walk(SRC)
  return out.sort()
}

function scanRepo(): ScanResult {
  const files = collectVueFiles()
  const actions: RowAction[] = []
  const rejected = {
    'not-hit-surface': 0,
    'no-vw-box': 0,
    grows: 0,
    overlay: 0,
    'not-trailing': 0,
    'no-row-context': 0,
    'clear-of-band': 0,
  } as Record<RejectReason, number>
  let filesScanned = 0
  for (const abs of files) {
    const rel = relative(PKG, abs).split('\\').join('/')
    let tpl: string
    try {
      tpl = templateOf(readPkg(rel))
    } catch {
      continue // 无 `<template>` 的文件（如纯 .ts 语法的辅助模块）不参与本判据
    }
    filesScanned++
    const r = scanTemplate(tpl, rel)
    actions.push(...r.actions)
    for (const k of Object.keys(rejected) as RejectReason[]) rejected[k]! += r.rejected[k]!
  }
  return { actions, rejected, filesScanned }
}

const SCAN = scanRepo()
/** 站点标识：文件 + 处理器表达式。扫描命中与债务登记用**同一把钥匙**配平。 */
const keyOf = (file: string, marker: string): string => `${file}::${marker}`
const detectedKeys = new Set(SCAN.actions.map((a) => keyOf(a.file, a.handler)))
const registeredKeys = new Set(BAND_DEBT.flatMap((e) => e.sites.map((s) => keyOf(s.file, s.marker))))

/** ADR-0221 §4「刻意不处理」表 —— 豁免的书面依据。票关闭 ⇒ 该行删除 ⇒ 门禁转红。 */
const ADR_0221 = readRepo('docs/adr/ADR-0221-row-action-leaves-trailing-band.md')
const ADR_0221_S4 = (() => {
  const m = /##\s*4\.\s*覆盖范围([\s\S]*?)##\s*5\./.exec(ADR_0221)
  if (!m?.[1]) throw new Error('ADR-0221 §4 解析失败 —— 豁免依据判据输入无效')
  return m[1]
})()

describe('遮挡带 · A 组：量纲与几何前提', () => {
  it('行内容右缘确实落在遮挡带内（这是「行尾 = 不可交互」的**推导前提**，不是假设）', () => {
    // 行内容右缘 = 100vw − 行卡片的左右内缩。内缩档位从 tailwind.config.ts 现读，
    // 带的两个边界从 fabGeometry import ⇒ 全链路无字面量。
    const rowCardInset = spacingVw('3') + spacingVw('3.5') // mx-3 + p-3.5（四处已修行卡的形态）
    const rowContentRight = 100 - rowCardInset
    // ⚠️ 这条若红，说明**前提被推翻**：行尾不再等于带内，「行尾动作一律判红」就失去根据，
    //    得连同 ADR-0221 §2 的理由一起重审，而不是把判据调松。
    expect(
      rowContentRight > FAB_BAND_LEFT_VW,
      `行内容右缘 ${rowContentRight.toFixed(3)}vw 须落在带左缘 ${FAB_BAND_LEFT_VW}vw 之内`,
    ).toBe(true)
    expect(
      rowContentRight < FAB_BAND_RIGHT_VW,
      `行内容右缘 ${rowContentRight.toFixed(3)}vw 须落在带右缘 ${FAB_BAND_RIGHT_VW}vw 之内`,
    ).toBe(true)
  })

  it('带边界只从 fabGeometry 取（本文件不得出现带数值的字面量）', () => {
    // 防的是「有人顺手把 80.8 / 95.733 抄进判据」：那会让 FAB 改尺寸时门禁静默放过
    // —— fabGeometry.ts 文末把这条写成 ADR-0221 §7 新增门禁的**前提**。
    const self = readPkg('tests/fabOcclusionBand.test.ts')
    // 只查代码区（头注里出现这两个数是**正确的事实陈述**，同「间距只从 tailwind.config 现读」）。
    const code = self.split('\n').filter((l) => !l.trim().startsWith('//'))
    // ⚠️ 反空洞：被扫的代码区必须真的有内容，否则「全都没查到」会与「本文件被清空成注释」同形。
    expect(code.length, '本文件被判为「全是注释」—— 该条断言已退化成恒真').toBeGreaterThan(150)
    for (const line of code) {
      expect(line, `判据代码里不得出现带边界字面量：${line.trim()}`).not.toMatch(
        /\b(?:80\.8|95\.733|80\.741|95\.648|14\.933)\b/,
      )
    }
  })

  it('行首动作不命中 / 行尾动作命中 / 行内容右缘已在带左缘之外时判清白（合成 fixture，判别力自证）', () => {
    // 行卡片的既定形态：横向内缩 + 表面 + 形状档位
    const row = (inner: string, inset = 'mx-3 p-3.5'): string =>
      templateOf(
        `<template><view class="flex flex-row items-center ${inset} bg-surface-container-lowest rounded-[var(--md-shape-medium)]">${inner}</view></template>`,
      )

    // 行首：动作在增长内容**之前**，且带 `mr-*`（四处已修站点的形态）
    const leading = scanTemplate(
      row(
        '<view class="mr-1.5 w-[10.667vw] h-[10.667vw] rounded-full" @tap="a" />' +
          '<view class="flex-1"><text>x</text></view>',
      ),
      'fixture-leading.vue',
    )
    expect(leading.actions.map((a) => a.handler)).toEqual([])

    // 行尾：动作在增长内容之后 ⇒ 必须命中，且处理器标识取自 @tap
    const trailing = scanTemplate(
      row('<view class="flex-1"><text>x</text></view><view class="h-[10.667vw] px-4 rounded-full" @tap="b" />'),
      'fixture-trailing.vue',
    )
    expect(trailing.actions.map((a) => a.handler)).toEqual(['b'])

    // 负样本 ①：**贴底内流动作条**（贴底动作条的既定形态：全宽 + 顶边分隔线 + 无形状档位）。
    //   它的发送/取消键同样「行尾 + 定长」，但该条既不在滚动流里、也不是卡片行 ⇒ 不判。
    //   依据：ADR-0147 / 术语表「滚动容器覆层约束」—— 合法写法就是走正常文档流的兄弟节点。
    const inFlowBar = templateOf(
      '<template><view class="w-full bg-surface-container-lowest border-t border-t-outline-variant px-3 py-2">' +
        '<view class="flex flex-row items-center gap-2"><view class="flex-1" /><view class="h-[10.667vw] px-5 rounded-full" @tap="d" /></view>' +
        '</view></template>',
    )
    const bar = scanTemplate(inFlowBar, 'fixture-inflow-bar.vue')
    expect(bar.rejected['no-row-context'], '贴底内流动作条不该判为行内动作').toBeGreaterThan(0)
    expect(bar.actions.map((a) => a.handler)).toEqual([])

    // 负样本 ②：**模态浮层内的卡片行**。`hasOpenModal` 会把 GlobalFab 强制成 `hidden`
    //   ⇒ 浮层内的命中面不可能与它抢点击（ADR-0221 §4 对 `SearchSheet.vue:438` 的原话）。
    const modal = templateOf(
      '<template><view class="absolute inset-0 z-40">' +
        '<view class="flex flex-row items-center mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]">' +
        '<view class="flex-1" /><view class="h-[10.667vw] px-4 rounded-full" @tap="e" /></view></view></template>',
    )
    const sheet = scanTemplate(modal, 'fixture-modal.vue')
    expect(sheet.rejected['overlay'], '模态浮层内的动作不该判为行内动作').toBeGreaterThan(0)
    expect(sheet.actions.map((a) => a.handler)).toEqual([])

    // 行内容右缘已退到带左缘**左侧** ⇒ 几何判清白（带边界在这里真正承重，不是摆设）
    // ⚠️ 档位必须在 spacing 里**登记**：未登记的档位按 0 计（追不进的写法不参与估算），
    //    用不存在的档位会让内缩被静默腰斩 ⇒ 本用例测不到几何判据却照样「绿」。
    const heavyInset = ['12', '12'].reduce((s, k) => s + spacingVw(k), 0) // mx-12 + p-12
    expect(heavyInset, 'fixture 的内缩档位必须在 spacing 里登记').toBeGreaterThan(0)
    expect(100 - heavyInset, 'fixture 的内缩须把行右缘推出带，否则本用例测不到几何判据').toBeLessThan(FAB_BAND_LEFT_VW)
    const cleared = scanTemplate(
      row('<view class="flex-1"><text>x</text></view><view class="h-[10.667vw] px-4 rounded-full" @tap="c" />', 'mx-12 p-12'),
      'fixture-cleared.vue',
    )
    expect(cleared.rejected['clear-of-band'], '几何判清白这条判据必须是活的').toBeGreaterThan(0)
    expect(cleared.actions.map((a) => a.handler)).toEqual([])
  })
})

describe('遮挡带 · B 组：扫描面（反空洞）', () => {
  it('扫描面非空且模板区全部解析成功', () => {
    // ⚠️ 「扫不到东西所以全绿」是最坏的门禁形态。先证输入非空，再谈内容。
    expect(SCAN.filesScanned, '参与扫描的 .vue 文件数过少 —— 判据输入疑死').toBeGreaterThan(40)
    expect(SPACING_VW.size, 'tailwind spacing 档位解析失败 —— 几何估算输入无效').toBeGreaterThan(10)
    expect(FAB_BAND_LEFT_VW, '带左缘须为正（fabGeometry 输入无效）').toBeGreaterThan(0)
    expect(FAB_BAND_RIGHT_VW - FAB_BAND_LEFT_VW, '带宽须为正').toBeGreaterThan(0)
  })

  it('每条判据都在**真实文件**上淘汰过元素（筛选器不是摆设）', () => {
    // 空淘汰计数 = 该判据从未生效 ⇒ 它要么恒真、要么输入根本没到它面前。
    // ⚠️ `clear-of-band` 由 A3 的合成 fixture 单独证明（真实文件里目前无人走到它，
    //    这本身就是登记信息：一旦有人把行内容右缘推到带左侧，它才会被触发）。
    for (const why of ['no-vw-box', 'grows', 'overlay', 'not-trailing', 'no-row-context'] as RejectReason[]) {
      expect(SCAN.rejected[why]!, `判据「${why}」在全仓 0 次淘汰 —— 它没在承重`).toBeGreaterThan(0)
    }
    expect(SCAN.rejected['not-hit-surface']!).toBeGreaterThan(0)
  })
})

describe('遮挡带 · C 组：债务登记与票的活性', () => {
  it('扫描命中集合 == 债务登记集合（双向配平：漏登记 ⇒ 红，登记已过期 ⇒ 红）', () => {
    const unregistered = [...detectedKeys].filter((k) => !registeredKeys.has(k))
    expect(
      unregistered,
      '以下站点有行内动作落在遮挡带内却未登记为债务 ⇒ 立即红：\n  - ' +
        unregistered.join('\n  - ') +
        '\n\n修法二选一：把动作迁到行首（ADR-0221 决策）；或在 BAND_DEBT 里登记并带上票号' +
        '（票关掉后本条会再次转红，强制移除豁免）。',
    ).toEqual([])

    const stale = [...registeredKeys].filter((k) => !detectedKeys.has(k))
    expect(
      stale,
      '以下登记的债务**已不再被扫描命中** ⇒ 豁免已腐烂（站点已修 / 已改名 / 已搬走）：\n  - ' +
        stale.join('\n  - ') +
        '\n\n这正是「白名单静默腐烂」的形态。请：① 确认对应票可以关闭；' +
        '② 把该站点从 BAND_DEBT 移除（票号已无对象挂着它）；' +
        '③ 若站点只是被改名，把 marker 更新成新的处理器表达式。',
    ).toEqual([])
  })

  it('每条登记都必须有票号与具体理由（防登记表变成垃圾桶）', () => {
    for (const entry of BAND_DEBT) {
      expect(entry.ticket, '登记缺票号 ⇒ 豁免没有可追溯的依据').toBeGreaterThan(0)
      expect(entry.why.length, `#${entry.ticket} 的登记理由太短，不像理由`).toBeGreaterThan(30)
      expect(entry.sites.length, `#${entry.ticket} 没有任何站点`).toBeGreaterThan(0)
      for (const site of entry.sites) {
        expect(
          readPkg(site.file),
          `#${entry.ticket} 登记的 ${site.file} 读不到（文件已改名/移动？）`,
        ).toContain(site.marker)
      }
    }
    // 同一票号只登记一次：拆成两条会让「这票还开着吗」的判断散成多份
    const tickets = BAND_DEBT.map((e) => e.ticket)
    expect(new Set(tickets).size, `票号重复登记：${tickets.join(' / ')}`).toBe(tickets.length)
  })

  it('当前登记的债务票恰好是 #950 与 #951（钉住「只有这两笔债」）', () => {
    expect(
      [...BAND_DEBT.map((e) => e.ticket)].sort((a, b) => a - b),
      '登记的债务票集合与 DECLARED_TICKETS 不一致 —— 新增/移除豁免必须同时改这两处（双写让变更有痕迹）',
    ).toEqual([...DECLARED_TICKETS].sort((a, b) => a - b))
    expect([...DECLARED_TICKETS].sort((a, b) => a - b), 'DECLARED_TICKETS 本体被改动，请确认是有意为之').toEqual([950, 951])
  })

  it('每笔债务在 ADR-0221 §4「刻意不处理」表里仍有书面依据（票关闭 ⇒ 该行删除 ⇒ 本条转红）', () => {
    // 这是**离线**唯一可得的「票还开着吗」证据：豁免必须仍被决策文档登记为未处理。
    // ⚠️ 已知限制：GitHub 票的开关状态单测读不到（无网络、不调 gh），故用站点活性代理，
    //    详见文件头「票的活性」。三条转红路径里这条最晚触发，但不构成腐烂的出路。
    expect(ADR_0221_S4.length, 'ADR-0221 §4 解析为空 —— 判据输入无效').toBeGreaterThan(200)
    for (const entry of BAND_DEBT) {
      for (const site of entry.sites) {
        // §4 的表里写的是相对 src 的路径
        const adrPath = site.file.replace(/^src\//, '')
        expect(
          ADR_0221_S4.includes(adrPath),
          `#${entry.ticket} 的 ${site.file} 已不在 ADR-0221 §4 的「刻意不处理」表里 ⇒ ` +
            '豁免的书面依据没了。请删掉该登记（若站点确已修复）。',
        ).toBe(true)
      }
    }
  })
})

describe('遮挡带 · D 组：四处已修站点不得回到行尾', () => {
  // 票 #952–#955 的产物。这四条断言是本门禁的**正面锚**：它们让「行首」这个结论
  // 持续可见，而不是只靠债务配平间接约束。
  const FIXED_SITES: ReadonlyArray<{ file: string; marker: string }> = [
    { file: 'src/components/ContinueRow.vue', marker: "emit('remove', entry)" },
    { file: 'src/pages/Watchlist.vue', marker: 'askUnwatch(item)' },
    { file: 'src/pages/WatchLater.vue', marker: 'removeItem(item)' },
    { file: 'src/pages/MuteTags.vue', marker: 'removeTag(name)' },
  ]

  it('四处破坏性动作均未被判为行尾动作', () => {
    for (const site of FIXED_SITES) {
      const hits = SCAN.actions.filter((a) => a.file === site.file && a.handler === site.marker)
      expect(
        hits,
        `${site.file} 的破坏性动作又落回行尾（${site.marker}）⇒ 会被 GlobalFab 的遮挡带吃掉点击，` +
          '点它开的是搜索弹层而不是执行动作（票 #932）。请按 ADR-0221 决策迁回行首。',
      ).toEqual([])
      // 站点标记必须还在（文件被大改过 ⇒ 本断言要显形，而不是静默通过）
      expect(readPkg(site.file), `${site.file} 里找不到 ${site.marker}`).toContain(site.marker)
    }
  })

  it('四处行首动作确实落在带左侧（几何复核，不只看「没被列进命中」）', () => {
    // ⚠️ 这条是**正向几何断言**：把每个动作的实际水平位置算出来，要求右缘明确退到带左缘之外。
    //   「没命中」可能是筛选器漏了它；「右缘 < 带左缘」才是真的让开了。
    //   依据 ADR-0221 §5 取证第 2 条：贴边**不算通过** —— 贴边时命中归属没有余量。
    for (const site of FIXED_SITES) {
      const tpl = templateOf(readPkg(site.file))
      const hit = findActionNode(tpl, site.marker)
      expect(hit, `${site.file} 里按处理器表达式「${site.marker}」找不到该动作 —— 站点标记已变`).not.toBeNull()
      const { right } = leadingBox(hit!.node, hit!.chain)
      expect(
        right < FAB_BAND_LEFT_VW,
        `${site.file}：行首动作右缘 ${right.toFixed(3)}vw 未退到带左缘 ${FAB_BAND_LEFT_VW.toFixed(3)}vw 之外` +
          `（间隙 ${(FAB_BAND_LEFT_VW - right).toFixed(3)}vw）—— 贴边不算通过：` +
          '命中归属没有余量（ADR-0221 §5 取证第 2 条）',
      ).toBe(true)
    }
  })
})