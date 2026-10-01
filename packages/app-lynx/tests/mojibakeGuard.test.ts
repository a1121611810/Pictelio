// ─── U+FFFD（Unicode 替换字符）守门 · mojibake guard ───
//
// 起因：某次对 Vue 模板的**批量正则编辑**静默腐化了一个源文件 ——
// `src/pages/IllustDetail.vue` 的注释里留下 2 个 U+FFFD（`切<U+FFFD><U+FFFD>沉浸`，
// 本应是「切换沉浸」）。U+FFFD 是「这里原本有个字符但解码失败」的标记：
// 它是**合法 UTF-8 序列**，所以编译器、类型检查、构建、单测**全部照常通过**
// （实测：`vue-tsc` 干净、3360 个测试全绿、构建成功）。
//
// ⇒ 结论：这个缺陷类别**不产生任何既有信号**，必须自己长一个门禁。
// 它最阴的地方不是「查不到」，而是**任何常规验证都显示绿灯** —— 一条
// 「查不到 ⇒ 不存在」的推断在这里必然成立，且永远成立。
//
// ── 为什么按「行 + 原文」点名，而不是只报「某文件有 N 处」──
// 只报文件名的话，定位成本是「打开文件全文搜 U+FFFD」，而 U+FFFD 在编辑器里
// 常常**渲染成一个空心方框或直接不可见**，肉眼扫过去极易漏掉。
// 报出行号 + 该行截断原文，才能让人一眼看到「哪个字烂了」。
//
// ── 扫描范围（刻意不含 docs/**）──
// 只扫**构建真正会打包的源码**：`app-lynx/{src,tests,scripts}` + `android-host/**`。
// 排除 `docs/**` 是因为有并行会话正在编辑它，半成品状态会让本门禁随机变红 ——
// 那是**噪声不是信号**，而噪声会诱导人加白名单，白名单会掩盖真缺陷。
//
// ── 登记豁免（存量）──
// 下面 3 个文件在本轮之前就已含 U+FFFD，且**都不在本票的写入范围内**
// （并行会话正在编辑它们；本票禁止越界修改他人文件）。故逐条登记
// 「路径 + 允许条数 + 理由 + 原文证据」。规则与本仓既有的
// `hardcode-whitelist-colors.json` 完全同构。
// 依据 AGENTS.md「门禁冻结线」第 5 条（假绿比没门禁更糟）——豁免必须**显式登记**，
// 不能靠「忽略这个文件」实现，那等于把门禁关掉。
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * U+FFFD REPLACEMENT CHARACTER。
 * ⚠️ 必须写成转义而非字面量：本文件自身在扫描面内（`packages/app-lynx/tests/**`），
 * 一旦源码里出现真的 U+FFFD，本门禁会把自己判红。
 */
const FFFD = '\uFFFD'

/** 扫描根（相对仓库根）。刻意不含 `docs/**`，理由见文件头。 */
const SCAN_ROOTS = [
  'packages/app-lynx/src',
  'packages/app-lynx/tests',
  'packages/app-lynx/scripts',
  'packages/android-host',
]

/** 参与扫描的文本类型（构建会打包 / 会跑到的源码与资源） */
const SCAN_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.java',
  '.kt',
  '.kts',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.gradle',
  '.properties',
  '.pro',
  '.sh',
  '.bash',
  '.py',
  '.bat',
  '.txt',
  '.md',
])

/** 跳过：构建产物、依赖目录、IDE 目录、CodeGraph 索引（均非手写源码） */
const SKIP_DIR = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.codegraph',
  '.idea',
  '.gradle',
  '.kotlin',
  'fastlane',
])

// ────────────────────────── 登记豁免（存量 U+FFFD）──────────────────────────
// Oracle 溯源（测试硬约束 #6）：下面的条数**不是**本文件扫描器的输出回填，
// 而是逐处打开原文件读那一行原文点算出来的，`evidence` 字段即当时的原文
// （U+FFFD 以 `<FFFD>` 标注）。⇒ 复核者**不运行本门禁**也能核对每一条。
const REGISTERED: { path: string; count: number; reason: string; evidence: string }[] = [
  {
    path: 'packages/app-lynx/tests/md3ConfigTokens.test.ts',
    count: 2,
    reason:
      '存量：门禁自身的注释分隔线里「违规定??收集器」的两个全角括号，在一次批量正则编辑中被截断成 U+FFFD。' +
      '位于 `//` 注释内，不参与任何判据逻辑；但该文件被并行会话编辑，本票禁止越界修改，故登记而非顺手修。',
    evidence: '// ══ 违规定<FFFD><FFFD>收集器（供真配置与反事实共用同一套判据） ══',
  },
  {
    path: 'packages/app-lynx/tests/md3FilledTextField.test.ts',
    count: 3,
    reason:
      '存量：注释里紧跟 `1dp = 0.2667vw` 之后的 3 个字符（原本是一个破折号/箭头类符号）被批量编辑截断成 U+FFFD。' +
      '位于 `//` 注释内。同样因并行编辑而登记。',
    evidence: '// （docs/adr/glossary-lynx-units.md：1dp = 0.2667vw）<FFFD><FFFD><FFFD>形状档位名只认 `--md-shape-*`',
  },
  {
    path: 'packages/app-lynx/scripts/lynx-router-back-regression.sh',
    count: 1,
    reason:
      '存量：注释里引用的 shell 报错原文 `"OUT_DIR`: unbound variable"` 中，包裹 $OUT_DIR 的**反引号**' +
      '被截断成 U+FFFD。位于 `#` 注释内，不影响脚本执行；该脚本不在本票写入范围，故登记。',
    evidence: '#（实测 `$OUT_DIR（` 报 "OUT_DIR<FFFD>: unbound variable"）→ 强制 C locale；',
  },
]

/**
 * 登记豁免的**总量上限**。
 * ⚠️ 不得为了「让门禁变绿」而随手上调 —— 加白名单就是**把门禁关掉**（门禁冻结线第 5 条）。
 * 6 = 上面三条的存量合计（2+3+1），即本轮开始时**实际点算**出来的数字。
 * 确有正当理由要加时，必须先解释「为什么这些存量必须留着、修它们的代价是什么」。
 */
const MAX_REGISTERED_TOTAL = 6

// ────────────────────────────── 判据（纯函数）──────────────────────────────

interface Hit {
  /** 1 起的行号 */
  line: number
  /** 该行截断后的原文（U+FFFD 原样保留，便于肉眼定位） */
  text: string
  /** 该行的 U+FFFD 个数 */
  count: number
}

/** 数一行里的 U+FFFD 个数（不用 `split` 技巧：可读性优先） */
function countFffd(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === FFFD) n += 1
  }
  return n
}

/** 逐行找出所有含 U+FFFD 的行。纯函数 —— 阳性对照直接喂合成字符串。 */
function scanText(text: string): Hit[] {
  const out: Hit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const count = countFffd(lines[i]!)
    if (count > 0) {
      out.push({ line: i + 1, text: lines[i]!.trim().slice(0, 90), count })
    }
  }
  return out
}

/** 把仓库相对路径统一成 posix 分隔符（Windows/macOS 上都得到同一个 key） */
function repoPath(abs: string): string {
  return relative(REPO, abs).split(sep).join('/')
}

interface Occurrence extends Hit {
  path: string
}

/** 扫描「路径 + 文本」条目流。抽出来是为了让阳性对照能喂**真实文件**的内存副本。 */
function scanFiles(entries: { path: string; text: string }[]): Occurrence[] {
  const out: Occurrence[] = []
  for (const e of entries) {
    for (const hit of scanText(e.text)) {
      out.push({ ...hit, path: e.path })
    }
  }
  return out
}

/** 遍历全部扫描根，收集「路径 + 文本」条目。 */
function collectEntries(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      // ⚠️ 只跟随真实文件/目录：符号链接按不处理跳过，避免扫到仓库外或成环。
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) walk(abs)
        continue
      }
      if (!entry.isFile() || !SCAN_EXT.has(extname(entry.name))) continue
      const buf = readFileSync(abs)
      // 跳过二进制（含 NUL 字节）：按 utf8 解会造出假的 U+FFFD
      if (buf.includes(0)) continue
      out.push({ path: repoPath(abs), text: buf.toString('utf8') })
    }
  }
  for (const root of SCAN_ROOTS) walk(join(REPO, root))
  return out
}

const ENTRIES = collectEntries()
const OCCURRENCES = scanFiles(ENTRIES)

function fmt(occ: Occurrence): string {
  return `  ${occ.path}:${occ.line} （${occ.count} 个）${occ.text}`
}

const registeredTotal = REGISTERED.reduce((s, r) => s + r.count, 0)

describe('U+FFFD 守门 · 检测器判别力自检（阳性/阴性对照：扫不到 ≠ 不存在）', () => {
  // ⚠️ 「0 违规」与「判据压根没在工作」在 toEqual([]) 上完全同形。
  // 没有这两条，本文件的绿灯**不携带任何信息**。

  it('阳性对照：合成脏文本必须被逐行点名（行号 + 原文 + 个数）', () => {
    const dirty = [
      'const a = 1',
      '// 切换沉浸：走状态机',
      `const t = '坏${FFFD}字${FFFD}'`,
      'const z = 2',
    ].join('\n')
    // 行号必须算对 —— 报错信息里行号是唯一定位手段，算错就等于没有。
    expect(scanText(dirty)).toEqual([{ line: 3, text: `const t = '坏${FFFD}字${FFFD}'`, count: 2 }])
  })

  it('阳性对照：单个 U+FFFD 也必须被抓（防「只抓连续 ≥2 个」的漏网形态）', () => {
    // 真实事故 `切<U+FFFD><U+FFFD>沉浸` 是连续 2 个；若判据写成 /\uFFFD{2,}/ 就会漏掉单点腐化。
    expect(scanText(`a${FFFD}b`)).toEqual([{ line: 1, text: `a${FFFD}b`, count: 1 }])
  })

  it('阴性对照：干净中文 / 形近字符不得误伤（否则假阳性会逼人加白名单）', () => {
    const clean = [
      '// 切换沉浸：应用内 chrome 走状态机，系统栏走宿主桥',
      "const 名字 = '替换字符测试'",
      '// ── 破折号 —— 与 → 箭头 · 间隔号 · 全角括号（）· 中文引号「」',
      '// emoji 🎨 与组合字符 é 与零宽 U+200B',
    ].join('\n')
    expect(
      scanText(clean),
      '阴性对照被误伤：干净中文被当成腐化 ⇒ 判据过宽，会诱发白名单泛滥',
    ).toEqual([])
  })

  it('检测器在本仓真实扫描面上确实在遍历（读到的文件数与覆盖目录）', () => {
    // 这一条断言的是**遍历与读取链路活着**，与「仓库现在脏不脏」无关。
    // ⚠️ 刻意**不**断言「扫描面里有命中」——那等于把「当前存量」当成判据自检，
    // 一旦整改完成就必然转红，诱导下一个人去加白名单（本仓反复在消灭的假绿）。
    // liveness 由「读到了 N 个文件」证明；判别力由上面的合成对照 + 下面的真实文件注入对照证明。
    expect(
      ENTRIES.length,
      '扫描面读到的文件数异常少 ⇒ 扫描根 / 扩展名白名单配错，判据处于恒绿状态',
    ).toBeGreaterThan(500)
    for (const root of SCAN_ROOTS) {
      expect(
        ENTRIES.some((e) => e.path.startsWith(`${root}/`)),
        `扫描根 ${root} 一个文件都没读到 ⇒ 该根配错（路径拼写 / 被 SKIP_DIR 整根跳过）`,
      ).toBe(true)
    }
  })

  it('阳性对照 B（真实文件注入，不落盘）：把已修掉的那处 U+FFFD 塞回真实 IllustDetail.vue 必须当场判红', () => {
    // ⭐ 合成对照只证明「正则认得这个形态」；本条读**磁盘上的真实文件**、
    // 在内存里注入 U+FFFD，走**同一条** `scanFiles` 链路 —— 证明它扫的是真文件、
    // 且行号定位落在真实位置。
    //
    // 背景：本票要抓的正是 `src/pages/IllustDetail.vue` 注释里的
    // `切<U+FFFD><U+FFFD>沉浸`。该行已由并行会话在 22:28 修好，
    // ⇒ 「等它变红」已不可能，必须用注入把判别力**当场证明**出来，
    // 否则这条门禁在本轮交付时就是一条从未被证伪过的恒绿断言。
    const rel = 'packages/app-lynx/src/pages/IllustDetail.vue'
    const real = ENTRIES.find((e) => e.path === rel)
    expect(real, `读不到 ${rel} ⇒ 扫描面没覆盖事故文件`).toBeDefined()
    expect(
      (real!.text.match(/\uFFFD/g) ?? []).length,
      '前置：该文件当前必须是干净的（若已含 U+FFFD，零容忍面那条会先转红，本对照就失去意义）',
    ).toBe(0)

    // 复原事故形态。⚠️ 注入点用**固定行号**而不是「按散文内容找那一行」——
    // 该文件归并行会话所有，散文会被改写，拿措辞当锚点会让本对照某天静默失去对照能力
    // （ADR 那条门禁已经踩过一次这个坑：锚在 `> 实测：` 上，段落被改写后对照直接失效）。
    const lines = real!.text.split('\n')
    const at = 9
    expect(lines.length, '真实文件短于注入点，锚点失效').toBeGreaterThan(at)
    const injected = lines.map((l, i) =>
      i === at ? `/** 切${FFFD}${FFFD}沉浸：应用内 chrome 走状态机 */` : l,
    ).join('\n')

    const found = scanFiles([{ path: rel, text: injected }])
    expect(found.length, '注入的 2 个 U+FFFD 必须被整条链路抓到').toBe(1)
    expect(found[0]).toMatchObject({ path: rel, line: at + 1, count: 2 })
    expect(found[0]!.text).toContain(FFFD)

    // ⭐ 判别链的**最后一环**：抓到还不够，必须证明它会**真的落到零容忍面那条断言里**。
    // `offenders()` 只过滤豁免表内的路径 ⇒ 事故文件若在豁免表内，这条注入就只会
    // 验到「检测器认识这个字符」，而门禁仍然不会红 —— 那正是要防的假绿。
    expect(
      REGISTERED_PATHS.has(rel),
      '事故文件竟在登记豁免表内 ⇒ 它是被有意豁免的，零容忍面对它无效，判红证明不成立',
    ).toBe(false)
    expect(
      scanFiles([{ path: rel, text: injected }]).filter((o) => !REGISTERED_PATHS.has(o.path)),
      '注入的 U+FFFD 必须落进 offenders()，即零容忍面会当场转红',
    ).toHaveLength(1)
  })
})

const REGISTERED_PATHS = new Set(REGISTERED.map((r) => r.path))

/** 未登记（= 不在豁免表内）的全部 U+FFFD */
function offenders(): Occurrence[] {
  return OCCURRENCES.filter((o) => !REGISTERED_PATHS.has(o.path))
}

/**
 * 零容忍面的失败文案。
 * ⚠️ 抽成函数是为了能被单测断言 —— `expect(x, '')` 在判红时**不输出任何上下文**，
 * 那等于红得没有信息；而「文案里必须点名文件 / 行号 / 原文」本身是本票的验收条件之一。
 */
function reportLines(offs: Occurrence[]): string {
  return [
    `检测到 ${offs.length} 行未登记的 U+FFFD 替换字符（源码腐化）。`,
    'U+FFFD 是「此处原有字符但解码失败」的标记：它对编译器 / 类型检查 / 构建 / 全部单测**完全隐形**，',
    '所以只能靠本门禁。逐处如下：',
    ...offs.map(fmt),
    '',
    '处置：把该处 U+FFFD 还原成原字符（多半是批量正则编辑把某个符号截断了）。',
    '若确属有意保留的存量腐化，按豁免表的同构格式**显式登记**（路径 + 条数 + 理由 + 原文），',
    '不要改本判据，也不要把文件加进忽略列表。',
  ].join('\n')
}

describe('U+FFFD 守门 · 零容忍面', () => {
  it('未登记文件出现 U+FFFD 即失败（点名文件 / 行号 / 原文）', () => {
    const offs = offenders()
    expect(offs, offs.length === 0 ? '' : reportLines(offs)).toEqual([])
  })

  it('失败文案必须点名文件、行号与 offending 原文（判红时不给上下文等于没给）', () => {
    const sample: Occurrence[] = [
      { path: 'packages/app-lynx/src/pages/IllustDetail.vue', line: 117, count: 2, text: `切${FFFD}${FFFD}沉浸` },
    ]
    const msg = reportLines(sample)
    expect(msg, '文案必须含文件路径').toContain('packages/app-lynx/src/pages/IllustDetail.vue')
    expect(msg, '文案必须含行号').toContain(':117')
    expect(msg, '文案必须含 offending 原文').toContain(`切${FFFD}${FFFD}沉浸`)
    expect(msg, '文案必须给出处数').toContain('1 行')
  })

  it('已登记豁免文件不得超出登记条数', () => {
    const over: string[] = []
    for (const r of REGISTERED) {
      const actual = OCCURRENCES.filter((o) => o.path === r.path).reduce((s, o) => s + o.count, 0)
      if (actual > r.count) {
        over.push(
          `  ${r.path}：实际 ${actual} 个 > 登记 ${r.count} 个\n` +
            OCCURRENCES.filter((o) => o.path === r.path)
              .map(fmt)
              .join('\n'),
        )
      }
    }
    expect(
      over,
      over.length === 0
        ? ''
        : `已登记豁免文件新增了 U+FFFD —— 豁免只覆盖「登记时那几处」，不是给整个文件开绿灯：\n${over.join('\n')}`,
    ).toEqual([])
  })

  it('登记豁免不得失效（不得留永不匹配的空条目）', () => {
    // 文件被删/改名后，豁免条目会变成永远匹配不到的空壳 —— 那正是「门禁看着在、其实没在管」的状态。
    const seen = new Set(OCCURRENCES.map((o) => o.path))
    const dead = REGISTERED.filter((r) => !seen.has(r.path)).map((r) => `  ${r.path}`)
    expect(
      dead,
      dead.length === 0
        ? ''
        : `登记豁免已失效（对应文件已不存在或已无 U+FFFD）——请删除该条目，别让它变成空壳：\n${dead.join('\n')}`,
    ).toEqual([])
  })

  it('豁免总量不得超过上限（防止「用加白名单的方式让门禁变绿」）', () => {
    expect(
      registeredTotal,
      `登记豁免合计 ${registeredTotal} > 上限 ${MAX_REGISTERED_TOTAL}。` +
        '加白名单就是关门禁 —— 要上调必须先解释「这些存量为什么必须留着」。',
    ).toBeLessThanOrEqual(MAX_REGISTERED_TOTAL)
  })
})
