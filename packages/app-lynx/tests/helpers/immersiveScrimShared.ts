// 沉浸卡 scrim 门禁的**共享内核**（#1009 拆分自 immersiveScrimContrast.test.ts）：
// 消费点清单 / WCAG 对比度所需令牌事实源 / 颜色令牌判定 / 底色块抽取 / 自发现扫描面。
//
// ⚠️ 本文件**不是测试文件**（helpers/ 下、非 *.test.ts），vitest 不收集它。
//    真门禁（immersiveScrimContrast.test.ts）、验收组（immersiveScrimContrast.acceptance.test.ts）、
//    自发现组（immersiveScrimDiscovery.test.ts）三处从这里 import ——
//    「两个消费方之间只允许存在一份实现」，写两遍的话两侧各自漂移、各自绿。
import fs from 'node:fs'
import path from 'node:path'
import {
  extractOpeningTags,
  extractTagContaining,
  readClassAttr,
  stripComments,
  templateBlock,
} from './vueTagScan'
import { srcKey, walkProductionVue } from './walkProductionVue'

/** 沉浸卡源码树根（#1004 全仓发现的扫描根）。 */
export const SRC_ROOT = path.resolve(__dirname, '../../src')
export type Rgb = readonly [number, number, number]
// ── 令牌事实源：直接读 tokens.css，不抄副本 ────────────────────────────────
// ⚠️ 抄副本 = 同义反复（断言 A==B 而 B 是 A 的抄本）。这里现读真源。

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../../src/styles/tokens.css'), 'utf-8')

export type Palette = {
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

export const PALETTES: Palette[] = (() => {
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
// ── 三个消费点：门禁要确认它们**真的用上**了稳定底色 ────────────────────────
//
// ⚠️ 这里**不能**用 `toContain('bg-inverse-surface')`：三个文件里都还有**别的**、
//    与 scrim 无关的 inverse 元素（NovelIntro 的导出面板就在用），`toContain`
//    会被那些无关命中满足掉 —— 删掉 scrim 底色照样绿。
//    判据必须是结构性的：**底色块出现在标题元素之前**。

export const CONSUMERS = [
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
export function extractPlates(src: string): string[] {
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
export function plateAlphaViolation(consumer: string, plate: string): string | undefined {
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
export function colourTokenNames(cls: string, prefix: 'bg' | 'text', ref: Palette): string[] {
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
export function colourTokenViolation(
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
export function titleTagClassOf(src: string, titleMarker: string): string | undefined {
  const tag = extractTagContaining(templateBlock(src), titleMarker)
  return tag === undefined ? undefined : readClassAttr(tag)
}

/** `CONSUMERS` 单项的类型（该常量是 `as const`，故由 typeof 派生而非手写一份）。 */
export type Consumer = (typeof CONSUMERS)[number]

/** 单个消费点的颜色判定结果（#1012）。 */
export interface ConsumerColours {
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
 *    这件事**没有任何机器防线** —— 原单文件里「共享函数 ≠ 共享接线」的两处注释（现随拆分散在验收组头注释与 `plateAlphaViolation` 的说明里）把这条立成了规矩，而实现没做到。
 *    ⇒ 现在真门禁**只经由本函数**取得颜色判定，验收组也调本函数；再由验收组一条
 *      **接线自检**（source-scan 断言真门禁 describe 真的调用了它）堵住「函数还在、接线被删」。
 */
export function judgeConsumerColours(src: string, c: Consumer): ConsumerColours {
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
export function stripVueComments(src: string): string {
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
export function missingPlateMessage(name: string, src: string, plates: readonly string[]): string {
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
export function isImmersiveCardSource(src: string): boolean {
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
export function consumerSetDiagnosis(
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
export function discoverImmersiveCards(root: string): string[] {
  return [...walkProductionVue(root, '[immersiveScrimGate]')]
    .filter((abs) => isImmersiveCardSource(fs.readFileSync(abs, 'utf-8')))
    .map((abs) => srcKey(root, abs))
    .sort()
}

/** 登记清单归一为与候选同构的键。 */
export function registeredKeys(): string[] {
  return CONSUMERS.map((c) => srcKey(SRC_ROOT, path.resolve(__dirname, '..', c.rel))).sort()
}

