// ─── 暗色色板「生成器 ↔ 产物」漂移防线（spec docs/specs/lynx-night-mode.md T2 §4.7）───
//
// 覆盖两处此前只靠人工同步、零校验的关系：
//   (a) 产物 ≡ 脚本输出：tokens.css 自动生成段 ≡ `node scripts/generate-theme-palettes.mjs --stdout`
//   (b) lightPrimaryAnchor ↔ 亮色 primary：脚本内 THEMES 的 6 个 `lightPrimaryAnchor`
//       ≡ tokens.css 6 个亮色 .theme-X 的 --md-primary
//
// 术语（review round-2 M3 澄清，防「seed」一词两义固化）：
//   脚本清单字段 = `lightPrimaryAnchor`（= **亮色 --md-primary 值**，双职责：亮色主色值 +
//   暗色方案 M3 `SchemeTonalSpot` 的 seed 输入）。与 docs/specs/app-lynx-theme-color.md 早期
//   「列出的 hex 是 seed 输入、生成后 --md-primary 是派生 tone-40」的描述是**历史口径差异**
//   （那批 seed 值 #6750a4 等是亮色板生成时的输入，与产物 primary #65558f 不等）；本文件与
//   生成脚本以「锚点 = 亮色 primary」为准。
//
// 说明与口径：
//   - 脚本以 `--stdout` 运行时不写任何文件（在 injectIntoTokens 之前 process.exit），本测试另以
//     「运行前后 tokens.css 内容不变」显式断言该只读契约，防止测试自身篡改仓库产物。
//   - 脚本的 patchMaterialColorUtilities 是**模块级副作用**：它会遍历 node_modules 内
//     @material/material-color-utilities 的 .js 给相对 import 补 .js 后缀（Node 22+ 严格 ESM
//     解析缺陷自愈）。仅作用于 devDependency，测试环境（Node + devDeps 已安装）可安全触发；
//     脚本自检 + 自愈幂等，故重复 spawn 不会造成持续变更。
//   - 比对规范化：stdout 末尾比产物多一个换行（产物经 trimEnd + 单个 '\n' 落盘），
//     故两侧统一 `trimEnd()` 后再比；除行尾空白外**逐字节**要求一致（含注释串）。
//   - 期望值来源：产物侧取 tokens.css 真实文件，脚本侧取脚本真实源码 + 真实 spawn 输出，
//     两侧均为独立来源，测试不写入任何手写色值（避免自洽反推）。
//   - spawn 一律**在 it 体内**触发（不在 describe 收集阶段）：生成器挂死时失败落在该用例上，
//     而非「整 run 无输出挂死」（review round-2）；并带 30s 看门狗（正常 < 5s）。
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..')
const scriptPath = resolve(rootDir, 'scripts/generate-theme-palettes.mjs')
const tokensPath = resolve(rootDir, 'src/styles/tokens.css')

const SCRIPT_REL = 'scripts/generate-theme-palettes.mjs'
const START_MARKER = '自动生成段'
const END_MARKER = '/* END auto-generated */'

/** 期望的暗色色板支数（lightPrimaryAnchor 清单口径，防正则塌陷后恒真通过） */
const EXPECTED_THEME_COUNT = 6

/** spawn 看门狗（ms）：生成脚本只读本地 node_modules + 打印，正常 < 5s；CI 冷缓存也不应超 30s */
const SPAWN_TIMEOUT_MS = 30_000

const tokensCss = readFileSync(tokensPath, 'utf-8')
const scriptSrc = readFileSync(scriptPath, 'utf-8')

/** 抽取 tokens.css 的自动生成段（从该段注释开头的 `/*` 到 END 标记之前，不含 END 标记本身） */
function extractGeneratedSection(css: string): string {
  const marker = css.indexOf(START_MARKER)
  expect(marker, `tokens.css 缺少自动生成段起始标记（${START_MARKER}）`).toBeGreaterThan(-1)
  // 回退到该段注释的 `/*` 开头：脚本注入的产物以 `/* ═══…` 起（与 stdout 首行对齐）
  const start = css.lastIndexOf('/*', marker)
  expect(start, '自动生成段标记前缺少注释开头 `/*`').toBeGreaterThan(-1)
  const end = css.indexOf(END_MARKER, start)
  expect(end, `tokens.css 缺少自动生成段结束标记（${END_MARKER}）`).toBeGreaterThan(start)
  return css.slice(start, end)
}

/** 行尾空白归一（见文件头「比对规范化」） */
const normalize = (s: string): string => s.trimEnd()

interface GeneratorRun {
  stdout: string
  stderr: string
  status: number | null
  /** spawn 自身失败（超时 ETIMEDOUT / 启动失败）；null = spawn 正常完成 */
  error: string | null
}

/** 跑一次生成脚本（--stdout），返回 stdout / stderr / status / spawn 错误。
 *  只能在 it 体内调用（见文件头「spawn 一律在 it 体内触发」）。 */
function runGeneratorStdout(): GeneratorRun {
  const res = spawnSync(process.execPath, [SCRIPT_REL, '--stdout'], {
    cwd: rootDir,
    encoding: 'utf-8',
    // 环境变量透传（代理等无需干预：脚本仅读本地 node_modules）
    env: process.env,
    // 看门狗：生成器挂死 → 30s 被杀（error=ETIMEDOUT + status=null）→ 下方断言带证据翻红，
    // 而不是让 CI 无界挂死（review round-2）
    timeout: SPAWN_TIMEOUT_MS,
  })
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status,
    error: res.error ? String(res.error.message) : null,
  }
}

/** 退出码断言的诊断串（超时 / spawn 失败 / stderr 一并带出） */
function spawnFailure(run: GeneratorRun): string {
  const timeoutHint = run.error ? `，spawn error=${run.error}` : ''
  return `生成脚本未正常退出（退出码=${run.status}${timeoutHint}，看门狗 ${SPAWN_TIMEOUT_MS}ms）\n--- stderr ---\n${run.stderr}`
}

describe('色板生成器漂移防线（产物 ↔ 脚本）', () => {
  it('(a) tokens.css 自动生成段 ≡ 脚本 --stdout 输出（逐字节，行尾空白归一）', () => {
    const run = runGeneratorStdout() // it 体内 spawn（见文件头）
    expect(run.status, spawnFailure(run)).toBe(0)
    // 产物侧
    const section = extractGeneratedSection(tokensCss)
    expect(section.length).toBeGreaterThan(0)
    // 脚本侧：非空 + 恰好 6 个暗色块（防脚本输出被截断/清单塌陷时两侧「一起空」仍通过）
    expect(run.stdout.length).toBeGreaterThan(0)
    const emittedBlocks = [...run.stdout.matchAll(/^\.theme-[a-z0-9-]+\.dark \{$/gm)].length
    expect(emittedBlocks).toBe(EXPECTED_THEME_COUNT)
    // 产物侧的支数独立计数（两份 oracle：脚本输出 vs 落盘产物）
    const inArtifact = [...section.matchAll(/^\.theme-[a-z0-9-]+\.dark \{$/gm)].length
    expect(inArtifact).toBe(EXPECTED_THEME_COUNT)

    expect(
      normalize(section),
      'tokens.css 自动生成段与脚本输出不一致 —— 请运行 node scripts/generate-theme-palettes.mjs 重新生成',
    ).toBe(normalize(run.stdout))
  }, 60_000)

  it('(a-保真) --stdout 为只读路径：运行前后 tokens.css 内容不变', () => {
    const before = readFileSync(tokensPath, 'utf-8')
    const run = runGeneratorStdout() // it 体内实际跑一次并比对前后（非模块级快照）
    expect(run.status, spawnFailure(run)).toBe(0)
    const after = readFileSync(tokensPath, 'utf-8')
    expect(after, '生成脚本 --stdout 路径改写了 tokens.css（只读契约被破坏）').toBe(before)
  }, 60_000)

  it('(b) 脚本 lightPrimaryAnchor 清单 ↔ tokens.css 亮色 --md-primary 逐一对等（6/6）', () => {
    // 脚本侧：THEMES 数组条目（字段名 = lightPrimaryAnchor，见文件头「术语」）
    const anchors = [
      ...scriptSrc.matchAll(
        /\{\s*id:\s*'([a-z0-9-]+)',\s*lightPrimaryAnchor:\s*'(#[0-9a-fA-F]{6})'\s*\}/g,
      ),
    ].map((m) => ({ id: m[1]!, anchor: m[2]!.toLowerCase() }))
    expect(anchors.length, '脚本内 lightPrimaryAnchor 条目数（正则失效/清单被改）').toBe(
      EXPECTED_THEME_COUNT,
    )
    expect(new Set(anchors.map((s) => s.id)).size, '脚本内 lightPrimaryAnchor id 需唯一').toBe(
      EXPECTED_THEME_COUNT,
    )

    // 产物侧：每个 id 的亮色块（`.theme-X { ... }`，非 .dark 复合块）内的 --md-primary
    const lightPrimaries: string[] = []
    for (const { id, anchor } of anchors) {
      const block = tokensCss.match(new RegExp(`\\.theme-${id}\\s*\\{([^}]*)\\}`))?.[1]
      expect(block, `tokens.css 缺少亮色块 .theme-${id} { ... }`).toBeTruthy()
      const primary = block!.match(/--md-primary:\s*(#[0-9a-fA-F]{6})/)?.[1]
      expect(primary, `.theme-${id} 缺少 6 位 hex --md-primary`).toBeTruthy()
      lightPrimaries.push(primary!.toLowerCase())
      expect(
        anchor,
        `.theme-${id}：脚本 lightPrimaryAnchor ${anchor} ≠ 亮色 --md-primary ${primary} —— 锚点已漂移，请同步两处`,
      ).toBe(primary!.toLowerCase())
    }
    // 计数与集合防塌陷：6 条且互不相同（锚点全等会让上面循环空转通过）
    expect(lightPrimaries.length).toBe(EXPECTED_THEME_COUNT)
    expect(new Set(lightPrimaries).size).toBe(EXPECTED_THEME_COUNT)
  })
})

