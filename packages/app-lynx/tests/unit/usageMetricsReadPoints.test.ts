// 度量读点存在性门禁（Spec 审计 P-2 的模板 B 防线）。
//
// 【为什么需要这道门】spec §4 P0.5 承诺四个本地指标，此前**只存在于文档**——
// 代码里零读点，审计一 read-point 反事实判据判为未接线（possible silent misconfiguration）。
// 本门禁把「承诺」钉成「代码里真有读点」，防它再次退化成只有文档。
//
// 【抽取器自检（ArchUnit `failOnEmptyShould` 教训）】见最后一条用例：
// 若正则因改写而失配，本门禁会**自己报红**，而不是恒真放行。
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import {
  emptySectionRate,
  tabShare,
  subTabShare,
  REVISIT_SAMPLE_LIMIT,
} from "../../src/primitives/usageMetrics"

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

function productionSources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) {
        if (name === "i18n") continue
        walk(abs)
      } else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) {
        out.push(abs)
      }
    }
  }
  walk(SRC)
  return out
}

const ALL = productionSources()
/**
 * 语料**先剥注释再入表**。
 *
 * 【为什么必须剥】第三轮 Standards 审查实测出的假绿：把 7 个真实读点全删、
 * 只在原地留一行 `// useUsageMetricsStore().recordXxx(...)` 注释，
 * 裸正则逐行扫描仍会命中 ⇒ 门禁 9/9 全绿。注释不是读点。
 * （同族判据：`bottomOcclusionAllowance.test.ts:558` 剥 HTML 注释；
 *   本门禁首版只处理了"定义处"，漏了"注释处"这一支 —— 两支都漏才是首版全绿的原因。）
 *
 * 【剥法】`/* *\/` 块注释 + 行注释。行注释用 `(^|\s)\/\/` 而非 `//`：
 *   `https://…` 的 `//` 前面是 `:`，不会被误剥；`code(); // 注释` 前面是空格，会被剥。
 */
const CORPUS = ALL.map((f) => ({
  file: relative(SRC, f),
  text: readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, ""),
}))

/**
 * 定义处不算读点（这正是本门禁**第一版假绿**的原因）。
 *
 * 首版用 `hits(/\brecordTabVisit\s*\(/)` 找读点，而纯逻辑文件里
 * `recordTabVisit(name: number): UsageMetrics {` 这条**接口声明与函数体首行**
 * 本身就匹配同一条正则 ⇒ 即使四个 record 读点全被删光，门禁照样全绿。
 * 更隐蔽的是三个比率函数：它们**只有**定义处会匹配
 * （`export function tabShare(...)`），生产代码里出现 0 次也能过 ——
 * 「有计数没率」这个判据在首版是恒真的。
 *
 * ⇒ 读点的定义收紧为「**度量实现层之外**的调用点」，两个文件整体排除：
 *   - primitives/usageMetrics.ts  纯逻辑 + 比率函数本体
 *   - stores/usageMetrics.ts      接线层，`commit((m) => m.recordXxx(...))`
 *                                 是把调用转交给纯逻辑的内部委托，不是消费点
 * 判据最后一条用例断言「这两个文件确实在语料里」，防止剔除逻辑本身静默失效。
 */
const IMPL_FILES = new Set(["primitives/usageMetrics.ts", "stores/usageMetrics.ts"])

/** 全仓未截断命中清单（`outsideImpl = true` 时剔除度量实现层自身） */
function hits(pattern: RegExp, outsideImpl = false): string[] {
  const found: string[] = []
  for (const { file, text } of CORPUS) {
    if (outsideImpl && IMPL_FILES.has(file)) continue
    text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) found.push(`${file}:${i + 1}`)
    })
  }
  return found
}

describe("度量读点存在性门禁（spec §4 P0.5 · 模板 B）", () => {
  // 四个 record 读点合为一条循环用例：它们是**同一判据换符号**，逐条展开只会让门禁
  // 文件虚增（第三轮 Standards 审查 I-8 的门禁冻结线意见），而判据强度完全相同。
  // 失败信息仍逐符号点名，定位能力不损失。
  const RECORD_READ_POINTS: ReadonlyArray<[指标: string, 符号: string]> = [
    ["复访间隔", "recordLaunch"],
    ["顶层触达率", "recordTabVisit"],
    ["二级使用占比", "recordSubTabUse"],
    ["空段出现率", "recordSectionObserved"],
  ]

  it("四个指标各有**计数**读点（写入侧）", () => {
    for (const [metric, fn] of RECORD_READ_POINTS) {
      expect(hits(new RegExp(`\\b${fn}\\s*\\(`), true), `${metric}（${fn}）读点缺失`).not.toEqual([])
    }
  })

  it("四个指标都有**比率**读出口（不只有计数 —— 「有计数没率」等于没实现指标）", () => {
    for (const fn of ["emptySectionRate", "tabShare", "subTabShare"]) {
      expect(hits(new RegExp(`\\b${fn}\\s*\\(`), true), `${fn} 在实现层之外无读点`).not.toEqual([])
    }
  })

  it("隐私约束：使用度量不得进备份域（决策 5 = A，键不带 uid 且不在 BACKUP_DEVICE_KEYS）", () => {
    // 备份域守卫在 settingsStore.test.ts 的 *_KEY ⊆ BACKUP_DEVICE_KEYS；此处反向断言
    // 「度量键没有被列进任何账号级/备份级键表」。
    const settingsStore = readFileSync(join(SRC, "stores/settingsStore.ts"), "utf8")
    expect(settingsStore).not.toContain("usage_metrics")
  })

  it("抽取器不得静默空转（ArchUnit failOnEmptyShould 教训）", () => {
    // 语料规模下界：src 生产源码远多于 50 个文件；若路径写错导致语料为空，全部断言会恒真
    expect(ALL.length, "生产源码语料异常为空 —— 抽取路径可能已失配").toBeGreaterThan(50)
    expect(REVISIT_SAMPLE_LIMIT).toBeGreaterThan(0)
  })

  it("顶层触达率的记录点在**路由落定侧**（冷启动/登录后不漏记）", () => {
    // 模拟器实测证据：记录点原挂在 FAB dispatch 的 select 分支上，而冷启动直接落在
    // /discover、登录成功后也直接 navigate 过去，两条路径都不过 dispatch
    // ⇒ tabHits.discover 恒 0，面板显示「发现 0% / 我的 100%」，数字会让人判反。
    const app = readFileSync(join(SRC, "App.vue"), "utf8")
    expect(app, "App.vue 应在 routeState 落定侧记录顶层触达").toMatch(
      /watch\(\s*\(\)\s*=>\s*routeState\.value\s*,/,
    )
    expect(app).toMatch(/topLevelTabForPath\(path\)/)
    // ⚠️ 反向断言：监听 `.value.path` 是**假接线**。routeState 的占位初值就是
    //   DISCOVER_PATH，而冷启动真实落点也是 DISCOVER_PATH ⇒ 新旧值相同、watcher 不触发。
    //   该形态下 3760 条测试全绿而真机面板仍显示「发现 0%」——只有真机能抓到。
    expect(
      app,
      "不得监听 routeState.value.path：占位值与首落点相同会令 watcher 不触发（真机实测缺陷）",
    ).not.toMatch(/=>\s*routeState\.value\.path\s*,/)
    // ⚠️ 剥注释后再断言：App.vue 的注释里**正**写着「不用 `immediate: true`」，
    //   不剥就会命中注释本身 ⇒ 判据恒真（与本仓同族教训：token 写进注释就能假绿）。
    const appCode = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(
      appCode,
      "顶层触达 watch 不得带 immediate：routeState 初值是占位值，immediate 会把占位记成触达",
    ).not.toMatch(/immediate\s*:\s*true/)
    // 记录点唯一：FAB 侧若还留着 dispatch 记录，同一次切 tab 会被计两次
    const fabStore = readFileSync(join(SRC, "stores/globalFab.ts"), "utf8")
    expect(fabStore, "globalFab 不应再记顶层触达（会与 App.vue 双计）").not.toMatch(
      /\brecordTabVisit\s*\(/,
    )
  })

  it("剥注释真的生效：同一段文本，剥前命中、剥后不命中", () => {
    // ⚠️ 第三轮 Standards 审查 I-4 指出：此前这条「自证」是**假的** —— 它只重复断言了
    //   「实现层之外存在读点」，从未拿注释语料做过对照，等于没验剥离逻辑。
    //   本条改用**可证伪的对照**：同一行文本，剥注释前应命中、剥后应不命中。
    const needle = "recordSectionObserved("
    const onlyComment = `    // ${needle} 这里只是说明，不是读点`

    // 剥前：裸正则确实会命中（这正是假绿的成因）
    expect(
      [...onlyComment.matchAll(/\brecordSectionObserved\s*\(/g)].length,
      "剥离前本应命中（若不命中，说明这条对照已无意义）",
    ).toBe(1)
    // 剥后：走本文件实际的语料管线，必须不命中
    const stripped = onlyComment
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "")
    expect([...stripped.matchAll(/\brecordSectionObserved\s*\(/g)].length, "剥注释后仍命中 ⇒ 剥离失效").toBe(0)

    // 且真实语料里确实存在带行注释的生产文件（否则上面只是自说自话）
    const withComments = CORPUS.filter((c) => /^\s*\/\//m.test(readFileSync(join(SRC, c.file), "utf8")))
    expect(withComments.length, "语料里没有带行注释的生产文件 —— 对照失去意义").toBeGreaterThan(10)
  })

  it("剔除逻辑不得静默失效（否则 outsideImpl 退化成恒真筛选）", () => {    // 上面所有读点判据都依赖「实现层被剔除」。若这两个文件因重命名/搬家不在语料里，
    // 剔除就成了 no-op，首版那种假绿会**原样回来**且更难察觉 —— 故显式钉住它们在语料中。
    for (const f of IMPL_FILES) {
      expect(
        CORPUS.some((c) => c.file === f),
        `度量实现层 ${f} 不在语料中，outsideImpl 剔除已失效`,
      ).toBe(true)
    }
  })

  it("「比率读出口」不是被实现层自身满足的（反事实：把实现层算回去必须变红）", () => {
    // 显式反向断言：同一个 pattern 在**含**实现层的语料里必然多出命中。
    // 若哪天有人把 hits() 的 outsideImpl 参数悄悄删掉，这条会先红。
    for (const fn of ["tabShare", "subTabShare", "emptySectionRate"]) {
      const p = new RegExp(`\\b${fn}\\s*\\(`)
      expect(hits(p).length, `${fn} 在实现层内竟然没有定义处命中？剔除名单可能已过期`).toBeGreaterThan(
        hits(p, true).length,
      )
    }
  })
})
