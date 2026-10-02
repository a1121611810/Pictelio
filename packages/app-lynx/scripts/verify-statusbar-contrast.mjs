#!/usr/bin/env node
// ─── 沉浸式首页状态栏遮罩 · 真机对比度对拍（票 #909 / 决策 D3）───
//
// ## 这条脚本存在的理由
//
// 文档里写着「遮罩把状态栏对比度从 1.09:1 提到 12.03:1」。那个数字**看起来精确可信**，
// 而**仓里没有任何东西能复现它** —— 当时唯一的真机脚本 `verify-top-inset.mjs`
// 量的是**几何**（让位了多少 px），不是**颜色**。几何全绿与「看不清」可以同时成立。
//
// 故本脚本只做一件事：**取真机截图，量状态栏文字压在遮罩实际合成底色上的对比度**。
//
// ## 与幅值脚本的关系（同构，不是同题）
//
//   verify-top-inset.mjs      问「让位对不对」  → 幅值（px）
//   verify-statusbar-…（本脚本）问「看不看得清」→ 对比度（WCAG 比值）
//
// 两者读同一批平台真值（`dumpsys window` / `wm`）、各取各的截图、各自出三态。
// **不合并成一个脚本**：一个要 `self` 页（顶栏在），一个要 `bleed` 页（顶栏不在），
// 前置条件互斥；硬合会让「本页不适用」与「判据失败」混成同一个退出码。
//
// ## 用法与**适用范围**（务必先读）
//   node packages/app-lynx/scripts/verify-statusbar-contrast.mjs [选项]
//     --fg <light|dark|r,g,b>  状态栏文字色极性。缺省 light。
//                                极性由原生 `isAppearanceLightStatusBarsFor`
//                                决定（明外观 = 深图标），改主题必须同步传。
//     --page <路由名>          声明**当前停在哪个路由**（缺省 recommended）。
//                                本脚本不做导航，只用于查让位归属声明。
//     --screenshot <png>       复用已有截图（离线复算/回归，不再连设备取图）。
//     --threshold <n>          WCAG 阈值，缺省 4.5（AA 正文）。
//
//   （需先安装，并停在**有顶部遮罩**的页面 —— 即沉浸式首页 `carousel`。）
//
//   ⚠️ 本脚本**不适用**于无遮罩页：它们的让位归属是 `self`，状态栏带里是
//     实体顶栏的 surface，与本判据要量的「遮罩叠在封面上」不是同一件事 ⇒ REJECT。
//
// ## 退出码（三态**互不等价**，REJECT ≠ 通过）
//   0 = PASS    两端对比度都 ≥ 阈值
//   1 = FAIL    样本适用，但最坏一端低于阈值
//   2 = REJECT  本判据在此样本上给不出答案（既不是通过也不是缺陷）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDeclaredTopInset } from './topInsetVerdict.mjs'
import {
  classifyStatusBarContrast,
  deriveStatusBarWindow,
  parseContrastMetricsOutput,
  MIN_STATUS_BAR_CONTRAST,
  MIN_COLUMN_FLATNESS,
  STATUS_BAR_TEXT,
} from './statusBarContrastVerdict.mjs'

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function tryRead(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** 平台真值：状态栏带（物理 px）。取 InsetsSource 的 frame。 */
function platformStatusBarFrame() {
  const out = adb(['shell', 'dumpsys', 'window'])
  const m = out.match(/type=statusBars\s+frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  return { x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]) }
}

/** 平台真值：视口宽（物理 px）。 */
function platformScreenWidth() {
  const out = adb(['shell', 'wm', 'size'])
  const m = out.match(/Physical size:\s*(\d+)x(\d+)/)
  if (!m) throw new Error('wm size 输出无法解析')
  return Number(m[1])
}

function screenshot() {
  const dir = mkdtempSync(join(tmpdir(), 'statusbar-contrast-'))
  const file = join(dir, 'shot.png')
  writeFileSync(file, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }))
  return file
}

// 未知参数**直接拒绝**，不静默忽略：拼错 `--fg=ligh` 若被忽略，会退回 light，
// 而在暗色主题下那是**浅图标** —— 于是量出一个「深图标 vs 深底」的假 FAIL。
const KNOWN = new Set(['--fg', '--page', '--screenshot', '--threshold'])
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (!a.startsWith('--')) continue
  if (!KNOWN.has(a)) {
    console.error(
      `未知参数 \`${a}\`。本脚本只接受：${[...KNOWN].join(' / ')}。\n` +
        `  静默忽略拼错的参数会让 --fg 退回 light，在暗色主题下量出「深图标 vs 深底」的假 FAIL。`,
    )
    process.exit(2)
  }
  if (args[i + 1] === undefined) {
    console.error(`参数 \`${a}\` 缺值。`)
    process.exit(2)
  }
}
const val = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const fgArg = val('--fg') ?? 'light'
const threshold = val('--threshold') === undefined ? MIN_STATUS_BAR_CONTRAST : Number(val('--threshold'))
const PAGE = val('--page') ?? 'recommended'

let foreground
if (fgArg === 'light' || fgArg === 'dark') foreground = STATUS_BAR_TEXT[fgArg]
else if (/^\d+,\d+,\d+$/.test(fgArg)) foreground = fgArg.split(',').map(Number)
else {
  console.error(`--fg 只接受 light / dark / "r,g,b"，实得 \`${fgArg}\`（REJECT：口径不明不硬算）。`)
  process.exit(2)
}

console.log('=== 沉浸式首页 · 状态栏遮罩真机对比度对拍（#909）===\n')

// ── 前置条件：让位归属必须是 bleed（= 有遮罩）──
// 为什么放在像素度量**之前**：判据问的是「遮罩叠在封面上够不够」，
// 而 `self` 页的状态栏带里根本没有遮罩 ⇒ 在那里量到的是实体顶栏的 surface，
// 会给出一个**与遮罩无关**却看着很健康的数。
// 归属从**应用自己的路由声明**读（`src/router.ts` 的 `meta.topInset`），
// 而不是从像素猜 —— 那是规格级事实，比启发式可靠。
const pageTopInset = resolveDeclaredTopInset(
  PAGE,
  tryRead(fileURLToPath(new URL('../src/router.ts', import.meta.url))) ?? '',
  tryRead(fileURLToPath(new URL('../dist/main.web.bundle', import.meta.url))),
)
if (pageTopInset === 'self') {
  console.error(
    `被测路由 \`${PAGE}\` 的让位归属是 **self**（有实体顶栏、**无遮罩**），本判据不适用 ⇒ REJECT。\n` +
      `  遮罩只存在于 bleed 形态的沉浸式首页（\`Recommended.vue\` 的 \`--md-statusbar-scrim\` 层）。\n` +
      `  在 self 页量到的是实体顶栏的 surface，与「遮罩叠在封面上」不是同一件事。\n` +
      `  ⇒ 停到沉浸式首页再测：\n` +
      `     adb shell am force-stop io.pictelio.app\n` +
      `     adb shell am start -n io.pictelio.app/.LynxActivity --es benchNav carousel\n` +
      `  ⚠️ REJECT ≠ 通过。`,
  )
  process.exit(2)
}

const offline = val('--screenshot')
let frame
let screenWidth
if (offline) {
  // 离线复算：截图自带尺寸，但**状态栏 inset 无从得知** ⇒ 必须显式说明这一点，
  // 否则读数会被误当成「在真机上量到的」。
  const png = readFileSync(offline)
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  screenWidth = w
  frame = { x0: 0, y0: 0, x1: w, y1: 72 }
  console.log(`离线复算模式：截图 ${offline}（${w}×${h}）`)
  console.log(`  ⚠️ 状态栏 inset 无从得知，按 ADR-0214 记录的 emulator-5554 真值 72 物理 px 假定。`)
  console.log(`  ⇒ 本模式的读数**不能**当作真机证据，只能用来复算算法。\n`)
} else {
  frame = platformStatusBarFrame()
  screenWidth = platformScreenWidth()
}

const win = deriveStatusBarWindow({ frame, screenWidth })
if (!win) {
  console.error(
    `平台真值里取不到可用的状态栏采样窗（dumpsys frame=${frame ? JSON.stringify(frame) : '未找到'}）⇒ REJECT。\n` +
      `  判据在空窗上只会给出一个与渲染无关的数。REJECT ≠ 通过。`,
  )
  process.exit(2)
}

console.log(`平台真值（dumpsys / wm）`)
console.log(`  状态栏带            = x[${frame.x0},${frame.x1}) y[${frame.y0},${frame.y1}) ⇒ inset ${win.inset} 物理 px`)
console.log(`  采样窗              = x[${win.x0},${win.x1}) y[${win.y0},${win.y1})（正中竖带，避开铃铛与运营商信息）`)
console.log(`  状态栏文字色        = rgb(${foreground.join(',')})（极性 ${fgArg}）`)
console.log(`  阈值                = ${threshold}:1`)

const png = offline ?? screenshot()
console.log(`\n实测`)
console.log(`  截图                = ${png}`)

// 度量在独立脚本里（scripts/status_bar_contrast_metrics.py）而不是内嵌字符串：
// 内嵌版只有「连着真机跑一遍」这一条验证路径，而「它现在是对的」与
// 「它对所有输入都对」完全同形。合成 fixture 由 tests/statusBarContrast.test.ts 提供。
const out = execFileSync(
  'python3',
  [
    fileURLToPath(new URL('./status_bar_contrast_metrics.py', import.meta.url)),
    png,
    String(win.x0),
    String(win.x1),
    String(win.y0),
    String(win.y1),
  ],
  { encoding: 'utf8' },
).trim()

// 解析走 `parseContrastMetricsOutput`（无依赖纯函数）：首版把字段序内联在此处，
// 取成了颜色分量 ⇒ flatness 闸门拿到 205 而恒真。详见该函数的头注。
const m = parseContrastMetricsOutput(out)
if (m.kind === 'malformed') {
  console.error(
    `度量脚本输出无法解析：\`${out}\`\n  这通常意味着 python 侧契约变了而解析器没跟上 ——\n` +
      `  此时脚本**不会**判红也不会判绿，而是直接停下。`,
  )
  process.exit(2)
}
if (m.kind === 'empty') {
  console.error(
    `采样窗 x[${win.x0},${win.x1}) y[${win.y0},${win.y1}) 在画布上取不到像素 ⇒ REJECT。\n` +
      `  可能：截图尺寸与平台真值不匹配（旋转/分屏），或遮罩区域被裁掉。REJECT ≠ 通过。`,
  )
  process.exit(2)
}

console.log(`  最暗像素            = rgb(${m.darkestBg.join(',')})`)
console.log(`  最亮像素            = rgb(${m.lightestBg.join(',')})`)
console.log(`  横向平色度          = ${m.flatness.toFixed(4)}（闸门 ≥ ${MIN_COLUMN_FLATNESS}）`)

const verdict = classifyStatusBarContrast({
  foreground,
  darkestBg: m.darkestBg,
  lightestBg: m.lightestBg,
  flatness: m.flatness,
  threshold,
})

// ⚠️ 判据非 reject 时才打印两端读数。REJECT 分支**必须先于**任何读数输出判定：
//    reject 对象的 `worst/best/vsDarkest/vsLightest` 是 NaN（判据没给出答案），
//    先打印再判 ⇒ `NaN.toFixed` 正常但 `undefined.toFixed` 直接抛 TypeError
//    —— 于是一条本该报「REJECT」的样本变成**崩溃**（退出码被 node 吃掉 = 0），
//    在只看退出码的 CI 里反而是绿的。暗色主题首次真跑就撞上了这个。
if (verdict.kind === 'reject') {
  console.error(
    verdict.branch === 'column-not-flat'
      ? `采样窗内**不是平色的遮罩+封面**（flatness ${m.flatness.toFixed(4)} < ${MIN_COLUMN_FLATNESS}）⇒ REJECT。\n` +
          `  窗内混进了内容或封面本身有硬边，量到的极值不是「遮罩叠在封面上」的效果。\n` +
          `  ⚠️ 已知残留失效面（见 statusBarContrastVerdict.mjs）：**稀疏**字形（系统时钟）\n` +
          `     拦不住 —— 窗内若有系统字形，逐像素极值会量到字形自己。\n` +
          `     真机上沉浸式首页状态栏是隐藏的（不画字形），flatness 恒为 1.0000；\n` +
          `     非 1.0000 时先别信这个数，看一眼截图确认采样窗里是什么。\n` +
          `  ⇒ 换到采样窗内只有遮罩+封面的页面再测。⚠️ REJECT ≠ 通过。`
      : `输入非有限数（取样崩了 / 输出被截断 / 窗内空集），判据不可用 ⇒ REJECT。\n` +
          `  ⚠️ 不要把这条当「量到了但不好看」：它意味着读数根本不可信。REJECT ≠ 通过。`,
  )
  process.exit(2)
}

console.log(`\n换算（WCAG 相对亮度）`)
console.log(`  vs 最暗              = ${verdict.vsDarkest.toFixed(2)}:1`)
console.log(`  vs 最亮              = ${verdict.vsLightest.toFixed(2)}:1`)
console.log(`  **最坏一端**         = ${verdict.worst.toFixed(2)}:1（对 ${verdict.branch}，阈值 ${threshold}:1）`)

if (verdict.kind === 'fail') {
  console.error(
    `\n❌ FAIL  最坏一端对比度 ${verdict.worst.toFixed(2)}:1 < 阈值 ${threshold}:1（对 ${verdict.branch}）。\n` +
      `  状态栏文字压在 rgb(${verdict.branch === 'darkest' ? m.darkestBg : m.lightestBg}) 上读不出来。\n` +
      `  常见成因：① 遮罩层没渲染（令牌被换回字面量 / 高度写错）；② 极性传反\n` +
      `     （暗色主题下没传 --fg dark，量成了「深图标 vs 深底」）；③ 封面本身过暗。\n` +
      `  ⇒ 确认 --fg 极性与当前主题一致后复跑。`,
  )
  process.exit(1)
}

console.log(
  `\n✅ PASS  最坏一端 ${verdict.worst.toFixed(2)}:1 ≥ ${threshold}:1` +
    `（vs 最暗 ${verdict.vsDarkest.toFixed(2)} / vs 最亮 ${verdict.vsLightest.toFixed(2)}）`,
)
console.log(
  `  ⚠️ 这是**当前这一帧**的数：底色含封面像素，换一张轮播图会变。\n` +
    `     引用它时必须连采样条件一起写（机器 / 帧 / 采样窗），否则就是不可复现的孤数字。`,
)
process.exit(0)
