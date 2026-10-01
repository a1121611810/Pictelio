// ─── 声明—现状一致性（code review Spec 轴 F1 / Standards 轴 S1 修复）───
//
// 问题：ADR-0212 把「`elevation-1` 余额归零、`elevation-0` 升到 47」写成**完成态陈述**
// 并列为复核判据，而 code review 复核当时的实测是 `elevation-1` 仍有 43 处、
// `elevation-0` 为 **0**（此处的 43 是**复核当时**的快照，不是当前值 —— 当前值只有
// 本文件末尾注释块里那一个带机器可读标记的数字说了算，由下方判据当场复算校验）。
// 下一个人读 ADR 会以为已归零，或照着去补一条必红的门禁。
//
// 本判据只覆盖本轮真实存在的那个缺陷（完成态措辞），不覆盖全部余额口径。
//
// ── 判据形态的教训（本判据自己踩了三次 + 一次自我背叛，登记备查）──
// 自然语言判据是**脆弱面制造机**，三次失败各有一种形态：
// ① **按行扫** → 把解释性引用「『归零』与『漏改』无法区分」误判为完成态（假阳性）；
//    且挂账标记写在**下一行**时转红（假阴性）——跨行分号/续行/引用块都同样错配。
// ② **按段落扫 + 关键词表** → 更糟：ADR 里「为何不升到 low」「初稿算术差已订正」
//    「本条已于 X 订正」三段**已闭合的论证**因不含关键词表里的词而被误判（3 个假阳性）。
//    ⇒ 关键词表越补越漏，永远补不完。
// ③ ⇒ **放弃理解自然语言**，改为**结构化判据**：只检查一个**机器可数、不需理解语义**
//    的事实 —— 「余额声称的实测值」与「本轮实际达成的差值」是否一致。
// ④ **判据自己留了一条散文事实当「唯一事实源」**（本轮 review 发现）：文件末尾写着
//    「实测 43 / 净减 10」，复算命令实跑是 **3** / 净减 **50**。
//    ⇒ 这是 ①②③ 全部规避掉之后**仍然漏掉的那一面**：ADR 侧已机器化，
//    判据侧却把同一事实又抄了一份散文，还自称「唯一事实源」——两个事实源必有一个是假的。
//    修法不是「把散文数字改对」（那只是修好这一次的实例，数字下次照样漂），
//    而是**让散文进入机器管辖**：本文件末尾的实测值由 `parseGateNote()` 解析出来，
//    与复算值当场对撞（见「本文件末尾的复算注释块」那两条）。散文仍在，但不再无人看管。
//
// 期望值出处（Oracle 溯源）：
// - 「完成态声称必须带实测值」= AGENTS.md「精确语义以 ADR/源码为准绳」+ F1 finding；
// - 「实测值必须可复算」= 本文件末尾给出的复算命令，其数字由下方判据解析校验，
//   不再是「写了就没人看」的散文。
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const ADR_PATH = `${REPO}docs/adr/ADR-0212-tonal-elevation-surface-over-shadow.md`
const ADR = readFileSync(ADR_PATH, 'utf8')

/** 生产 .vue 中某 elevation 档的消费处数（未截断计数） */
function countInVue(level: number): number {
  const out = execSync(
    `grep -rhoE 'md-elevation-${level}\\b' --include='*.vue' packages/app-lynx/src | wc -l`,
    { cwd: REPO, encoding: 'utf8' },
  )
  return Number(out.trim())
}

/**
 * 匹配一处机器可读实测标记。
 * 每次调用新建：带 `/g` 的正则自带 `lastIndex`，复用同一实例做多次扫描会串味。
 */
function markerRe(): RegExp {
  return /<!--\s*measured:level-1=(\d+)\s*-->/g
}

interface MarkerFinding {
  /** ADR 中的行号（1 起）；整篇缺标记时为 0 */
  line: number
  /** 标记里写的值；整篇缺标记时为 NaN */
  value: number
  reason: string
}

/**
 * 审计 ADR 里的 level-1 实测标记：**唯一**，且**每一处**都等于实测值。
 *
 * 逐行扫描（而不是文档级 `ADR.match(...)`）有两个原因：
 * ① 文档级 `match` **只取首个匹配** —— ADR-0212 正文写 3、后果章残留一处陈旧的 8，
 *    旧判据永远只看得到 3，于是陈旧标记可以无限期躺着没人发现（review 实测：
 *    门禁 2/2 绿，ADR 第 453 行仍挂着 `measured:level-1=8`）。
 * ② 文档级匹配报不出行号，红了只能让人自己去全文搜。
 */
function auditMarkers(text: string, measured: number): MarkerFinding[] {
  const hits: { line: number; value: number }[] = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(markerRe())) {
      hits.push({ line: i + 1, value: Number(m[1]) })
    }
  })

  if (hits.length === 0) {
    return [
      {
        line: 0,
        value: Number.NaN,
        reason: '缺少机器可读实测标记 <!-- measured:level-1=N -->（无法核对声明与现状）',
      },
    ]
  }

  const findings: MarkerFinding[] = []

  if (hits.length > 1) {
    // 唯一性与取值是**两件事**：即使多处都写对了，多处标记仍然让「该信哪个」无解，
    // 且下一轮实测一变就会立刻出现「哪个是陈旧的」这个歧义。故独立成一条。
    findings.push({
      line: hits[1]!.line,
      value: hits[1]!.value,
      reason:
        `实测标记出现 ${hits.length} 次（第 ${hits.map((h) => h.line).join('、')} 行），必须唯一` +
        ' —— 多处标记里至少有一处是陈旧的，读者无从判断该信哪个',
    })
  }

  for (const h of hits) {
    if (h.value !== measured) {
      findings.push({
        line: h.line,
        value: h.value,
        reason: `标记值 ${h.value} 与真实计数 ${measured} 不符`,
      })
    }
  }

  return findings
}

function fmtFindings(findings: MarkerFinding[]): string {
  return findings.map((f) => `  ADR 第 ${f.line} 行 → ${f.reason}`).join('\n')
}

// ── 本文件末尾「复算命令」注释块（学名：gate note）──
// 散文事实原本无人校验（review 实测：写着 43/净减 10，实跑 3/净减 50）。
// 现在由 `parseGateNote()` 解析并与复算值对撞：数字仍在注释里，但**再漂移就转红**。
const SELF = readFileSync(fileURLToPath(import.meta.url), 'utf8')

interface GateNote {
  /** 注释块声明的当前实测值 */
  current: number
  /** 注释块声明的 HEAD 基线值 */
  baseline: number
  /** 注释块声明的净减值 */
  net: number
}

/**
 * 切出本文件末尾由哨兵定界的复算注释块。
 *
 * ⚠️ 必须用 `lastIndexOf` 而不是 `indexOf`：**本函数自己的源码里就写着哨兵字面量**
 * （`SELF.indexOf('<!-- gate-note:start -->')`），`indexOf` 会先命中代码里的那份，
 * 切出来的「注释块」是几行 TypeScript —— 解析必然失败，表现为
 * 「缺少可解析的复算注释块」。哨兵是成对且唯一的，真块在文件末尾、在函数定义之后。
 */
function gateNoteBlock(): string {
  const start = SELF.lastIndexOf('<!-- gate-note:start -->')
  const end = SELF.lastIndexOf('<!-- gate-note:end -->')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('本文件末尾缺少成对的 gate-note:start / gate-note:end 定界哨兵')
  }
  // ⚠️ 必须按哨兵切片，不能扫全文：本文件的阳性对照夹具里**故意**写着多份
  // `measured:level-1=N` 合成文本，全文扫会把夹具当成注释块的声明。
  return SELF.slice(start, end)
}

function parseGateNote(): GateNote | null {
  const block = gateNoteBlock()
  const hits = [...block.matchAll(markerRe())]
  if (hits.length !== 1) return null
  const baseline = /基线\s*(\d+)/.exec(block)?.[1]
  const net = /净减\s*(\d+)/.exec(block)?.[1]
  if (baseline === undefined || net === undefined) return null
  return { current: Number(hits[0]![1]), baseline: Number(baseline), net: Number(net) }
}

describe('ADR-0212 · 声明与现状不得脱节（结构化判据）', () => {
  it('全文每一处实测标记都必须等于真实计数，且标记唯一', () => {
    const actual = countInVue(1)
    // ⚠️ 只认**机器可读标记** `<!-- measured:level-1=N -->`，不扫散文。
    // 原因：散文里的「53」是 HEAD 基线（合法历史引用），扫散文必然把它误判为
    // 「声称的当前值」——上一版就是这么红的。判据不理解自然语言，
    // 改由 ADR 显式声明哪个数字是「当前实测」，两侧各司其职。
    const findings = auditMarkers(ADR, actual)
    expect(
      findings,
      `ADR 的 level-1 实测标记与现状脱节（实测 ${actual}）：\n${fmtFindings(findings)}`,
    ).toEqual([])
  })

  it('「目标余额 0」类声称必须同段带实测值与未达成标记', () => {
    // 只认一种**结构化形态**：`目标` / `当前` / `实测` 三者出现在同一段落
    const targetBlocks = ADR.split(/\n\s*\n/).filter((b) => /目标.*余额|余额.*目标|余额.*=.*0/.test(b))
    expect(targetBlocks.length, '未找到「目标余额」类声称段落').toBeGreaterThan(0)
    for (const b of targetBlocks) {
      expect(b, `「目标余额」段缺实测值：${b.replace(/\s+/g, ' ').slice(0, 80)}`).toMatch(
        /(当前|实测|尚未|未达成|未满足|解封条件)/,
      )
    }
  })
})

describe('ADR 声明一致性 · 判据自身的判别力（阳性对照：判红能力不足的门禁就是装饰）', () => {
  // ⚠️ 下面三条一律调用**真实判据函数** `auditMarkers`，不另写一个等价实现 ——
  // 上一版纪律（stateLayerOnPrimary.test.ts）：自检用另一套组合函数会把
  // 「.ts 路径的缺口」掩盖成「已覆盖」。

  it('阳性对照 A1：第二处陈旧标记必须被判红（旧判据取首个匹配会放过）', () => {
    // 取自 ADR-0212 整改前的真实形态：正文一处（正确）+ 后果章引用块一处（陈旧）。
    const broken = [
      '# ADR-0212',
      '',
      '当前实测：<!-- measured:level-1=3 -->',
      '',
      '> 实测：<!-- measured:level-1=8 -->',
    ].join('\n')

    // ⭐ 先钉住**旧判据确实看不见**，否则本对照只是在给一个假盲点做演示。
    // 文档级 match 只取首个匹配 ⇒ 值 3 = 实测 3 ⇒ 恒绿。ADR 第 453 行的 8 就是这么活下来的。
    const legacy = broken.match(/<!--\s*measured:level-1=(\d+)\s*-->/)
    expect(legacy, '阳性对照自身失真：旧判据本该匹配到首个标记').not.toBeNull()
    expect(Number(legacy![1]), '阳性对照自身失真：首个标记应恰好等于实测值').toBe(3)

    const findings = auditMarkers(broken, 3)
    expect(findings.length, `两处标记（一处陈旧）必须报 2 条，实得：\n${fmtFindings(findings)}`).toBe(2)
    // ① 不唯一
    expect(findings[0]!.line, '不唯一那条应指向第二处标记所在行').toBe(5)
    expect(findings[0]!.reason).toContain('必须唯一')
    // ② 陈旧值 8 ≠ 实测 3
    expect(findings[1]).toMatchObject({ line: 5, value: 8 })
    expect(findings[1]!.reason).toContain('与真实计数 3 不符')
  })

  it('阳性对照 A2：两处**值都正确**的标记同样判红（唯一性独立于取值）', () => {
    const dup = ['正文 <!-- measured:level-1=3 -->', '附录 <!-- measured:level-1=3 -->'].join('\n')
    const findings = auditMarkers(dup, 3)
    expect(findings.length, '值全对也不许放过重复标记').toBe(1)
    expect(findings[0]!.reason).toContain('必须唯一')
    // 取值侧一条都不该报 ⇒ 证明上条确实是因「不唯一」而红，不是因值不符蹭到的
    expect(findings.filter((f) => f.reason.includes('与真实计数'))).toEqual([])
  })

  it('阳性对照 B（真实仓库注入，不落盘）：把已修掉的那处陈旧标记塞回真实 ADR 必须当场判红', () => {
    // ⭐ 合成对照只证明「正则认得这个形态」；本条把**真实 ADR 文本**（读自磁盘、
    // 未改写）注入一处陈旧标记，判据必须转红 —— 证明它扫的是真 ADR、
    // 且定位到的正是本轮被并行修掉的那一处缺陷。
    // 背景：review 复核时 ADR 后果章残留 `<!-- measured:level-1=8 -->`，而旧判据
    // （文档级 match 取首个匹配）对此**完全无感**、长期恒绿。
    const actual = countInVue(1)
    expect(auditMarkers(ADR, actual), '前置：真实 ADR 当前必须是干净的，否则本对照无意义').toEqual([])

    // 注入锚点只认**标记形态**（本门禁自己的格式），不认 ADR 散文 ——
    // 散文会被并行改写，拿它当锚点会让对照因「措辞变了」而失效（实测踩过：
    // 锚在 `> 实测：` 上时，ADR 后果章被并行改写后本条直接失去对照能力）。
    const injected = ADR.replace(
      /^.*<!--\s*measured:level-1=\d+\s*-->.*$/m,
      (line) => `${line}\n\n> 实测：<!-- measured:level-1=8 -->`,
    )
    expect(injected, '注入失败：真实 ADR 里找不到已有的实测标记行').not.toBe(ADR)

    const findings = auditMarkers(injected, actual)
    expect(findings.length, `注入陈旧标记后必须判红，实得：\n${fmtFindings(findings)}`).toBe(2)
    expect(findings.some((f) => f.reason.includes('必须唯一')), '必须报「不唯一」').toBe(true)
    const stale = findings.find((f) => f.reason.includes('与真实计数'))
    expect(stale, '必须报「陈旧值」').toBeDefined()
    expect(stale!.value).toBe(8)
  })

  it('阴性对照：唯一且取值正确的标记不得误伤（否则假阳性会逼人加白名单掩盖真缺陷）', () => {
    expect(
      auditMarkers('当前实测：<!-- measured:level-1=3 -->\n\n剩余 3 处保留。', 3),
      '唯一 + 取值正确时必须零 findings',
    ).toEqual([])
    // 整篇没有标记 ⇒ 必须报，且理由要指向「缺标记」而不是别的
    expect(auditMarkers('ADR 里通篇没有机器可读标记。', 3)).toMatchObject([
      { line: 0, reason: expect.stringContaining('缺少机器可读实测标记') },
    ])
  })
})

describe('本文件末尾的复算注释块 · 散文事实进入机器管辖（反漂移）', () => {
  it('注释块声明的当前实测值必须等于真实计数', () => {
    const actual = countInVue(1)
    const note = parseGateNote()
    expect(
      note,
      '本文件末尾缺少可解析的复算注释块（需恰好一处 measured:level-1=N 标记 + 基线 N + 净减 N）',
    ).not.toBeNull()
    expect(
      note!.current,
      `本文件末尾注释块声明实测 ${note!.current}，复算实跑 ${actual} —— 散文事实已漂移` +
        '（历史上正是这么写的：注释 43/净减 10，实跑 3/净减 50）',
    ).toBe(actual)
  })

  it('注释块的账目算术必须自洽（基线 − 当前 = 净减）', () => {
    const note = parseGateNote()
    expect(note, '本文件末尾缺少可解析的复算注释块').not.toBeNull()
    expect(note!.baseline, '注释块未解析出 HEAD 基线值').toBeGreaterThanOrEqual(0)
    expect(note!.net, '注释块未解析出净减值').toBeGreaterThanOrEqual(0)
    expect(
      note!.baseline - note!.current,
      `账目算术不自洽：基线 ${note!.baseline} − 当前 ${note!.current} ≠ 净减 ${note!.net}`,
    ).toBe(note!.net)
  })
})

// <!-- gate-note:start -->
// ── 复算命令（可粘贴验证；下方数字由上方两条判据解析校验，不靠人读）──
//   cd <repo> && grep -rhoE 'md-elevation-1\b' --include='*.vue' packages/app-lynx/src | wc -l
// 当前实测：<!-- measured:level-1=3 -->（HEAD 基线 53 ⇒ 净减 50）
//
// ⚠️ 改动本块里的实测值时，三件事必须同时做：① 改这里的数字；② 跑上面那条命令确认；
// ③ 同步 ADR-0212 的 `<!-- measured:level-1=N -->` 标记（ADR 侧同样被门禁双向锁，
// 两处不一致时门禁会点名到行号）。
// <!-- gate-note:end -->
