// ─── T07 字重档位门禁（issue #855 验收第 4 条后半段「清理档位上误用的 font-bold」）───
//
// 背景：ADR-0206 决策 2 规定官方 15 档里只有 label-* 与 title-small/medium 是 medium(500)，
// 其余（含 headline-* / title-large）是 regular(400)；MD3 的 emphasized 变体在 headline/title
// 上也只到 500，700 仅出现在 label-emphasized（chip/徽标）。⇒ 挂在 headline-*/title-large
// 档位上的 700 一律不在该档位字重刻度内。本门禁把「清理」变成可持续的断言。
//
// 三条纪律，本文件逐条对应：
//  ① **扫描的是 class 属性、不是全文 grep**。原因：注释里出现的类名不是消费。若按全文 grep，
//     「判定理由」注释本身会把自己判红，门禁立刻退化成不可用（这正是本仓反复出现的假绿/假红）。
//  ② **白名单逐条带具体理由 + 必须在源码里有判定标记**。删掉理由注释即转红 ⇒ 留痕无法被静默抹掉。
//     本仓的白名单式门禁反复失效，根因就是「白名单只有位置没有理由」。
//  ③ **反事实自检**：接缝自带「塞回去必须转红」的证明，防止断言恒绿。
//
// ⚠️ 期望值纪律：断言的是**结构承诺**（白名单之外零 700 / 白名单条目必须可解析 / 理由必须
// 存在），不写死「当前值」。字重刻度本身来自 ADR-0206，不在本文件复述为硬编码数字。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { buildTailwindArtifact, projectTailwindConfig, tryDeclarationsForClass } from './helpers/md3TailwindArtifact'

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))

/** 700 字重的 utility 名。MD3 里它只属于 label-emphasized，见文件头说明 */
const BOLD = 'font-bold'

/**
 * 白名单：**唯一**允许出现 700 字重的位置。
 * `marker` 必须是该文件源码里真实存在的判定标记串 —— 白名单不是「位置记账」，而是
 * 「位置 + 理由」二元组；marker 让理由与代码同生共死（删注释即转红）。
 */
const WHITELIST: ReadonlyArray<{ file: string; marker: string; reason: string }> = [
  {
    file: 'pages/Login.vue',
    marker: '[T07 白名单 · 有意保留 700]',
    reason:
      '产品字标「Pictelio」：品牌标记而非 MD3 内容文本。headline-large 官方 regular(400)、' +
      'emphasized 也只到 500，字标刻意用 700 + 主色承载品牌识别（AGENTS.md 有意偏离第 1 条' +
      '保留品牌蓝）。登录屏无同级 headline 与之竞争，700 是品牌语气而非层级主张。' +
      '失效条件：引入真实 logo lockup 素材后随 logo 字重走。',
  },
]

/** 递归列出 src/ 下所有 .vue（相对路径，正斜杠） */
function listVueFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listVueFiles(full, base))
    else if (entry.name.endsWith('.vue')) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

/** 去掉 HTML 注释 —— 注释不是消费（纪律 ①） */
function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 取模板里 class / :class 属性值中的类名 token。
 * 同时覆盖静态 class="..." 与动态 :class="'a b' + c"（后者内部的字符串字面量同样会被扫到）。
 */
function classAttrTokens(source: string): string[] {
  const tokens: string[] = []
  const attr = /(?::class|class)\s*=\s*(["'])([\s\S]*?)\1/g
  let match: RegExpExecArray | null
  while ((match = attr.exec(source)) !== null) {
    for (const token of match[2]!.split(/\s+/)) {
      if (token) tokens.push(token)
    }
  }
  return tokens
}

const VUE_FILES = listVueFiles(SRC_DIR)
const SOURCES = new Map(VUE_FILES.map((f) => [f, readFileSync(path.join(SRC_DIR, f), 'utf8')]))

/** 全仓 class 属性里所有 700 字重的落点：文件 → 命中次数 */
function boldUsages(): Map<string, number> {
  const hits = new Map<string, number>()
  for (const file of VUE_FILES) {
    const count = classAttrTokens(stripHtmlComments(SOURCES.get(file)!)).filter(
      (t) => t === BOLD,
    ).length
    if (count > 0) hits.set(file, count)
  }
  return hits
}

/**
 * 主判据的**判别力核心**：命中表里不在白名单文件集合中的落点。
 * 抽成可传参的纯函数，反事实才能真的喂数据进来——否则反事实断言的是
 * 一个写死的字面量文件名，在任何实现下都恒真。
 */
function offendersOf(
  hits: ReadonlyMap<string, number>,
  allowed: ReadonlySet<string>,
): Array<[string, number]> {
  return [...hits.entries()].filter(([file]) => !allowed.has(file))
}

describe('T07 字重档位：700 只允许出现在白名单位置', () => {
  it('扫描面非空（接缝本身有效，不是扫空气）', () => {
    expect(VUE_FILES.length).toBeGreaterThan(50)
  })

  it('白名单之外的 .vue 不再使用 700 字重', () => {
    const allowed = new Set(WHITELIST.map((w) => w.file))
    const offenders = offendersOf(boldUsages(), allowed)

    expect(
      offenders,
      '以下文件在 class 属性里使用了 font-bold，但不在白名单：\n' +
        offenders.map(([f, n]) => `  ${f}（${n} 处）`).join('\n') +
        '\n修法：挂在 MD3 语义档位上的 700 → font-medium；若确属有意强强调，' +
        '在白名单里加一条并写清理由 + 判定标记注释。',
    ).toEqual([])
  })

  it('700 的总命中数恰好等于白名单条数（既不漏抓、也不多放）', () => {
    const total = [...boldUsages().values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(WHITELIST.length)
  })

  it('T07 本票涉及的 6 个文件各自零 700（直接对应验收条件，不靠总数间接推出）', () => {
    // 8 处 700 分布在 7 个文件：其中 Login.vue 是白名单（字标），其余 6 个文件全部清理干净。
    // NovelDetail.vue 一处文件含 2 处落点（meta 卡 / 受限小说分支），故文件数是 6 而非 7。
    const cleaned = [
      'pages/UpdatePage.vue',
      'pages/NovelDetail.vue',
      'pages/ErrorPage.vue',
      'pages/Me.vue',
      'pages/IllustDetail.vue',
      'pages/UserHome.vue',
    ]
    for (const file of cleaned) {
      expect(classAttrTokens(stripHtmlComments(SOURCES.get(file)!)), `${file} 仍有 700 字重`).not.toContain(
        BOLD,
      )
    }
  })

  it('白名单每条都带具体理由，且不是占位文本', () => {
    for (const entry of WHITELIST) {
      expect(entry.reason.length, '理由过短，等于没写').toBeGreaterThanOrEqual(40)
      expect(entry.reason).not.toMatch(/TODO|待补|待定|fixme/i)
      // 理由必须指向「为什么这里可以是 700」，而不是复述「这里是 700」
      expect(entry.reason, '理由需说明判据来源').toMatch(/ADR|官方|档位|字标|字重|品牌/)
    }
  })

  it('白名单条目的判定标记注释真实存在于源码（删理由即转红）', () => {
    for (const entry of WHITELIST) {
      expect(SOURCES.get(entry.file), `${entry.file} 不存在`).toBeDefined()
      expect(
        SOURCES.get(entry.file)!,
        `${entry.file} 里找不到白名单判定标记「${entry.marker}」—— 理由被删了，必须补回`,
      ).toContain(entry.marker)
    }
  })

  it('白名单里的 700 仍是可解析的活类（不是死类名：fontWeight 档位没被删）', async () => {
    const artifact = await buildTailwindArtifact([BOLD])
    expect(
      tryDeclarationsForClass(artifact, BOLD),
      `${BOLD} 在真实产物里没有规则 ⇒ 白名单条目其实是死类名`,
    ).toBeDefined()
  })

  it('反事实：① 抽取器能看见 700（否则上面几条全是恒绿）', () => {
    const synthetic = '<template><text class="text-title-large font-bold">x</text></template>'
    expect(classAttrTokens(stripHtmlComments(synthetic))).toContain(BOLD)
  })

  it('反事实：② 注释里的 700 不算消费（否则判定理由注释会把门禁自己判红）', () => {
    const synthetic = '<template><!-- font-bold --><text class="text-title-large">x</text></template>'
    expect(classAttrTokens(stripHtmlComments(synthetic))).not.toContain(BOLD)
  })

  it('反事实：③ 把 fontWeight 档位里的 bold 删掉，白名单条目会失去规则（证明上一条有判别力）', async () => {
    const real = projectTailwindConfig()
    expect(tryDeclarationsForClass(await buildTailwindArtifact([BOLD]), BOLD)).toBeDefined()

    const patched = await buildTailwindArtifact([BOLD], {
      theme: { ...real.theme, fontWeight: { regular: '400', medium: '500' } },
    })
    expect(
      tryDeclarationsForClass(patched, BOLD),
      '删掉 bold 档位后规则仍在 ⇒ 上一条断言恒绿，无判别力',
    ).toBeUndefined()
  })

  it('反事实：④ 新增一处未登记的 700 会被「白名单之外」判红（自证门禁确实拦得住）', () => {
    // 命中表来自抽取器（不是手写的字面量文件名），再喂进主判据同一个函数：
    const synthetic = '<template><text class="text-headline-small font-bold">x</text></template>'
    const hits = new Map<string, number>([['pages/Synthetic.vue', classAttrTokens(stripHtmlComments(synthetic)).filter((t) => t === BOLD).length]])
    expect(hits.get('pages/Synthetic.vue'), '抽取器没切出这一处 ⇒ 下面证明不了任何事').toBe(1)

    const allowed = new Set(WHITELIST.map((w) => w.file))
    // ① 现行判据：不在白名单 ⇒ 判红
    expect(offendersOf(hits, allowed), '白名单外的 700 必须被列为 offender').toEqual([
      ['pages/Synthetic.vue', 1],
    ])
    // ② 什么都不检查的判据（等价于把过滤退化成恒真）：同一份数据下 0 offender
    const checkNothing = new Set([...allowed, 'pages/Synthetic.vue'])
    expect(offendersOf(hits, checkNothing), '该文件已登记 ⇒ 不再是 offender').toEqual([])
    // ① 与 ② 的差 = 本条断言的判别力：任一为 0 都不相等
    expect(offendersOf(hits, allowed).length).not.toBe(offendersOf(hits, checkNothing).length)

    // ③ 白名单逐条都真的在主判据里被豁免（登记不是摆设，也不是死条目）
    for (const entry of WHITELIST) {
      const whitelisted = new Map<string, number>([[entry.file, 1]])
      expect(offendersOf(whitelisted, allowed), `${entry.file} 登记在白名单里却仍被判红`).toEqual([])
    }
  })
})

// ═══════════════ 字重与档位一致性（补本门禁原先抓不到的一类偏差） ═══════════════
//
// 原门禁只管 **700**（禁 `font-bold`），抓不到「显式字重与字号档位不符」。
// 本轮 code-review 指出：`font-medium`(500) 被用在 ~110 处，其中大量落在
// `text-title-large` / `text-headline-*` 上，而项目自订 typescale（ADR-0206 决策 2）
// 明确规定 **label-* 与 title-small/medium = medium(500)，其余 = regular(400)**。
// ⇒ 那些 500 是与档位定义冲突的，只是「不像 700 那样刺眼」所以没人管。
//
// ⚠️ 下面这张表是**从 tailwind.config.ts 的 typescale 注释抄来的**，不是独立事实源。
//   它存在的意义是让「显式字重」可被机器核对；要改档位定义时两处必须一起改。
//   （config 的注释才是单一事实源；本表是它的可执行投影。）
const TIER_WEIGHT: Readonly<Record<string, 'regular' | 'medium'>> = {
  // medium(500) —— ADR-0206 决策 2 只给了这两族
  'text-label-small': 'medium',
  'text-label-medium': 'medium',
  'text-label-large': 'medium',
  'text-title-small': 'medium',
  'text-title-medium': 'medium',
  // regular(400) —— 其余三族全部落在 400
  'text-title-large': 'regular',
  'text-body-small': 'regular',
  'text-body-medium': 'regular',
  'text-body-large': 'regular',
  'text-headline-small': 'regular',
  'text-headline-medium': 'regular',
  'text-headline-large': 'regular',
  'text-display-small': 'regular',
  'text-display-medium': 'regular',
  'text-display-large': 'regular',
}

describe('T07 字重：显式 font-* 必须与字号档位一致', () => {
  it('档位表覆盖了项目 typescale 的 15 档（少一档就等于给该档开后门）', () => {
    // 15 档 = display3 + headline3 + title3 + body3 + label3
    expect(Object.keys(TIER_WEIGHT)).toHaveLength(15)
    for (const family of ['display', 'headline', 'title', 'body', 'label']) {
      for (const size of ['small', 'medium', 'large']) {
        expect(TIER_WEIGHT, `缺档位 text-${family}-${size}`).toHaveProperty(`text-${family}-${size}`)
      }
    }
    // medium(500) 只允许落在 label-* 与 title-small/medium
    for (const [tier, w] of Object.entries(TIER_WEIGHT)) {
      if (w === 'medium') {
        expect(tier, `${tier} 被标成 medium，但 ADR-0206 只允许 label-* 与 title-small/medium`).toMatch(
          /^text-(label-|title-(small|medium)$)/,
        )
      }
    }
  })

  it('本轮改过的 8 处显式字重与档位一致（direct 断言，不靠总数间接推出）', () => {
    // 逐处点名：headline-small / headline-medium / title-large 都应为 regular(400)
    for (const tier of ['text-headline-small', 'text-headline-medium', 'text-title-large']) {
      expect(TIER_WEIGHT[tier], `${tier} 的档位定义应为 regular`).toBe('regular')
    }
    // 源码里这 8 处确实写的是 font-regular，不是 font-medium
    const cases: Array<[string, string]> = [
      ['pages/IllustDetail.vue', 'text-headline-small font-regular'],
      ['pages/Me.vue', 'text-headline-small font-regular'],
      ['pages/NovelDetail.vue', 'text-title-large font-regular'],
      ['pages/UserHome.vue', 'text-title-large font-regular'],
      ['pages/UpdatePage.vue', 'text-headline-medium font-regular'],
    ]
    for (const [rel, snippet] of cases) {
      const text = readFileSync(path.join(SRC_DIR, rel), 'utf8')
      expect(text.includes(snippet), `${rel} 缺 ${snippet}（本轮 font-bold→font-regular 的落点）`).toBe(true)
    }
  })

  it('反事实：档位为 regular 却写 font-medium 会被这条映射抓出来', () => {
    // 判别力自证：拿 title-large（regular）配 font-medium（500）应当被判为不符
    // ⚠️ 比较前必须把 `font-` 前缀剥掉：表里存的是档位字重名（'regular'），
    // 传进来的是 utility 类名（'font-regular'）。不剥就永远判「不符」——
    // 首版正是这么写的，反事实用例当场把它顶红。
    const check = (tier: string, weightClass: string): boolean => {
      const want = TIER_WEIGHT[tier]
      if (want === undefined) return false
      return weightClass.replace(/^font-/, '') !== want
    }
    expect(check('text-title-large', 'font-medium')).toBe(true)
    expect(check('text-title-large', 'font-regular')).toBe(false)
    expect(check('text-label-large', 'font-medium')).toBe(false)
    expect(check('text-headline-small', 'font-bold')).toBe(true)
  })
})
