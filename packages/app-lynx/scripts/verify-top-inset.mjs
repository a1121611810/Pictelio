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
//   node packages/app-lynx/scripts/verify-top-inset.mjs [--tolerance 12]
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
import { classifyTopInsetVerdict, MIN_FLAT_SURFACE_UNIFORMITY } from './topInsetVerdict.mjs'

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
 */
const TITLE_GLYPH_BIAS = 3.3

/** 容差 = 固有偏置 + 余量。见上。真实缺陷量级 ≫ 此值。 */
const DEFAULT_TOLERANCE = 12

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
 *   均匀度把两族干净分开（emulator-5554 / 1080×2160 实测，窗 [82,246]）：
 *     有 M3 顶栏的 7 页 + 首页之外的截图：窗内中位均匀度 = **1.000**（顶栏是平色 surface）
 *     B 变体首页（无顶栏，封面出血）：            窗内中位均匀度 = **0.10 ~ 0.40**
 *   空档极大，阈值取 0.75 落在空档正中。
 */
function findTitleBandCenter(pngPath, insetPhysical, barPhysical) {
  const py = `
import sys
from collections import Counter
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
W, H = im.size
px = im.load()
LO, HI, DARK, MINPX, MAXRATIO = int(sys.argv[2]), int(sys.argv[3]), ${DARK_LUMA_MAX}, ${MIN_DARK_PX}, ${MAX_ROW_DARK_RATIO}
def luma(x, y):
    c = px[x, y]; return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]
xs = list(range(int(W*0.15), int(W*0.85), 3))
uxs = list(range(0, W, 2))
rows = []
peak = 0.0
unif = []
for y in range(LO, min(HI, H)):
    dark = sum(1 for x in xs if luma(x, y) < DARK)
    ratio = dark / len(xs)
    if ratio > peak: peak = ratio
    if dark > MINPX and ratio <= MAXRATIO:   # 稀疏才可能是文字；连续必是背景
        rows.append(y)
    # 行均匀度：量化到 8 级色阶（容忍抗锯齿与压缩噪点）后取众数占比
    cnt = Counter((px[x, y][0]//8, px[x, y][1]//8, px[x, y][2]//8) for x in uxs)
    unif.append(cnt.most_common(1)[0][1] / len(uxs))
unif.sort()
median_unif = unif[len(unif)//2] if unif else 0.0
if not rows:
    # 区分「窗内全亮（没有文字）」与「窗内全暗（背景被误当文字）」
    print('BG' if peak > MAXRATIO else 'NONE', f"{median_unif:.3f}")
    sys.exit(0)
start = rows[0]; end = start
for y in rows[1:]:
    if y - end <= 6:
        end = y
    else:
        break
print(f"{(start + end) / 2.0:.2f} {start} {end} {peak:.3f} {median_unif:.3f}")
`
  const out = execFileSync(
    'python3',
    ['-c', py, pngPath, String(insetPhysical + 10), String(Math.round(insetPhysical + barPhysical - 10))],
    { encoding: 'utf8' },
  ).trim()
  const parts = out.split(' ')
  if (parts[0] === 'NONE') return { kind: 'none', medianUniformity: Number(parts[1]) }
  if (parts[0] === 'BG') return { kind: 'background', medianUniformity: Number(parts[1]) }
  const [center, start, end, peak, medUnif] = parts.map(Number)
  return {
    kind: 'ok',
    center,
    band: `${start}–${end}`,
    peakRatio: peak,
    medianUniformity: medUnif,
  }
}

const args = process.argv.slice(2)
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
})
console.log(`  偏差                  = ${verdict.delta >= 0 ? '+' : ''}${verdict.delta.toFixed(1)} 物理 px（容差 ±${TOLERANCE}）`)

if (verdict.branch === 'not-flat-surface') {
  fail(
    `搜索窗内**没有平色 surface**（窗内中位行均匀度 ${band.medianUniformity.toFixed(3)} < ${MIN_FLAT_SURFACE_UNIFORMITY}）—— 本页没有顶栏。\n` +
      `  搜索窗 [${insetPhysical + 10}, ${Math.round(insetPhysical + barPhysical - 10)}] 物理 px 落在**封面图/插画**上，\n` +
      `  深色头发、阴影的稀疏深色像素会被当成「文字」（行内占比仅 ${(band.peakRatio * 100).toFixed(1)}%，\n` +
      `  过不了 60% 的连续背景闸门，却完全够得上「稀疏文字」）。\n` +
      `  ⚠️ 此时反推出的 inset 完全取决于**画的是谁**：同一张 B 变体首页实测出现过\n` +
      `     −1.5 与 +9.5 两个值 —— 纯噪声，却都会被当成真实偏差报出去。\n` +
      `  ⇒ 换到**有 M3 顶栏且顶栏为浅色**的页面再测。本判据在此页不可用。\n` +
      `     （真机实测：有顶栏 7 页窗内中位均匀度 = 1.000；首页 = 0.10~0.40）`,
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
