// ─── 作品标题渲染门禁（#893）───
//
// 缺陷形态：Pixiv 对「无标题」作品返回**未本地化的字面串** `"no title"`。任何一处
// 裸插值标题都会把它直接显示给用户，且**违反本仓「UI 文案必须进 i18n 词典」的硬约束**。
//
// 判据：`.vue` 模板里凡是插值**作品/小说标题**的，必须经 `artworkTitle(...)` 归一化出口。
// 本门禁是该修复的**防复发面**——修复只改了当时的 15 处，下一个人新增一个卡片就会复发。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (e.name.endsWith('.vue')) out.push(f)
  }
  return out
}
const VUE = walk(SRC).map((f) => ({ rel: relative(SRC, f).split(sep).join('/'), src: readFileSync(f, 'utf8') }))

/** 去掉注释，避免注释里的示例代码被判红（与既有 .template.test.ts 同口径） */
function stripComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 豁免表：形如 `x.title` 的插值但**不是作品/小说标题**的。
 * 每条都要写明理由——豁免而无理由，等于给门禁开后门。
 */
const EXEMPT: { file: string; pattern: string; why: string }[] = [
  { file: 'components/SeriesSheet.vue', pattern: 'chapter.title', why: '章节名（作品内的第 n 章），与作品标题是两个概念；Pixiv 的无标题哨兵不适用于章节' },
  { file: 'pages/NetworkCheck.vue', pattern: 'c.title', why: '网络自检的**诊断项名称**（本地常量），不是 API 返回的作品标题' },
]

/**
 * 抽候选：模板里**会被渲染出来的**标题文本。
 *
 * ⚠️ 两种形态都要抓，缺一即漏（本门禁第一版就漏了其中一种）：
 *  ① `{{ x.title }}` —— 裸插值，API 哨兵 "no title" 直出给用户。
 *  ② `{ artworkTitle(x.title) }` —— **单花括号**。Vue 模板只有 `{{ }}` 是插值，
 *     单花括号会被当作**普通文本**原样渲染成 `{artworkTitle(x.title)}`。
 *     2026-10-02 真机实测：批量替换时误写单花括号，标题位直接显示该字面串，
 *     而 vue-tsc / vitest / lint / fmt 全绿 ⇒ 只能靠门禁 + 真机发现。
 */
function candidates(src: string): string[] {
  const body = stripComments(src)
  const out: string[] = []
  // ① 裸插值
  for (const m of body.matchAll(/\{\{\s*([^{}]*?\.title)\s*\}\}/g)) {
    const expr = m[1]
    if (expr.includes('artworkTitle(')) continue
    if (/^t\(/.test(expr)) continue // i18n 键插值，是词典键不是数据字段
    out.push(expr)
  }
  // ② 单花括号：双花括号已被上面消费，这里只取「恰好一层」且内含 artworkTitle 的
  for (const m of body.matchAll(/(?<!\{)\{\s*artworkTitle\((.*?)\)\s*\}(?!\})/g)) {
    out.push(`[单花括号] artworkTitle(${m[1]})`)
  }
  return out
}

function violations(): { file: string; expr: string }[] {
  const out: { file: string; expr: string }[] = []
  for (const { rel, src } of VUE) {
    for (const expr of candidates(src)) {
      const ex = EXEMPT.find((e) => e.file === rel && e.pattern === expr)
      if (ex) continue
      out.push({ file: rel, expr })
    }
  }
  return out
}

describe('作品标题必须经 artworkTitle 归一化（#893）', () => {
  it('抽取面非空且含全部渲染点（防抽取器静默塌陷成恒绿）', () => {
    expect(VUE.length).toBeGreaterThanOrEqual(40)
    // 候选抽取器本身必须能命中东西：喂一段已知含裸 title 的合成模板
    const synthetic = '<text>{{ illust.title }}</text>'
    expect(candidates(synthetic)).toEqual(['illust.title'])
    // 已归一化的**双花括号**形态放行（阴性对照）
    expect(candidates('<text>{{ artworkTitle(illust.title) }}</text>')).toEqual([])
    expect(candidates("<text>{{ t('later.title') }}</text>")).toEqual([])
    // 单花括号**必须判红**：它渲染成字面文本（真机实测的缺陷形态）
    expect(candidates('<text>{artworkTitle(illust.title)}</text>')).toEqual([
      '[单花括号] artworkTitle(illust.title)',
    ])
  })

  it('全仓无未归一化的作品/小说标题插值', () => {
    const v = violations()
    expect(
      v,
      `以下插值未走 artworkTitle 归一化，Pixiv 的 "no title" 哨兵会直出给用户：\n` +
        v.map((x) => `  ${x.file} → {{ ${x.expr} }}`).join('\n'),
    ).toEqual([])
  })

  it('阳性对照：判据必须能判红（喂已知违规输入）', () => {
    // 判据内核的判别力：同一个抽取器，对裸插值判红、对归一化形态放行
    expect(candidates('<text>{{ illust.title }}</text>').length).toBe(1)
    expect(candidates('<text>{{ item.title }}</text>').length).toBe(1)
    expect(candidates('<text>{{ hero?.title }}</text>').length).toBe(1)
    // 单花括号形态同样判红（本门禁第一版漏掉的就是这一种）
    expect(candidates('<text>{artworkTitle(item.title)}</text>').length).toBe(1)
    // 豁免表必须真的生效（否则上条「全仓无违规」是假的）
    const exemptSynthetic = { rel: 'components/SeriesSheet.vue', src: '{{ chapter.title }}' }
    expect(candidates(exemptSynthetic.src)).toEqual(['chapter.title'])
  })

  it('豁免表每条都有理由（防止无理由开后门）', () => {
    for (const e of EXEMPT) expect(e.why.length).toBeGreaterThan(10)
  })
})
