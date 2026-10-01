// ─── 图标单一事实源门禁（ADR-0208 决策 2 / 复核判据 2、4）───
// 锁的真实缺陷：项目此前用 unicode 字符「画」图标（⌂ ✎ ◎ ♡ ◇ ✓ …），而
// **没有任何门禁能判红**——硬编码门扫颜色、token 门扫 token，没有一道门扫
// 「图标是不是规范图标集」。unicode 写法可以无限回流。
//
// Oracle（期望值独立来源，禁自证）：
//   方向 A「映射有、字体无」→ 期望值 = 字体子集的 **cmap**（TTF 二进制，独立于 iconMap.ts）
//   方向 B「字体有、映射无」→ 期望值 = 字体子集的 **cmap**（同上，浪费体积方向）
//   方向 C「码点写错」→ 期望值 = Material Symbols **官方 codepoints 文件**（见下方 URL 常量，
//                            该文件随包内快照提交于 tests/fixtures/，构建期不联网）
// 三条断言都**不**用「映射表说 A，字体说 A」互证。
//
// 抽取器纪律：所有全称断言前必须断言抽取集合非空 + 数量下界，
// 否则正则失效会让门禁静默恒真（本仓反复在消灭的假绿）。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICON_CODEPOINTS, ICON_FONT_FAMILY, iconChar } from '../src/utils/iconMap'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const FONT = join(SRC, 'assets', 'fonts', 'material-symbols-outlined-subset.ttf')
/** base64 内联的 @font-face（Lynx 原生端唯一可用的形式，见 generate-icon-subset.py） */
const FONT_CSS = join(SRC, 'styles', 'icon-font.css')
/** 官方 codepoints 快照（Material Symbols Outlined 可变字体仓的 .codepoints 文件）。
 *  提交进仓库是刻意的：门禁不得依赖网络。 */
const OFFICIAL = fileURLToPath(new URL('./fixtures/material-symbols-outlined.codepoints', import.meta.url))

// ─── 1. 读取字体子集 cmap（最小 TTF cmap 解析：format 4 + format 12）───

interface TtfCmap {
  /** 码点集合（仅 BMP + 扩展 B，足够 Material Symbols 的 U+E0xx–U+F2xx） */
  codepoints: Set<number>
  tableCount: number
}

function readTtfCmap(file: string): TtfCmap {
  const buf = readFileSync(file)
  const numTables = buf.readUInt16BE(4)
  let cmapOffset = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (buf.toString('latin1', rec, rec + 4) === 'cmap') {
      cmapOffset = buf.readUInt32BE(rec + 8)
      break
    }
  }
  if (cmapOffset < 0) throw new Error('字体缺少 cmap 表')

  const numSubtables = buf.readUInt16BE(cmapOffset + 2)
  const codepoints = new Set<number>()
  let tableCount = 0
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmapOffset + 4 + i * 8
    const subOffset = cmapOffset + buf.readUInt32BE(rec + 4)
    const format = buf.readUInt16BE(subOffset)
    tableCount++
    if (format === 4) {
      const segX2 = buf.readUInt16BE(subOffset + 6)
      const seg = segX2 / 2
      const endBase = subOffset + 14
      const startBase = endBase + segX2 + 2
      const deltaBase = startBase + segX2
      const rangeBase = deltaBase + segX2
      for (let s = 0; s < seg; s++) {
        const end = buf.readUInt16BE(endBase + s * 2)
        const start = buf.readUInt16BE(startBase + s * 2)
        if (start === 0xffff) continue
        for (let cp = start; cp <= end; cp++) codepoints.add(cp)
      }
    } else if (format === 12) {
      const nGroups = buf.readUInt32BE(subOffset + 12)
      for (let g = 0; g < nGroups; g++) {
        const gr = subOffset + 16 + g * 12
        const start = buf.readUInt32BE(gr)
        const end = buf.readUInt32BE(gr + 4)
        for (let cp = start; cp <= end; cp++) codepoints.add(cp)
      }
    }
  }
  return { codepoints, tableCount }
}

// ─── 2. 官方 codepoints 快照 → name → codepoint ───
function readOfficialCodepoints(): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of readFileSync(OFFICIAL, 'utf8').split('\n')) {
    const m = /^([a-z0-9_]+) ([0-9a-f]+)$/.exec(line.trim())
    if (m) out.set(m[1]!, parseInt(m[2]!, 16))
  }
  return out
}

// ─── 3. 模板裸字形抽取器（两种书写形态都要抓）───
//   形态 A：文本节点裸字形          `<text ...>⌂</text>`
//   形态 B：属性值/表达式里的字面量  `:icon="'⌂'"` / `icon="⌂"` / `icon: '⌂'`
// 与 hardcode-gate.test.ts 同款：先剥 <script>/<style>/注释，再扫属性值 + 剥标签后的文本节点。
const GLYPH_BLOCKS = [
  [0xe000, 0xf8ff], // 私用区（Material Symbols 区）——留给未来的规范图标字形
  [0x2039, 0x203a], // ‹ › 返回/前进（iconMap: arrow_back / arrow_forward）
  [0x2190, 0x21ff], // ← → ↑ ↓ ↔ ↻ ⇒ ⇔
  [0x2261, 0x2261], // ≡（iconMap: list）。**刻意只取这一个码点**，不覆盖整个 0x2200–0x22ff
                    // 数学运算符区——实测把整段打开会误报 SearchSheet.vue:580 的
                    // `≥{{ px }}px`（分辨率筛选 chip 的标签，≥ 是文本比较语义不是图标位）。
                    // 覆盖口径 = 「对应 iconMap 已登记名字的码点」，不是「看着像符号的码点」。
                    // 日后若把 ∆ / ∑ 等图标化，须先登记进 iconMap 再在此逐点加码点。
  [0x2300, 0x23ff], // ⌂ ⌃ ⌄ ⏱
  [0x2460, 0x24ff], // ①②③④
  [0x25a0, 0x27bf], // ▦ ▲ ▶ ◇ ◎ ★ ☆ ♥ ⚠ ✓ ✕ ✗ ✦
  [0x2b00, 0x2bff], // ⬆
  [0x1f000, 0x1faff], // 💬 🔍 👁
]
function isIconGlyph(cp: number): boolean {
  return GLYPH_BLOCKS.some(([lo, hi]) => cp >= lo && cp <= hi)
}

const GLYPH_RE = new RegExp(
  `[${GLYPH_BLOCKS.map(([lo, hi]) =>
    [...Array(hi - lo + 1)].map((_, i) => `\\u{${(lo + i).toString(16)}}`).join(''),
  ).join('')}]`,
  'gu',
)

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walkSource(p)
    else if (/\.vue$/.test(entry)) yield p
  }
}

function* walkScriptSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walkScriptSource(p)
    // .ts 图标数据源（navTabs.ts / primitives/createGlobalFab.ts / utils/watchLaterGlyph.ts）
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) yield p
  }
}

/** 单个 .vue 源码内的裸字形命中（属性值 + 文本节点两种形态） */
function scanVueGlyphs(source: string): string[] {
  const tpl = source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const hits: string[] = []
  // 形态 B：属性值（含 :icon="'⌂'" 里的引号内字面量）
  for (const m of tpl.matchAll(/[\w:.-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const seg of [m[1] ?? '', m[2] ?? '']) {
      for (const g of seg.matchAll(GLYPH_RE)) {
        hits.push(`U+${g[0]!.codePointAt(0)!.toString(16).toUpperCase()}`)
      }
    }
  }
  // 形态 A：剥标签与插值后的文本节点
  const textOnly = tpl.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]*>/g, '\n')
  for (const g of textOnly.matchAll(GLYPH_RE)) {
    hits.push(`U+${g[0]!.codePointAt(0)!.toString(16).toUpperCase()}`)
  }
  return hits
}

/** .ts / <script> 区的图标字面量。模板之外的数据层同样是图标的书写形态
 *  （navTabs.ts 的 `icon: '⌂'`、createGlobalFab.ts 的 `icon: '↻'`），一并纳入门禁。 */
function scanScriptGlyphs(source: string): string[] {
  const scripts = source.endsWith('.vue')
    ? [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
    : [source]
  const hits: string[] = []
  for (const code of scripts) {
    // 剥注释（注释里的 ⌂ 是文档说明不是图标渲染）
    const bare = code
      .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释 + JSDoc
      .replace(/^\s*(?:\/\/|\*).*$/gm, '') // 行注释 + JSDoc 每行
    for (const m of bare.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
      // console.* 参数豁免（与 hardcode-gate.test.ts isConsoleArg 同款）：
      // 「…不可用 → 停用」里的箭头是日志行文，不是渲染出来的图标位。
      if (/console\s*\.\s*[a-zA-Z]+\s*\(\s*$/.test(bare.slice(0, m.index))) continue
      for (const g of m[1]!.matchAll(GLYPH_RE)) {
        hits.push(`U+${g[0]!.codePointAt(0)!.toString(16).toUpperCase()}`)
      }
    }
  }
  return hits
}

// 存量欠账台账已于 T12 收口时删除（原 tests/icon-glyph-baseline.json），门禁收紧为
// **零容忍**——该文件自己的约定是「台账清空那天删除本文件并把门禁收紧为零容忍」。
//
// 为什么不留一个「允许清单」：留了就等于给 unicode 写法留了一条合法回流通道，
// 而 unicode 写法回流是**静默**的（默认字体没有该字形 → 空白/豆腐块，无报错），
// 正是本门禁要消灭的东西。白名单式门禁在本仓反复失效的记录见 md3GuardScans 的教训。

const cmap = readTtfCmap(FONT)

/**
 * 读取字体的族名（name 表 nameID 1）。
 *
 * ⚠️ 这条解析器存在的原因：曾真实发生「全站图标渲染成豆腐块 ⊠」，而 cmap 断言全绿——
 * 因为缺陷不在码点，在**族名**：subset 时 `--name-IDs=` 传了空值，产出一款**没有
 * nameID 1** 的字体，@font-face 的 `font-family: 'MaterialSymbolsOutlinedSubset'`
 * 永远匹配不上 ⇒ 回退默认字体 ⇒ 私用区码点无字形。
 * cmap 查得到码点 ≠ @font-face 匹配得到字体：前者验「字形在不在」，后者验「名字对不对」。
 * 这两个是**正交**的失败面，必须各自有断言。
 */
function readTtfFamilyNames(file: string): string[] {
  const buf = readFileSync(file)
  const numTables = buf.readUInt16BE(4)
  let nameOff = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      nameOff = buf.readUInt32BE(rec + 8)
      break
    }
  }
  if (nameOff < 0) return []
  const count = buf.readUInt16BE(nameOff + 2)
  const stringOffset = buf.readUInt16BE(nameOff + 4)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12
    const platformID = buf.readUInt16BE(rec)
    const nameID = buf.readUInt16BE(rec + 6)
    const len = buf.readUInt16BE(rec + 8)
    const off = buf.readUInt16BE(rec + 10)
    if (nameID !== 1) continue
    const start = nameOff + stringOffset + off
    const raw = buf.subarray(start, start + len)
    // Windows(3) 平台是 UTF-16BE；Mac(1) 是单字节。只采信 Windows 那份做断言。
    if (platformID === 3) {
      const be = Buffer.from(raw)
      be.swap16() // UTF-16BE → LE（Node 无内置 utf16be 解码，swap16 是标准做法）
      out.push(be.toString('utf16le'))
    }
  }
  return out
}
/**
 * 读取 head 表的 created / modified（8 字节 longdatetime，秒数，自 1904-01-01 起算）。
 *
 * ⚠️ 为什么要有这条：字体子集是**离线生成、提交进仓库**的产物。若产物含当次运行的
 * 挂钟时间，则任何人重跑生成脚本都会得到一个 diff（实测两次仅差 4 字节，全在 head 表
 * 及其目录校验和），「重跑应无 diff」的可复现性承诺名不副实、干净 clone 与本分会分叉。
 * 本仓已因此踩过一次：`fontTools.subset` 把运行时刻写进 head.modified，而
 * `recalcTimestamp=False` 只保证 save() 不再刷新——**保留 ≠ 固定**。
 *
 * 取证方式：用 `git stash` 把产物换回修复前的版本比 sha256（见测试注释里的判定）。
 */
function readTtfHeadTimestamps(file: string): { created: number; modified: number } | null {
  const buf = readFileSync(file)
  const numTables = buf.readUInt16BE(4)
  let headOff = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (buf.toString('latin1', rec, rec + 4) === 'head') {
      headOff = buf.readUInt32BE(rec + 8)
      break
    }
  }
  if (headOff < 0) return null
  // head 表内偏移：version(4) fontRevision(4) checkSumAdjustment(4) magic(4)
  //                flags(2) unitsPerEm(2) → created 在 20，modified 在 28
  const readDate = (at: number) => Number(buf.readBigUInt64BE(headOff + at))
  return { created: readDate(20), modified: readDate(28) }
}

const official = readOfficialCodepoints()
const mapEntries = Object.entries(ICON_CODEPOINTS) as [string, number][]
/** 实际扫描结果：相对 src 的路径 → 该文件命中的码点集合 */
const actual = new Map<string, Set<string>>()
/** 实际**被扫描过**的 .vue 文件（相对 src）。与违规数无关，是"零"这一结论的可信度证据：
 *  零容忍断言若因扫描器塌陷而恒真，光看 `actual.size === 0` 分辨不出来，
 *  必须另有一条"确实扫过了 N 个文件且 AppIcon 在其中"的独立判据。 */
const scannedVueFiles = new Set<string>()
{
  const add = (rel: string, hits: string[]) => {
    if (hits.length === 0) return
    actual.set(rel, new Set([...(actual.get(rel) ?? []), ...hits]))
  }
  for (const file of walkSource(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/')
    scannedVueFiles.add(rel)
    add(rel, scanVueGlyphs(readFileSync(file, 'utf8')))
  }
  for (const file of walkScriptSource(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/')
    // i18n 字典排除：「我的 → 追更列表」的箭头、「✓ 兼容」的勾是行文符号不是图标位，
    // 计进图标欠账会把文案改写混进 T12 的图标替换。
    if (rel.startsWith('i18n/')) continue
    add(rel, scanScriptGlyphs(readFileSync(file, 'utf8')))
  }
}

/** 遍历 i18n locale 字典（`src/i18n/locales/**`）。
 *  与 walkScriptSource 分开：i18n 在零容忍字形扫描里是**按目录排除**的
 *  （行文符号不是图标位），这里由 scanI18nIconLeak 用**形态**单独判。
 *
 *  ⚠️ 首版这个 walker 写成了「只下沉到名字叫 locales 的目录」，但它从 `src/` 起步，
 *  第一层是 `i18n`（不叫 locales）⇒ 整个目录被跳过 ⇒ 抽到 0 个文件 ⇒
 *  全称断言 `toEqual([])` **恒绿**。注入真实泄漏实测 15 passed，判据完全没响。
 *  教训与本仓反复出现的「正则塌陷让全称断言真空」完全同型：**抽取器不产出任何东西时，
 *  「零命中」和「零违规」在断言上长得一模一样**。所以下面必须配非空下界。 */
function* walkI18nLocales(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walkI18nLocales(p)
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) yield p
  }
}

/** 去掉 TS 的行/块注释 —— 注释里的符号不是渲染出来的，不能算图标位。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 扫描 i18n locale **值**里的图标位泄漏。
 *
 * 背景：`i18n/` 整个目录被排除在零容忍字形扫描之外（理由正当 ——
 * 「我的 → 追更列表」的 →、「加载中…」的 … 是行文符号不是图标位，
 * 把它们算进图标欠账会把文案改写混进图标替换）。
 *
 * 但正是这道排除，让作品类型徽标的 `▶︎`(U+25B6+U+FE0E) / `⧉`(U+29C9) 长期存活：
 * 它们是**图标**、藏在文案值里、而门禁按目录整个不看。这是「按位置排除」
 * 必然留下的结构性缝隙 —— 排除规则无法区分同一目录里的图标位与行文符号。
 *
 * 这里换一个**按形态**的判据，只认两种绝不会出现在行文里的记号：
 *   ① U+FE0E（文本呈现选择符）：文案不需要它，只有「强制符号按文本渲染、
 *     避免被平台渲成彩色 emoji」才会写 —— 即图标位的标志。
 *   ② ICON_CODEPOINTS 里登记的码位字面量：图标就该走 `<AppIcon>`，不该以码点
 *     形式出现在字符串里。
 * 两者都不覆盖 → / ✓ · ※ —— 行文符号不受影响。
 */
/** 偏移 → 行号（1 起）。判据的报错要能直接定位到行，否则「转红了但不知道去哪看」
 *  会让人先去怀疑判据本身。 */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function scanI18nIconLeak(text: string, path: string): Violation[] {
  const out: Violation[] = []
  for (const m of text.matchAll(/️/g)) {
    out.push({ rule: 'i18n-icon-leak', path, line: lineOf(text, m.index ?? 0), form: 'U+FE0E 文本呈现选择符' })
  }
  for (const [name, cp] of mapEntries) {
    for (const m of text.matchAll(new RegExp(`\\u${cp.toString(16)}`, 'gi'))) {
      out.push({ rule: 'i18n-icon-leak', path, line: lineOf(text, m.index ?? 0), form: `${name} U+${cp.toString(16)}` })
    }
  }
  return out
}

describe('图标单一事实源（ADR-0208）', () => {
  it('抽取器自身有效：cmap / 官方快照 / 映射表三者都非空且有数量下界（防空转恒真）', () => {
    expect(cmap.tableCount).toBeGreaterThanOrEqual(1)
    expect(cmap.codepoints.size).toBeGreaterThanOrEqual(20)
    expect(official.size).toBeGreaterThanOrEqual(3000)
    expect(mapEntries.length).toBeGreaterThanOrEqual(20)
  })

  it('字体族名 == ICON_FONT_FAMILY（@font-face 的匹配键；缺此项全站图标豆腐块 ⊠）', () => {
    // 这条与上面的 cmap 断言**正交**：cmap 管「字形在不在字体里」，
    // 族名管「@font-face 能不能匹配到这款字体」。两者都绿，图标仍可能全是豆腐块
    // —— 该缺陷已真实发生过一次（subset 的 --name-IDs= 传空值，族名被整个丢掉）。
    const declared = readTtfFamilyNames(FONT)
    expect(
      declared,
      '字体没有 nameID 1（族名）⇒ @font-face 的 font-family 永远匹配不上 ⇒ ' +
        '私用区码点回退默认字体 ⇒ 全站图标渲染成豆腐块 ⊠。' +
        '修复：重跑 python3 scripts/generate-icon-subset.py（已内置族名写入 + 回读校验）。',
    ).toEqual([ICON_FONT_FAMILY])
  })

  it('icon-font.css 的 base64 载荷 === 字体文件字节（两个产物不许漂移）', () => {
    // @font-face 真正加载的是 icon-font.css 里那份 base64，而门禁验的是 .ttf 文件。
    // 两者是**两个产物**，各自都能独立地"看起来对"：ttf 正确而 css 里塞了旧版本
    // base64（或反过来）时，cmap / 族名断言照样全绿，真机却是旧字形或豆腐块。
    // 故必须逐字节锁死。
    const css = readFileSync(FONT_CSS, 'utf8')
    const m = css.match(/url\('data:font\/ttf;base64,([A-Za-z0-9+/=]+)'\)/)
    expect(
      m,
      "icon-font.css 里没有 base64 data URI。Lynx 的 @font-face url() 只支持远程地址与" +
        "base64，url('./x.ttf') 会被打包器改写成 webpack:/// 路径并在原生端失效" +
        '（真机实证：全站图标豆腐块 ⊠）。重跑 python3 scripts/generate-icon-subset.py。',
    ).not.toBeNull()
    expect(Buffer.from(m![1]!, 'base64').equals(readFileSync(FONT))).toBe(true)
    // 族名也要在 css 里写对——css 里的名字才是 @font-face 真正拿去匹配的那个
    expect(css).toContain(`font-family: '${ICON_FONT_FAMILY}'`)
  })

  it('产物可复现：head.modified == head.created（产物不含生成时刻）', () => {
    // Oracle：源字体是固定发布物，其 created 是常量；生成器把 modified 对齐到 created
    // 之后，产物就**只由「源字体字节 + ICON_CODEPOINTS」决定**，与运行时刻无关。
    // 反向判据：只要 modified ≠ created，就说明有运行时刻被烙进产物 ⇒ 重跑必产生 diff。
    //   实测（修复前）：2092-09-30T01:58:40 vs 02:00:22，两次重跑仅差 4 字节。
    //   实测（修复后）：连续两次 `python3 scripts/generate-icon-subset.py`
    //                   sha256 均为 2e0c977d…582a8（.ttf）/ 8e568487…efce7（.css）。
    //
    // ⚠️ 这条**不能**改成「跑两次生成器比 sha256」：脚本要联网取源字体 + 装 fontTools，
    // CI 未必具备该环境，会把一条真防线降级成一条假绿。判据只锁机制、不跑副作用。
    const ts = readTtfHeadTimestamps(FONT)
    expect(ts, '字体里没有 head 表 ⇒ 无法判定可复现性').not.toBeNull()
    expect(
      ts!.modified,
      'head.modified ≠ head.created ⇒ 产物烙进了生成时刻，重跑生成脚本必然产生 diff，' +
        '"离线生成、提交进仓库"的产物就不可复现。修复：确认 generate-icon-subset.py 的 ' +
        'rename_family() 里保留了 `head.modified = head.created`。',
    ).toBe(ts!.created)
  })

  it('抽取器防空转：i18n locale 确实被扫到了（含已知词条文件与非空下界）', () => {
    // 上一条的 `toEqual([])` 在抽取器扫不到任何文件时**同样成立**。
    // 这里用两条独立证据把它钉住：① 徽标词条所在文件在范围内 ② 文件数有下界。
    const files = [...walkI18nLocales(SRC)].map((f) => relative(SRC, f).split('\\').join('/'))
    expect(
      files,
      'i18n 抽取器扫不到任何文件 ⇒ 上一条的「零泄漏」是空转恒真。' +
        '（首版就是踩了这个：walker 只认名为 locales 的一级目录，从 src/ 起步时' +
        '第一层是 i18n，整目录被跳过，注入真实泄漏实测 15 passed。）',
    ).not.toEqual([])
    expect(files.length, 'i18n locale 文件数低于下界，扫描范围可能又窄了').toBeGreaterThanOrEqual(10)
    expect(files, '徽标词条所在的 zh-CN/misc.ts 不在扫描范围内').toContain('i18n/locales/zh-CN/misc.ts')
  })

  it('i18n locale 值里没有图标位泄漏（FE0E 选择符 / 已登记码点字面量）', () => {
    // 徽标的 ▶︎/⧉ 就是从「i18n 整目录排除」这道缝里活下来的：
    // 它是图标，却藏在文案值里，而按目录排除的门禁根本不看那一行。
    const hits: string[] = []
    let scanned = 0
    for (const file of walkI18nLocales(SRC)) {
      scanned++
      const rel = relative(SRC, file).split('\\').join('/')
      for (const v of scanI18nIconLeak(stripComments(readFileSync(file, 'utf8')), rel)) {
        hits.push(`${v.rule}｜${v.path}:${v.line}｜${v.form}`)
      }
    }
    expect(scanned, '抽取器产出 0 个文件 ⇒ 下面的「零泄漏」是空转恒真').toBeGreaterThanOrEqual(10)
    expect(
      hits,
      'i18n 文案里出现图标位标记。图标必须经 <AppIcon> 渲染：\n' +
        '  ① 出现 U+FE0E 说明该符号默认是彩色 emoji，作者在强制它按文本渲染 —— 这是图标位的标志；\n' +
        '  ② 出现 ICON_CODEPOINTS 登记的码点字面量，说明图标以码点形式塞进了字符串。\n' +
        '  修法：拆成 <AppIcon :name> + 纯文字，i18n 值只留文字。',
    ).toEqual([])
  })

  it('反事实：i18n 值里的图标位形态能被抓住，而行文符号不被误伤', () => {
    const [firstName, firstCp] = mapEntries[0]!
    // 阳性对照 ①：FE0E（徽标历史形态）
    expect(
      scanI18nIconLeak(`const a = { k: '▶${'️'} 动图' }`, 'i18n/locales/zh-CN/misc.ts')
        .map((v) => v.form),
    ).toContain('U+FE0E 文本呈现选择符')
    // 阳性对照 ②：已登记码点字面量
    expect(
      scanI18nIconLeak(`const a = { k: '${String.fromCharCode(firstCp)}' }`, 'i18n/locales/zh-CN/misc.ts')
        .map((v) => v.form),
    ).toContain(`${firstName} U+${firstCp.toString(16)}`)
    // 阴性对照：行文符号一个都不该命中（判据若把它们拦了，修正文案就会变成刷白名单）
    for (const prose of [
      '我的 → 追更列表',
      '✓ 兼容',
      '加载中…',
      '— 完 —',
      '第一章 · 开始',
      '输入…完成（3/8）',
    ]) {
      expect(scanI18nIconLeak(`const a = { k: '${prose}' }`, 'x.ts').map((v) => v.form), prose).toEqual([])
    }
  })

  it('方向 A：映射表每个 name 都能在字体子集 cmap 中找到（缺 ⇒ 静默空白图标）', () => {    const missing = mapEntries.filter(([, cp]) => !cmap.codepoints.has(cp)).map(([n, cp]) => `${n} U+${cp.toString(16)}`)
    expect(missing, `映射表登记了但字体子集没有的字形：\n${missing.join('\n')}`).toEqual([])
  })

  it('方向 B：字体子集每个字形都能在映射表找到（多 ⇒ 浪费体积）', () => {
    const mapped = new Set(mapEntries.map(([, cp]) => cp))
    const orphan = [...cmap.codepoints].filter((cp) => !mapped.has(cp)).map((cp) => `U+${cp.toString(16).toUpperCase()}`)
    expect(orphan, `字体子集里有但映射表未登记的字形：\n${orphan.join('\n')}`).toEqual([])
  })

  it('方向 C：码点与 Material Symbols 官方 codepoints 文件逐字一致（禁自证：不用映射表互证）', () => {
    const wrong = mapEntries
      .filter(([name, cp]) => official.get(name) !== cp)
      .map(([name, cp]) => `${name}: 映射表 U+${cp.toString(16)} ≠ 官方 ${official.has(name) ? `U+${official.get(name)!.toString(16)}` : '(官方文件无此名)'}`)
    expect(wrong, `码点与官方 codepoints 不符：\n${wrong.join('\n')}`).toEqual([])
  })

  it('映射表内码点不重复（同码点登记两个 name = 同一字形两套名字，浪费审计面）', () => {
    const seen = new Map<number, string>()
    const dup: string[] = []
    for (const [name, cp] of mapEntries) {
      const prev = seen.get(cp)
      if (prev) dup.push(`${prev} / ${name} 共用 U+${cp.toString(16)}`)
      else seen.set(cp, name)
    }
    expect(dup).toEqual([])
  })

  it('iconChar：name → 码点 → 字符，未登记 name 显式抛错（禁静默降级为空白）', () => {
    for (const [name, cp] of mapEntries) {
      expect(iconChar(name).codePointAt(0), `${name} 渲染字符与登记码点不符`).toBe(cp)
      expect(isIconGlyph(cp), `${name} 码点 U+${cp.toString(16)} 不在图标区块内`).toBe(true)
    }
    expect(() => iconChar('definitely_not_an_icon')).toThrow(/unknown icon name/)
  })
})

describe('模板裸字形门禁（ADR-0208 复核判据 1）', () => {
  it('抽取器自检：两种书写形态都必须命中（防线有效性）', () => {
    // 形态 A：文本节点
    expect(scanVueGlyphs('<template><text class="x">⌂</text></template>')).toEqual(['U+2302'])
    // 形态 B：属性值（静态 + 绑定表达式内字面量）
    expect(scanVueGlyphs('<template><EmptyState icon="◇" /></template>')).toEqual(['U+25C7'])
    expect(scanVueGlyphs("<template><ActionButton :icon=\"'✓'\" /></template>")).toEqual(['U+2713'])
    // 纯文本 / 类名 / script|style|注释区不得误报
    expect(scanVueGlyphs('<template><text class="text-body">加载中</text></template>')).toEqual([])
    expect(scanVueGlyphs('<script>const x = "⌂"</script><template><text>hi</text></template>')).toEqual([])
    expect(scanVueGlyphs('<style>/* ⌂ */</style><template><text>hi</text></template>')).toEqual([])
  })

  // ⚠️ 这条**不**断言「仓库还剩 N 处违规」——那是把下界写成了整改前的存量数，
  // 整改做完后必然转红，诱导下一个人去改数字或加白名单来「修复」（本仓反复在消灭的假绿）。
  // 扫描器有效性只对**合成 fixture** 断言：真仓库归零是「零容忍」那条的事。
  it('抽取器阳性对照：扫描器仍能命中（防线未随整改一起失效）', () => {
    // 覆盖 iconMap 登记表里真实存在过的字形码点，且两种书写形态各一
    expect(scanVueGlyphs('<template><text class="x">⌂</text></template>')).toContain('U+2302')
    expect(scanVueGlyphs('<template><EmptyState icon="◇" /></template>')).toContain('U+25C7')
    // ⚠️ 下面三条是**区段覆盖的阳性对照**，不是重复断言。
    // `‹ › ≡` 对应 iconMap 的 arrow_back / arrow_forward / list，是已登记图标，
    // 但它们所在的 U+2039–203A、U+2200–22FF 两个区段**曾经不在 GLYPH_BLOCKS 里**
    // ⇒ 零容忍断言对它们是空洞的（扫不到 ⇒ 恒为零）。补上区段后必须钉住，
    // 否则下次有人「精简」GLYPH_BLOCKS 时缺口会无声复活。
    expect(scanVueGlyphs('<template><text>‹</text></template>')).toEqual(['U+2039'])
    expect(scanVueGlyphs("<template><text :icon=\"'›'\" /></template>")).toEqual(['U+203A'])
    expect(scanVueGlyphs('<template><text>≡</text></template>')).toEqual(['U+2261'])
    // 阴性对照：AppIcon 自己的渲染位（走 iconChar 查表）不算裸字形
    expect(scanVueGlyphs('<template><AppIcon name="close" /></template>')).toEqual([])
    // 阴性对照：HTML 注释里的说明文字不算渲染位
    expect(scanVueGlyphs('<template><!-- 历史字形 ⌂ 说明 --><text>hi</text></template>')).toEqual([])
    // 阴性对照：`…`（U+2026）**刻意不覆盖**——它不在 iconMap，按 ADR-0208 收口决策
    // 属行文省略号（"查看更多…"）而非图标位。若日后决定图标化，须先登记进 iconMap
    // 再把它加进 GLYPH_BLOCKS，两步同做才不产生「有字形无映射」的空洞。
    expect(scanVueGlyphs('<template><text>查看更多…</text></template>')).toEqual([])
  })

  it('零容忍：src 下渲染位不得再有任何裸图标字形（unicode 写法不得回流）', () => {
    const detail = [...actual.entries()]
      .map(([rel, glyphs]) => `  ${rel}: ${[...glyphs].sort().join(', ')}`)
      .join('\n')
    expect(actual.size, `以下文件出现裸图标字形（改用 <AppIcon name="...">）：\n${detail}`).toBe(0)
  })

  it('零容忍不是扫描器瞎了：全仓 .vue 数量下界 + AppIcon 自身被扫到过', () => {
    // 证明"零"来自"扫过了且确实为零"，不是"正则塌陷导致的零"。
    // 判据是**被扫描的文件数**（与违规数无关，不会因整改推进而变化），
    // 而不是违规数下界。
    expect(scannedVueFiles.size).toBeGreaterThanOrEqual(50)
    // AppIcon.vue 必须在扫描范围内（否则上面两条都是空转）
    expect(scannedVueFiles.has('components/AppIcon.vue')).toBe(true)
  })
})
