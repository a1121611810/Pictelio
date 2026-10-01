// ─── 图标「守恒」门禁：登记的 name 必须有消费点（ADR-0208 决策 2 的第三条）───
//
// 锁的真实缺陷：iconMap 登记了字形却没人用，代码照跑、门禁全绿、字体白占体积，
// 而「这个图标到底在哪」无人可查。本轮实到的三例：content_copy（手绘复制图标没替换）、
// play_arrow / photo_library（注释谎称「随 i18n 字典进文案」，实际字典用的是 U+25B6/U+29C9）。
// 零消费是**静默**的：只有把「登记 ⇒ 消费」这条守恒律写成断言，它才可能判红。
//
// 与 tests/iconMap.test.ts 的分工：那条验「映射 ↔ 字体子集 ↔ 官方码点」三个方向，
// 本条验「映射 ↔ 消费点」——两个方向都要判红（只查双向 cmap 会漏掉「登记了但没人用」）。
//
// 抽取器纪律（防空转恒真）：全称断言前先断言候选文件数下界 + 阳性/阴性对照，
// 否则目录塌陷就会让「零违规」恒真（本仓反复在消灭的假绿）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_CODEPOINTS } from '../src/utils/iconMap'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ICON_MAP_REL = 'utils/iconMap.ts'

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(vue|ts)$/.test(entry) && !/\.test\.ts$/.test(entry)) yield p
  }
}

/**
 * 「可能消费图标名」的文件 = 渲染 `<AppIcon>` 的 .vue，或声明/使用 `IconName` 类型的 .ts/.vue。
 *
 * 为什么要这层过滤：名字是普通英文单词（`list` / `search` / `home`），不加过滤地全仓搜
 * 会把 `api/queryKeys.ts` 的 queryKey、i18n 文案等一并算成「消费点」——那样的门禁是假绿：
 * 它会为真阳性（查无消费）放行。收窄到「渲染图标 / 声明图标类型」的文件后，命中即真消费。
 *
 * 代价（须知）：若日后出现「纯数据对象里的字面量图标名、且该文件既不渲染 <AppIcon>
 * 也不提 IconName」，本门禁会误报。误报方向是**转红**，符合本仓偏好（宁可拦住，不可放过）；
 * 解法是给该文件补上 `IconName` 类型（本来就该补）。
 */
const CANDIDATES = [...walk(SRC)]
  .map((p) => ({ rel: relative(SRC, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }))
  // i18n 字典里的同名字符串是文案不是图标绑定（与 iconMap.test.ts 的排除同理由）
  .filter(({ rel }) => !rel.startsWith('i18n/') && rel !== ICON_MAP_REL)
  // 资格判定用**原文**（提到 <AppIcon>/IconName 就当候选，取超集 ⇒ 少误报）；
  // 实际匹配用**剥注释后**的代码——注释里写 `name="content_copy"` 是说明不是消费，
  // 这条已实跑过反事实：漏剥注释时，把缺陷形态塞回去本门禁不会转红（假绿）。
  .filter(({ text }) => text.includes('<AppIcon') || text.includes('IconName'))

/** rel → 剥注释后的代码（一次算完：N 个 name × M 个文件不必重复读盘） */
const CODE = new Map(
  CANDIDATES.map(({ rel, text }) => [
    rel,
    text
      // HTML 注释 + 块注释/JSDoc + 行注释（与 iconMap.test.ts 的抽取器同款）
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  ]),
)

/** name 作为**带引号字面量**出现才算消费点（裸单词不算：`list` 满仓都是） */
const NAMES = Object.keys(ICON_CODEPOINTS)
const QUOTE = `'${'"'}${String.fromCharCode(96)}` // 单引号 / 双引号 / 反引号
function isQuotedLiteral(text: string, name: string): boolean {
  return new RegExp(`[${QUOTE}]${name}[${QUOTE}]`).test(text)
}
function consumersOf(name: string): string[] {
  return [...CODE.entries()].filter(([, code]) => isQuotedLiteral(code, name)).map(([rel]) => rel)
}

describe('图标守恒：每个登记的 name 至少有一个消费点', () => {
  it('抽取器自检：候选文件数有下界 + 阳性/阴性对照（防空转恒真）', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(20)
    expect(CODE.size, '候选消费文件塌陷 ⇒ 本门禁恒真').toBeGreaterThanOrEqual(10)
    // 阳性对照：真实消费点确实被认出来（AppIcon 渲染位 + IconName 声明的数据源）
    expect(consumersOf('content_copy')).toContain('components/TextSelectionToolbar.vue')
    expect(consumersOf('play_arrow')).toContain('components/IllustTypeBadgeRow.vue')
    // 阴性对照：未登记的名字查不到（否则抽取器对任何字符串都返回非空）
    expect(consumersOf('definitely_not_an_icon')).toEqual([])
    // 阴性对照：裸单词不算消费点 —— 合成样本证明抽取器确实要求引号
    expect(isQuotedLiteral('const icons = [list, home]', 'list')).toBe(false)
    expect(isQuotedLiteral("const icons = { icon: 'list' }", 'list')).toBe(true)
  })

  it('零容忍：不存在「登记了却零消费」的 name（删登记要连带删消费，同理反之）', () => {
    const orphans = Object.entries(ICON_CODEPOINTS)
      .filter(([name]) => consumersOf(name).length === 0)
      .map(([name, cp]) => `${name} U+${cp.toString(16)}`)
    expect(
      orphans,
      `以下 name 登记在 ICON_CODEPOINTS 却无任何消费点（删掉它，或把它真正用上）：\n${orphans.join('\n')}\n` +
        '注意：删 name 会改变字体子集 ⇒ 须重跑 python3 scripts/generate-icon-subset.py，' +
        '并同步 tests/fixtures 与 icon-font.css。',
    ).toEqual([])
  })
})
