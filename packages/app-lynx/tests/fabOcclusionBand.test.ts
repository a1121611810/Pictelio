// ─── ADR-0221 决策 2「行内动作置行首」· 四处已修站点的位置门禁（票 #932）───
//
// 这道门禁只做一件事：四个已修站点的破坏性动作仍在**内容列之前**，且行内**其后没有任何
// 交互兄弟**。判据是**源码顺序 + flex 对齐写法**，不是几何。它必须住在 CI：模拟器 E2E 不进
// CI（AGENTS.md「门禁边界」/ ADR-0084），而「点击被谁吃掉」只能真机点按取证 ⇒ 源级位置
// 断言是这条决策唯一的前置防线。
//
// ## 已删除的能力（以及为什么删）
// 前一版（本文件曾有 758 行）用正则搭了标签树解析器 + `horizontalBox` 几何估算，扫描
// `src/` 下全部 .vue、判定「行尾动作是否落在 GlobalFab 遮挡带内」。**它被证明会假绿**：把
// `ContinueRow.vue` 的移除按钮搬回行尾（票 #932 的原缺陷形态）时它把控件算成「清白」并
// 放过，11 条断言全绿 —— 假绿比没门禁更糟（workflows/review-fix-loop.md §门禁冻结线 #5）。
// 几何估算层已整体删除，本门禁不再做任何像素位置推断。
//
// ## 这道门禁**不能**抓什么（显式登记，防下一个人把「全绿」读成「这类问题不存在」）
//
// 1. **不再全仓扫描**。新出现的行内动作若落在遮挡带内，本门禁**不会**红 —— 扫描能力已随
//    几何估算一并删除。已覆盖的是下方**两组共 6 处已登记站点**（`LEADING_SITES` 4 +
//    `LEADING_FOLLOW_ACTIONS` 2）。债务登记 `BAND_DEBT` 已于 2026-10-12
//    清空（票 #950 / #951 结清）：新豁免必须同时登记进 `BAND_DEBT` 与 ADR-0221 §4
//    「刻意不处理」表，缺任一项「债务清零」那条即红。
// 2. **不做几何判定**，只判源码顺序与对齐写法；遮挡带自身的像素锚点由 `tests/fabGeometry.test.ts` 承担。
// 3. **只看那 6 处登记站点**（文件见下方 `LEADING_SITES` / `LEADING_FOLLOW_ACTIONS` 两组）。
//    （原第三组 `DISMISS_SITE` 随 #1043 删除 `RankingEntryCard.vue` 退场。）
//    其它文件里等价的已修写法若被改回行尾，本门禁不红。
//    未覆盖面可复算（外部复核 2026-10-12 订正：此前此处写的是「约 27 处 / 15 个文件」，
//    该数字来自二手报告、无推导命令，按两种口径都复算不出来 —— 已删除）：
//      $ grep -rlE "justify-between|justify-end|ml-auto|flex-row-reverse|order-(first|last|[0-9]+)|right-[0-9a-z[]" \
//          src --include=*.vue | wc -l
//      31
//    ⚠️ 这**不是**「31 个 bug」：是否真落在带内还取决于竖直位置，而本门禁刻意不做几何判定。
//    它只是「同类写法在仓内的分布」，用来提醒下一个人：本门禁的覆盖面是 7 处，不是全仓。
// 4. **读不到票的开关状态**（不调 `gh`、CI 无网络）⇒ 债务是否仍成立用**站点条件**代理。
//    票 #957 把该代理从「标记字符串还在」升级为「**该站点仍真在行尾**」（源码顺序 / 尾推类，
//    见下方 `带内证明`）：**站点一旦被修好，豁免即刻自动腐烂**——不需要任何人记得来删登记。
//    ⚠️ **残留缺口（不可再收窄）**：若有人在 GitHub 上**直接关掉 #950 / #951 而站点并未修复**，
//    本门禁**不会**红。CI 内读不到票状态是物理限制，不是配置疏漏；此缺口只能靠关闭流程兜底
//    （关票前必须先让对应站点转红或删登记）。**不要把这里的全绿读成「票与站点一致」。**
// 5. **只认静态 `class="…"`**：`:class` 里的动态拼接类名不参与「尾推」判据。
// 6. **判据作用在整个开标签上，不只作用在 `class` 属性值里**（外部复核 2026-10-12 登记）：
//    `openTagAt` 返回的是完整开标签，而 `"` 成为边界后，**任何属性值**里写着枚举词都会误判
//    （已构造：`data-bandprobe="ml-auto"` 使整行假红）。本仓现实中不易触发（无此类属性值），
//    但**门禁假阳性会被人用白名单掩盖** —— 那比漏判更危险，因为它会把真信号一起淹掉。
//    收窄办法是只取 `class="…"` 的值再判；本轮不做（会改动判据本体，须重跑一轮抗攻击复核），
//    故在此显式登记为**已知失效面**，而不是当作已解决。
//
// ## 期望值出处（oracle 溯源，禁从被测实现反推）
// 「动作在内容列之前」「间距写在右侧」= ADR-0221 §4「本次处理」表 + §2 决策 2 的形态定义；
// 已修站点清单（4 + 2 + 1）= ADR-0221 §4「本次处理」表逐行核对；债务登记（当前为空）=
// ADR-0221 §4「刻意不处理」表 + 票面。三类锚点均为逐文件现读核对过的**唯一串**。
// 文末「判别力自检」的期望值则来自**判据自身的定义**（源码顺序 / 尾推类），不是从实现反推的快照。

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 包内相对路径（相对 `src/`）/ 仓库根相对路径，均相对本文件所在目录解析。 */
const readPkg = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
const readRepo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 去掉 HTML 注释与整行行注释。⚠️ 必须剥：这四个组件的注释里逐字写着「行首」「行尾药丸」
 *  「遮挡带 [80.80, 95.73]vw」等字样，不剥会让注释把位置断言喂饱（`tests/tagMuteTemplate.test.ts`
 *  / `src/pages/watchLaterPage.template.test.ts` 同款约定）。 */
const strip = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** 只取 `<template>` 区：位置判据扫全文会命中 import 行。找不到 ⇒ 判据输入无效，抛。 */
const templateOf = (src: string): string => {
  const clean = strip(src)
  const i = clean.indexOf('<template>')
  if (i === -1) throw new Error('未找到 <template> 区 —— 判据输入无效')
  return clean.slice(i)
}

/**
 * 从 `openIdx`（某个 `<view` 开标签起点）起做**开合配平**，返回该元素内部源码在模板中的区间。
 *
 * ⚠️ 只数 `view` 标签的开合，不解析属性、不算任何几何 —— 前版门禁栽在「结构解析之后还要
 * 估几何」这一步，这一层不含推断。已知限制：属性值内出现 `>` 会让 `[^>]*` 提前截断
 * （这四个行根都没有）。
 */
function innerSpanOfView(tpl: string, openIdx: number): { start: number; end: number } | null {
  let depth = 0
  let openEnd = -1
  const re = /<(\/?)view\b([^>]*?)(\/?)>/g
  re.lastIndex = openIdx
  for (let m = re.exec(tpl); m !== null; m = re.exec(tpl)) {
    if (openEnd === -1) openEnd = re.lastIndex
    if (m[1]) {
      if (--depth === 0) return { start: openEnd, end: m.index }
    } else if (m[3] !== '/') depth++
  }
  return null
}

/** 含 `attrIdx` 处那个属性的元素的开标签原文（回退到最近的 `<view`，右切到第一个 `>`）。 */
const openTagAt = (tpl: string, attrIdx: number): string =>
  tpl.slice(tpl.lastIndexOf('<view', attrIdx), tpl.indexOf('>', attrIdx) + 1)

/** 四个已修站点（票 #932）。`row` / `action` / `content` 三个锚点各自在该文件内唯一（已现读核对）。 */
const LEADING_SITES = [
  {
    file: 'src/components/ContinueRow.vue',
    action: `@tap.stop="emit('remove', entry)"`,
    row: 'class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest',
    content: 'class="flex-1 flex flex-col ml-2.5 min-w-0"',
  },
  {
    file: 'src/pages/Watchlist.vue',
    action: '@tap.stop="askUnwatch(item)"',
    row: 'class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest',
    content: 'class="flex-1 flex flex-col ml-3"',
  },
  {
    file: 'src/pages/WatchLater.vue',
    action: '@tap.stop="removeItem(item)"',
    row: 'class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest',
    content: 'class="flex-1 flex flex-col ml-3 min-w-0"',
  },
  {
    file: 'src/pages/MuteTags.vue',
    action: '@tap="removeTag(name)"',
    row: 'class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest',
    content: 'class="flex-1 text-body-medium text-surface-on [max-line:2]"',
  },
] as const

/** 把 flex 的动作推到行尾的写法：`justify-between` / `justify-end` / `ml-auto` /
 *  **绝对定位靠右**（`right-*`，含反转整行的 `flex-row-reverse` —— 反转后源码在前的动作反而落到右端）。
 *  ⚠️ 只枚举**确知**的尾推写法（本仓写法收敛所致），不是通用 CSS 判据 —— 见文件头失效面 5。
 *  `flex-row-reverse` 于 2026-10-12 补入：全仓 `src/` 零使用 ⇒ 加它不会让任何既有站点转红，
 *  但堵住了「源码顺序判据对反转行失效」这个洞（`flex-row-reverse` 不在原枚举里时，
 *  源码顺序仍会判「动作在前」而实际落在行尾）。
 *
 * ⚠️ **两侧都要认 `"` 作边界**（2026-10-12 由文末阳性对照查出）：`class="a b"` 里 `a` 的前面
 * 是 `"`、`b` 的后面也是 `"`，都不是空白。原判据只认 `^` / 空白 ⇒ **类属性的首个类与末个类一律漏判**。
 * 实测漏网 6 处 `justify-between"`（`Me.vue` / `SearchSheet.vue` / `SettingsEndpoint.vue` ×2 /
 * `RelatedInlineSection.vue` / `NovelDetail.vue`）——复算命令：
 *   grep -rn 'justify-between"' src --include=*.vue | wc -l   ⇒ 6
 * ⚠️ **这 6 处按设计仍不在本门禁视野内**：扫描能力已整体删除（见文件头失效面 1），本门禁只读
 * 下方那 7 处登记站点。边界修复只提升「未来新增站点被登记时」的可判定性，**不追溯覆盖存量**。
 * （此处曾断言「SearchSheet 是 §4 登记过的站点」——**错的**：§4 登记的是该文件的 chip 内历史 ✕，
 * 而上面那处 `justify-between` 是词条区标题行，两个不同元素。已一并订正，行号以 §4 现读为准。）
 *
 * ⚠️ **裸 `absolute` 已从枚举移除**：绝对定位靠不靠右取决于 `left-*` / `right-*`，`right-*` 已覆盖；
 * 留着裸 `absolute` 只会在放开 `"` 边界后把**每一个**绝对定位元素（含已改用 `left-*` 的收起 ✕）
 * 都误判成尾推。那是「意图写绝对定位靠右、枚举却只写了 absolute」的措辞与实现脱节。
 *
 * ⚠️ **`order-*` 于 2026-10-12 补入**（同 `flex-row-reverse` 的论证）：`order` 在本工程 Lynx preset
 * 的 corePlugin 白名单内（实测会产出真规则），而 `order-*` 在全仓 `src/` **零使用**
 * （`grep -rEoh "\border-[a-z0-9-]+" src --include=*.vue | wc -l` = 0）⇒ 加它零成本。
 * 只收 `order-first` / `order-last` / `order-<数字>`，**不含 `order-none`**（那恰恰是不尾推）。
 * 响应式变体前缀（`md:` / `sm:`）**不构成同类洞**：本工程 preset 白名单无 `screens` / `responsive`。
 */
const TRAILING_PUSH =
  /(?:^|[\s"])(?:justify-between|justify-end|ml-auto|flex-row-reverse|order-(?:first|last|\d+)|right-[^"\s]+)(?=[\s"]|$)/

/** 交互面属性（用于「动作之后不得再有交互兄弟」）。`@tap.stop` / `@long-press` 等。 */
const INTERACTIVE = /@(?:tap|long-?press|click)(?![\w-])/g

describe('ADR-0221 决策 2 · 四处已修站点的行首位置', () => {
  it('破坏性动作排在内容列之前，且行内其后没有任何交互兄弟', () => {
    for (const site of LEADING_SITES) {
      const tpl = templateOf(readPkg(site.file))
      const where = `${site.file}（${site.action}）`
      const rowAt = tpl.indexOf(site.row)
      const actionAt = tpl.indexOf(site.action)
      const contentAt = tpl.indexOf(site.content)
      expect(rowAt, `${where}：行根锚点消失（行类被改？判据输入无效）`).toBeGreaterThanOrEqual(0)
      expect(actionAt, `${where}：找不到该破坏性动作 —— 站点标记已变，请同步本文件锚点`).toBeGreaterThan(rowAt)
      expect(contentAt, `${where}：内容列锚点消失（判据输入无效）`).toBeGreaterThan(rowAt)

      // ① 行首判据：动作排在内容列**之前**（`flex-row` 不换行 ⇒ 源码顺序即视觉左右顺序）
      expect(
        actionAt,
        `${where}：动作排到了内容列**之后** ⇒ 它回到了行尾，落在 GlobalFab 遮挡带内，` +
          '点它开的是搜索弹层而不是执行动作（票 #932）。请按 ADR-0221 决策 2 迁回行首。',
      ).toBeLessThan(contentAt)

      // ② 行尾判据：动作**之后**的行内源码里不得再有交互面（尾随药丸 / 折叠键 / chip）
      const span = innerSpanOfView(tpl, tpl.lastIndexOf('<view', rowAt))
      expect(span, `${where}：行根元素的 view 标签配平失败 —— 判据输入无效`).not.toBeNull()
      const tail = tpl.slice(actionAt + site.action.length, span!.end)
      const trailing = [...new Set([...tail.matchAll(INTERACTIVE)].map((m) => m[0]))]
      expect(trailing, `${where}：行首动作之后仍有交互面（${trailing.join(' / ')}）⇒ 该行仍存在行尾动作`).toEqual([])
    }
  })

  it('动作不被 flex/绝对定位推到行尾，且其间距写在内容一侧（mr-* 而非 ml-*）', () => {
    for (const site of LEADING_SITES) {
      const src = readPkg(site.file)
      const tpl = templateOf(src)
      const actionAt = tpl.indexOf(site.action)
      expect(actionAt, `${site.file}：找不到 ${site.action}`).toBeGreaterThanOrEqual(0)
      const tag = openTagAt(tpl, actionAt)

      // 行根一旦有 justify-between/justify-end，任何「源码在内容列之前」的元素照样会被推到右端。
      // ⚠️ 判据必须读**被测文件**的行根，不能读本文件自己的 site.row 常量 —— 后者
      //   只能证明「常量没被改」，改动真实源码时恒绿（同 门禁冻结线 #3：自测绿不算数）。
      const rowAt = tpl.indexOf(site.row)
      expect(rowAt, `${site.file}：找不到行根锚点（${site.row}）`).toBeGreaterThanOrEqual(0)
      const rowTag = openTagAt(tpl, rowAt)
      expect(rowTag, `${site.file}：行根出现尾推对齐类 —— 它的意图就是「把动作推到行尾」，正是 ADR-0221 废除的那件事`).not.toMatch(
        TRAILING_PUSH,
      )
      expect(tag, `${site.file}：动作元素带尾推写法（${tag.trim()}）⇒ 位置不再由源码顺序决定`).not.toMatch(TRAILING_PUSH)
      // 四处已修站点的既定写法：间距在右（内容侧）。改成 ml-* ＝ 被当作尾随元素重排。
      expect(tag, `${site.file}：动作元素的间距不写在右侧（mr-*）—— 现行写法 mr-1.5 + 10.667vw 圆形图标按钮`).toMatch(
        /(?:^|\s)mr-[\d.]+(?:\s|$)/,
      )
    }
  })
})

// ═══════════════ 债务登记（ADR-0221 §4「刻意不处理」表）═══════════════
// 这一组**不是**扫描命中集合的配平（扫描能力已删除，见文件头）——它是「已知仍落在带内、
// 且刻意不处理」的站点台账：票号是豁免的唯一凭据，站点修掉后必须连登记一起删。
// **当前为空**（2026-10-12，票 #950 / #951 结清）；下方判据的能力由文末「判别力自检」持续证明。

/**
 * **带内证明**：豁免登记的前提是「这个动作**仍落在**遮挡带内」。只登记一个 marker 字符串
 * 不足以证明这一点——标记还在、动作却早已迁到行首时，豁免会**静默存活**（票 #957 修的正是
 * 这个洞：旧判据是 `toContain(marker)`，任何保留下 marker 的修复都能骗过它）。
 *
 * 两种证明，都只用本门禁已经在信的静态判据（源码顺序 + 尾推类），**不做任何几何推断**
 * ——文件头已登记几何估算层会假绿并被整体删除，这里不得把它请回来：
 *
 * - `after-content`：动作在**内容列之后**（`flex-row` 不换行 ⇒ 源码顺序即视觉左右顺序）
 * - `pushed`：动作元素自带尾推写法（`absolute` + `right-*` 等），位置根本不由源码顺序决定
 *
 * ⇒ **站点修好 ⇒ 证明不再成立 ⇒ 门禁红 ⇒ 豁免自动失效**。这兑现了 ADR-0221 §7「票关闭后
 * 豁免必须失效」中**能离线兑现的那一半**；另一半（票被关而站点未修）见文件头失效面 4。
 *
 * ⚠️ 登记清零后这条判据在真实站点上**没有执行实例**，故判定逻辑抽为 {@link judgeStillInBand}
 * 并由文末「判别力自检」在合成模板上双向验证。少了那组自检，本判据会退化成一段永不执行的
 * 死代码，而周围的 `.not.toMatch` 全称否定断言仍会全绿 —— 门禁冻结线 #5：假绿比没门禁更糟。
 */
type 带内证明 = { kind: 'after-content'; content: string } | { kind: 'pushed' }

/**
 * 「该站点仍落在遮挡带内」的判定。**抽成纯函数**是为了让它能在合成模板上被自检 ——
 * `BAND_DEBT` 清零后真实登记为 0 条，若判据只能靠真实登记驱动，它就**一次都不会执行**，
 * 而它周围全是 `.not.toMatch` 断言：那时把 `TRAILING_PUSH` 改成永不命中的正则，整份门禁
 * **仍然全绿**（ArchUnit `failOnEmptyShould` 那个坑）。自检见文末「判别力自检」。
 *
 * `invalid` 非空表示**判据输入无效**（锚点消失）——此时 `inBand` 无意义，调用方必须先红在这里，
 * 不得把「量不出来」当成「量出来没问题」。
 */
function judgeStillInBand(
  tpl: string,
  actionAt: number,
  proof: 带内证明,
): { inBand: boolean; invalid?: string } {
  if (actionAt < 0) return { inBand: false, invalid: '找不到动作标记' }
  if (proof.kind === 'after-content') {
    const contentAt = tpl.indexOf(proof.content)
    if (contentAt < 0) return { inBand: false, invalid: '内容列锚点消失' }
    // flex-row 不换行 ⇒ 源码顺序即视觉左右顺序；动作排在内容列**之后**才叫落在行尾
    return { inBand: actionAt > contentAt }
  }
  // 位置根本不由源码顺序决定：动作元素自己带尾推写法即算落在行尾
  return { inBand: TRAILING_PUSH.test(openTagAt(tpl, actionAt)) }
}

/** 豁免腐烂时的失败文案（债务循环与文末自检共用，避免两处各说各话）。 */
const gone = (where: string): string =>
  `${where}：该动作**已不落在行尾** ⇒ 登记豁免的前提（仍落在 GlobalFab 遮挡带内）不再成立。\n` +
  '        票 #957 起，豁免不再靠「标记还在」续命：站点修好必须让本条转红。\n' +
  '        请关闭该票，并删除本文件中这条 site 登记（同时更新 ADR-0221 §4 与上方集合断言）。'

const BAND_DEBT: readonly {
  ticket: number
  why: string
  sites: readonly { file: string; marker: string; proof: 带内证明 }[]
}[] = [
  // ✅ **当前为空**（2026-10-12，票 #950 / #951 结清）。
  //
  // 曾经的四条登记，两条真债已修（见下方 LEADING_FOLLOW_ACTIONS；第三条 `DISMISS_SITE`
  // 随 #1043 删除 `RankingEntryCard.vue` 一并退场，删后无被测对象故整组移除），
  // 一条**验伪为误报**：`src/pages/UserHome.vue` 的「关注数 / 粉丝数 chip」按 ADR-0221 §4 的
  // 措辞本就只写「非破坏性导航 chip」、**从未声称「同带重叠」**——是 #951 票面把它们
  // 归进「三者均落在 GlobalFab 遮挡带内」时顺带算进去的。静态算：卡片 `m-3 p-3.5` ⇒
  // 内容盒 6.73–90.27vw，头像 17.067vw、内容列 `ml-3.5` ⇒ chip 行起点 27.0vw；两个 chip
  // 宽度由文字决定（各 `px-2`），合计约 35vw ⇒ **右缘 ≈ 62vw，距带左沿 80.80vw 尚有 ~19vw**。
  // 它们是**内容不是动作**，搬到行首反而是语义错误，正确处置是**移出登记**而非改代码。
  //
  // 新增登记必须同时：① 在本数组补一条 ② 在 ADR-0221 §4「刻意不处理」表补一行
  // ③ 给出可验证理由。缺任一项，下面的「债务清零」断言会红。
]

/**
 * 两处**非破坏性**关注开关的行首位置（票 #950 / #951，2026-10-12 由债务转正修）。
 *
 * 与 `LEADING_SITES` 的差别，也是**为什么单列一组**：那四处是破坏性动作，行内其后
 * 不得再有交互兄弟（误触代价是删数据）；这两处是行**本身就该可点**的作者/用户入口
 * （点行进主页），其后的交互面是特性而非缺陷，故不套用「其后无交互兄弟」那条判据。
 * 位置判据与间距判据仍完全一致：动作在内容列**之前**、间距写 `mr-*`、无尾推类。
 */
const LEADING_FOLLOW_ACTIONS = [
  {
    file: 'src/components/UserRow.vue',
    action: '@tap="onToggle"',
    row: 'class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest',
    content: 'class="flex flex-col ml-3.5 flex-1"',
  },
  {
    file: 'src/pages/IllustDetail.vue',
    action: '@tap="toggleFollowAuthor"',
    row: 'class="flex flex-row items-center mt-2"',
    content: 'data-testid="illust-detail-author"',
  },
] as const

describe('ADR-0221 决策 2 · 带内债务登记', () => {
  it('债务登记为空（#950 / #951 已结清；新增登记须同步本断言与 ADR-0221 §4）', () => {
    expect(
      BAND_DEBT.map((e) => `#${e.ticket}（${e.sites.length} 站点）`),
      '带内债务登记非空 —— 新增豁免必须：① 在 BAND_DEBT 补一条 ② 在 ADR-0221 §4「刻意不处理」' +
        '表补一行 ③ 给出可验证理由。三者缺一，本断言即红。这道断言存在的意义是让「新增债务」' +
        '变成一次显式决定，而不是改代码时顺手留下的例外。',
    ).toEqual([])
  })

  it('每个登记站点的文件与标记仍在（站点没了 ⇒ 豁免已腐烂，必须删登记）', () => {
    for (const entry of BAND_DEBT) {
      expect(entry.why.length, `#${entry.ticket} 缺登记理由`).toBeGreaterThan(30)
      for (const site of entry.sites) {
        expect(readPkg(site.file), `#${entry.ticket} 的 ${site.file} 读不到（已改名/移动？）或不再含 ${site.marker} ⇒ 站点已修或已搬家：请关闭该票并删除这条登记`).toContain(site.marker)
      }
    }
  })

  it('每笔债务的「仍落在带内」前提成立——站点被修好即豁免自动腐烂（票 #957）', () => {
    for (const entry of BAND_DEBT) {
      for (const site of entry.sites) {
        const tpl = templateOf(readPkg(site.file))
        const where = `#${entry.ticket} 的 ${site.file}（${site.marker}）`
        const verdict = judgeStillInBand(tpl, tpl.indexOf(site.marker), site.proof)
        expect(verdict.invalid, `${where}：${verdict.invalid ?? ''} —— 判据输入无效，不能当成通过`).toBeUndefined()
        expect(verdict.inBand, gone(where)).toBe(true)
      }
    }
  })

  it('每笔债务在 ADR-0221 §4「刻意不处理」小节里仍有书面依据（票关闭 ⇒ 该行删除 ⇒ 红）', () => {
    const adr = readRepo('../../../docs/adr/ADR-0221-row-action-leaves-trailing-band.md')
    // 只取「刻意不处理」小节：连 §4 上半的「本次处理」表一起取，会让「站点被移进已处理表」也判通过
    const m = /\n##\s*4\.[\s\S]*?\*\*刻意不处理[\s\S]*?(?=\n##\s*5\.)/.exec(adr)
    expect(m, 'ADR-0221 §4「刻意不处理」小节解析失败 —— 判据输入无效').not.toBeNull()
    const deferred = m![0]
    for (const entry of BAND_DEBT) {
      for (const site of entry.sites) {
        expect(
          deferred.includes(site.file.replace(/^src\//, '')),
          `#${entry.ticket} 的 ${site.file} 已不在 ADR-0221 §4 的「刻意不处理」表里 ⇒ 豁免的书面依据没了。请删掉该登记（若站点确已修复）。`,
        ).toBe(true)
      }
    }
  })
})

// ═══════════════ #950 / #951 结清后的正向断言 ════════════════
// 债务清零只是「不再豁免」；这三处若被改回行尾/右侧，仍得有东西变红——否则清零只是把风险
// 从「已登记的例外」变成「没人看的例外」。判据与 LEADING_SITES 同源（源码顺序 + 尾推类），
// 不引入任何几何推断。

describe('ADR-0221 决策 2 · 关注开关行首化（票 #950 / #951）', () => {
  it('两处关注开关排在内容列之前，且间距写在右侧（mr-* 而非 ml-*）', () => {
    for (const site of LEADING_FOLLOW_ACTIONS) {
      const tpl = templateOf(readPkg(site.file))
      const where = `${site.file}（${site.action}）`
      const rowAt = tpl.indexOf(site.row)
      const actionAt = tpl.indexOf(site.action)
      const contentAt = tpl.indexOf(site.content)
      expect(rowAt, `${where}：行根锚点消失（判据输入无效）`).toBeGreaterThanOrEqual(0)
      expect(actionAt, `${where}：找不到关注开关 —— 站点标记已变，请同步本文件锚点`).toBeGreaterThanOrEqual(0)
      expect(contentAt, `${where}：内容列锚点消失（判据输入无效）`).toBeGreaterThanOrEqual(0)

      expect(
        actionAt,
        `${where}：关注开关排到了内容列**之后** ⇒ 它回到了行尾，落在 GlobalFab 遮挡带内，` +
          '点它开的是搜索弹层而不是 toggle（票 #950 / #951）。请迁回行首。',
      ).toBeLessThan(contentAt)

      // 判据读**被测文件**的行根，不读本文件的常量 —— 后者只能证明「常量没被改」
      const rowTag = openTagAt(tpl, rowAt)
      expect(rowTag, `${where}：行根出现尾推对齐类 ⇒ 源码顺序不再决定视觉左右`).not.toMatch(TRAILING_PUSH)
      const tag = openTagAt(tpl, actionAt)
      expect(tag, `${where}：开关元素带尾推写法（${tag.trim()}）`).not.toMatch(TRAILING_PUSH)
      expect(tag, `${where}：开关的间距不写在右侧（mr-*）—— 现行写法 mr-1.5`).toMatch(/(?:^|\s)mr-[\d.]+(?:\s|$)/)
    }
  })

  it('关注开关是圆形图标按钮，且无障碍标签随状态变化（文字不再渲染 ⇒ label 是唯一语义来源）', () => {
    for (const site of LEADING_FOLLOW_ACTIONS) {
      const tpl = templateOf(readPkg(site.file))
      const where = site.file
      const actionAt = tpl.indexOf(site.action)
      // 从**开标签**起切：`innerSpanOfView` 返回的是元素内部区间，若从 `actionAt`（= `@tap` 属性）
      // 起切会把排在它前面的 class 整段漏掉 —— 判据输入不完整时必须红，不能凑合绿
      const openIdx = tpl.lastIndexOf('<view', actionAt)
      const span = innerSpanOfView(tpl, openIdx)
      expect(span, `${where}：开关元素的 view 标签配平失败 —— 判据输入无效`).not.toBeNull()
      const inner = tpl.slice(openIdx, span!.end)

      expect(inner, `${where}：开关内没有图标`).toMatch(/<AppIcon\s[^>]*name="person"/)
      // 固定尺寸 = 切状态时内容区不抖动（原 px-4 药丸「已关注」比「关注」宽，会挤动内容）
      expect(inner, `${where}：开关不是固定 10.667vw 圆形`).toMatch(/w-\[10\.667vw\][^>]*h-\[10\.667vw\]/)
      // 状态语义只剩 label 这一条通路，缺它读屏用户拿不到「关注/已关注」
      expect(inner, `${where}：开关缺 accessibility-label ⇒ 文字移除后状态对读屏用户不可见`).toMatch(
        /:accessibility-label="/,
      )
      expect(
        inner,
        `${where}：状态文字仍渲染在按钮内 ⇒ 行首药丸方案未真正退场，与门禁预期不符`,
      ).not.toMatch(/<text[^>]*>\s*\{\{\s*(?:isFollowed|following)/)
    }
  })
})

// ═══════════════ 判别力自检（阳性对照）═══════════════
// 这一组**不读任何项目文件**，只喂合成模板。它存在的原因：
//
// `BAND_DEBT` 已清空（票 #950 / #951 结清）⇒ 上面那条 #957 核心判据的真实登记为 **0 条**。
// 而本文件里其余 5 处尾推判据全是 `.not.toMatch` —— 那是**全称否定断言**：集合为空时恒真。
// 于是「把 TRAILING_PUSH 改成永不命中的正则」会让**整份门禁依然全绿**，判别力无法被证明。
// 这正是 ArchUnit `failOnEmptyShould` 那个坑（正则/集合失效 ⇒ 全称断言静默恒真）。
//
// 门禁纪律「抽取器自身有效（扫描面非空 + 命中数下界）+ 阳性对照」要求的就是这一组。
// 它的判别力检验很直接：把下面任一期望值反过来改，本组必须变红。

/** 合成模板：动作排在内容列**之后**（= 仍在行尾，豁免成立）。 */
const 仍在行尾 = [
  '<view class="flex flex-row items-center">',
  '  <view class="flex flex-col flex-1" data-testid="内容列">文字</view>',
  '  <view class="mr-1.5" @tap="onTap">',
].join('\n')

/** 合成模板：动作已迁到内容列**之前**（= 站点修好，豁免必须腐烂）。 */
const 已迁行首 = [
  '<view class="flex flex-row items-center">',
  '  <view class="mr-1.5" @tap="onTap">',
  '  <view class="flex flex-col flex-1" data-testid="内容列">文字</view>',
].join('\n')

/** 合成模板：动作已迁行首且**自身开标签干净**，但模板**后面**另有一处无关的 `right-*`。
 *  这条专门封住「测量范围」这个自由度 —— 判据必须只量动作元素**自己**的开标签。
 *  反例即外部复核的攻击 A：`openTagAt(tpl, actionAt)` 一旦被换成 `tpl`，这里会被后段那处
 *  无关的 `right-*` 替它续命（已修站点的豁免静默存活），而当时的自检**仍然全绿**。
 *  真实危害不是假想：已删除的 `RankingEntryCard.vue`（#1043）模板里本来就有 `right-[30vw]`（:141）与
 *  `right-2.5`（:152）两处与收起 ✕ 无关的令牌。 */
const 远处有尾推令牌 = [
  '<view class="flex flex-row items-center">',
  '  <view class="mr-1.5" @tap="onTap">',
  '  <view class="flex flex-col flex-1" data-testid="内容列">文字</view>',
  '  <view class="absolute right-[30vw] bottom-3">名次</view>',
].join('\n')

const AFTER_CONTENT: 带内证明 = { kind: 'after-content', content: 'data-testid="内容列"' }

describe('门禁判别力自检 · 阳性对照（防「全绿 = 无事发生」）', () => {
  it('TRAILING_PUSH 对每种已知尾推写法都命中（含类属性首/末位），且不误伤行首写法', () => {
    // 命中数下界：枚举里的每一项都要能被正则命中。少改一项、或正则整体失效，本条即红。
    // 前两条刻意取「首/末位」形态 —— `class="…"` 的首个类前面是 `"`、末个类后面是 `"`，
    // 这两处正是原判据的漏网区（实测漏掉 6 处 `justify-between"`）。
    for (const cls of [
      'class="justify-between flex items-center"', // 首位（前面是 `"`）
      'class="flex justify-between"', // 末位（后面是 `"`）
      'class="flex flex-row items-center justify-between items-center"', // 中间
      'class="justify-end"',
      'class="ml-auto"',
      'class="absolute right-2 top-2"',
      'class="absolute top-2 right-2"',
      'class="flex flex-row-reverse items-center"',
    ]) {
      expect(
        TRAILING_PUSH.test(cls),
        `TRAILING_PUSH 未命中已知尾推写法「${cls}」—— 正则失效或类属性首/末位漏判，会让本文件 5 处 .not.toMatch 断言静默恒真（ArchUnit failOnEmptyShould 同款陷阱）。`,
      ).toBe(true)
    }
    // 反向：现行行首写法不得被误判成尾推，否则「已修站点」会假红、门禁会被改坏而不自知。
    // 末条尤其重要：裸 `absolute` 已从枚举移除，靠左的浮层（收起 ✕ 改用 left-* 后的形态）不算尾推。
    expect(TRAILING_PUSH.test('class="flex flex-row items-center mr-1.5"')).toBe(false)
    expect(TRAILING_PUSH.test('class="absolute left-2 top-2"')).toBe(false)
    expect(TRAILING_PUSH.test('class="absolute"')).toBe(false)
  })

  it('带内证明 · after-content 分支双向可判（仍在行尾 ⇒ 成立；已迁行首 ⇒ 腐烂）', () => {
    expect(judgeStillInBand(仍在行尾, 仍在行尾.indexOf('@tap="onTap"'), AFTER_CONTENT).inBand).toBe(true)
    expect(judgeStillInBand(已迁行首, 已迁行首.indexOf('@tap="onTap"'), AFTER_CONTENT).inBand).toBe(false)
  })

  it('带内证明 · 判据不得**量得太宽**（量到动作元素之外即为逃逸；外部复核攻击 A）', () => {
    // 极性被上一条钉住；这一条钉的是**测量范围的下界**。把 `openTagAt(tpl, actionAt)` 换成
    // `tpl`（量得太宽）会让判据变松，而当时的两条单行夹具分辨不出来 —— 因为它们的尾推令牌
    // 恰好就在动作元素自身。判据变松正是 #957 要杀的方向：已修站点的豁免静默续命。
    // 真实危害不是假想：已删除的 `RankingEntryCard.vue`（#1043）:141/152 本就有两处与收起 ✕ 无关的 `right-*`
    // 令牌（夹具即照此构造）。
    //
    // ⚠️ **刻意不钉住「量得太窄」那一侧**（如改量行根：外部复核实测该变异仍全绿）。那一侧是
    // **fail-safe**：量窄只会把真在带内的站点误判成「不在带内」⇒ 门禁**假红**，
    // 而「豁免静默存活」才是 #957 要杀的。故此处只守会放行豁免的那个方向。
    const at = 远处有尾推令牌.indexOf('@tap="onTap"')
    expect(judgeStillInBand(远处有尾推令牌, at, AFTER_CONTENT).inBand, '源码顺序分支被模板后段的无关令牌带偏').toBe(false)
    expect(
      judgeStillInBand(远处有尾推令牌, at, { kind: 'pushed' }),
      'pushed 分支量了整个模板而非动作自己的开标签',
    ).toMatchObject({ inBand: false })
  })

  it('带内证明 · pushed 分支双向可判（自带尾推类 ⇒ 成立；改 left-* ⇒ 腐烂）', () => {
    const 右浮层 = '<view class="absolute right-2 top-2" @tap="close">'
    const 左浮层 = '<view class="absolute left-2 top-2" @tap="close">'
    expect(judgeStillInBand(右浮层, 右浮层.indexOf('@tap="close"'), { kind: 'pushed' }).inBand).toBe(true)
    expect(judgeStillInBand(左浮层, 左浮层.indexOf('@tap="close"'), { kind: 'pushed' }).inBand).toBe(false)
  })

  it('带内证明 · 判据输入无效时报 invalid，不静默判成「不在带内」也不静默判成通过', () => {
    // 锚点消失 = 量不出来，必须与「量出来不在带内」区分开，否则删掉内容列就能骗过门禁
    expect(judgeStillInBand(已迁行首, -1, AFTER_CONTENT).invalid).toBe('找不到动作标记')
    const 无内容列 = '<view class="flex flex-row items-center"><view @tap="onTap"></view></view>'
    expect(judgeStillInBand(无内容列, 无内容列.indexOf('@tap="onTap"'), AFTER_CONTENT).invalid).toBe('内容列锚点消失')
  })

  it('债务判据在空登记下不会「假装跑过」（自检这条的存在性，防有人把自检一并删掉）', () => {
    // 不是同义反复：它钉的是「真实登记为 0 条」这一**当前事实**，而上面的自检钉的是判据**能力**。
    // 两者缺一，门禁就会出现「全绿但什么都证明不了」的状态。
    expect(BAND_DEBT.length, 'BAND_DEBT 非空 ⇒ 请同步本组自检与文件头失效面登记').toBe(0)
    expect(typeof judgeStillInBand, 'judgeStillInBand 被移除 ⇒ #957 的判据已无处可证').toBe('function')
  })
})