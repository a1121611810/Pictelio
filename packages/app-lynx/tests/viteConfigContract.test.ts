// ─── vite-plus 配置契约（仓库根 vite.config.ts）───
//
// 本文件锁一条**已经真实漂移过一次**的不变式：`lint` 与 `fmt` 两个块的
// `ignorePatterns` 必须是**同一组路径**。
//
// 漂移史：ADR-0203 把 WebView 客户端迁走后，gradle 的 `GRADLE_USER_HOME` 变成了
// **包根**下的 `.gradle/`（`build:android` 以 `GRADLE_USER_HOME=$(pwd)/.gradle` 起
// gradle），而两个块当时都只列了 `android/.gradle/`。后果是 `pnpm lint` /
// `pnpm fmt:check` 恒红，而诊断里 0 条来自本仓源码 —— 全是 Gradle 发行版自带的
// JDK HTML 文档。修的时候只改了其中一个块，另一个块仍然红。
//
// 为什么值得一条门禁：当时防它复发的只有**注释**。注释不参与任何执行，
// 下一个人改路径时没有任何机制提醒他「这个块还有一个孪生兄弟」。
// **注释里的硬要求不是约束** —— 这与本仓反复出现的「注释声称已做、代码没做」同型。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VITE_CONFIG = fileURLToPath(new URL('../../../vite.config.ts', import.meta.url))
const SRC = readFileSync(VITE_CONFIG, 'utf8')

/** 取出某个块里 `ignorePatterns` 数组的字面量路径条目（按出现顺序，去重）。
 *  刻意**不**做完整 TS 解析：只认数组字面量里的双引号字符串，
 *  与仓库里其他配置契约测试同一手法（读得出来的形式才锁，锁不住就明说）。 */
function ignoreEntries(blockStart: number, blockEnd: number): string[] {
  const slice = SRC.slice(blockStart, blockEnd)
  const m = slice.match(/ignorePatterns:\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error(`未在偏移 ${blockStart} 附近找到 ignorePatterns 数组`)
  const out = new Set<string>()
  for (const line of m[1]!.split('\n')) {
    const s = line.match(/^\s*"([^"]+)"\s*,?\s*$/)
    if (s?.[1]) out.add(s[1])
  }
  return [...out]
}

function blockBounds(marker: string): [number, number] {
  const i = SRC.indexOf(marker)
  if (i < 0) throw new Error(`vite.config.ts 里找不到标记：${marker}`)
  // 块以 `},` 收尾；找不到就退到下一个顶层键
  const close = SRC.indexOf('\n    },', i)
  return [i, close > 0 ? close : SRC.length]
}

describe('vite-plus lint / fmt 忽略路径必须同组', () => {
  const [lintStart, lintEnd] = blockBounds('lint: {')
  const [fmtStart, fmtEnd] = blockBounds('fmt: {')

  it('两个块都能被抽取出 ignorePatterns（非空）', () => {
    // 抽取器防空转：若下面某次重构把数组写成了变量引用，这里会直接抛错而不是静默空集。
    const lint = ignoreEntries(lintStart, lintEnd)
    const fmt = ignoreEntries(fmtStart, fmtEnd)
    expect(lint.length, 'lint 块没抽出任何路径条目').toBeGreaterThanOrEqual(1)
    expect(fmt.length, 'fmt 块没抽出任何路径条目').toBeGreaterThanOrEqual(1)
  })

  it('lint 的每一条忽略路径，fmt 也必须忽略（lint ⊆ fmt）', () => {
    // ⚠️ 方向是**子集**不是相等。首版我把这条写成 `toEqual(集合相等)`，当场判红，
    // 差异是 fmt 多出 4 条：`**/*.md`、`docs/**`、`**/tests/fixtures/**`、
    // `packages/app/android/app/src/main/assets/public/**`。
    // 逐条核过：这 4 条都是「oxfmt 不该去格式化、而 oxlint 根本不关心」的类别
    // （Markdown、文档、测试夹具、已构建产物）。把它们塞进 lint 块只会让 oxlint
    // 白扫一遍，是**反向**的成本。
    //
    // 真正会出事的是**反方向**：lint 忽略而 fmt 没忽略 ⇒ oxfmt 扫进去 ⇒ 恒红。
    // 这正是 ADR-0203 迁移后发生的那次（两个块都漏了包根 .gradle/，而当时
    // 只改了其中一个）。所以判据只锁「lint ⊆ fmt」这一个方向。
    const lint = ignoreEntries(lintStart, lintEnd)
    const fmt = ignoreEntries(fmtStart, fmtEnd)
    expect(
      lint.filter((x) => !fmt.includes(x)),
      'lint 忽略但 fmt 没忽略的路径 ⇒ oxfmt 会扫进去。\n' +
        '  这正是 ADR-0203 迁移后导致 `pnpm fmt:check` 恒红的那一类漂移' +
        '（诊断全是 Gradle 发行版自带的 JDK 文档，0 条来自本仓源码）。\n' +
        '  两个块必须成对修改：oxlint 与 oxfmt 都不读 .gitignore。',
    ).toEqual([])
  })

  it('fmt 侧多出来的条目逐条都有存在理由（防止反方向也悄悄漂）', () => {
    // 子集判据只锁一个方向；反过来「fmt 越加越多」也需要一道闸 ——
    // 没人复核的忽略列表会变成垃圾桶，最后把该格式化的文件排除掉。
    const lint = ignoreEntries(lintStart, lintEnd)
    const fmtOnly = ignoreEntries(fmtStart, fmtEnd).filter((x) => !lint.includes(x))
    // 已知合法差异：oxfmt 会去格式化 .md / docs / 夹具，oxlint 不会碰这些类型
    const known = ['**/*.md', 'docs/**', '**/tests/fixtures/**']
    expect(
      fmtOnly.filter((x) => !known.includes(x)),
      `fmt 块多出未登记的忽略路径：${fmtOnly.filter((x) => !known.includes(x)).join(', ')}\n` +
        '  新增前先确认 oxlint 确实不需要它；确属必要则连同理由登记进 known。',
    ).toEqual([])
  })

  it('已删包的路径不得留在忽略列表里（死条目棘轮）', () => {
    // 这不是洁癖：`packages/app` 曾带着 9 条忽略项（lint 4 + fmt 5）留在配置里，
    // 而**紧挨着的注释写着「不要在这里重建对已删包的长期忽略契约」**——
    // 注释禁止的事，代码正在做。注释里的硬要求不是约束，代码才是。
    //
    // 实测证明这 9 条匹配不到任何东西：oxlint/oxfmt 的文件发现按 **workspace
    // 成员**收敛（pnpm-workspace.yaml = `packages/*` 下真实存在的包），
    // ADR-0203 整包删除后 `packages/app` 不是成员。阳性对照：磁盘上重建一个
    // 带 package.json 的完整 packages/app/ 并塞入 .json/.html/.ts 垃圾文件，
    // `pnpm fmt:check` 扫描数恒 163、0 条来自该目录；同一时刻
    // packages/update-check/src/ 的同类垃圾被抓出转红 ⇒ 排除「门禁根本没跑」。
    const lint = ignoreEntries(lintStart, lintEnd)
    const fmt = ignoreEntries(fmtStart, fmtEnd)
    expect(
      [...lint, ...fmt].filter((x) => x.startsWith('packages/app/')),
      '已随 ADR-0203 删除的 packages/app 又出现在 ignorePatterns 里。\n' +
        '  它已不是 workspace 成员，oxlint/oxfmt 的文件发现根本到不了那里，\n' +
        '  这些条目匹配不到任何文件 ⇒ 纯误导。本机若真有残留垃圾，删掉目录。',
    ).toEqual([])
  })

  it('回归防线：已漂移过的那条真实路径必须在两个块里都在', () => {
    // 上面的集合相等是**关系**判据；这条是**锚点**判据：万一哪天两个块一起被清空，
    // 「相等」会恒真（空集 == 空集），锚点判据仍会红。
    const known = 'packages/android-host/.gradle/**'
    const lint = ignoreEntries(lintStart, lintEnd)
    const fmt = ignoreEntries(fmtStart, fmtEnd)
    expect(lint, `lint 块缺 ${known}`).toContain(known)
    expect(fmt, `fmt 块缺 ${known}`).toContain(known)
  })
})
