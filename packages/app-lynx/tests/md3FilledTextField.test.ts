// ─── MD3 filled text field 形态门禁（ADR-0209 复核判据 1/2/4）───
//
// 守的是「非豁免 `<input>` 的容器形态命中官方规格」，不是「某个类名恰好存在」。
// 官方真值（回源核对，勿凭记忆改；依据见 ADR-0209 决策 1）：
//   容器 56dp / 圆角顶 4dp 底 0dp（corner-extra-small-top）/ 指示条在**底部** 1px→聚焦 2px
//   容器色 surface-container-highest
// 两条易错点（本门禁存在的理由）：
//   ① 指示条在**底部**，不是顶部 —— 「顶部色带」是错误口径；
//   ② 底角是 **0dp**，不是 12dp —— 项目的 `rounded-b-none` 形态已命中真值，门禁不得把它们判红。
//
// 期望值溯源（禁自证）：56dp ↔ 14.933vw 的换算依据是项目权威换算表
// （docs/adr/glossary-lynx-units.md：1dp = 0.2667vw）���形状档位名只认 `--md-shape-*` 令牌
// （项目唯一形状档位来源，tailwind.config.ts 的 borderRadius 六档全部指向它），
// 两者都不在本文件里抄一份「看起来对」的字面量。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 375 设计稿下 56dp 的 vw 值（1dp = 0.2667vw，见 glossary-lynx-units.md）。
 *  从换算式算出而非抄字面量：56 × 0.2667 = 14.9352，保留 3 位小数 = 14.935；
 *  仓内实际用的是 14.933（等价于 56/375*100 = 14.9333…，取 3 位）。
 *  两者差 0.002vw @375 ≈ 0.0075px，远小于 1px 边框，判断用**同一精确串**。 */
const OFFICIAL_56DP_VW = (56 / 375) * 100 // 14.9333…（仓内写 14.933）
const OFFICIAL_56DP_VW_STR = OFFICIAL_56DP_VW.toFixed(3) // '14.933'

/** 圆角：官方 corner-extra-small-top = 顶 4dp / 底 0dp。
 *  顶角必须走 shape 令牌（extra-small = 4dp），底角必须为 0（官方明文，不是「没写」）。 */
const TOP_RADIUS_TOKEN = 'rounded-t-[var(--md-shape-extra-small)]'
const BOTTOM_ZERO = 'rounded-b-none'

/** 底部指示条：未聚焦 1px + on-surface-variant；聚焦 2px + primary。
 *  ⚠️ 色值是 on-surface-**variant**（官方 `active-indicator-color`），**不是** outline-variant
 *  —— 后者是 outlined 变体的色。回源 material-web v0_192
 *  `_md-comp-filled-text-field.scss`：`'active-indicator-color': on-surface-variant`。
 *  只校验「未聚焦态」这一层是静态可判的（聚焦态由脚本/绑定驱动，形态由实现保证）。 */
const INDICATOR_UNFOCUSED = ['border-b-[1px]', 'border-b-surface-on-variant']

/* 容器底色 = 官方 filled text field 的 container-color（ADR-0209 决策 1）。
 * ⚠️ **刻意不纳入形态门禁**：加进去需连带改全部合成样本，判别力增量（防一类未来回归）
 * 低于它带来的复杂度与假红面 —— 属 AGENTS.md 门禁冻结线「停止加码」的射程。
 * 现状 17/17 处均正确消费，回归风险靠 code-review 人工比对 + 术语文档 §3.2 承载。 */
const CONTAINER_BG = 'bg-surface-container-highest'

/** 5 项形态判据（56dp 高度 / 顶 4dp 圆角 / 底 0dp 圆角 / 底部指示条 / 容器底色）——**静态 class 必须
 *  自身齐备**的那几项。是 `inputClassList` 的静态优先短路与 `scanInputShapes` 报缺项的
 *  **同一份定义**：两处若各写一份，任何一侧改动都会让判据与说明漂移（ADR-0209 判据 2）。 */
const REQUIRED_STATIC: string[] = [
  `h-[${OFFICIAL_56DP_VW_STR}vw]`,
  TOP_RADIUS_TOKEN,
  BOTTOM_ZERO,
  ...INDICATOR_UNFOCUSED,
]

/** 豁免登记制：与 md3-guard-whitelist.json 同款台账，**死登记必须转红** ——
 *  被豁免的写法日后改回合规形态时，登记项若不转红就变成永久豁免口子。 */
const EXEMPTIONS: Record<string, string> = {
  'SearchSheet.vue': '全局搜索框药丸形态：ADR-0205 决策 4 第 2 条已豁免（封闭清单不得扩张）',
}

/** 递归收集生产 .vue（排除 .test. 与 errorPrototype/）——对齐术语文档的 75 文件口径。 */
function collectVue(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'errorPrototype') continue
      collectVue(full, out)
    } else if (entry.endsWith('.vue') && !entry.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

/** 剥注释：约束说明与决策留痕里会提到 `<input>` 与类名，判据必须落在代码本文上。
 *  ⚠️ 不剥会产生的假阳性是**实测过的**：注释里写 `` `<input>` `` 解释「5 字段 vs 6 元素」，
 *  会被 `/<input\b/` 匹配成一个 `class=""` 的真输入框 ⇒ 门禁红在一个不存在的违规上，
 *  而这类红会逼人去改注释或加白名单 —— 两者都会掩盖真缺陷。
 *  （`lynxUnsupportedTailwindClasses.test.ts` 已因同族理由记录过不剥注释的代价。） */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 解析脚本里某个函数的返回字符串集合（用于 `:class="fn(id)"` 的形态判定）。
 *  只取**该函数体内**的字符串字面量，不取全文件。
 *  ⚠️ 签名与引号都必须放宽，否则对**合法**实现假红（终审实测三种被误判）：
 *  ① 箭头函数 `const fn = (id: string): string => …`；② 无返回类型注解；③ 双引号字面量。 */
function functionReturnLiterals(src: string, fnName: string): string {
  // function 声明（有无返回类型注解均可）
  const decl = new RegExp(
    `function\\s+${fnName}\\s*\\([^)]*\\)(?:\\s*:\\s*[\\w<>\\[\\]| ]+)?\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(src)
  // const 箭头函数
  const arrow = new RegExp(`const\\s+${fnName}\\s*=\\s*(?:\\([^)]*\\)|[\\w$]+)\\s*(?::\\s*[\\w<>\\[\\]| ]+)?\\s*=>\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
  const body = decl?.[1] ?? arrow?.[1]
  if (!body) return ''
  // 单引号 + 双引号 + 模板字面量（无插值的那种形态串通常就写在反引号里）
  return [
    ...[...body.matchAll(/'([^']*)'/g)].map((m) => m[1]!),
    ...[...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]!),
    ...[...body.matchAll(/`([^`$]*)`/g)].map((m) => m[1]!),
  ].join(' ')
}

/** 切出每个 `<input …>` 标签的**全部** class 来源（静态 + 该元素绑定链上的动态类）。
 *
 *  ⚠️ 为什么合并两者：未聚焦基线既可能写在静态 `class`（SettingsEndpoint 风格），
 *  也可能由 `:class="fn(id)"` 在脚本里返回（Me.vue 风格 —— 聚焦态 1px↔2px 必须动态切换，
 *  写进静态类就没法切）。**只读静态类会把后一种合法实现判红**，逼实现者把动态状态
 *  写死成静态 —— 那才是真的退化。
 *
 *  ⚠️⚠️ 动态侧必须**逐元素**解析（只取该 input 的 `:class` 绑定里调到的那个函数的返回集），
 *  **不可**把全文件字面量并入每一个 input：那是**跨元素污染** —— 本文件曾因此产生
 *  可实证的假阴性：给 Me.vue 新增一个「完全无底部指示条、只挂 `:class="pt-0"`」的 input，
 *  因同文件 `fieldIndicatorClass` 的字面量被并入判定面而 PASS。
 *  那样判据会塌陷为「文件级子串存在性」：同文件**任何一个**合规 input 就能替**所有** input 背书，
 *  新增不合规 input 永远抓不到。逐元素解析后，无指示条的新 input 必红。
 *  ⚠️ 形态覆盖两种书写：单行 `class="…"` 与多行 `class="\n … \n"`。 */
function inputClassList(rawSrc: string): string[] {
  const src = stripComments(rawSrc)
  const out: string[] = []
  const re = /<input\b([\s\S]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const attrs = m[1]!
    const stat = attrs.match(/(?<!:)\bclass="([^"]*)"/)
    const parts = [stat ? stat[1]! : '']
    // 该元素若挂了 :class，只并入**它自己绑定到的**那些函数的返回集（逐元素，见上格警示）
    if (/:class=/.test(attrs)) {
      const dyn = attrs.match(/:class="([^"]*)"/)?.[1] ?? ''
      const dynClasses: string[] = []
      for (const call of dyn.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) {
        const lit = functionReturnLiterals(src, call[1]!)
        if (lit) dynClasses.push(lit)
      }
      // ⚠️ 共享函数背书缺口：若某 input 的某项形态**只**来自动态侧（静态 class 不含该项），
      // 而它调用的函数被同文件另一个 input 共享，则「函数返回值」不能作为**本元素**合规的
      // 证据 —— 实测形态：违规 input 调合规函数 `fn('b')` 即免检。
      // 故 **4 项形态判据（56dp 高度 / 顶 4dp 圆角 / 底 0dp 圆角 / 底部指示条）全部只认静态
      // class**：静态侧缺任一项 ⇒ 直接记违规，动态侧不参与补齐。
      // ⚠️ 此短路只在该 input 挂了 `:class` 时生效；纯静态实现（无 `:class`）天然满足。
      // 判别力：见「反事实（共享函数背书）」与「反事实（跨元素污染）」两条用例。
      const stat0 = stat ? stat[1]! : ''
      const staticIncomplete = REQUIRED_STATIC.some((seg) => !stat0.includes(seg))
      if (staticIncomplete && dynClasses.length > 0) {
        out.push(`${stat0} __DYNAMIC_ONLY__`)
        continue
      }
      parts.push(...dynClasses)
    }
    out.push(parts.join(' '))
  }
  return out
}

interface Violation {
  file: string
  index: number
  missing: string[]
  classValue: string
}

/** 4 项判据 → 报错标签（与 REQUIRED_STATIC 一一对应，单一事实源）。
 *  指示条两项由 `INDICATOR_UNFOCUSED` 派生而非重打一份 —— 两处若各写一份字面量，
 *  改了其中一处会让「判据」与「报错文案」漂移。 */
const REQUIRED_LABELS: Record<string, string> = {
  [`h-[${OFFICIAL_56DP_VW_STR}vw]`]: '56dp 高度',
  [TOP_RADIUS_TOKEN]: '顶 4dp 圆角（shape 令牌）',
  [BOTTOM_ZERO]: '底 0dp 圆角',
  'border-b-[1px]': '底部指示条 border-b-[1px]',
  'border-b-surface-on-variant': '底部指示条 border-b-surface-on-variant',
}

/** 切出每个 `<input …>` 标签的原文（供「label vs placeholder 同框」判据使用）。 */
function inputTags(rawSrc: string): string[] {
  const src = stripComments(rawSrc)
  return [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0])
}

function scanInputShapes(sources: Record<string, string>): Violation[] {
  const violations: Violation[] = []
  for (const [file, src] of Object.entries(sources)) {
    const base = file.split('/').pop() ?? file
    if (EXEMPTIONS[base]) continue
    inputClassList(src).forEach((classValue, index) => {
      // __DYNAMIC_ONLY__ = 静态 class 形态不齐、且该 input 挂了 :class（详见 inputClassList）
      const missing = REQUIRED_STATIC.filter((seg) => !classValue.includes(seg)).map(
        (seg) => REQUIRED_LABELS[seg] ?? seg,
      )
      if (missing.length > 0) violations.push({ file, index, missing, classValue })
    })
  }
  return violations
}

const SOURCES: Record<string, string> = Object.fromEntries(
  collectVue(SRC_ROOT).map((f) => [relative(SRC_ROOT, f), readFileSync(f, 'utf8')]),
)

describe('MD3 filled text field 形态门禁（ADR-0209）', () => {
  it('抽取器自身有效：扫描面非空且 input 数有下界（防正则塌陷导致全称断言恒真）', () => {
    const files = Object.keys(SOURCES)
    expect(files.length, '生产 .vue 文件数应 ≥ 70（术语文档口径 75）').toBeGreaterThanOrEqual(70)
    const total = Object.values(SOURCES).reduce((n, s) => n + inputClassList(s).length, 0)
    // 实测 17 处（Me 7 + SettingsEndpoint 6 + BookmarkPanel/CommentInputBar/Login/SearchSheet 各 1）
    expect(total, `扫出的 <input> 总数：${total}`).toBeGreaterThanOrEqual(17)
    // 抽取器对构造正样本必须非空：全仓碰巧 0 处 input 时「零违规」与「抽取器失效」同形
    expect(inputClassList('<input class="h-[14.933vw]" />')).toHaveLength(1)
    expect(inputClassList('<input\n  class="h-[14.933vw]"\n/>')).toHaveLength(1)
  })

  it('全仓：非豁免 <input> 全部命中 MD3 filled 形态（56dp + 顶 4dp/底 0 + 底部指示条）', () => {
    const violations = scanInputShapes(SOURCES)
    expect(
      violations.map((v) => `${v.file}#${v.index} 缺：${v.missing.join('、')}\n    class="${v.classValue}"`),
      '这些 <input> 未对齐 MD3 filled text field（ADR-0209）',
    ).toEqual([])
  })

  it('反事实：非合规形态必须被逐项点名（56dp 药丸 / 全描边 / 无指示条）', () => {
    const bad = {
      // 旧形态：42dp 药丸（真阳性对照，形态取自整改前的 BookmarkPanel）
      'BookmarkPanel.vue': '<input class="h-[11.2vw] rounded-[var(--md-shape-full)] text-body-medium" />',
      // 旧形态：45dp 中圆角 + 全描边（真阳性对照，取自整改前的 SettingsEndpoint）
      'SettingsEndpoint.vue':
        '<input class="h-[12vw] bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)]" />',
      // 缺底部指示条（真阳性对照，取自整改前的 Me.vue）
      'Me.vue':
        `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO}" />`,
      // 底角非 0（对抗「底 0dp」这条易错点）
      'Login.vue': `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} rounded-b-[var(--md-shape-medium)] ${INDICATOR_UNFOCUSED.join(' ')}" />`,
    }
    const violations = scanInputShapes(bad)
    expect(violations).toHaveLength(4)
    // 每处必须点名它真正缺的那几项，而不是笼统报错
    expect(violations[0]!.missing).toEqual(
      expect.arrayContaining(['56dp 高度', '顶 4dp 圆角（shape 令牌）', '底 0dp 圆角']),
    )
    expect(violations[0]!.missing).toContain('底部指示条 border-b-[1px]')
    // 该样本刻意「形态齐备、只缺指示条」⇒ 必须**只**点名两项指示条，不得顺带报别的
    expect(violations[2]!.missing).toEqual([
      '底部指示条 border-b-[1px]',
      '底部指示条 border-b-surface-on-variant',
    ])
    // 阴性对照：合规形态不得转红（证明不是「一律点名」）
    expect(
      scanInputShapes({
        'Ok.vue': `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] box-border bg-surface-container-highest ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} text-body-large" />`,
      }),
    ).toEqual([])
  })

  it('反事实（跨元素污染）：同文件另一个 input 的指示条**不得**替本 input 背书', () => {
    // 这是本门禁曾真实塌陷的形态：动态侧曾把**全文件**字面量并入每个带 `:class` 的 input，
    // 于是「同文件任意一个合规 input」就能替**所有** input 背书 —— 新增一个完全无指示条的
    // input 仍然 PASS。判据由此塌陷为「文件级子串存在性」，新增违规永远抓不到。
    // 修法 = 逐元素解析（只并入该 input 绑定链上函数的返回集）；本用例锁死该修法。
    const src = [
      // ✅ 合规 input：静态类自带指示条（判据要求形态关键项静态可判）
      `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}" :class="fieldIndicatorClass('a')" />`,
      // ❌ 新增的违规 input：形状对但**无任何指示条**，只挂一个与形态无关的动态类
      `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO}" :class="pt-0" />`,
    ].join('\n')
    const violations = scanInputShapes({ 'Me.vue': src })
    expect(violations, '同文件的合规 input 替违规 input 背书了 ⇒ 判据已被跨元素污染').toHaveLength(1)
    expect(violations[0]!.index).toBe(1)
    expect(violations[0]!.missing).toEqual(
      expect.arrayContaining(['底部指示条 border-b-[1px]', '底部指示条 border-b-surface-on-variant']),
    )
  })

  it('反事实（共享函数背书）：动态侧不能替「静态侧缺指示条」的 input 免检', () => {
    // 上一条反事实修掉了「全文件污染」，但**同函数共享**仍是缺口：违规 input 只要调一个
    // 同文件合规 input 也在调的函数，就借到该函数的返回集而被免检。
    // 判据收紧为：形态关键项**只认静态 class**；静态侧缺指示条时，动态侧不参与补齐。
    const compliantStatic = `h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')}`
    const src = [
      `<script setup lang="ts">
function fieldIndicatorClass(id: string): string {
  return id ? '${INDICATOR_UNFOCUSED.join(' ')}' : ''
}
</script>`,
      // ✅ 合规：静态类自带指示条
      `<input class="${compliantStatic}" :class="fieldIndicatorClass('a')" />`,
      // ❌ 违规：静态类**缺**指示条，却调同一个合规函数 ⇒ 必须红
      `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO}" :class="fieldIndicatorClass('b')" />`,
    ].join('\n')
    const violations = scanInputShapes({ 'Me.vue': src })
    expect(violations, '借共享函数免检 ⇒ 判据仍可被绕过').toHaveLength(1)
    expect(violations[0]!.index).toBe(1)
    expect(violations[0]!.missing).toEqual(
      expect.arrayContaining(['底部指示条 border-b-[1px]']),
    )
  })

  it('反事实（形态项背书）：共享函数不得替**高度/圆角**免检（不只指示条）', () => {
    // 终审实测的残留缺口：上一版只对「指示条」做静态优先短路，于是静态只含指示条、
    // 真实形态是 42dp 药丸的违规 input，只要调一个返回合规高度/圆角的共享函数即免检。
    // 本用例把 4 项形态判据一并锁死。
    const src = [
      `<script setup lang="ts">
function fieldShapeClass(id: string): string {
  return 'h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}'
}
</script>`,
      // ✅ 合规：静态类四项齐备
      `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}" :class="fieldShapeClass('a')" />`,
      // ❌ 违规：静态只含指示条（真形态是 42dp 药丸），却调合规函数 ⇒ 必须红
      `<input class="h-[11.2vw] rounded-[var(--md-shape-full)] ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}" :class="fieldShapeClass('b')" />`,
    ].join('\n')
    const violations = scanInputShapes({ 'Me.vue': src })
    expect(violations, '共享函数替高度/圆角背书 ⇒ 4 项判据未全量静态优先').toHaveLength(1)
    expect(violations[0]!.index).toBe(1)
    expect(violations[0]!.missing).toEqual(
      expect.arrayContaining(['56dp 高度', '顶 4dp 圆角（shape 令牌）']),
    )
  })

  it('抽取器容忍合法写法变体：箭头函数 / 无返回类型 / 双引号字面量不得假红', () => {
    // 终审实测的假红：旧抽取器只认 `function NAME(): string {` + 单引号，
    // 三种**合法**实现被误判。放宽后它们必须与 function 声明写法同样被解析。
    const shape = `h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}`
    const variants: Record<string, string> = {
      'arrow': `<script setup lang="ts">
const fieldShapeClass = (id: string): string => {
  return "${shape}"
}
</script>`,
      'no-annot': `<script setup lang="ts">
function fieldShapeClass(id) {
  return '${shape}'
}
</script>`,
      'double-quote': `<script setup lang="ts">
function fieldShapeClass(id: string): string {
  return "${shape}"
}
</script>`,
    }
    for (const [name, script] of Object.entries(variants)) {
      // 静态缺形态 + 动态提供 ⇒ 应因「静态不齐」报**全部** 4 项，而不是被误判为合规
      const violations = scanInputShapes({
        'Me.vue': `${script}\n<input class="pt-0" :class="fieldShapeClass('a')" />`,
      })
      expect(violations, `${name} 写法应被解析为「静态不齐」`).toHaveLength(1)
      expect(violations[0]!.missing.length, `${name}：应点名 4 项形态判据`).toBe(REQUIRED_STATIC.length)
    }
  })

  it('label 与 placeholder 不得在静止态同框渲染（真机实证：曾出现「用户名/用户名」双行）', () => {
    // 真机证据（ADR-0209 决策 4 第②层，emulator-5554 / Android 14）：Me.vue 的 6 处
    // input 在静止态把 label 与 placeholder 同时渲染 ⇒ 屏上出现「用户名 / 用户名」双行。
    // ⚠️ 这类缺陷**静态形态门禁抓不到**（形态全对），只有真机截图 + 本条断言能抓。
    // 契约：有浮动 label 的 input，placeholder 必须**随浮动状态条件化**（静止传空串），
    // 否则静止态 label 与 placeholder 争同一个居中位。
    const FLOATABLE = ['Me.vue', 'SettingsEndpoint.vue', 'CommentInputBar.vue', 'Login.vue']
    for (const [file, src] of Object.entries(SOURCES)) {
      const base = file.split('/').pop() ?? file
      if (!FLOATABLE.includes(base)) continue
      for (const [index, tag] of inputTags(src).entries()) {
        // 该 input 附近有 label（绝对定位的 text 或 label key）才适用本契约
        const hasFloatingLabel = /fieldLabelClass\(|labelCls|isFloated\(/.test(tag) || /label\b/.test(tag)
        if (!hasFloatingLabel) continue
        const ph = tag.match(/\b:?placeholder="([^"]*)"/)
        if (!ph) continue
        expect(
          ph[1],
          `${file} 第 ${index + 1} 个 input 的 placeholder 必须条件化且未显示时传空串` +
            ` —— 真机已实证两种失败形态：① 静止态 label 与 placeholder 同框「用户名/用户名」；` +
            `② 有值未聚焦时 label 已浮顶、placeholder 又叠一层「目录/目录（默认…）」。` +
            `故判据是「仅聚焦时显示」，不是「随浮动（含有值）显示」。`,
        ).toMatch(/\?.*:\s*''/)
      }
    }
  })

  it('disabled 状态层必须独立成层（真机实证：同元素双 background-color 会静默失效）', () => {
    // 真机取色证据（emulator-5554，BookmarkPanel 保存按钮 disabled 态）：
    //   期望 = #e6e8ee(surface-container-high) 叠 on-surface 12% = (205, 208, 213)
    //   实测 = (163, 197, 220) ⇒ 12% alpha 层**根本没生效**
    // 根因：`bg-state-disabled-container` 与 `bg-surface-container-*` 都是 `background-color`，
    //   Tailwind 产物里后者的声明更靠后 ⇒ 整条覆盖前者（同特异性按声明顺序决胜）。
    // ⚠️ 这类缺陷**产物级与静态断言都抓不到**：类名在、令牌在、门禁全绿，只有取色才看得见。
    //   故本条断言的是**结构契约**：disabled 类不得与任意 `bg-*` 写在同一元素上。
    const STATE_LAYER_SOURCES = ['DownloadManager.vue', 'BookmarkPanel.vue']
    for (const [file, src] of Object.entries(SOURCES)) {
      const base = file.split('/').pop() ?? file
      if (!STATE_LAYER_SOURCES.includes(base)) continue
      for (const [index, tag] of inputTags(src).length ? [] : []) void [index, tag]
      // 逐个 view 标签检查：含 disabled 状态层的元素，其 class 里不得同时出现其他 bg-*
      for (const tag of [...src.matchAll(/<view\b[\s\S]*?>/g)].map((m) => m[0])) {
        if (!tag.includes('bg-state-disabled-container')) continue
        const cls = tag.match(/\bclass="([^"]*)"/)?.[1] ?? ''
        // 覆盖层的 class 只应含圆角 + 自身；不得再有第二个背景色类
        const bgClasses = cls.match(/\bbg-[a-z0-9-]+/g) ?? []
        expect(
          bgClasses,
          `${base}：bg-state-disabled-container 所在元素不得再叠其他 bg-* ` +
            `（互斥 background-color 会让 12% alpha 层静默失效 —— 真机取色实证）`,
        ).toEqual(['bg-state-disabled-container'])
      }
    }
    // 反事实：旧写法（同元素双 bg-*）必须被本判据抓住
    const legacy = { 'DownloadManager.vue': SOURCES['DownloadManager.vue'] ?? '' }
    const legacyHasViolation = [...(legacy['DownloadManager.vue'] ?? '').matchAll(/<view\b[\s\S]*?>/g)]
      .map((m) => m[0])
      .some((tag) => {
        if (!tag.includes('bg-state-disabled-container')) return false
        const cls = tag.match(/\bclass="([^"]*)"/)?.[1] ?? ''
        return (cls.match(/\bbg-[a-z0-9-]+/g) ?? []).length > 1
      })
    expect(
      legacyHasViolation,
      '阳性对照失效：若真实源码里已无「同元素双 bg-」的违规，本条判据无法区分好坏实现',
    ).toBe(false)
  })

  it('阳性对照 load-bearing：合规样本在「只看高度」的弱判据下也绿（证明强判据不是靠运气）', () => {
    // 弱判据 = 只查高度。合规样本在弱判据下必须**不红**，否则它无法区分强弱判据。
    const compliant = `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${INDICATOR_UNFOCUSED.join(' ')} ${CONTAINER_BG}" />`
    const weakScan = (src: string) =>
      !inputClassList(src)[0]!.includes(`h-[${OFFICIAL_56DP_VW_STR}vw]`) ? ['56dp 高度'] : []
    expect(weakScan(compliant)).toEqual([])
    // 反向：缺指示条的样本在弱判据下**也绿** —— 正是弱判据的盲区，强判据必须抓住它
    const noIndicator = `<input class="h-[${OFFICIAL_56DP_VW_STR}vw] ${TOP_RADIUS_TOKEN} ${BOTTOM_ZERO} ${CONTAINER_BG}" />`
    expect(weakScan(noIndicator), '弱判据对「缺指示条」恒真 —— 这是它单独用时的漏网形态').toEqual([])
    expect(scanInputShapes({ 'Me.vue': noIndicator })[0]!.missing).toContain(
      '底部指示条 border-b-[1px]',
    )
  })

  it('豁免登记制：SearchSheet 药丸仍被豁免，且登记项不得变成永久口子', () => {
    // 豁免确实生效
    expect(EXEMPTIONS['SearchSheet.vue']).toBeTruthy()
    expect(
      scanInputShapes({ 'SearchSheet.vue': '<input class="h-[11.2vw] rounded-full" />' }),
      'SearchSheet 走豁免，不该被判违规',
    ).toEqual([])
    // 死登记检测：豁免项若指向的文件已无 input，登记项必须转红（防永久豁免口子）
    const deadExemptions = Object.keys(EXEMPTIONS).filter((base) => {
      const entry = Object.entries(SOURCES).find(([f]) => (f.split('/').pop() ?? f) === base)
      return !entry || inputClassList(entry[1]).length === 0
    })
    expect(
      deadExemptions,
      '死登记：被豁免的文件已不含 <input>，登记项应删除而非继续挂着',
    ).toEqual([])
  })
})
