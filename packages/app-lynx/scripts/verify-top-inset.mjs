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
//     ① **无顶栏页** —— 窗内不存在「标题居中于 64dp 顶栏」这个几何事实可量，
//        会报出一个无意义的偏差值。肉眼判定：页面顶部**没有**一条与背景异色的横向条。
//     ② **顶栏区为深色底的页面**（如沉浸式出血到深色封面下）—— v1 在此恒真；
//        v2 已加行内占比闸门把它变成**显式拒绝**（见 findTitleBandCenter 说明），
//        但**拒绝 ≠ 通过**：此时应换页面测，不要绕过闸门。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
 */
function findTitleBandCenter(pngPath, insetPhysical, barPhysical) {
  const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
W, H = im.size
px = im.load()
LO, HI, DARK, MINPX, MAXRATIO = int(sys.argv[2]), int(sys.argv[3]), ${DARK_LUMA_MAX}, ${MIN_DARK_PX}, ${MAX_ROW_DARK_RATIO}
def luma(x, y):
    c = px[x, y]; return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]
xs = list(range(int(W*0.15), int(W*0.85), 3))
rows = []
peak = 0.0
for y in range(LO, min(HI, H)):
    dark = sum(1 for x in xs if luma(x, y) < DARK)
    ratio = dark / len(xs)
    if ratio > peak: peak = ratio
    if dark > MINPX and ratio <= MAXRATIO:   # 稀疏才可能是文字；连续必是背景
        rows.append(y)
if not rows:
    # 区分「窗内全亮（没有文字）」与「窗内全暗（背景被误当文字）」
    print('BG' if peak > MAXRATIO else 'NONE')
    sys.exit(0)
start = rows[0]; end = start
for y in rows[1:]:
    if y - end <= 6:
        end = y
    else:
        break
print(f"{(start + end) / 2.0:.2f} {start} {end} {peak:.3f}")
`
  const out = execFileSync(
    'python3',
    ['-c', py, pngPath, String(insetPhysical + 10), String(Math.round(insetPhysical + barPhysical - 10))],
    { encoding: 'utf8' },
  ).trim()
  if (out === 'NONE') return { kind: 'none' }
  if (out === 'BG') return { kind: 'background' }
  const [center, start, end, peak] = out.split(' ').map(Number)
  return { kind: 'ok', center, band: `${start}–${end}`, peakRatio: peak }
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
const delta = impliedInset - insetPhysical
console.log(`\n换算`)
console.log(`  盒中心 = 标题中心 - 字形偏置 = ${band.center.toFixed(1)} - ${TITLE_GLYPH_BIAS} = ${(band.center - TITLE_GLYPH_BIAS).toFixed(1)}`)
console.log(`  反推应用 inset        = 盒中心 - 顶栏半高 = ${impliedInset.toFixed(1)} 物理 px  = ${(impliedInset / scale).toFixed(2)} 逻辑 px`)
console.log(`  平台真值 inset        = ${insetPhysical} 物理 px  = ${(insetPhysical / scale).toFixed(2)} 逻辑 px`)
console.log(`  偏差                  = ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} 物理 px（容差 ±${TOLERANCE}）`)

if (Math.abs(delta) > TOLERANCE) {
  // 实测/平台倍率：反推出的应用 inset 是平台真值的多少倍。
  // 1 = 一致；显著 <1 = 让位没生效；>1 的**整数倍** = 密度倍数错误（物理像素当逻辑像素用）。
  //
  // ⚠️ 判别顺序要紧：**先判「偏小」再判「整数倍」**。
  //    反过来写时，spacer=0 的实测倍率约 0.10 会先命中「接近 0 倍」那个整数分支，
  //    把根因误指成「物理像素未换算」—— 活设备上就是这样误报过的。
  //    「偏小」与「密度错」是两类完全不同的缺陷，误指会把排查引向错误方向。
  const approx = impliedInset / insetPhysical
  const isNearZeroish = approx < 0.8
  const isIntegerMultiple =
    !isNearZeroish && Math.abs(approx - Math.round(approx)) < 0.15 && Math.round(approx) > 1
  fail(
    `对拍失败：偏差 ${delta.toFixed(1)} 物理 px 超出容差。\n` +
      `  实测/平台 ≈ ${approx.toFixed(3)} 倍` +
      (isNearZeroish
        ? `  ⇐ 明显**偏小**：页面自让位但让位没生效 —— 根容器已不补偿、页面那侧也没补上` +
          `（检查该页是否有 spacer / 路由 meta 是否为 'self'）`
        : isIntegerMultiple
          ? `  ⇐ 接近 ${Math.round(approx)} 倍，疑似**物理像素未换算为逻辑像素**（历史缺陷形态）`
          : `  ⇐ 非整数倍且不偏小：形态不在已知两类内，需人工看图`) +
      `\n  ⚠️ 「有没有染色」这类判据在此仍会全绿 —— 只有幅值对拍能抓到。`,
  )
} else {
  console.log(`\n✅ 通过：应用顶部让位与平台真值一致（偏差 ${delta.toFixed(1)} 物理 px，在容差内）。`)
  console.log(`   提示：跨页比较时请看「反推 inset」这一列 —— 各页极差应 ≲1px，那才是「视觉中性」的证据。`)
}
