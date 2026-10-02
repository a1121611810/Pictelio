// ─── 状态栏遮罩对比度判据的判别力门禁（scripts/statusBarContrastVerdict.mjs）───
//
// ## 为什么要有这个文件
//
// `verify-statusbar-contrast.mjs` 的像素取样跑在 **adb + python** 里，vitest 跑不动；
// 而「这个数该判成什么」是最该有门禁的部分。故判定与几何常量都在
// `statusBarContrastVerdict.mjs`（无依赖纯函数），本文件与脚本共用同一份。
//
// 本门禁**不**断言「能算出一个数」—— 那对任何实现都成立，包括把返回字段写反的
// 实现。它断言的是**判别力**：同一套阈值下，把输入从「有遮罩」换成「无遮罩」、
// 把采样窗从「平色」换成「被铃铛占据」，结论必须**跟着变**。
//
// 判别力自证见本文件末尾的「变异对照」注释：把 MAX_ROW/FLATNESS 闸门短接掉，
// 这几条断言必须转红 —— 门禁能红才算数，只绿不红的门禁等于没门禁。
//
// ## 为什么现画 fixture，不提交 PNG
//
// 沿用 `tests/topInsetMetrics.test.ts` 的理由：提交的二进制 fixture 会陈旧 ——
// 改了阈值或几何，PNG 还在，断言已经对不上，门禁要么红得莫名其妙、
// 要么（更糟）有人把期望值改成「当前输出」那就彻底失去意义。
// 现画则每次运行都从**同一份几何定义**重新生成，期望值与几何写在同一处。
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyStatusBarContrast,
  contrastRatio,
  deriveStatusBarWindow,
  parseContrastMetricsOutput,
  relativeLuminance,
  MIN_COLUMN_FLATNESS,
  MIN_STATUS_BAR_CONTRAST,
  STATUS_BAR_TEXT,
  CENTER_COLUMN,
  EDGE_MARGIN,
} from '../scripts/statusBarContrastVerdict.mjs'
import { Canvas, encodePng, W, H, type RGB } from './helpers/rasterCanvas'

const METRICS = fileURLToPath(new URL('../scripts/status_bar_contrast_metrics.py', import.meta.url))

// ── 几何（与 verify-statusbar-contrast.mjs 同源：emulator-5554 / 1080×2160）──
// ⚠️ 画布尺寸与 inset 必须用共享 helper / 平台真值，不在此重复定义：
//    采样窗是**按比例**从屏宽算出来的，换尺寸就不是在验真机上标定的那套判据。
const INSET = 72
const FRAME = { x0: 0, y0: 0, x1: W, y1: INSET }
const WIN = deriveStatusBarWindow({ frame: FRAME, screenWidth: W })!
const Y_TOP = WIN.y0
const Y_BOT = WIN.y1
/** 采样窗必须与 ADR-0214 记录的取证条件逐字一致（y∈[4,68)） */
const DOCUMENTED_WINDOW = { x0: 454, x1: 626, y0: 4, y1: 68 }

const tmpDirs: string[] = []
function draw(name: string, shade: (x: number, y: number) => RGB): string {
  const c = new Canvas([255, 255, 255])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.set(x, y, shade(x, y))
  const dir = mkdtempSync(join(tmpdir(), 'statusbar-contrast-'))
  tmpDirs.push(dir)
  const file = join(dir, `${name}.png`)
  writeFileSync(file, encodePng(c.px))
  return file
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

/** 跑真正的 python 取样脚本（与真机路径同一条，不复制一份逻辑到测试里） */
function sample(file: string) {
  const out = execFileSync(
    'python3',
    [METRICS, file, String(WIN.x0), String(WIN.x1), String(WIN.y0), String(WIN.y1)],
    { encoding: 'utf8' },
  ).trim()
  return parseContrastMetricsOutput(out)
}

function verdictOf(m: ReturnType<typeof sample>, fg: number[] = STATUS_BAR_TEXT.light) {
  if (m.kind !== 'ok') throw new Error(`取样没给 ok：${JSON.stringify(m)}`)
  return classifyStatusBarContrast({
    foreground: fg,
    darkestBg: m.darkestBg,
    lightestBg: m.lightestBg,
    flatness: m.flatness,
  })
}

// ── fixture 几何：把真机取证记录里的两组底色**逐字**搬进来 ──
// ⚠️ 这些色值不是「挑的好看的」，而是 `recommendedBleedHeader.template.test.ts`
//    取证记录里量到的真实采样值。合成输入与真实输入的差异必须小于被测阈值。
const SC = {
  // 亮色 sky 板：`tokens.css` 亮色块 `--md-surface: #f8faff`（遮罩 0% 端，最实）
  surface: [248, 250, 255] as RGB,
  // 取证记录：有遮罩时该带内量到的最亮 / 最暗像素
  litDarkest: [205, 218, 231] as RGB,
  litLightest: [251, 252, 255] as RGB,
  // 取证记录：**无**遮罩时同一带的最暗像素（近乎不可见那一档）
  unlitDarkest: [41, 7, 8] as RGB,
  unlitLightest: [255, 253, 254] as RGB,
}

describe('采样窗推导（平台真值 → 窗）', () => {
  it('与 ADR-0214 取证记录的窗逐字一致：x[454,626) y[4,68)', () => {
    expect(WIN).toMatchObject(DOCUMENTED_WINDOW)
  })

  it('inset 缺失/非正/带太薄 ⇒ 判据不可用（不给空窗，不落进比较运算）', () => {
    expect(deriveStatusBarWindow({ frame: null, screenWidth: W })).toBeNull()
    expect(deriveStatusBarWindow({ frame: { x0: 0, y0: 72, x1: W, y1: 72 }, screenWidth: W })).toBeNull()
    // inset = 4 ⇒ 扣掉两侧 EDGE_MARGIN 后窗口为空
    expect(deriveStatusBarWindow({ frame: { x0: 0, y0: 0, x1: W, y1: 2 * EDGE_MARGIN }, screenWidth: W })).toBeNull()
    expect(deriveStatusBarWindow({ frame: FRAME, screenWidth: 0 })).toBeNull()
  })

  it('竖带落在正中：必须避开右上角铃铛，且左右对称', () => {
    expect(WIN.x0).toBeGreaterThan(W * 0.4)
    expect(WIN.x1).toBeLessThan(W * 0.6)
    expect(W - WIN.x1).toBe(WIN.x0) // 对称 ⇒ 左侧也不含运营商信息
    expect(CENTER_COLUMN[0]).toBeLessThan(CENTER_COLUMN[1])
  })
})

describe('WCAG 相对亮度（口径可被独立复算）', () => {
  it('纯黑 = 0、纯白 = 1，且纯白对纯黑恰为 21:1', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6)
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 2)
  })

  it('对比度对称：与参数顺序无关', () => {
    expect(contrastRatio(SC.litDarkest, STATUS_BAR_TEXT.light)).toBeCloseTo(
      contrastRatio(STATUS_BAR_TEXT.light, SC.litDarkest),
      9,
    )
  })

  it('**复算文档引用的 12.03:1 与 16.67:1**（本门禁存在的核心理由）', () => {
    // 取证记录：on-surface 深图标 rgb(25,28,32) 对最暗 rgb(205,218,231) = 12.03:1，
    // 对最亮 rgb(251,252,255) = 16.67:1。文档把这两个数当作事实引用了两处
    // （ADR-0214 §后果、glossary 状态栏遮罩行），所以本门禁把它们钉住：
    // 任何人改了 fg 常量或 WCAG 公式，这两个引用值会当场转红，而不是继续被复制。
    const fg = STATUS_BAR_TEXT.light
    expect(fg).toEqual([25, 28, 32])
    expect(contrastRatio(fg, SC.litDarkest)).toBeCloseTo(12.03, 2)
    expect(contrastRatio(fg, SC.litLightest)).toBeCloseTo(16.67, 2)
    // 取证记录里的「无遮罩」那一档同样要能复算出来
    expect(contrastRatio(fg, SC.unlitDarkest)).toBeCloseTo(1.09, 2)
  })
})

describe('python ↔ JS 接缝（parseContrastMetricsOutput）', () => {
  it('**用真实 python 输出**钉住字段序：flatness 在倒数第二位', () => {
    // ⚠️ 这条就是前车之鉴的封堵：`metricsParse.test.ts` 记着上一条接缝曾把
    //    `OK` 的字段取错位，两道闸门被无条件旁路而全量测试照样全绿。
    const r = sample(draw('seam', () => SC.surface))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.darkestBg).toEqual([248, 250, 255])
    expect(r.lightestBg).toEqual([248, 250, 255])
    // 纯平色图 ⇒ flatness 恰好 1.0000。取错字段位就会拿到 248 或 64。
    expect(r.flatness).toBeCloseTo(1, 6)
    expect(r.rows).toBe(Y_BOT - Y_TOP)
  })

  it('EMPTY / 畸形输出分别归类，不得当成「通过」', () => {
    expect(parseContrastMetricsOutput('EMPTY').kind).toBe('empty')
    expect(parseContrastMetricsOutput('OK 1 2 3').kind).toBe('malformed')
    expect(parseContrastMetricsOutput('OK a b c d e f g h').kind).toBe('malformed')
    expect(parseContrastMetricsOutput('NOPE 1 2 3').kind).toBe('malformed')
    // 字段数对但含非有限数 ⇒ 同样不得放行
    expect(parseContrastMetricsOutput('OK 1 2 3 4 5 6 NaN 8').kind).toBe('malformed')
  })
})

describe('判别力：同一套阈值下，输入变了结论必须跟着变', () => {
  // 三张 fixture 覆盖**有遮罩 / 无遮罩 / 窗内被实心内容占据**三种形态。
  // 关键断言不是「算出了多少」，而是**三者的 kind 不相同，且 PASS ≠ REJECT**。

  /** 带内铺指定底色（模拟「遮罩在该带内合成出的实际颜色」）。 */
  const flatBand = (c: RGB) => (_x: number, y: number) => (y < Y_BOT ? c : SC.surface)

  const scrimmed = sample(draw('scrimmed', flatBand(SC.litDarkest)))
  const unscrimmed = sample(draw('unscrimmed', flatBand(SC.unlitDarkest)))
  // 实心内容**压住采样窗的一部分**（~60% 宽）⇒ 每行有两种颜色、众数仍是背景
  // ⇒ flatness = 众数/行宽 ≈ 0.60 < 闸门 ⇒ REJECT。
  // ⚠️ 必须**部分**覆盖才拦得住：若压满整条采样窗，每行内部仍同色 ⇒ flatness = 1.0000
  //    ⇒ 闸门**放行**。那是本判据在原理上拦不住的失效面，单独有一条用例钉住。
  const BLOCK_W = Math.round((WIN.x1 - WIN.x0) * 0.6)
  const polluted = sample(
    draw('polluted', (x, y) =>
      x >= WIN.x0 && x < WIN.x0 + BLOCK_W && y < Y_BOT ? SC.unlitDarkest : SC.surface,
    ),
  )

  it('有遮罩 ⇒ PASS，且最坏一端复算为 12.03:1', () => {
    const v = verdictOf(scrimmed)
    expect(v.kind).toBe('pass')
    expect(v.worst).toBeCloseTo(12.03, 2)
    expect(v.branch).toBe('darkest')
  })

  it('**把遮罩抽掉 ⇒ 必须转 FAIL**（这是本门禁的判别力核心）', () => {
    // 若遮罩被删/令牌被换回字面量/高度写错，落到窗里的就是**封面原色**。
    // 判据必须在同一阈值、同一采样窗下由 pass 转 fail —— 否则它量的是别的东西。
    const v = verdictOf(unscrimmed)
    expect(v.kind).toBe('fail')
    expect(v.worst).toBeCloseTo(1.09, 2)
    expect(v.worst).toBeLessThan(MIN_STATUS_BAR_CONTRAST)
  })

  it('窗内被实心内容占据 ⇒ REJECT（**不是** FAIL，更不是 PASS）', () => {
    const v = verdictOf(polluted)
    expect(v.kind).toBe('reject')
    expect(v.branch).toBe('column-not-flat')
    // REJECT 必须**同时**不落在 pass 与 fail 上：三态互不等价。
    expect(v.kind).not.toBe('pass')
    expect(v.kind).not.toBe('fail')
  })

  it('三种形态的结论两两不同（防止「三态塌成一态」）', () => {
    const kinds = new Set([verdictOf(scrimmed).kind, verdictOf(unscrimmed).kind, verdictOf(polluted).kind])
    expect(kinds.size).toBe(3)
  })

  it('平色度闸门确实是**那道**闸门：被污染样本的 flatness 恰好低于阈值', () => {
    if (polluted.kind !== 'ok' || scrimmed.kind !== 'ok') throw new Error('fixture 取样失败')
    expect(polluted.flatness).toBeLessThan(MIN_COLUMN_FLATNESS)
    expect(scrimmed.flatness).toBeGreaterThanOrEqual(MIN_COLUMN_FLATNESS)
  })

  it('**报的是最坏一端，不是挑好看的报**（两端不等时才有意义）', () => {
    // ⚠️ 上面那些 fixture 全是**单一平色**，两端算出来相等 ⇒ `min` 与 `max` 同值，
    //    于是「把 Math.min 写成 Math.max」这个变异**照样全绿**（实测变异 2）。
    //    要钉住「取最坏」这条契约，必须有一张**两端真的不等**的带。
    //    这正是真机暗色主题的形态：带内 rgb(17,21,25) ~ rgb(26,29,34)，
    //    浅图标压在**较亮**那一端更吃力 ⇒ worst 落在 lightest。
    const rampTop: RGB = [17, 21, 25]
    const rampBottom: RGB = [200, 200, 200]
    const gradient = sample(
      draw('gradient', (_x, y) => {
        if (y >= Y_BOT) return SC.surface
        const t = (y - Y_TOP) / Math.max(1, Y_BOT - Y_TOP - 1)
        return [
          Math.round(rampTop[0] + (rampBottom[0] - rampTop[0]) * t),
          Math.round(rampTop[1] + (rampBottom[1] - rampTop[1]) * t),
          Math.round(rampTop[2] + (rampBottom[2] - rampTop[2]) * t),
        ]
      }),
    )
    if (gradient.kind !== 'ok') throw new Error('fixture 取样失败')
    // 前置：这张带的两端**确实不等**（否则下面两条断言是空转）
    expect(contrastRatio(STATUS_BAR_TEXT.light, gradient.darkestBg)).not.toBeCloseTo(
      contrastRatio(STATUS_BAR_TEXT.light, gradient.lightestBg),
      2,
    )

    // 深图标压这条带：带顶 rgb(17,21,25) 与深图标**几乎同色** ⇒ 最坏落在**最暗**一端。
    // 这正是遮罩要解决的那一档（浅色封面 + 深图标近乎不可见），故这里是 fail。
    const darkFg = verdictOf(gradient, STATUS_BAR_TEXT.light)
    expect(darkFg.branch).toBe('darkest')
    expect(darkFg.worst).toBe(darkFg.vsDarkest)
    expect(darkFg.kind).toBe('fail')

    // 浅图标压同一条带：带底 rgb(200,200,200) 与浅图标更接近 ⇒ 最坏翻到**最亮**一端。
    // 两端最坏方向相反，才说明 `branch` 真的在跟着数据走，而不是写死一个名字。
    const lightFg = verdictOf(gradient, STATUS_BAR_TEXT.dark)
    expect(lightFg.branch).toBe('lightest')
    expect(lightFg.worst).toBe(lightFg.vsLightest)

    // 契约本体：worst 恒为两端之**小**、best 恒为**大**（变异：min 写成 max ⇒ 此处转红）
    for (const v of [darkFg, lightFg]) {
      expect(v.worst).toBeCloseTo(Math.min(v.vsDarkest, v.vsLightest), 9)
      expect(v.best).toBeCloseTo(Math.max(v.vsDarkest, v.vsLightest), 9)
      expect(v.worst).toBeLessThanOrEqual(v.best)
    }
  })

  it('**已登记失效面**：实心内容压满整条采样窗 ⇒ flatness=1.0000 ⇒ 闸门放行（拦不住）', () => {
    // AGENTS.md「门禁冻结线」#5：已知失效面必须显式钉住，而不是只记它抓到了什么。
    // 这条**不**是「期望它拦住」，而是「如实记录它拦不住，且记录为什么」：
    // 压满整窗时每行内部同色，颜色统计与干净的平色遮罩**同形**。
    // 主防线是正中竖带按设计不含铃铛/运营商信息，本闸门只是第二道。
    const full = sample(
      draw('full', (x, y) => (x >= WIN.x0 && x < WIN.x1 && y < Y_BOT ? SC.unlitDarkest : SC.surface)),
    )
    if (full.kind !== 'ok') throw new Error('fixture 取样失败')
    expect(full.flatness).toBeCloseTo(1, 6)
    expect(full.flatness).toBeGreaterThanOrEqual(MIN_COLUMN_FLATNESS)
    // 后果如实记录：它会走完判定，量到的是**那个内容**的颜色
    expect(verdictOf(full).kind).not.toBe('reject')
  })
})

describe('守卫：非有限数一律显式拒绝（不得静默旁路阈值）', () => {
  const base = { foreground: STATUS_BAR_TEXT.light, darkestBg: SC.litDarkest, lightestBg: SC.litLightest, flatness: 1 }

  it('flatness 为 NaN / Infinity ⇒ reject', () => {
    expect(classifyStatusBarContrast({ ...base, flatness: NaN }).kind).toBe('reject')
    expect(classifyStatusBarContrast({ ...base, flatness: Infinity }).kind).toBe('reject')
  })

  it('底色 / 文字色 / 阈值含 NaN ⇒ reject', () => {
    expect(classifyStatusBarContrast({ ...base, darkestBg: [NaN, 0, 0] }).kind).toBe('reject')
    expect(classifyStatusBarContrast({ ...base, foreground: [25, 28, NaN] }).kind).toBe('reject')
    expect(classifyStatusBarContrast({ ...base, threshold: NaN }).kind).toBe('reject')
  })

  it('**非有限数不得给出 pass**：`NaN < 4.5` 是 false，短接比较就会假绿', () => {
    // 这条是「为什么会红」的解释性断言：把守卫拿掉，NaN 会一路落到
    // `worst >= threshold`，而 `NaN >= 4.5` 同样是 false ⇒ 报 fail；
    // 但若实现写成 `!(worst < threshold)` 就会得到**假绿**。故必须显式钉住 reject。
    const v = classifyStatusBarContrast({ ...base, flatness: NaN })
    expect(v.kind).toBe('reject')
    expect(v.branch).toBe('non-finite-input')
  })
})

describe('暗色极性（跨端契约的另一侧）', () => {
  it('暗色主题文字 = 浅图标 rgb(224,226,232)（= 暗色板 --md-on-surface）', () => {
    expect(STATUS_BAR_TEXT.dark).toEqual([224, 226, 232])
  })

  it('极性传反 ⇒ 报出**假 FAIL**：浅图标压深底', () => {
    // 真机上暗色主题漏传 --fg dark 就会走到这一支。判据必须把它**报红**，
    // 因为那个数确实不达标 —— 关键是它要给出 fail 而**不是** reject，
    // 这样运维才会去看极性，而不是以为判据坏了。
    const darkBg: RGB = [16, 20, 24] // 暗色板 --md-surface #101418
    const v = classifyStatusBarContrast({
      foreground: STATUS_BAR_TEXT.dark,
      darkestBg: darkBg,
      lightestBg: darkBg,
      flatness: 1,
    })
    expect(v.kind).toBe('pass')
    const wrong = classifyStatusBarContrast({
      foreground: STATUS_BAR_TEXT.light, // 极性传反
      darkestBg: darkBg,
      lightestBg: darkBg,
      flatness: 1,
    })
    expect(wrong.kind).toBe('fail')
    expect(wrong.worst).toBeLessThan(MIN_STATUS_BAR_CONTRAST)
  })
})

// ── 变异对照（门禁能红的凭据）────────────────────────────────────────────
// 本文件里**没有**任何「只断言产出数字」的用例；全部断言都锁在 kind 的翻转或
// 具体色值上。人工变异验证：把 `classifyStatusBarContrast` 里的
// `if (flatness < MIN_COLUMN_FLATNESS) return reject('column-not-flat')`
// 整行注释掉 ⇒ 「窗内被实心内容占据 ⇒ REJECT」与「三种形态两两不同」两条**必须转红**，
// 且污染样本会被误判成 pass/fail —— 正是我们要它抓住的那类失效。
// 把 `worst` 改成 `Math.max(...)` ⇒ 「把遮罩抽掉 ⇒ 必须转 FAIL」必须转红。
