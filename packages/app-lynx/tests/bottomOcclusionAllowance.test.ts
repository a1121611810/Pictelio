// ─── 底部遮挡让位 · 结构门禁（ADR-0217 / spec docs/specs/bottom-occlusion-allowance.md）───
//
// ## 这道门禁在守什么
//
// 撤销全局 FAB 占位带（ADR-0216）后，末屏可点性由「滚动内容末尾的零内容占位」承担
// （术语表 glossary-bottom-occlusion-allowance.md）。这四页若漏接线 / 接错位置 / 被 v-if
// 吃掉，占位**静默失效**——真机表现只是「末屏那一张点不到」，不报错、不白屏。
//
// ## 覆盖边界（明写）
// ✅ 抓得到：三根页是否在**滚动容器内**挂了占位、占位是否被 v-if 条件化、几何是否复用
//    同一档位、沉浸页是否被误加。
// ❌ 抓不到：占位高度在真机的实际渲染（node 单测无渲染缝）—— 靠 spec §5 的真机量测。
//
// ⚠️ 本门禁的每条断言都做过变异验证（2026-10-03 复审，9/9 符合预期）：
//    塞进 footer list-item 内部(→3 红) / `:item-key` 等价写法(→0 红，**修前假红**) /
//    属性顺序调换(→0 红，**修前假红**) / 删占位(→2 红) / 占位移出 `</list>`(→2 红) /
//    占位带 v-if(→1 红) / `<template v-if>` 包裹(→1 红) / 占位后追加 list-item(→1 红) /
//    删第二个 `<list>` 的占位(→1 红)。
//
// ## ⚠️ 已知失效面（显式登记，见 AGENTS.md 门禁冻结线 #5「假绿比没门禁更糟」）
//
// 本门禁是**源码文本判据**，不是渲染判据。以下形态**当前抓不到**，列出来是为了让下一个人
// 不把「全绿」读成「这类问题不存在」：
//
// 1. **`<list-item v-if>` 直接包裹占位**（不经 `<template>`）：`v-if` 向上回溯只统计
//    `<template>` 开闭标签，认不出 `list-item` 自己的条件指令。现由「占位不得带条件指令」
//    那条**属性表判据**兜底（它直接读占位自己开标签的属性，不依赖回溯匹配）。
// 2. **同一页面出现多个 `<template>` / 多个 `<list>` / 多个 `<scroll-view>`**：
//    多 `<list>` 已由「每条滚动流都有且只有一个占位」那条标签栈配平判据覆盖；
//    `<template>` 条件包裹由回溯判据覆盖。
// 3. **占位被条件渲染的父组件包住**（如整页 `v-if`）：判据只读页面模板，不追组件树。
// 4. **`:item-key` 的值来自别处变量**（如 `:item-key="spacerKey"` + `const spacerKey = 'fab-allowance'`）：
//    `isSpacerItem` 要求值里**含** `fab-allowance` 字面量，静态判据追不进变量引用。
//    等价写法（`:item-key="'fab-allowance'"` / 反引号 / 属性换序）**已放行**，不再假红。
// 5. ~~让位高度是否够用抓不到~~ → **已修**（票 #922）：新增几何数值 oracle，直接
//    `import` `fabGeometry` 把公式跑出数字断言（menu 19.2 / search 58.668 / hidden 降级 /
//    差值 39.467 / 底边 43.734）。**对「公式搬不搬家、等价写法」免疫**，这是字符串判据做不到的。
// 6. ~~清单外页面完全无门禁~~ → **已修**（票 #922）：新增「从 `router.ts` 反查」判据 ——
//    任何路由对应的页面只要模板含滚动容器就必须挂占位，例外须在 `NO_ALLOWANCE` 逐条写理由，
//    且免检页不得偷偷挂占位。实测：新增一个未接线页面 ⇒ 立刻转红并**点名**是哪个页。
// 7. ✅ ~~模板 `:style` 高度与 fabGeometry 脱钩无防线~~ → **已修**（Spec 轴 code-review B1）：
//    变异 M10（把模板写成 `:style="{ height: '58.668vw' }"`）曾让**全仓 3709 测全绿**——
//    「改 FAB 尺寸占位跟随」（spec C4）的唯一实现是那一行，却无人断言。现补值流判据：
//    从调用点向前定位派生标识符 → 模板 `height:` 必须引用它（实测 4 种坏形态红、2 种等价写法绿）。
// 8. ⚠️ **真机渲染仍抓不到**：node 单测无渲染缝。58.668vw 在真机的实际效果靠
//    spec §5.1/§5.3 的像素量测（收藏页 634px vs 理论 633.6px、偏差 +0.06%、零重叠）。
// 9. ⚠️ **`NO_ALLOWANCE` 里的两条诊断页例外依赖运行时长度**（`NetworkCheck` / `PlatformCheck`
//    「内容不足一屏 ⇒ 补占位反而造出可滚动的空白区」）。静态判据无法验证「不足一屏」——
//    这两页将来加长内容时，例外就变成了多余留白。已在例外理由里写明「内容变长须重新评估」。
// 10. ✅ ~~`DownloadManager` 的手工 `h-[30vw]` 不受本门禁管辖~~ → **已修**（票 #922）：
//     那个「in-flow ⇒ 不遮挡」的判断是**错的** —— in-flow 只说明动作栏本身不覆盖 scroll-view，
//     而 `GlobalFab` 是**从屏幕底边定位的固定浮层**，照样落在滚动内容上。
//     真机实测 `/downloads` 的搜索 FAB 顶边 = 58.611vw（与其他 search 页逐字一致），
//     而 30vw 只有 324px ⇒ **短 310px**。已改用 `FabAllowanceSpacer`，并从 `NO_ALLOWANCE` 移除，
//     由本文件的反查判据接手。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
/** 剥注释，避免头注里讨论的写法被判据命中（判据报错先怀疑判据） */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')

/**
 * 只取 **<template> 区**（script 之后）。
 * ⚠️ 为什么必须切：import 路径 `RefreshableList.vue` 含子串 `<list`，
 *    注释里也会出现 `<list>` / `<scroll-view>` 字样；不切模板区，位置判据会
 *    命中 import 或注释，**变成恒真/恒假的假门禁**（本文件踩过一次）。
 */
const templateOf = (rel: string): string => {
  const full = codeOf(rel)
  const i = full.indexOf('<template>')
  // ⚠️ **不得**在 -1 时回退成全文：那会让位置判据转去命中 import 行与注释，
  //    把「找不到模板区」伪装成「判据通过」= 假绿（本文件已因同类回退栽过一次，
  //    见上方注释里 import 路径含 `<list` 的那段）。找不到 = 判据失效或文件结构已变，
  //    直接红，让它显形。
  expect(i, `${rel} 未找到 <template> 区 —— templateOf 会退化成全文扫描，位置判据随之失真`).toBeGreaterThan(-1)
  return full.slice(i)
}

// ═══ 占位 list-item 的结构解析（判据基座）═══
//
// ⚠️ 为什么必须**解析**而不能用正则扫字面量（2026-10-03 code-review 两项阻塞的共同根因）：
//
//   原判据全部写成 `/<list-item[^>]*item-key="fab-allowance"[^>]*full-span/` 这种
//   **字面量 + 属性顺序敏感**的形式。实测两个方向都错：
//
//   ① 假红（形态锁）：`:item-key="'fab-allowance'"`（语义完全等价）⇒ 5 条转红；
//      `full-span` 写在 `item-key` 之前也转红。门禁锁的是**写法**不是**危险形态**——
//      门禁自身的规矩就是「判据报错先怀疑判据」，这条判据自己就违反了它。
//   ② 假绿（更要命）：「占位是最后一个 list-item」用 `.pop()` 取 `</list>` 前最后一个
//      `<list-item` **开标签**。占位一旦被塞进 `item-key="footer"` 的 list-item **内部**，
//      footer 的开标签在占位**之后** ⇒ `.pop()` 正好抓到占位自己 ⇒ **全绿**。
//      而「占位不带 v-if」只匹配占位自身那一小块，看不见外面的 footer。
//      ⇒ 对 ADR-0217 §2.2 最核心的失效形态（塞进三态条件渲染的 footer）**恒绿**。
//
// 改法：把开标签解析成 { 属性表, 嵌套深度, 所属滚动流 }，判据只读这份结构。
//   深度 0 = `<list>` 的直接子节点 —— 这一条同时把上面 ② 那个假绿堵死。

/** 解析开标签的属性表。裸属性（`full-span`）记为 `true`，`name`/`name="v"` 统一去冒号。 */
const parseAttrs = (inner: string): Record<string, string | true> => {
  const attrs: Record<string, string | true> = {}
  const re = /([:@]?[A-Za-z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const name = m[1]
    if (name === undefined) continue
    attrs[name] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : true
  }
  return attrs
}

interface ListItemTag {
  /** 开标签在模板区中的偏移 */
  at: number
  /** 嵌套深度：0 = 滚动容器的直接子节点；>0 = 嵌在别的 list-item 里 */
  depth: number
  attrs: Record<string, string | true>
  /** 所属滚动容器区间序号；-1 = 不在任何容器内 */
  container: number
}

/** 用标签栈配平切出每个 `<list>` / `<scroll-view>` 的区间（不能用 indexOf 取首个）。 */
const containerSpansOf = (src: string): Array<[number, number]> => {
  const spans: Array<[number, number]> = []
  let start = -1
  let depth = 0
  for (const m of src.matchAll(/<list(?=[\s>])|<\/list>|<scroll-view(?=[\s>])|<\/scroll-view>/g)) {
    const open = m[0].startsWith('</')
    if (!open) {
      if (depth === 0) start = m.index
      depth++
    } else {
      depth--
      if (depth === 0 && start !== -1) {
        spans.push([start, m.index])
        start = -1
      }
    }
  }
  return spans
}

/** 解析模板区里每个 `<list-item>` 开标签：属性表 + 嵌套深度 + 所属容器。 */
const listItemTagsOf = (src: string): ListItemTag[] => {
  const spans = containerSpansOf(src)
  const out: ListItemTag[] = []
  const open: number[] = []
  for (const m of src.matchAll(/<list-item(?=[\s/>])|<\/list-item>/g)) {
    if (m[0] === '</list-item>') {
      open.pop()
      continue
    }
    const gt = src.indexOf('>', m.index)
    out.push({
      at: m.index,
      depth: open.length,
      attrs: parseAttrs(src.slice(m.index + '<list-item'.length, gt)),
      container: spans.findIndex(([a, b]) => m.index >= a && m.index < b),
    })
    open.push(out.length - 1)
  }
  return out
}

/**
 * 该 list-item 的 item-key 是否指向让位占位。
 * 容忍等价写法：`:item-key="'fab-allowance'"` / `` :item-key="`fab-allowance`" `` /
 * 反引号 / 前后缀拼接 —— 只要求值里**含** `fab-allowance` 这个字面量。
 * ⚠️ 不容忍「值来自别处的变量」（`:item-key="spacerKey"`）：静态判据追不进去，
 *    已登记在下方「已知失效面」第 4 条，不假装抓得到。
 */
const isSpacerItem = (it: ListItemTag): boolean => {
  for (const [name, value] of Object.entries(it.attrs)) {
    if (!/^(:?)(item-key|key)$/.test(name)) continue
    if (typeof value === 'string' && value.includes('fab-allowance')) return true
  }
  return false
}

/**
 * 提取 `fnName(` 的**括号配平**实参（跳过字符串字面量里的括号），并**归一化**：
 * 去掉所有空白与冗余包裹括号。
 *
 * ⚠️ 为什么不用正则 `fn\([^)]*\)`：实参里若带括号（`fn((x))`、`fn(cond ? a : b)`）
 * 会被提前截断；为什么归一化：`(view.value.routeMode)` 与 `view.value.routeMode`
 * **语义完全相同**，不该一个绿一个红 —— 制造这种假红就是形态锁（Standards 轴 B2 的教训：
 * 判据的两次返工都是形态锁，一次假红一次恒绿）。
 */
const callArgOf = (src: string, fnName: string): string | null => {
  const start = src.indexOf(`${fnName}(`)
  if (start === -1) return null
  let i = start + fnName.length + 1
  let depth = 1
  let quote: string | null = null
  while (i < src.length && depth > 0) {
    const c = src[i]!
    if (quote) {
      if (c === quote) quote = null
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  if (depth !== 0) return null // 括号不配平 = 源码有问题，交给别的判据报
  return src
    .slice(start + fnName.length + 1, i - 1)
    .replace(/[\s()]/g, '')
    .replace(/,$/, '') // 尾随逗号
    // 剥掉尾随的 TS `as <类型断言>`：**运行时是 no-op**（类型擦除），语义完全等价。
    // 只认「as + 简单类型表达式」这一种形状，且必须顶到结尾，避免误吞实参表达式。
    .replace(/as['"\w|.[\]&<>,]+$/, '')
}

/** 某条滚动流里的 list-item（按出现顺序）。 */
const itemsIn = (tags: ListItemTag[], container: number) => tags.filter((t) => t.container === container)

/** 三根页 + 沉浸页（负样本） */
/**
 * 有底部遮挡让位的 `<list>` 形态页面。
 * ⚠️ 别把这张清单当成「已验收页面」清单，更**别**把清单本身读成完备性证明：
 *    - 三根页有真机量测（见 spec §5.1）；
 *    - 下面 9 页是**结构门禁覆盖 + 几何沿用 `fabGeometry`**，**未做真机像素量测**。
 *    - 几何：这些页档位为 **search**，让位 **58.668vw**（票 #922 修复前是 19.2vw，
 *      差 39.467vw，真机实测末项被搜索 FAB 压住 356px；现由几何 oracle 钉住数值）。
 *    - `WatchLater` / `NovelDetail` 是票 #922 全量盘点（25 条路由）补接线的两个 `<list>` 页。
 *    - ⚠️ 本清单只保证「**接线形态**」；「**清单本身全不全**」由下方「从 router.ts 反查」
 *      那条判据独立保证 —— 新增页面忘了同步本清单，反查判据会转红并点名。
 *    - `DownloadManager` 原先有个手工 `h-[30vw]`（324px），已改用 `FabAllowanceSpacer`
 *      —— 它是 `<scroll-view>` 形态，由下方「每条 `<scroll-view>` 滚动流」那组判据覆盖。
 */
const LIST_PAGES = [
  // 三根页（menu 档 FAB，已真机量测 19.2vw）
  'src/pages/IllustList.vue',
  'src/pages/NovelList.vue',
  // #921：9 个列表页（search 档 FAB，让位 58.668vw）
  'src/pages/Bookmarks.vue',
  'src/pages/FollowList.vue',
  'src/pages/Following.vue',
  'src/pages/MyPixiv.vue',
  'src/pages/Notifications.vue',
  'src/pages/Ranking.vue',
  'src/pages/TagNeighbors.vue',
  'src/pages/UserHome.vue',
  'src/pages/Watchlist.vue',
  // #922：全量盘点后补接线的 2 个 `<list>` 页（此前**从未**接线）
  'src/pages/NovelDetail.vue',
  'src/pages/WatchLater.vue',
]

/** `<scroll-view>` 形态页面（占位直接挂在 `</scroll-view>` 前，无 list-item 包裹）。 */
const SCROLLVIEW_PAGES = [
  'src/pages/Me.vue', // 4 个根页之一，menu 档
  // #922：补接线的 2 个详情/设置页（search 档）
  'src/pages/IllustDetail.vue',
  'src/pages/MuteTags.vue',
  // #922：原为手工 h-[30vw]（324px）⇒ 少让位 310px，已改用共享占位（search 档）
  'src/pages/DownloadManager.vue',
  // [维度重构 2026-10-03] 三个新页。**必须登记**：本清单的形态判据（「占位紧邻 </scroll-view>」）
  //   只有在册页面才会被跑到；不登记 = 新页的让位形态无人守护（登记前它们曾把占位多包一层 view）。
  'src/pages/Updates.vue', // 顶层页 → menu 档
  'src/pages/Shelf.vue', // 顶层页 → menu 档
  'src/pages/AdvancedSettings.vue', // 次级页 → search 档
]
const IMMERSIVE_PAGE = 'src/pages/Recommended.vue'

describe('底部遮挡让位：占位组件本身', () => {
  it('FabAllowanceSpacer 高度由 fabGeometry 按**路由档位**算出，且不得在组件侧硬编码档位', () => {
    const src = codeOf('src/components/FabAllowanceSpacer.vue')
    // ⚠️ 本条判据**返工过两次**，两次都是形态锁：
    //    ① 原判据要求「用 h-18 档位」——错。档位是编译期常量，FAB 几何是 JS 常量，两者不同源；
    //       「19.2vw 只写一次 / 改 FAB 尺寸占位自动跟随」被实测证伪（spacing.18 改 30vw，门禁仍全绿）。
    //    ② 改要求 `fabAllowanceHeightVw()` **零参**调用——票 #922 加了分档后调用必然带参，
    //       语义等价写法被误判红。
    //    ③ 再改要求「文件里出现过 routeMode」——**恒绿**。实测可构造变异体：组件改成
    //       `fabAllowanceHeightVw('menu')` 硬编码低档 + 留一个读 routeMode 的**死变量**，
    //       4 条断言全绿，而 39.467vw 缺陷完整回归（Standards 轴 code-review B2）。
    //    ⇒ 现在钉住**实参**：必须把 `view.value.routeMode` 直接传进去，
    //      且任何位置都不得传字符串字面量档位。
    //
    // ⚠️ 这仍是**形态锁**，但锁的正是本组件的契约本身（"只做直通，不做降级"）：
    //    `hidden` 的降级住在 `fabGeometry` 内、被上面的数值 oracle 覆盖。
    //    若将来重构这条接线，**必须同步改本判据与数值 oracle**，否则门禁在骗人。
    expect(src, '占位高度必须来自 fabGeometry（与 GlobalFab 共用同一常量）').toMatch(
      /import\s*\{[^}]*fabAllowanceHeightVw[^}]*\}\s*from\s*['"][^'"]*fabGeometry['"]/,
    )
    const arg = callArgOf(src, 'fabAllowanceHeightVw')
    expect(arg, `${src.slice(0, 0)}未找到 fabAllowanceHeightVw 调用点`).not.toBeNull()
    expect(
      arg,
      '让位高度必须由 fabAllowanceHeightVw(view.value.routeMode) 直接算出（不得在组件侧做降级映射）',
    ).toBe('view.value.routeMode')
    expect(
      arg,
      '不得向 fabAllowanceHeightVw 传字符串字面量档位（档位只能来自路由，' +
        '否则新页面漏接线会静默落到 19.2vw —— 票 #922 的原始失效形态）',
    ).not.toMatch(/^['"]/)
    // 零内容：不渲染任何可见子节点
    expect(src, '占位必须是零内容组件（不得有可见子节点）').not.toMatch(/<text|<image|<scroll-view|<list\b/)
  })

  it('占位高度由 fabGeometry 的结果**驱动模板**（不得在模板里写死 vw 字面量）', () => {
    // ⚠️ Spec 轴 code-review B1（高）：此前只断言 `<script>` 区出现过 `fabAllowanceHeightVw(`，
    //    **不验模板 `:style` 是否绑定它的结果**。实测变异 M10：把
    //    `:style="{ height: `${heightVw}vw` }"` 改成 `:style="{ height: '58.668vw' }"`，
    //    ⇒ 本门禁 94/94 绿、unit.test.ts 213/213 绿、**全仓 3709/3709 绿**。
    //    而「改 FAB 尺寸时占位自动跟随」（spec C4）恰恰**只**由这一行实现 ⇒ 防线在门禁之外。
    const src = codeOf('src/components/FabAllowanceSpacer.vue')
    // 值流第一步：找出「由 fabAllowanceHeightVw 派生」的标识符。
    // ⚠️ 不要用 `/const\s+(\w+)\s*=[\s\S]{0,N}?fabAllowanceHeightVw\(/` 这类正则：
    //    它会**跨语句**匹配（本仓无分号，`const fab = useGlobalFabStore()` 会被算成派生变量，
    //    实测踩过 ⇒ 判据红得莫名其妙）。改为从**调用点向前**定位所属的 `const NAME =`。
    const callAt = src.indexOf('fabAllowanceHeightVw(')
    expect(callAt, '未找到 fabAllowanceHeightVw 调用点（值流起点已断）').toBeGreaterThan(-1)
    const declStart = src.lastIndexOf('const ', callAt)
    const derived = src.slice(declStart + 6).match(/^\s*(\w+)/)?.[1] ?? ''
    expect(derived, '未找到承载 fabAllowanceHeightVw 结果的变量名（值流起点已断）').not.toBe('')
    // 值流第二步：模板的 height 绑定必须引用该标识符
    const tpl = templateOf('src/components/FabAllowanceSpacer.vue')
    const heights = [...tpl.matchAll(/\bheight:\s*([^,}]+)/g)].map((m) => m[1]!)
    expect(heights.length, '未找到模板里的 height 绑定').toBeGreaterThan(0)
    for (const v of heights) {
      // ⚠️ **不能用子串包含** `v.includes(derived)`：终审实测把它骗过 ——
      //    派生变量改名成 `vw` + 模板写死 `'58.668vw'` ⇒ `'58.668vw'.includes('vw')` 成立
      //    ⇒ 全仓 3710 测全绿，spec C4 重新静默失效。⇒ 改**词边界**匹配。
      // ⚠️ 还要区分「模板字符串插值」与「纯字面量」：`'${x}vw'` 用的是**单引号**，
      //    在模板里是**普通字符串**（不插值），不能因为含 `${` 就放行。
      const t = v.trim()
      const isBacktick = t.includes('`')
      const isPlainQuote = !isBacktick && /^['"]/.test(t)
      const bounded = new RegExp(`\\b${derived}\\b`).test(t)
      expect(
        bounded && !isPlainQuote,
        `模板 height 绑定必须来自 ${derived}（fabAllowanceHeightVw 的结果），` +
          `实际是「${t}」—— 写死字面量会让「改 FAB 尺寸占位自动跟随」（spec C4）无声失效`,
      ).toBe(true)
    }
  })

  it('FAB 几何与占位高度共用同一来源（防漂移的唯一机制，code-review Spec B1）', () => {
    const fab = codeOf('src/components/GlobalFab.vue')
    const spacer = codeOf('src/components/FabAllowanceSpacer.vue')
    const geo = read('src/utils/fabGeometry.ts')

    // GlobalFab 不得再自带本地几何常量，必须 import 共享模块
    expect(fab, 'GlobalFab 必须从 fabGeometry 取 FAB_SIZE_VW / FAB_EDGE_VW').toMatch(
      /import\s*\{[^}]*FAB_SIZE_VW[^}]*\}\s*from\s*['"][^'"]*fabGeometry['"]/,
    )
    expect(
      fab,
      'GlobalFab 不得再硬编码 const FAB_SIZE_VW = <数字>（那是第二个来源）',
    ).not.toMatch(/const\s+FAB_SIZE_VW\s*=\s*[\d.]+\s*$/m)

    // ⚠️ search 模式的抬高推导（票 #922）**也**必须住在共享模块里。
    //    它原先是 GlobalFab 的组件局部常量 ⇒ 占位侧根本看不到 search 那一档，
    //    9 个非 tab 页因此全都按 menu 档（19.2vw）让位，比真实遮挡源少 39.467vw。
    expect(fab, 'GlobalFab 必须从 fabGeometry 取 FAB_BOTTOM_SEARCH_VW（search 抬高单一来源）').toMatch(
      /import\s*\{[^}]*FAB_BOTTOM_SEARCH_VW[^}]*\}\s*from\s*['"][^'"]*fabGeometry['"]/,
    )
    expect(
      fab,
      'GlobalFab 不得再自带 search 抬高推导（第二个来源：票 #922 的根因之一）',
    ).not.toMatch(/FAB_MENU_PANEL_HEIGHT_VW|const\s+FAB_BOTTOM_SEARCH_VW\s*=/)

    // 共享模块本身：两档都必须是「底边 + 本体」，且不掺水平方向量
    const geoCode = geo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(geoCode, 'fabGeometry 必须导出 fabAllowanceHeightVw').toMatch(
      /export\s+function\s+fabAllowanceHeightVw/,
    )
    expect(
      geoCode,
      'menu 档让位高度 = 底边距 + 本体（竖向），不得用右距推导',
    ).toMatch(/FAB_EDGE_VW\s*\+\s*FAB_SIZE_VW/)
    expect(
      geoCode,
      'search 档让位高度 = search 底边 + 本体（竖向），不得用右距推导',
    ).toMatch(/FAB_BOTTOM_SEARCH_VW\s*\+\s*FAB_SIZE_VW/)

    // 占位与 FAB 读同一模块
    expect(spacer, '占位与 FAB 必须读同一模块').toMatch(/fabGeometry/)
  })
  it('tailwind spacing 不得再出现与 FAB 让位几何同值的档位（防漂移温床回流）', () => {
    // 上一轮正是在 spacing 里栽的：`18` 档（19.200vw）被四份文档宣称为「让位的单一数值来源」，
    // 还推论出「共用同一档位 ⇒ FAB 改尺寸时占位自动跟随」——**那句话是假的**（编译期常量 ≠ JS 几何，
    // 实测把该档位改成 30vw，占位纹丝不动）。code-review 实测该档位 class 消费者为 0（死档位），
    // 已连同 `14` / `16` 一并删除。
    //
    // ⚠️ 判据锁的是**危险行为**（spacing 里出现与让位高度同值的档位 = 重新制造第二来源），
    //    **不是**某个键名 —— 键名形态锁会把「将来加一个无关的 18 档」也判红，那是误伤。
    const raw = read('tailwind.config.ts')
    // 只看档位定义行（`^\s*<数字>:` ），不看注释 —— 注释里提到 19.2vw 是**正确的事实陈述**。
    // ⚠️ 这两个谓词必须**在链外**声明：写在链中间会被 ASI 截断成
    //    `offenders = raw.split('\n')`（字符串数组，长度 = 全文行数），
    //    filter/map 整条链不执行，断言变成「351 个元素 ≠ []」——
    //    **红是红了，但红的原因与要抓的东西无关**（本文件已栽过一次，见「判据报错先怀疑判据」）。
    const isDefLine = (s: string) => /^\s*\d[\d.]*\s*:/.test(s)
    const isAllowanceValue = (s: string) => s.includes('19.200vw')
    const offenders = raw
      .split('\n')
      .map((l, i) => ({ n: i + 1, text: l.trim() }))
      .filter(({ text }) => isDefLine(text) && isAllowanceValue(text))
      .map(({ n, text }) => `${n}: ${text}`)
    // ⚠️ 先证输入非空再断言「里面没有」：若 raw 读空 / 拆分失效，offenders 会恒为 []，
    //    本断言变成恒真（AGENTS.md：断言接在派生的空集合后面时恒真）。
    expect(raw.length, 'tailwind.config.ts 读取失败或为空，判据输入无效').toBeGreaterThan(500)
    expect(
      offenders,
      'spacing 里不得存在与底部遮挡让位同值（19.2vw）的档位：编译期常量与 utils/fabGeometry.ts ' +
        '的 JS 几何不同源，同值纯属巧合，宣称「共用 ⇒ 跟随」会把两个独立来源伪装成受防漂移机制保护',
    ).toEqual([])
  })
})

describe('底部遮挡让位：<list> 形态页面均已接线', () => {
  for (const page of LIST_PAGES) {
    /**
     * 该页每条滚动流各自的让位占位（按容器序号分组）。
     * 判据基座见文件上方 `listItemTagsOf` / `isSpacerItem`——全部读**解析出的结构**，
     * 不再对源码做字面量正则匹配。
     */
    const spacersByStream = (page: string) => {
      const src = templateOf(page)
      const tags = listItemTagsOf(src)
      const streams = containerSpansOf(src)
      return { src, tags, streams }
    }

    it(`${page}：每条 <list> 滚动流都有且只有一个 fab-allowance 占位（多 tab 页的第二个 list 勿漏）`, () => {
      // ⚠️ **多 `<list>` 页面陷阱**（2026-10-03 code-review 抓出，本条是它拦下的）：
      //   `Bookmarks` / `UserHome` 有**两个并列的 `<list>`**（插画 tab / 小说 tab），
      //   每个都是独立滚动流，各自需要让位；只给第一个加 ⇒ 切到另一个 tab 时末项重新被吞点击。
      const { tags, streams } = spacersByStream(page)
      expect(streams.length, `${page} 未解析出滚动容器区间（判据自身失效？）`).toBeGreaterThan(0)
      for (let c = 0; c < streams.length; c++) {
        const inStream = itemsIn(tags, c)
        const spacers = inStream.filter(isSpacerItem)
        expect(
          spacers.length,
          `${page} 第 ${c + 1} 条滚动流（模板偏移 ${streams[c][0]}…${streams[c][1]}）有 ${spacers.length} 个让位占位，` +
            `应为 1 —— 多 tab 页的每个 <list> 都是独立滚动流，漏一个 ⇒ 切到该 tab 时末项重新被 FAB 吞点击`,
        ).toBe(1)
      }
    })

    it(`${page}：占位是滚动容器的**直接子节点**（不是嵌在别的 list-item 里）`, () => {
      // ⚠️ 这条取代过一版**恒绿**的「占位是最后一个 list-item」判据：
      //    那版用 `.pop()` 取 `</list>` 前最后一个 `<list-item` **开标签**。占位一旦被塞进
      //    `item-key="footer"` 的 list-item **内部**，footer 的开标签反而在占位**之后**
      //    ⇒ `.pop()` 正好抓到占位自己 ⇒ 变异实测 **72 条全绿**。而「占位不带 v-if」只匹配
      //    占位自身那一小块，看不见外面的 footer ⇒ 对 ADR-0217 §2.2 最核心的失效形态**恒绿**。
      //    现在改用标签栈算出的 `depth`：depth>0 即嵌在别的 list-item 内。
      const { tags } = spacersByStream(page)
      for (const it of tags.filter(isSpacerItem)) {
        expect(
          it.depth,
          `${page} 让位占位嵌在另一个 <list-item> 内部（深度 ${it.depth}）：` +
            `它会随外层 list-item 的条件渲染一起消失（footer 是三态条件渲染，ADR-0217 §2.2）`,
        ).toBe(0)
      }
    })

    it(`${page}：占位是所在滚动流的最后一个直接子节点（ADR-0217 §2「末尾追加」承重不变量）`, () => {
      // ⚠️ 只在 **depth===0 的直接子节点**里取最后一个——不是全部 `<list-item` 开标签。
      //    旧判据取全部开标签的 `.pop()`，正是 B1 假绿的来源。
      //    取代过一版**双向失效**的「缩进齐平」判据：`<template v-if>` 包裹 + 缩进平铺会假绿，
      //    只改缩进 6→4 又会假红；且 oxfmt 不管辖该目录模板，缩进可自由漂移，两端都不可靠。
      const { tags } = spacersByStream(page)
      for (const it of tags.filter(isSpacerItem)) {
        const siblings = itemsIn(tags, it.container).filter((t) => t.depth === 0)
        const last = siblings[siblings.length - 1]
        expect(last, `${page} 第 ${it.container + 1} 条滚动流没有直接子节点`).toBeTruthy()
        expect(
          isSpacerItem(last!),
          `${page} 第 ${it.container + 1} 条滚动流的最后一个直接子 list-item 不是让位占位` +
            `——否则 footer/末项出现时让位带不再覆盖最底部（ADR-0217 §2）`,
        ).toBe(true)
      }
    })

    it(`${page}：占位 list-item 须 full-span 且不带 v-if/v-else（条件化则静默失效）`, () => {
      // ⚠️ 属性表判据**与属性顺序无关**（旧正则要求 full-span 写在 item-key 之后 ⇒ 换序假红）。
      const { tags } = spacersByStream(page)
      for (const it of tags.filter(isSpacerItem)) {
        const attrs = it.attrs
        expect(
          'full-span' in attrs,
          `${page} 占位 list-item 缺 full-span（属性：${Object.keys(attrs).join(' ') || '(空)'}）`,
        ).toBe(true)
        // 条件化会随条件一起消失 ⇒ 静默失效。裸属性与 :attr 形式都算。
        const conditional = Object.keys(attrs).filter((k) => /^:?v-(if|else|show)$/.test(k))
        expect(
          conditional,
          `${page} 占位不得带 ${conditional.join('/') || '(条件指令)'}（ADR-0217 §2.2：三态皆假时节点不存在）`,
        ).toEqual([])
      }
    })

    it(`${page}：占位不得被 <template v-if/v-show> 等容器包裹（code-review Standards M8 假绿）`, () => {
      // ⚠️ 变异 M8：用 `<template v-if="endOfFeed">` 包住整块、缩进保持平铺
      //    ⇒ 「占位是最后一个 list-item」仍成立（template 不是 list-item），
      //    但占位照样会随条件消失。实测该形态一度 14/14 全绿。
      //    ⇒ 直接禁：占位 list-item 之前的**最近一个未闭合容器**不得带条件指令。
      const { src, tags } = spacersByStream(page)
      for (const it of tags.filter(isSpacerItem)) {
        // 向上扫描并**做括号配平**（不能逐行 push/pop：那会把同区间内的
        // <template v-if>…</template> 一对互相抵消，回溯结果恒为空 = 判据恒真）。
        const lines = src.slice(0, it.at).split('\n')
        let depth = 0
        const unclosed: string[] = []
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i]
          const closes = (l.match(/<\/template>/g) ?? []).length
          const opens = [...l.matchAll(/<template\b([^>]*)>/g)].map((m) => m[1])
          depth += opens.length - closes
          for (let k = 0; k < depth; k++) unclosed.push(opens[k] ?? '')
          if (depth <= 0 && /<(list|scroll-view)(?=[\s/>])/.test(l)) break
          if (i === 0) break
        }
        expect(
          unclosed.filter((a) => /\bv-(if|show|else)\b/.test(a)),
          `${page} 占位被带条件的 <template> 包裹 ⇒ 会随该条件一起消失（ADR-0217 §2.2 陷阱）`,
        ).toEqual([])
      }
    })

    it(`${page}：占位在滚动容器内部而非容器之外（内容级 inset，不是容器 padding）`, () => {
      const { src, tags, streams } = spacersByStream(page)
      const at = src.indexOf('<FabAllowanceSpacer')
      expect(at, `${page} 未找到占位标签`).toBeGreaterThan(-1)
      for (const it of tags.filter(isSpacerItem)) {
        expect(
          it.container,
          `${page} 占位不在任何 <list>/<scroll-view> 区间内（它必须作为内容追加在流末尾）`,
        ).toBeGreaterThan(-1)
      }
      expect(streams.length, `${page} 未解析出滚动容器区间`).toBeGreaterThan(0)
    })
  }

  for (const page of SCROLLVIEW_PAGES) {
    it(`${page}：占位紧邻 </scroll-view> 之前（scroll-view 形态无 list-item 顺序问题）`, () => {
      const src = templateOf(page)
      expect(src, `${page} 未找到 FabAllowanceSpacer`).toContain('FabAllowanceSpacer')
      const svClose = src.indexOf('</scroll-view>')
      // ⚠️ 必须找**标签**而非裸词：`<FabAllowanceSpacer />` 的裸词在注释里也出现
      //   （注释提到「末尾零内容 view」等），用 indexOf 裸词会命中注释或 import 残留。
      const at = src.indexOf('<FabAllowanceSpacer')
      expect(at, `${page} 未找到占位标签`).toBeGreaterThan(-1)
      expect(at, `${page} 占位必须落在 </scroll-view> 之前`).toBeLessThan(svClose)
      // 末尾性：占位之后到 </scroll-view> 之间**不得再有别的元素**。
      // 判据形态：剥掉注释后，占位标签的下一个非空 token 必须是 </scroll-view>。
      const noCmt = src.replace(/<!--[\s\S]*?-->/g, '')
      const after = noCmt.slice(noCmt.indexOf('<FabAllowanceSpacer'))
      const nextTag = after.replace(/^<FabAllowanceSpacer\b[^>]*\/?>/, '').match(/^\s*(<\/[^>]+>)/)
      expect(
        nextTag && nextTag[1],
        `${page} 占位之后紧接的应是 </scroll-view>，实际是 ${nextTag ? nextTag[1] : '(无)'}`,
      ).toBe('</scroll-view>')
      // 该页不是 <list> 形态，不应出现 list-item 包裹
      expect(
        listItemTagsOf(src).filter(isSpacerItem).length,
        `${page} 用 <scroll-view>，不应有 fab-allowance 的 list-item`,
      ).toBe(0)
    })
  }
})

describe('底部遮挡让位：清单完备性（反查自证，票 #922 / code-review B4）', () => {
  /**
   * ⚠️ 这条判据存在的理由：`LIST_PAGES` 曾是**纯手工数组**，没有任何东西校验它全不全
   * ⇒ 新增一个带滚动容器的内容页而忘了接线时，**门禁全绿**。实测这不是假设：
   * 4 个页面（`WatchLater` / `NovelDetail` / `IllustDetail` / `MuteTags`）就是这样
   * 从未被任何判据发现，直到本轮人工盘点 25 条路由才暴露。
   *
   * ⇒ 改为**从 `router.ts` 反查**：任何路由对应的页面，只要模板里有滚动容器，
   *    就必须挂让位占位；例外必须在下方 `NO_ALLOWANCE` 里**逐条写明理由**。
   *    新增页面忘了接线 ⇒ 这条立刻红，且失败信息里直接列出该补什么。
   */
  const NO_ALLOWANCE = new Map<string, string>([
    ['src/pages/Recommended.vue', '沉浸式轮播页，spec S4 明确排除（底部不做空带，已有负样本判据）'],
    [
      'src/pages/NetworkCheck.vue',
      '网络诊断页（dev 工具）：结果卡片数量随探测项变化，**内容不满一屏** ⇒ 补 58.668vw 占位会' +
        '**凭空造出可滚动的空白区**（比遮挡更糟）。本条理由**刻意不写死子节点数**——那是会漂的' +
        '实现细节，且静态判据本就无法验证「不满一屏」。内容将来变长时须重新评估（见下方已知失效面）',
    ],
    [
      'src/pages/PlatformCheck.vue',
      '平台自检页（dev 工具）：与 NetworkCheck 同形态，**内容不满一屏** ⇒ 补占位会造出可滚动空白区。' +
        '同样刻意不写死计数；内容变长时须重新评估（见下方已知失效面）',
    ],
  ])

  it('每条路由的页面若含滚动容器，就必须挂让位占位（手工清单漏页 ⇒ 本条转红）', () => {
    const router = read('src/router.ts')
    // 组件名 → 页面文件（router 的 import 是唯一权威映射，不另抄一份页面清单）
    const imports = new Map<string, string>()
    for (const m of router.matchAll(/import\s+(\w+)\s+from\s+'\.\/pages\/([\w./-]+\.vue)'/g)) {
      imports.set(m[1]!, `src/pages/${m[2]!}`)
    }
    // ⚠️ 先证输入非空：路由表若解析失败，下面的循环会空转 ⇒ 断言恒真
    expect(imports.size, 'router.ts 页面 import 解析失败，判据输入无效').toBeGreaterThan(15)

    // 非内容页（FAB hidden ⇒ 根本没有遮挡源）直接从 createGlobalFab 读，不硬编码
    const fabSrc = read('src/primitives/createGlobalFab.ts')
    const ncBody = fabSrc.match(/NON_CONTENT_ROUTE_NAMES\s*=\s*new Set\(\[([^\]]*)\]/)?.[1] ?? ''
    const nonContent = new Set([...ncBody.matchAll(/'([^']+)'/g)].map((m) => m[1]!))
    expect(nonContent.size, 'NON_CONTENT_ROUTE_NAMES 解析失败').toBeGreaterThan(0)

    const missing: string[] = []
    for (const m of router.matchAll(/\{\s*path:\s*[^,]+,\s*name:\s*'([^']+)',\s*component:\s*(\w+)/g)) {
      const [routeName, comp] = [m[1]!, m[2]!]
      const file = imports.get(comp)
      if (!file) continue // 非 pages/ 下的组件
      if (nonContent.has(routeName)) continue // FAB hidden，无遮挡源
      if (NO_ALLOWANCE.has(file)) continue
      const src = read(file)
      const tpl = templateOf(file)
      const scrolls = /<list(?=[\s>])|<scroll-view(?=[\s>])/.test(tpl)
      if (!scrolls) continue
      if (!src.includes('FabAllowanceSpacer')) missing.push(`${file}（路由 ${routeName}）`)
    }
    expect(
      missing,
      '以下页面有滚动容器但没挂底部遮挡让位占位 ⇒ 滚到底时末项会被 GlobalFab 压住：\n  - ' +
        missing.join('\n  - ') +
        '\n\n修法：把 `<FabAllowanceSpacer />` 按容器形态接上（`<list>` 用 full-span `list-item` 包裹、' +
        '`<scroll-view>` 直接放末尾），并 import 该组件。\n' +
        '若该页确实不需要（如内容不满屏、底部有 in-flow 动作栏），加入下方 NO_ALLOWANCE 并写明理由。',
    ).toEqual([])
  })

  it('例外清单里的页面确实不需要（防止例外本身变成藏污纳垢的垃圾桶）', () => {
    // 防止「先加进 NO_ALLOWANCE 免检，日后再也不回头看」。逐条要求给出**非空且具体**的理由。
    for (const [file, why] of NO_ALLOWANCE) {
      expect(why.length, `${file} 的免检理由太短，不像理由`).toBeGreaterThan(20)
    }
    // 免检页不得**偷偷**挂了占位（那说明它其实需要，例外是多余的）
    for (const file of NO_ALLOWANCE.keys()) {
      expect(
        read(file).includes('FabAllowanceSpacer'),
        `${file} 已挂让位占位，却还在 NO_ALLOWANCE 免检清单里 ⇒ 请从例外中移除`,
      ).toBe(false)
    }
  })
})

describe('底部遮挡让位：反例（守住 S4 与 C2）', () => {
  it(`${IMMERSIVE_PAGE}：沉浸页不得有该占位（轮播页无底部空带）`, () => {
    expect(
      codeOf(IMMERSIVE_PAGE),
      `${IMMERSIVE_PAGE} 是沉浸式轮播页，不应挂底部遮挡让位（spec S4）`,
    ).not.toContain('FabAllowanceSpacer')
  })

  it('根容器不再用 paddingBottom 承载 FAB 遮挡（否则内容滚不过去，C2）', () => {
    const src = codeOf('src/App.vue')
    // 根容器只应保留 safeBottom（系统栏），不得出现 FAB 几何档位
    expect(src, 'App.vue 不得重新引入 FAB 占位带（ADR-0217 C2）').not.toMatch(/\b(pb-18|h-18)\b/)
    // safeBottom 仍在（系统栏那半边保留，ADR-0216 §2.2）
    expect(read('src/App.vue'), 'safeBottom 消费须保留').toContain('paddingBottom: safeBottom')
  })
})
