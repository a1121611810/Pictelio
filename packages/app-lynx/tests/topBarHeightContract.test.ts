// ─── 顶栏高度契约：探测器的假定 vs 页面实际（#909 遗留）───
//
// ## 这道门禁在守什么
//
// `scripts/verify-top-inset.mjs` 用 `TOP_BAR_VW = 17.067` 硬编码顶栏高，
// 由标题带中心反推 inset 时要除以它的**一半**。也就是说：
//
//   **每页顶栏都必须真的是 17.067vw，否则反推出的 inset 全部带系统偏差。**
//
// 这个假定此前**零防线**：
// - `PageTopBar`（~11 页在用）的两个变体被 `PageTopBar.template.test.ts:69,117`
//   钉住了 ✅
// - 4 个自绘顶栏的页（`Me` / `NetworkCheck` / `PlatformCheck` / `UpdatePage`）
//   只是**写了** `h-[17.067vw]`，没有任何门禁钉它 ❌
// - 脚本里那个 `17.067` 与页面里的 `17.067vw` 是**两个独立的字面量**，
//   各自漂移时不会有任何东西变红 ❌
//
// 形态与本仓反复吃过的「接缝无人验」同类（见 `tests/metricsParse.test.ts` 头注）：
// A 有门禁、B 有门禁，**A 与 B 之间的等式没人验**。
//
// ## 这道门禁**做不到**什么（明写，避免下一个人以为它覆盖了全部）
//
// 首版曾试图「扫出全站所有画顶栏的文件、逐个校验它们的 `h-[…vw]`」。
// **实测不可行**：一个页面里 `h-[Nvw]` 大量用于**非顶栏**元素 ——
// `DownloadManager.vue` 10 处（进度条 / 列表格高）、`Bookmarks.vue` 的 `h-[48.4vw]`
// 是网格单元高度。首版因此把正常页面判红，是**判据过宽**而非页面有问题。
//
// ⇒ 本文件**不做**全站枚举，只验下面 5 条**无歧义**的。
// 全站顶栏几何一致性仍无机器防线；要补它需要的是「顶栏容器」的结构化识别
// （如按组件名 / 特定类串组合），不是正则扫 `h-[Nvw]`。
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../scripts/verify-top-inset.mjs', import.meta.url))

/** 全站顶栏高度的唯一定值（vw）。改它 = 改全站 25 条路由的顶部几何。 */
const TOP_BAR_VW = 17.067

const SCRIPT_BARE = readFileSync(SCRIPT, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*(?:\/\/|\*).*$/gm, '')

/** 4 个自绘顶栏的页（不经 PageTopBar）。新增此类页面时须同步登记。 */
const CUSTOM_BAR_PAGES = ['Me.vue', 'NetworkCheck.vue', 'PlatformCheck.vue', 'UpdatePage.vue']

const countIn = (src: string, re: RegExp): number => (src.match(re) ?? []).length

describe('顶栏高度 = 17.067vw（探测器的 load-bearing 假定）', () => {
  it('探测器的硬编码常量与页面实际一致（跨文件等式）', () => {
    // 本文件的核心：脚本里的 17.067 与页面里的 17.067vw 是两个独立字面量。
    // 谁漂移都不会红 —— 除非有这道门禁。
    const m = SCRIPT_BARE.match(/const\s+TOP_BAR_VW\s*=\s*([\d.]+)/)
    expect(m, 'verify-top-inset.mjs 里找不到 TOP_BAR_VW 声明').not.toBeNull()
    expect(
      Number(m![1]),
      `探测器的 TOP_BAR_VW = ${m![1]}，而页面实际用 ${TOP_BAR_VW}vw。\n` +
        '  两者不一致时，反推 inset 会带一个 (实际半高 − 假定半高) 的系统偏差，\n' +
        '  且该偏差对每页相同 —— 看起来像「所有页都偏了同样的量」，很容易被当成正常。',
    ).toBe(TOP_BAR_VW)
  })

  it('PageTopBar 的 back / 居中两个变体都在（回退阀走的也是同一高度）', () => {
    // 只钉一个变体是常见的漏网：回退构建下页面走另一条分支。
    const src = readFileSync(join(SRC, 'components/PageTopBar.vue'), 'utf8')
    const re = new RegExp(`h-\\[\\s*${TOP_BAR_VW}vw\\s*\\]`, 'g')
    expect(countIn(src, re), 'PageTopBar 的 back / 居中两个变体应各有一次高度声明').toBeGreaterThanOrEqual(2)
  })

  it('4 个自绘顶栏页各自声明了 17.067vw（此前无任何门禁钉它们）', () => {
    const bad: string[] = []
    for (const f of CUSTOM_BAR_PAGES) {
      const p = join(SRC, 'pages', f)
      if (!existsSync(p)) {
        bad.push(`${f} 不存在（文件被重命名/删除？登记需同步）`)
        continue
      }
      const src = readFileSync(p, 'utf8')
      if (countIn(src, new RegExp(`h-\\[\\s*${TOP_BAR_VW}vw\\s*\\]`)) === 0) {
        bad.push(`${f} 没有 h-[${TOP_BAR_VW}vw] 的顶栏高度声明`)
      }
    }
    expect(
      bad,
      `自绘顶栏页必须与 PageTopBar 同高（${TOP_BAR_VW}vw）—— 探测器按这个值的一半反推 inset，\n` +
        `  偏离会给该页实测值带系统偏差，且可能小到落在 ±12 容差内被放过。缺失项：\n    ${bad.join('\n    ')}`,
    ).toEqual([])
  })

  it('登记的自绘页清单非空且与已知实现相符（防空转）', () => {
    // ArchUnit `failOnEmptyShould` 教训：清单被清空时，上一条会静默恒真。
    expect(CUSTOM_BAR_PAGES.length).toBeGreaterThanOrEqual(4)
    // 反向核对：这 4 页确实**不**用 PageTopBar，否则登记就错了
    for (const f of CUSTOM_BAR_PAGES) {
      const src = readFileSync(join(SRC, 'pages', f), 'utf8')
      expect(src.includes('<PageTopBar'), `${f} 其实用的是 PageTopBar，登记该改`).toBe(false)
    }
  })

  it('safeArea.ts 的换算与顶栏高同源（让位几何与探测器不得脱钩）', () => {
    // safeArea.ts 也含 17.067：它是「顶部让位几何」的换算处，与探测器必须一致。
    const p = join(SRC, 'utils/safeArea.ts')
    expect(existsSync(p), 'safeArea.ts 不存在，路径假设已失效').toBe(true)
    const src = readFileSync(p, 'utf8')
    expect(
      countIn(src, new RegExp(`${TOP_BAR_VW}`)),
      'safeArea.ts 里没有 17.067 的换算 —— 让位几何与探测器可能已脱钩',
    ).toBeGreaterThan(0)
  })
})
