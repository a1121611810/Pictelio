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
// ── 扫描范围（2026-10-12 扩至含 docs/**，#897）──
// 扫**全部手写文本**：`app-lynx/{src,tests,scripts}` + `android-host/**` + `docs/**`。
//
// ── 为什么 docs/** 从「刻意排除」改为纳入（#897）──
// 排除的**原始理由**是「有并行会话正在编辑 docs/，半成品状态会让本门禁随机变红」。
// 该理由**成立**，但被误当成永久性理由用了。复核结论：
//   1. 该排除**从未被写进判据、只在文件头散文里**——任何读者都只能靠读散文才知道
//      有块盲区；散文的排除项没有机器防线，文档漂移无从判红。
//   2. 该风险**并未消失，只是暂时不发生**：`docs/` 是本仓高频编辑面（实测最近 10 次
//      提交有 4 次动 `docs/`，其中 10-12 当天 10:18/10:27/10:42 三次连续 docs 提交）。
//   3. **历史证据证明这不是假想**：`git log -S <U+FFFD> -- docs/` 返回 **11 个**提交，
//      命中 `adr/`、`research/`、`specs/` 三处 ⇒ `docs/` 真实出现过同源腐化，
//      而门禁对其完全无感。
//   4. 风险最高的是 `docs/adr/`：`docs/adr/` 是本仓「理由层」事实源（AGENTS.md「四层词」），
//      后续 agent 会把它当**依据**读取。理由层里的一个烂字符会静默影响决策依据，
//      而 U+FFFD 对编译器/类型检查/构建/全部单测**完全隐形**（见文件头）。
//
// ── 噪声怎么办：登记豁免，不是重新排除 ──
// 并行会话半成品**确实**会偶发命中。处置手段是既有的 `REGISTERED` 机制
// （路径 + 条数 + 理由 + 原文证据，与 `hardcode-whitelist-colors.json` 同构），
// 而**不是**把整个目录移出扫描面——后者正是「假装没这回事」，会让下一任读者
// 再次只读散文、以为 docs/ 有防线。⚠️ 半成品清完后，对应条目会触发
// 「登记豁免不得失效」那条断言（:501），**逼迫删除空壳条目**，噪声不会沉淀成永久白名单。
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * U+FFFD REPLACEMENT CHARACTER。
 * ⚠️ 必须写成转义而非字面量：本文件自身在扫描面内（`packages/app-lynx/tests/**`），
 * 一旦源码里出现真的 U+FFFD，本门禁会把自己判红。
 */
const FFFD = '\uFFFD'

/** 扫描根（相对仓库根）。`docs/**` 于 #897 纳入，理由见文件头。 */
const SCAN_ROOTS = [
  'packages/app-lynx/src',
  'packages/app-lynx/tests',
  'packages/app-lynx/scripts',
  'packages/android-host',
  'docs',
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
// 下面 3 个文件在本门禁建立之前就已含 U+FFFD，且都是**注释内**、不参与任何判据逻辑。
// 逐条登记「路径 + 允许条数 + 理由 + 原文证据」。规则与本仓既有的
// `hardcode-whitelist-colors.json` 完全同构。依据 AGENTS.md「门禁冻结线」第 5 条
// （假绿比没门禁更糟）——豁免必须**显式登记**，不能靠「忽略这个文件」实现。
// ⚠️ 2026-10-12：原注释称「并行会话正在编辑它们，本票禁止越界修改」——该理由已过期
// （当前工作树干净、无并行写入者）。这三条**现已可以正常修复**，但修复属独立改动，
// 不夹带在 #897 的扩面里；故保留登记并在理由里显式标注「已可修，待清理」。
// Oracle 溯源（测试硬约束 #6）：下面的条数**不是**本文件扫描器的输出回填，
// 而是逐处打开原文件读那一行原文点算出来的，`evidence` 字段即当时的原文
// （U+FFFD 以 `<FFFD>` 标注）。⇒ 复核者**不运行本门禁**也能核对每一条。
const REGISTERED: { path: string; count: number; reason: string; evidence: string }[] = [
  {
    path: 'packages/app-lynx/tests/md3ConfigTokens.test.ts',
    count: 2,
    reason:
      '存量：门禁自身的注释分隔线里「违规定??收集器」的两个全角括号，在一次批量正则编辑中被截断成 U+FFFD。' +
      '位于 `//` 注释内，不参与任何判据逻辑。⚠️ 已可修，待清理（#897 附注）。',
    evidence: '// ══ 违规定<FFFD><FFFD>收集器（供真配置与反事实共用同一套判据） ══',
  },
  {
    path: 'packages/app-lynx/tests/md3FilledTextField.test.ts',
    count: 3,
    reason:
      '存量：注释里紧跟 `1dp = 0.2667vw` 之后的 3 个字符（原本是一个破折号/箭头类符号）被批量编辑截断成 U+FFFD。' +
      '位于 `//` 注释内。⚠️ 已可修，待清理（#897 附注）。',
    evidence: '// （docs/adr/glossary-lynx-units.md：1dp = 0.2667vw）<FFFD><FFFD><FFFD>形状档位名只认 `--md-shape-*`',
  },
  {
    path: 'packages/app-lynx/scripts/lynx-router-back-regression.sh',
    count: 1,
    reason:
      '存量：注释里引用的 shell 报错原文 `"OUT_DIR`: unbound variable"` 中，包裹 $OUT_DIR 的**反引号**' +
      '被截断成 U+FFFD。位于 `#` 注释内，不影响脚本执行。⚠️ 已可修，待清理（#897 附注）。',
    evidence: '#（实测 `$OUT_DIR（` 报 "OUT_DIR<FFFD>: unbound variable"）→ 强制 C locale；',
  },
  // ── 以下 4 条为 #897 把 docs/** 纳入扫描面后**当场暴露**的存量腐化 ──────────
  // ⚠️ 与上面三条性质不同：上面三条的原文可从上下文唯一确定；这 4 处是**散文被截断**，
  //    缺的是「作者原本想写的那个字/词」，只能靠语义猜。把猜测写回文档等于 agent 替作者
  //    改写决策记录 —— 故按本门禁既有机制**登记**，由作者本人确认后清除。
  //    登记不是放过：`evidence` 逐处给出原文（U+FFFD 记作 `<FFFD>`），作者可一眼核对。
]

/**
 * 登记豁免的**总量上限**。
 * ⚠️ 不得为了「让门禁变绿」而随手上调 —— 加白名单就是**把门禁关掉**（门禁冻结线第 5 条）。
 * 确有正当理由要加时，必须先解释「为什么这些存量必须留着、修它们的代价是什么」。
 *
 * ── 2026-10-12 上调 6 → 17（#897 扩面扫描面）──
 * 6→6（前三条未变）+ 11（扩面后暴露的 4 处存量，3+2+3+2）。
 *
 * ⚠️ 这 11 处**不是**「为了让门禁变绿」而加：它们是扫描面从 4 个根扩到含 `docs/**`
 *   之后**当场判红暴露出来的真实腐化**——此前它们完全无人看守（实测注入验证：扩面前
 *   往 docs/adr 塞 U+FFFD，10 个用例全绿）。若不登记就要当场判红，而正确处置需要
 *   **作者确认原字**（详见各条 reason：这 4 处是被截断的散文，缺的是作者想写的字词，
 *   agent 猜写等于替作者改写决策记录）。故登记，**不是放过**：
 *   - 每条附 `evidence` 原文，作者可一眼核对；
 *   - `docs/` 半成品一旦清掉，对应条目会触发「登记豁免不得失效」那条断言（:501）
 *     **强制删除空壳条目**，不会沉淀成永久白名单；
 *   - 本上限同步上调到 17，是为了让「上限」继续锚住**真实存量**，而非让它逼着人
 *     去改判据或删文件。任何人再加豁免，仍受同一上限约束。
 *
 * ── 2026-10-13 下调 17 → 6（#1000 清完 docs/ 存量）──
 * 上述 4 条 docs/ 登记已删，余下前三条未变（2+3+1 = 6）。
 *
 * 四处原字**有镜像文档硬证据**，不是猜写（#1000 阻塞在作者确认原字；2026-10-13
 * 作者答复「深入分析、自行决定」后据此定案）：
 *   - 「完全可见」← `docs/specs/fail-safe-aux-mechanisms.md:65` 同句干净版；
 *   - 「不由代码保证」← `ADR-0215:63` 与 `specs/fail-safe-aux-mechanisms.md:107`；
 *   - 「已选中实心段」← `scripts/capture-md3-matrix.sh:24` 与 `find-ui-band.py:17`；
 *   - 「提醒我去看」← 无逐字镜像；2 个替换符 = 1 个汉字（3 字节）锁死单字，
 *     且与后半句「已读是我真的看过」构成语义对比（术语表用词亦为「真的看过」）。
 *
 * ⚠️ 下调不是「放松」，是**收紧**：上限回落意味着这 4 处再也不可能被登记豁免——
 *   同样的腐化再出现在 docs/ 必须当场判红。反向代价：它们已不复原，若判红说明
 *   有新腐化，不说明本上限可以随手调回去。
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

  // ── docs/** 纳管的判别力自检（#897）──────────────────────────────────────
  // 上面那条只证明「docs 根读到过文件」，**不**证明「理由层在扫」——
  // `docs/` 下有 research/specs/adr 等多个子目录，若整根被 SKIP 或扩展名不匹配，
  // 「读到了 docs/ 的某个文件」与「ADR 在被扫」是两件事（#897 阻塞级那一条的同款形状：
  // 恒真断言 + 遍历变量不参与判据）。
  it('阳性对照 C（真实文件注入，不落盘）：往真实 ADR 塞 U+FFFD，必须落到零容忍面', () => {
    // `docs/adr/` 是本仓「理由层」事实源（AGENTS.md「四层词」）——后续 agent 会把它当
    // **依据**读取。理由层里的烂字符会静默影响决策依据，而 U+FFFD 对编译器/类型检查/
    // 构建/全部单测完全隐形。⇒ 这一层必须有机器防线，而不是靠「记得看一眼」。
    const rel = 'docs/adr/ADR-0203-webview-client-source-removal.md'
    const real = ENTRIES.find((e) => e.path === rel)
    expect(real, `读不到 ${rel} ⇒ docs/** 实际未纳入扫描面（扩面宣称与判据脱节）`).toBeDefined()
    expect(
      (real!.text.match(/\uFFFD/g) ?? []).length,
      '前置：该 ADR 当前必须无 U+FFFD（否则零容忍面先转红，本对照失去意义）',
    ).toBe(0)

    // 注入点用**固定行号**，不拿散文措辞当锚点 —— 理由同上面的注入对照：
    // ADR 正文会被改写，锚在措辞上会让本对照某天静默失去对照能力。
    const lines = real!.text.split('\n')
    const at = 4
    expect(lines.length, '真实 ADR 短于注入点，锚点失效').toBeGreaterThan(at)
    const injected = lines
      .map((l, i) => (i === at ? `${l}  <!-- 探针${FFFD}${FFFD}-->` : l))
      .join('\n')

    const found = scanFiles([{ path: rel, text: injected }])
    expect(found.length, '注入的 U+FFFD 必须被整条链路抓到').toBe(1)
    expect(found[0]).toMatchObject({ path: rel, line: at + 1, count: 2 })

    // ⭐ 最后一环：抓到还不够，必须证明它会**真的落到零容忍面**。
    expect(
      REGISTERED_PATHS.has(rel),
      '该 ADR 竟在登记豁免表内 ⇒ 零容忍面对它无效，判红证明不成立',
    ).toBe(false)
    expect(
      scanFiles([{ path: rel, text: injected }]).filter((o) => !REGISTERED_PATHS.has(o.path)),
      '注入的 U+FFFD 必须落进零容忍面，即当场判红',
    ).toHaveLength(1)
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

  it('阳性对照 D（检测器自身可信）：复核本门禁的读取链路必须真的认得 U+FFFD', () => {
    // ⚠️ 本条针对的不是「仓内脏不脏」，而是「**复核本门禁的人手里那条命令可不可信**」。
    // #897 复核期实测：用 `grep -rlP '\x{FFFD}' docs/` 复测得到「0 个文件、退出码 0」，
    // 而该目录当时真实存在 4 个含 U+FFFD 的文件 —— **静默不匹配**，与「真的没有」完全同形，
    // 那一轮据此得出了「docs/ 当前 0 处、无需扩面」的错误结论。
    //
    // ⇒ 纪律：**任何用于复核门禁的计数命令，必须先用已知含 U+FFFD 的样本自测它自己**。
    //   本条把该纪律钉成机器断言，不靠下一位 reviewer 记得。
    // ⚠️ 不用 `\x{FFFD}` 转义做判据：本仓环境里 `grep -P '\x{FFFD}'` 静默不匹配（退出码 0、
    //   无输出），拿它当断言会把「命令坏了」伪装成「仓库干净」。此处走**门禁自己的读取链路**。
    const probe = `const a = 'x${FFFD}y'`
    expect(probe.includes(FFFD), '阳性对照自检：本条自己必须先认得 U+FFFD').toBe(true)

    // 落盘一份含 U+FFFD 的样本，走 collectEntries 同一条读取+扫描链路。
    const absProbe = resolve(REPO, 'packages/app-lynx/tests/.mojibake-probe.tmp')
    writeFileSync(absProbe, probe, 'utf8')
    try {
      const buf = readFileSync(absProbe)
      // collectEntries：含 NUL 才整份跳过 ⇒ 文本样本必被读入
      expect(buf.includes(0), '探针文件被误判为二进制（含 NUL）').toBe(false)
      expect(
        scanText(buf.toString('utf8')),
        '门禁自己的读取链路认不出探针里的 U+FFFD ⇒ 检测器已失效（这不是仓库干净）',
      ).toHaveLength(1)
    } finally {
      rmSync(absProbe, { force: true })
    }
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
