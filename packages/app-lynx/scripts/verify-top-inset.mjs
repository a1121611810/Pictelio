#!/usr/bin/env node
// ─── 顶部让位真机幅值对拍（#900 T1 / 票 #905）───
//
// ## 这条脚本存在的理由
//
// 上一轮「每处安全区补偿被放大 density 倍」的缺陷，在**「状态栏区域染 surface 了吗」**
// 这种判据下全绿通过 —— 因为放大了 3 倍之后它**仍然是染了的**。整条流水线里没有一处
// 量过幅值。判据问「有没有」时必须同时问「如果是 3 倍，这条判据还会绿吗」；会绿就是废判据。
//
// 故本脚本只做一件事：**把应用实际渲染出的顶部让位，与平台真值对拍，报出数字与偏差**。
//
// ## 测量原理（为什么量「顶栏下边缘」而不是量「状态栏高度」）
//
// 顶部那条带（Root 内边距 + 顶栏本身）**都是同一个 surface 色**，两者在像素上连成一片，
// 分不出边界 —— 任何「量状态栏区域多高」的做法都会量到一个把两者合并的值，测不出倍率。
//
// 可测的边界是**顶栏的下边缘**：其下是页面内容（推荐页 = surface-container-lowest 的白），
// 其上是 surface。颜色不同 ⇒ 有硬边界 ⇒ 可精确定位。
//
// 期望值完全由**独立来源**推出（不经本仓任何代码）：
//   顶栏下边缘 y = 状态栏 inset（dumpsys，物理 px） + 顶栏高（17.067vw，vw 是视口宽的 1%）
//
// ## 用法与**适用范围**（务必先读）
//   node packages/app-lynx/scripts/verify-top-inset.mjs [--page <路由名>] [--tolerance 12]
//     --page  声明**当前停在哪个路由**（缺省 recommended）。它不做导航，只用于查该路由的
//            让位归属声明；拼错不会报错而是退回缺省值，故建议显式传。
//   （需先安装，并停在一个**有 M3 顶栏、且顶栏底色为浅色 surface** 的页面）
//
//   ⚠️ 本脚本**不适用**于两类页面，对它们给不出有意义的结果：
//     ① **无顶栏页**（含 B 变体首页：顶栏已取消、封面出血到 y=0）—— 窗内不存在
//        「标题居中于 64dp 顶栏」这个几何事实可量。v3 起会**显式拒绝**而非报错
//        （反推 inset ≤ 0 ⇒ 判据不可用，见 topInsetVerdict.mjs `inconclusive`）。
//        ⚠️ 该形态与「顶栏在但让位完全失效」给出**同一个数**，本判据无法区分，
//        所以拒绝时请看截图自己判。肉眼判定：页面顶部**没有**一条与背景异色的横向条。
//     ② **顶栏区为深色底的页面**（如沉浸式出血到深色封面下）—— v1 在此恒真；
//        v2 已加行内占比闸门把它变成**显式拒绝**（见 findTitleBandCenter 说明），
//        但**拒绝 ≠ 通过**：此时应换页面测，不要绕过闸门。
//
//   ⚠️ 判定逻辑在 `scripts/topInsetVerdict.mjs`（无依赖纯函数），
//      门禁在 `tests/topInsetVerdict.test.ts` —— 改判定请连门禁一起改。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyTopInsetVerdict,
  resolveDeclaredTopInset,
  parseMetricsOutput,
  TITLE_GLYPH_BIAS,
  DEFAULT_TOLERANCE,
} from './topInsetVerdict.mjs'

/** 顶栏高度档位（vw）。必须与 tailwind.config.ts / 各页顶栏的 17.067vw 同源。
 *  抽成常量是为了让「期望值」这一步可审计：改档位时这里要一起改，且 review 会看见。 */
const TOP_BAR_VW = 17.067

/**
 * 标题文字带中心相对「顶栏盒中心」的固有偏移（物理 px）。
 *
 * ## 这个常量是什么、为什么必须显式登记
 *
 * 判据量的是**文字像素带的中心**，而 inset 决定的是**顶栏盒的位置**。两者差一个
 * 「字形盒中心 vs 行盒中心」的偏移，在本仓字体 + 22sp 标题下实测恒为 +3.3 物理 px。
 *
 * 它是**系统性偏置，不是误差**：所有页面同一个值（实测 5 页极差 0.5 px）。
 * 显式登记它的意义是：容差不再是「调到绿为止」的拍脑袋数字，而是
 * 「固有偏置 3.3 + 留 8.7 余量 = 12」。任何**真实缺陷**（spacer 失效 -64、
 * 倍率错 +576）都远超这个量级，不会被容差吞掉。
 *
 * ## 为什么不用「色块边界」当锚点（第一版的错误）
 *
 * 第一版量「surface → 内容的第一次色变」。它在推荐页/插画页成立（内容紧接顶栏），
 * 但在「我的」页失效：那里顶栏下方有一段留白，色变落在**卡片顶边**而不是顶栏下边缘，
 * 于是把卡片边距算进了 inset（实测偏 +34.7 px，误报 FAIL）。
 * ⇒ 判据依赖页面结构就不是好判据。标题文字带是**所有有顶栏的页面共有**的元素，
 * 与页面下方长什么样无关。
 *
 * ⚠️ 上面这段推导的**结论**（`TITLE_GLYPH_BIAS = 3.3` 与 `DEFAULT_TOLERANCE = 12`）
 *    已迁到 `scripts/topInsetVerdict.mjs`：测试要 import 同一份常量，
 *    否则改了偏置而门禁仍按旧值测，就是一道**静默失效**的门禁。
 *    本文件不再重复定义，避免两份真值。
 */

/** 标题文字视为「深色」的亮度上限（on-surface 在 surface 上远低于此） */
const DARK_LUMA_MAX = 128
/** 判定为「这一行含文字」所需的深色采样点数下限 */
const MIN_DARK_PX = 4

/**
 * 单行深色占比上限 —— **背景 / 文字判别闸门**（v2 补，见下）。
 *
 * 文字行是**稀疏**的（笔画只占行宽的一小段），背景行是**连续**的。
 * 实测（emulator-5554，采样 x∈[0.15W,0.85W] 步长 3）：
 *   · 真实标题行峰值占比：插画列表 12.7% / 我的 9.9% / B 变体胶囊行 27.0%
 *   · **纯色暗背景：164 行全部 100%**
 * 取 60% 作闸门：文字侧最大实测 27%，背景侧 100%，中间有 2 倍以上余量。
 */
const MAX_ROW_DARK_RATIO = 0.6

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function fail(msg) {
  console.error(`FAIL  ${msg}`)
  process.exitCode = 1
}

/** 平台真值：状态栏 inset（物理 px）。取 InsetsSource 的 frame 高度。 */
function platformStatusBarInset() {
  const out = adb(['shell', 'dumpsys', 'window'])
  const m = out.match(/type=statusBars\s+frame=\[0,0\]\[(\d+),(\d+)\]/)
  if (!m) throw new Error('dumpsys window 中找不到 type=statusBars 的 frame')
  return Number(m[2])
}

/** 平台真值：density（dpi）。换算比率 = dpi / 160。 */
function platformDensity() {
  const out = adb(['shell', 'wm', 'density'])
  const m = out.match(/Physical density:\s*(\d+)/)
  if (!m) throw new Error('wm density 输出无法解析')
  return Number(m[1])
}

function screenWidth() {
  const out = adb(['shell', 'wm', 'size'])
  const m = out.match(/Physical size:\s*(\d+)x(\d+)/)
  if (!m) throw new Error('wm size 输出无法解析')
  return Number(m[1])
}

/** 抓一张截图到临时 PNG */
function screenshot() {
  const dir = mkdtempSync(join(tmpdir(), 'topinset-'))
  const file = join(dir, 'shot.png')
  writeFileSync(file, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }))
  return file
}

/** 亮度（Rec.601 近似） */
function luma([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 纯像素扫描：求顶栏标题「文字像素带」的垂直中心（物理 px）。
 *
 * 搜索窗口 [inset+10, inset+barH-10] 来自 **dumpsys 平台真值**，不来自被测应用 ——
 * 所以若应用把 inset 放大 N 倍，标题会跑出窗口，量到的中心随之错误 ⇒ 被判红。
 * 窗口留 10px 余量是为容忍文字带不贴顶栏盒边缘。
 *
 * ## ⚠️ 背景/文字判别（v2 修补，务必保留）
 *
 * v1 只判「这一行有没有深色像素」。**在暗背景下它会恒真**：纯色暗屏的每一行都达标 ⇒
 * 「第一段连续暗行」饱和整个窗口 ⇒ 中心 = 窗口中心 ⇒ 反推出一个**与渲染无关的常数**
 * （inset−0.5−偏置 ≈ 68）⇒ 对「正确渲染 / 3× 缺陷 / spacer 失效」给出**完全相同的数字与判定**。
 * 实测复现：纯色 #1a6fa8 屏（根本没有任何标题）报出「✅ 通过、偏差 −4.0」。
 *
 * 这正是本脚本自己在注释里禁止的废判据形态（「如果是 N 倍，这条判据还会绿吗；会绿就是废判据」），
 * 所以必须加**行内深色占比**闸门把「连续背景」与「稀疏文字」分开。
 *
 * 返回 null 表示「未找到可信文字带」——调用方须据此判红，**不得**当成通过。
 *
 * 同时返回**窗内行均匀度中位数**（medianUniformity）：每一行取「最常见颜色的占比」，
 * 再取中位数。用来判「这个窗口里到底有没有一块平色 surface」。
 *
 * ⚠️ 为什么必须有它（实测数据，不是推演）：
 *   搜索窗 [82, 246] 在**无顶栏页**上落在封面图里，深色头发的稀疏深色像素会被
 *   当成「文字」（行内占比 6.3%，过不了 60% 连续背景闸门，却够得上「稀疏文字」）。
 *   由此反推出的 inset 完全取决于**封面画的是谁**：同一张首页，实测出现过
 *   −1.5 与 +9.5 两个值 ⇒ 纯噪声，却都被当成真实偏差报了出去。
 *   只靠「反推值 ≤ 0」去拦是**从一个样本推的**，拦不住另一半。
 *
 * ⚠️ 为什么有两个度量（实测，emulator-5554 / 窗 [82,246]）：
 *   逐行**横向**均匀度对「平滑纵向渐变封面」恒为 1.000（每行横向本就同色），
 *   而渐变封面在推荐流里很常见 ⇒ 单看它会漏一整族。跨行众数一致 ≥0.9 才拦得住。
 *   完整实测表见 `scripts/top_inset_metrics.py` 的 docstring。
 *   ⚠️ 两者都只是**第二/第三道防线**：首页有无顶栏由**路由声明**说了算
 *   （见 `resolveDeclaredTopInset`）—— 像素度量随封面变化，不能当主判据。
 */
function findTitleBandCenter(pngPath, insetPhysical, barPhysical) {
  const lo = insetPhysical + 10
  const hi = Math.round(insetPhysical + barPhysical - 10)
  // 度量在独立脚本里（scripts/top_inset_metrics.py）而不是内嵌字符串：
  // 内嵌版只有「连着真机跑一遍」这一条验证路径，而「它现在是对的」与
  // 「它对所有输入都对」完全同形。合成 fixture 由 tests/topInsetMetrics.test.ts 提供。
  const out = execFileSync(
    'python3',
    [fileURLToPath(new URL('./top_inset_metrics.py', import.meta.url)), pngPath, String(lo), String(hi)],
    { encoding: 'utf8' },
  ).trim()
  // 解析走 `parseMetricsOutput`（无依赖纯函数，与 tests/metricsParse.test.ts 共用）：
  // 首版把字段序内联在此处，取成了 center/start ⇒ 两道平色闸门被无条件旁路，
  // 而全量 3568 条测试照样全绿。详见该函数的头注。
  const r = parseMetricsOutput(out)
  if (r.kind === 'malformed') {
    fail(`度量脚本输出无法解析：\`${out}\`\n  这通常意味着 python 侧契约变了而解析器没跟上 ——\n` +
      `  此时脚本**不会**判红也不会判绿，而是直接停下。`)
  }
  if (r.kind === 'none' || r.kind === 'background') return r
  return {
    kind: 'ok',
    center: r.center,
    band: `${r.start}–${r.end}`,
    peakRatio: r.peak,
    medianUniformity: r.medianUniformity,
    crossRowAgreement: r.crossRowAgreement,
  }
}

function tryRead(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

const args = process.argv.slice(2)
// 未知参数**直接拒绝**，不静默忽略：拼错 `--pages` / `--page=x` 若被忽略，
// 会退回缺省 `recommended`，在 `PICTELIO_HOME_BLEED=0` 构建下就**静默跳过**
// 「本页有无顶栏」这道前置条件 —— 而那道闸门正是本脚本防误诊的关键。
const KNOWN = new Set(['--page', '--tolerance'])
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (!a.startsWith('--')) continue
  if (!KNOWN.has(a)) {
    fail(`未知参数 \`${a}\`。本脚本只接受：${[...KNOWN].join(' / ')}。\n` +
      `  静默忽略拼错的参数会让 --page 退回缺省值，在回退构建下直接跳过前置条件闸门。`)
  }
  if (args[i + 1] === undefined) fail(`参数 \`${a}\` 缺值。`)
}
const tolIdx = args.indexOf('--tolerance')
const TOLERANCE = tolIdx === -1 ? DEFAULT_TOLERANCE : Number(args[tolIdx + 1])

console.log('=== 顶部让位 · 真机幅值对拍（#905）===\n')

const insetPhysical = platformStatusBarInset()
const densityDpi = platformDensity()
const scale = densityDpi / 160
const widthPhysical = screenWidth()

// 顶栏高：vw 是视口宽的 1%，故直接用**物理**视口宽换算（避免中途引入逻辑/物理混用）
const barPhysical = (TOP_BAR_VW / 100) * widthPhysical

console.log(`平台真值（dumpsys / wm）`)
console.log(`  状态栏 inset        = ${insetPhysical} 物理 px`)
console.log(`  density             = ${densityDpi} dpi  ⇒ 换算比率 ${scale.toFixed(1)}`)
console.log(`  视口宽              = ${widthPhysical} 物理 px`)
console.log(`  inset 的逻辑值      = ${(insetPhysical / scale).toFixed(1)} px  （平台真值 ÷ 比率）`)
console.log(`  顶栏高 ${TOP_BAR_VW}vw      = ${barPhysical.toFixed(2)} 物理 px（其半 = ${(barPhysical / 2).toFixed(2)}）`)

const png = screenshot()
console.log(`\n实测`)
console.log(`  截图                = ${png}`)

// ── 前置条件 ⓪：按**应用自己的路由声明**判定，不从像素猜 ──
//
// 为什么放在像素度量**之前**：无顶栏页的判定本质是「有没有顶栏」，而像素只能猜。
// 首页封面可以是任意内容 —— 浅色低细节插画的逐行均匀度能到 1.000，
// 与浅色顶栏在颜色统计上同形（见 topInsetVerdict.mjs 登记的残留失效面）。
// 而 `src/router.ts` 里**已经写着**这条路由的让位归属：bleed 就是没有顶栏。
// 那是规格级事实，比任何像素启发式都可靠，而且是免费的。
const pageIdx = args.indexOf('--page')
const PAGE = pageIdx === -1 ? 'recommended' : args[pageIdx + 1]
const pageTopInset = resolveDeclaredTopInset(
  PAGE,
  tryRead(fileURLToPath(new URL('../src/router.ts', import.meta.url))) ?? '',
  tryRead(fileURLToPath(new URL('../dist/main.web.bundle', import.meta.url))),
)
if (pageTopInset === 'bleed') {
  fail(
    `被测路由 \`${PAGE}\` 在当前构建下的让位归属是 **bleed**（**无顶栏**），本判据不适用。\n` +
      `  依据 src/router.ts 里该路由自己的 meta.topInset 声明 —— 那是应用自己的规格，\n` +
      `  比任何像素启发式都可靠：bleed 就是「两侧都不让位」，不存在「标题居中于顶栏」可量。\n` +
      `  ⇒ 请停到**有 M3 顶栏**的页面再测，并带上 --page <路由名>，例如：\n` +
      `     node scripts/verify-top-inset.mjs --page bookmarks\n` +
      `  ⇒ 若你就是想测首页：bleed 归属下首页**本来就不该有顶栏**，本脚本测不出东西。`,
  )
  process.exit(1)
}

const band = findTitleBandCenter(png, insetPhysical, barPhysical)
if (!band || band.kind === 'background') {
  fail(
    `搜索窗内是**连续背景**而非文字（行内深色占比 > ${(MAX_ROW_DARK_RATIO * 100).toFixed(0)}%）——` +
      `\n  搜索窗 [${insetPhysical + 10}, ${Math.round(insetPhysical + barPhysical - 10)}] 物理 px 内每行都过暗阈值，` +
      `\n  「第一段连续暗行」会饱和整窗 ⇒ 中心恒等于窗中心 ⇒ 反推出一个**与渲染无关的常数**。` +
      `\n  ⚠️ 这正是本脚本禁止的废判据形态：此时对「正确渲染 / 倍率错 / spacer 失效」会给出**相同**结果。` +
      `\n  可能：① 页面顶栏区域是深色底（B 变体出血到深色封面下）；② 停在启动闪屏；③ 应用未渲染。` +
      `\n  ⇒ 换到**顶栏为浅色**的页面再测，或先确认屏幕已就绪。本判据在此背景下不可用。`,
  )
  process.exit(1)
}
if (band.kind === 'none') {
  fail(
    `未在顶栏区域找到标题文字带。\n` +
      `  搜索窗口 [${insetPhysical + 10}, ${Math.round(insetPhysical + barPhysical - 10)}] 物理 px 内无稀疏深色文字。\n` +
      `  可能：① 页面没有顶栏；② 顶栏被推到窗口外（inset 被放大）；③ 页面还没渲染完（加长等待重试）。`,
  )
  process.exit(1)
}
console.log(`  标题文字带          = y ${band.band}（中心 ${band.center.toFixed(1)}，行内峰值暗占比 ${(band.peakRatio * 100).toFixed(1)}%）`)

// 反推 inset：标题中心 = 盒中心 = inset + 顶栏高/2；再减去字形盒固有偏置
const impliedInset = band.center - barPhysical / 2 - TITLE_GLYPH_BIAS
console.log(`\n换算`)
console.log(`  盒中心 = 标题中心 - 字形偏置 = ${band.center.toFixed(1)} - ${TITLE_GLYPH_BIAS} = ${(band.center - TITLE_GLYPH_BIAS).toFixed(1)}`)
console.log(`  反推应用 inset        = 盒中心 - 顶栏半高 = ${impliedInset.toFixed(1)} 物理 px  = ${(impliedInset / scale).toFixed(2)} 逻辑 px`)
console.log(`  平台真值 inset        = ${insetPhysical} 物理 px  = ${(insetPhysical / scale).toFixed(2)} 逻辑 px`)

// 判定逻辑在 scripts/topInsetVerdict.mjs（无依赖纯函数），与
// tests/topInsetVerdict.test.ts 共用同一份 —— 像素探测跑不动单测，但「这个数
// 该判成什么」必须可执行、可回归。
const verdict = classifyTopInsetVerdict({
  impliedInset,
  insetPhysical,
  tolerance: TOLERANCE,
  medianUniformity: band.medianUniformity,
  // ⚠️ 两个度量都要传：ADR-0214 §后果第 2 层写的是「unif ≥ 0.75 **且** agree ≥ 0.9」。
  //    漏传第二个 ⇒ 整条跨行判据被 `undefined !== undefined` 短路跳过。
  crossRowAgreement: band.crossRowAgreement,
})
console.log(`  偏差                  = ${verdict.delta >= 0 ? '+' : ''}${verdict.delta.toFixed(1)} 物理 px（容差 ±${TOLERANCE}）`)

if (verdict.branch === 'not-flat-surface') {
  fail(
    `搜索窗内**不是平色 surface**（逐行中位均匀度 ${band.medianUniformity?.toFixed(3)} / 跨行一致 ${band.crossRowAgreement?.toFixed(3)}）—— 本判据不适用。\n` +
      `  搜索窗 [${insetPhysical + 10}, ${Math.round(insetPhysical + barPhysical - 10)}] 物理 px 内没有一块\n` +
      `  「各行同色且整行同色」的平色区域，因此**不存在「标题居中于顶栏」这个几何事实**。\n` +
      `  最常见成因：① 本页**没有顶栏**（B 变体首页，封面出血到 y=0）；② 封面图落在窗内\n` +
      `     （照片、噪点、纵向渐变——渐变每行横向同色，逐行均匀度会饱和到 1.000，靠跨行一致才拦得住）。\n` +
      `  ⇒ 换到**有 M3 顶栏且顶栏为浅色**的页面再测。\n` +
      `  ⚠️ 已知残留：整屏浅纯色底与浅色顶栏在颜色统计上同形，本判据拦不住 ——\n` +
      `     报 FAIL 时请看一眼截图，确认标题真的在那儿。\n` +
      `     （真机实测：有顶栏 7 页 unif=1.000 / agree=1.000；bleed 首页 0.117 / 0.817）`,
  )
  process.exit(1)
}

if (verdict.kind === 'inconclusive') {
  fail(
    `判据在此样本上**给不出答案**（反推 inset = ${impliedInset.toFixed(1)} ≤ 0，物理上不可能）。\n` +
      `  量到的「文字带」落在顶栏盒该在的位置**之上**，它不是顶栏标题。\n` +
      `  ⚠️ 「本页没有顶栏」与「顶栏在但让位完全失效」在本判据下**给出同一个数**\n` +
      `     （实测 −1.5 与 ≈ −3.5），不可区分 —— 此前这里一律报「让位没生效」，\n` +
      `     于是**默认落地页**（B 变体首页，顶栏已取消、封面出血到 y=0）上\n` +
      `     给出一个自信的错误诊断。\n` +
      `  另一条常见成因：搜索窗 [${insetPhysical + 10}, ${Math.round(insetPhysical + barPhysical - 10)}] 落在**封面图**上，\n` +
      `     深色头发/阴影的稀疏深色像素被当成了文字（行内占比仅 ${(band.peakRatio * 100).toFixed(1)}%，\n` +
      `     过不了 60% 的连续背景闸门，却完全够得上「稀疏文字」）。\n` +
      `  ⇒ 请看截图确认：顶栏在不在？在 ⇒ 让位完全失效（查该页 spacer / 路由 meta 是否 'self'）；\n` +
      `     不在 ⇒ 本页不适用，换到**有 M3 顶栏且顶栏为浅色**的页面再测。`,
  )
  process.exit(1)
}

if (verdict.kind === 'fail') {
  // 实测/平台倍率：反推出的应用 inset 是平台真值的多少倍。
  // 1 = 一致；显著 <1 = 让位没生效；>1 的**整数倍** = 密度倍数错误（物理像素当逻辑像素用）。
  // 判别顺序（先「偏小」后「整数倍」）见 topInsetVerdict.mjs 内的注释。
  const { approx, branch } = verdict
  fail(
    `对拍失败：偏差 ${verdict.delta.toFixed(1)} 物理 px 超出容差。\n` +
      `  实测/平台 ≈ ${approx.toFixed(3)} 倍` +
      (branch === 'too-small'
        ? `  ⇐ 明显**偏小**：页面自让位但让位没生效 —— 根容器已不补偿、页面那侧也没补上` +
          `（检查该页是否有 spacer / 路由 meta 是否为 'self'）`
        : branch === 'density-multiple'
          ? `  ⇐ 接近 ${Math.round(approx)} 倍，疑似**物理像素未换算为逻辑像素**（历史缺陷形态）`
          : `  ⇐ 非整数倍且不偏小：形态不在已知两类内，需人工看图`) +
      `\n  ⚠️ 「有没有染色」这类判据在此仍会全绿 —— 只有幅值对拍能抓到。`,
  )
} else {
  console.log(`\n✅ 通过：应用顶部让位与平台真值一致（偏差 ${verdict.delta.toFixed(1)} 物理 px，在容差内）。`)
  console.log(`   提示：跨页比较时请看「反推 inset」这一列 —— 各页极差应 ≲1px，那才是「视觉中性」的证据。`)
}
