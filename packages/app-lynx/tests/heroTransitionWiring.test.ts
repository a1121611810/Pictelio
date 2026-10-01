// heroTransition **接线门禁**（ADR-0211 决策 12「覆盖：全部能点图进详情的流，不留只有推荐流有的割裂」）。
//
// 判据形态 = **遍历式**（同 ADR-0211 复核判据 2）：不比计数、不写死页面名单，而是
// 「扫到一处 `/illust/` 导航，就必须能在同一文件里找到对应的测量发起 + 缩略图盒 id 绑定」。
// 名单不写死的理由：新增一个能点图进详情的流时**自动入判**，不需要改判据；
// 写死名单则会在对方合法新增/删除流时假红。
//
// ⚠️ 扫描面地板（先于任何「全清」结论）：抽取器一旦静默失配（本类门禁最常见的失效形态），
// 「零命中」会变成空洞的通过。故先断言**抽到了足够多的入口**，再谈合规。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const PAGES = path.resolve(__dirname, '../src/pages')
const COMPONENTS = path.resolve(__dirname, '../src/components')

/** 所有 `/illust/` 导航（含作品详情页自己进「标签近邻」子页的那种，不是缩略图入口） */
const NAVIGATE_ILLUST = /navigate\(\s*`\/illust\/\$\{[^`]*`/g
/** 作品详情 → 标签近邻**子页**（/illust/:id/tag-neighbors）：不是「点缩略图进详情」，排除掉 */
const SUB_PAGE = 'tag-neighbors'

/** 「点缩略图进作品详情」入口：命中处既用于计数，也用于定位「begin 必须在其之前」 */
function thumbnailEntries(source: string): { index: number }[] {
  return [...source.matchAll(NAVIGATE_ILLUST)]
    .filter((m) => !m[0].includes(SUB_PAGE))
    .map((m) => ({ index: m.index ?? -1 }))
}
/** 覆盖层绑定三件套（缺一件就是静默失效：没 style 没动画、没 mode 会变形、没 src 是空白矩形） */
const OVERLAY_ANCHOR = ':mode="\'aspectFill\'"'
/**
 * 决策 12 的实现口径：比例差由 Lynx 的 mode 吸收，**不是** CSS object-fit（见 CoverImage 头注）。
 * ⚠️ 必须带冒号只匹 CSS **声明**：裸词 `object-fit` 会命中注释里「以 mode 替代 CSS object-fit」这类
 * 说明文字（假阳性），而门禁要判的是「代码里真的写了这条 CSS」。
 */
const OBJECT_FIT = /object-fit\s*:/

/** 读一个目录下的 .vue 源码（rel 路径 → 源码） */
function readVueDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.vue')) out[`${path.basename(dir)}/${name}`] = fs.readFileSync(path.join(dir, name), 'utf-8')
  }
  return out
}

/** 仓库现状的扫描面（页面 + 组件） */
function repoSources(): Record<string, string> {
  return { ...readVueDir(PAGES), ...readVueDir(COMPONENTS) }
}

/**
 * 单花括号插值探测（本 session 真实发过的形态：卡片把 `{artworkTitle(...)}` 当正文渲染，
 * 而 vue-tsc / 3442 单测 / lint / fmt 全绿，只有真机截图能看见）。
 * 剥除顺序：script 块 → 注释 → 双花括号插值 → 带引号的属性值 → 标签，剩文本节点。
 */
function singleBraceTexts(source: string): string[] {
  const rest = source
    .replace(/<script[\s\S]*?<\/script>/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/\{\{[\s\S]*?\}\}/g, '\n')
    .replace(/[\w:@.[\]()#-]+\s*=\s*("[^"]*"|'[^']*')/g, '\n')
    .replace(/<[^>]*>/g, '\n')
  return rest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /(?<!\{)\{[^{}]+\}(?!\})/.test(line))
}

/** 判据内核：输入扫描面，返回违规描述（空数组 = 全清） */
function judge(sources: Record<string, string>): string[] {
  const offenders: string[] = []
  let entries = 0
  for (const [rel, source] of Object.entries(sources)) {
    const found = thumbnailEntries(source)
    if (found.length === 0) continue
    entries++
    // ① 每一处「点缩略图进详情」的导航之前都必须先发起测量（决策 12 机制 1：不 await，但不能没有）
    for (const { index } of found) {
      const lead = source.slice(Math.max(0, index - 400), index)
      if (!/heroTransition\.begin\(/.test(lead)) {
        offenders.push(`${rel}: 导航前未调用 heroTransition.begin()（决策 12 机制 1）`)
      }
    }
    // ② 缩略图必须挂稳定 id，否则量不到起点矩形
    if (!/heroTransition\.sourceId\(/.test(source)) {
      offenders.push(`${rel}: 未绑定 heroTransition.sourceId(...) 缩略图 id`)
    }
    // ③ 必须真的接了本模块（防「抄了 begin 的名字但没接实现」）
    if (!/from '\.\.\/composables\/heroTransition'/.test(source) && !/from '\.\/heroTransition'/.test(source)) {
      offenders.push(`${rel}: 未从 composables/heroTransition 导入`)
    }
    // ④ 渲染覆盖层的文件：绑定三件套齐全，且不得用 CSS object-fit 当机制
    if (/heroTransition\.overlay\.visible/.test(source)) {
      if (!source.includes(OVERLAY_ANCHOR)) offenders.push(`${rel}: 覆盖层缺 ${OVERLAY_ANCHOR}（比例差靠它吸收）`)
      if (!/:style=/.test(source)) offenders.push(`${rel}: 覆盖层缺 :style 绑定（无动画）`)
      if (!/:src=/.test(source)) offenders.push(`${rel}: 覆盖层缺 :src 绑定（空白矩形）`)
    }
    if (OBJECT_FIT.test(source)) offenders.push(`${rel}: 用了 CSS object-fit 声明，原生 Lynx 走 <image mode>（CoverImage 头注）`)
    // ⑤ 单花括号插值（真机才看得见的假绿）
    for (const text of singleBraceTexts(source)) {
      offenders.push(`${rel}: 文本节点出现单花括号表达式：${text.slice(0, 40)}`)
    }
  }
  // 扫描面地板：抽到的入口数低于地板值说明抽取器失配，「零命中」不作数
  if (entries < FLOOR) offenders.push(`扫描面地板未达标：只抽到 ${entries} 处 /illust/ 导航（下限 ${FLOOR}）`)
  return offenders
}

/** 扫描面地板：当前有 10 处 /illust/ 导航（IllustDetail→tag-neighbors 不算，那是作品级子页）。
 *  取下限 8 而非写死 10：新增流自动入判，地板只负责「抽取器没在扫」。 */
const FLOOR = 8

describe('heroTransition 接线门禁（遍历式，不比计数）', () => {
  it('扫描面地板：抽到的 /illust/ 导航入口数达标（抽取器没在静默失配）', () => {
    const sources = repoSources()
    const hits = Object.entries(sources).filter(([, s]) => thumbnailEntries(s).length > 0)
    expect(hits.length, '能点图进详情的流少于地板 ⇒ 抽取器或代码面出了问题').toBeGreaterThanOrEqual(FLOOR)
  })

  it('仓库现状零命中', () => {
    expect(judge(repoSources())).toEqual([])
  })

  // ── 阳性对照：判据必须先自证能红，否则「通过」是空话 ──
  it('阳性对照 A：抽掉某页的 begin 调用即转红（判据能分辨「接了」与「没接」）', () => {
    const sources = repoSources()
    const rel = Object.keys(sources).find(
      (k) => k.startsWith('pages/') && sources[k]!.includes('heroTransition.begin(') && thumbnailEntries(sources[k]!).length > 0,
    )
    expect(rel, '找不到已接线的页面作为对照底本').toBeDefined()
    // ⚠️ 替换必须**真的抹掉**该 token：写成注释里还留着同名字符串的话，判据会照旧命中
    // （这正是「判据能红」与「判据真的在扫」的区别）
    const broken = { ...sources, [rel!]: sources[rel!]!.replace('heroTransition.begin(', 'dropBegin(') }
    const hits = judge(broken)
    expect(hits.some((h) => h.includes(rel!) && h.includes('begin()'))).toBe(true)
  })

  it('阳性对照 B：覆盖层改成 CSS object-fit 即转红（机制口径被守住）', () => {
    const sources = repoSources()
    const rel = Object.keys(sources).find((k) => sources[k]!.includes('heroTransition.overlay.visible'))
    expect(rel, '找不到渲染覆盖层的页面作为对照底本').toBeDefined()
    const broken = { ...sources, [rel!]: sources[rel!]!.replace(OVERLAY_ANCHOR, 'style="object-fit: cover"') }
    expect(judge(broken).some((h) => h.includes('object-fit'))).toBe(true)
  })

  it('阳性对照 C：单花括号插值被判红（本 session 真机才抓住的那一格）', () => {
    const probe = (textNode: string): string =>
      [
        '<script setup lang="ts">',
        "import { navigate } from '../router'",
        "import { useHeroSource } from '../composables/heroTransition'",
        'const heroTransition = useHeroSource()',
        'function open(id: number) {',
        '  heroTransition.begin(id)',
        '  void navigate(`/illust/${id}`)',
        '}',
        '</' + 'script>',
        '<template>',
        '  <view :id="heroTransition.sourceId(1)" />',
        `  <text>${textNode}</text>`,
        '</template>',
      ].join('\n')
    // 底本只把「单花括号」这一格做坏：合规底本（双花括号）不得被判红
    const okHits = judge({ 'pages/__probe.vue': probe('{{ artworkTitle(illust.title) }}') })
    expect(okHits.filter((h) => h.includes('单花括号'))).toEqual([])
    const badHits = judge({ 'pages/__probe.vue': probe('{artworkTitle(illust.title)}') })
    expect(badHits.some((h) => h.includes('单花括号') && h.includes('artworkTitle'))).toBe(true)
  })

  it('阳性对照 D：扫描面地板会拦下「抽取器失配」（把入口面清空不得判绿）', () => {
    const empty: Record<string, string> = { 'pages/Empty.vue': '<template><view /></template>' }
    expect(judge(empty).some((h) => h.includes('扫描面地板'))).toBe(true)
  })
})
