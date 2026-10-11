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
//    几何估算一并删除。覆盖这类站点的是：票 #950 / #951（下方登记的四个债务站点，ADR-0221
//    §4「刻意不处理」表）+ code review。
// 2. **不做几何判定**，只判源码顺序与对齐写法；遮挡带自身的像素锚点由 `tests/fabGeometry.test.ts` 承担。
// 3. **只看这四个文件**。其它文件里等价的已修写法若被改回行尾，本门禁不红。
// 4. **读不到票的开关状态**（不调 `gh`、CI 无网络）⇒ 债务是否仍成立用**站点条件**代理。
//    票 #957 把该代理从「标记字符串还在」升级为「**该站点仍真在行尾**」（源码顺序 / 尾推类，
//    见下方 `带内证明`）：**站点一旦被修好，豁免即刻自动腐烂**——不需要任何人记得来删登记。
//    ⚠️ **残留缺口（不可再收窄）**：若有人在 GitHub 上**直接关掉 #950 / #951 而站点并未修复**，
//    本门禁**不会**红。CI 内读不到票状态是物理限制，不是配置疏漏；此缺口只能靠关闭流程兜底
//    （关票前必须先让对应站点转红或删登记）。**不要把这里的全绿读成「票与站点一致」。**
// 5. **只认静态 `class="…"`**：`:class` 里的动态拼接类名不参与「尾推」判据。
//
// ## 期望值出处（oracle 溯源，禁从被测实现反推）
// 四个站点清单与「动作在内容列之前」= ADR-0221 §4「本次处理」表；债务票 #950 / #951 及其
// 四站点 = 同一张表的「刻意不处理」表 + 票面。三类锚点均为逐文件现读核对过的**唯一串**。

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

/** 把 flex 的动作推到行尾的写法：`justify-between` / `justify-end` / `ml-auto` / 绝对定位靠右。
 *  ⚠️ 只枚举**确知**的尾推写法（本仓写法收敛所致），不是通用 CSS 判据 —— 见文件头失效面 5。 */
const TRAILING_PUSH = /(?:^|\s)(?:justify-between|justify-end|ml-auto|absolute|right-[^"\s]+)(?:\s|$)/

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
// 且刻意不处理」的四处站点台账：票号是豁免的唯一凭据，站点修掉后必须连登记一起删。

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
 */
type 带内证明 = { kind: 'after-content'; content: string } | { kind: 'pushed' }

const BAND_DEBT = [
  {
    ticket: 950,
    why: '关注/取关控件（UserRow，3 条路由共用）。非破坏性 toggle，失败形态是「点了没反应」而非「数据没了」；其 px-4 比 40dp 药丸更宽，重叠比例比已修四处更高 ⇒ 须独立评估。',
    sites: [
      {
        file: 'src/components/UserRow.vue',
        marker: 'onToggle',
        proof: { kind: 'after-content', content: 'class="flex flex-col ml-3.5 flex-1"' } as const,
      },
    ],
  },
  {
    ticket: 951,
    why: '关注作者 pill（IllustDetail）、关注数/粉丝数 chip（UserHome）、榜单卡折叠 ✕（RankingEntryCard）。三者非破坏性（pill/chip 是导航与 toggle，折叠是本次会话内收起），不与破坏性动作的迁移同批处理。',
    sites: [
      {
        file: 'src/pages/IllustDetail.vue',
        marker: 'toggleFollowAuthor',
        proof: { kind: 'after-content', content: 'class="text-body-medium text-surface-on-variant ml-2 flex-1"' } as const,
      },
      {
        file: 'src/pages/UserHome.vue',
        marker: 'openFollowers',
        proof: { kind: 'after-content', content: '@tap="openFollowing"' } as const,
      },
      { file: 'src/components/RankingEntryCard.vue', marker: 'dismissed = true', proof: { kind: 'pushed' } as const },
    ],
  },
] as const satisfies readonly { ticket: number; why: string; sites: readonly { file: string; marker: string; proof: 带内证明 }[] }[]

describe('ADR-0221 决策 2 · 带内债务登记', () => {
  it('登记恰好是 #950 / #951 两票、四站点（不多不少、票号不重复）', () => {
    const tickets = BAND_DEBT.map((e) => e.ticket)
    expect([...tickets].sort((a, b) => a - b), '登记的债务票集合变了 —— 增删豁免须同步本断言与 ADR-0221 §4').toEqual([950, 951])
    expect(new Set(tickets).size, `票号重复登记：${tickets.join(' / ')}`).toBe(tickets.length)
    expect(BAND_DEBT.flatMap((e) => e.sites.map((s) => `${s.file}::${s.marker}`)).sort(), '登记的债务站点集合变了').toEqual([
      'src/components/RankingEntryCard.vue::dismissed = true',
      'src/components/UserRow.vue::onToggle',
      'src/pages/IllustDetail.vue::toggleFollowAuthor',
      'src/pages/UserHome.vue::openFollowers',
    ])
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
        const actionAt = tpl.indexOf(site.marker)
        expect(actionAt, `${where}：找不到动作标记 —— 判据输入无效`).toBeGreaterThanOrEqual(0)

        const gone =
          `${where}：该动作**已不落在行尾** ⇒ 登记豁免的前提（仍落在 GlobalFab 遮挡带内）不再成立。\n` +
          '        票 #957 起，豁免不再靠「标记还在」续命：站点修好必须让本条转红。\n' +
          '        请关闭该票，并删除本文件中这条 site 登记（同时更新 ADR-0221 §4 与上方集合断言）。'

        if (site.proof.kind === 'after-content') {
          const contentAt = tpl.indexOf(site.proof.content)
          expect(contentAt, `${where}：内容列锚点消失（判据输入无效）`).toBeGreaterThanOrEqual(0)
          expect(actionAt, gone).toBeGreaterThan(contentAt)
        } else {
          expect(openTagAt(tpl, actionAt), gone).toMatch(TRAILING_PUSH)
        }
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