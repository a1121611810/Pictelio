/**
 * `scripts/find-ui-band.py` 的 `find_wide_solid`（**登录按钮**定位器）判据门禁。
 *
 * ## 为什么这个函数必须有门禁（它是 `do_login` 里唯一决定「点哪登录」的东西）
 *
 * 消费方只有两处，但都是承重的：`capture-md3-matrix.sh` 的 `do_login()` 里两处
 * `det find-ui-band.py --wide-solid --csv`（登录前定位按钮、收键盘后重新定位）拿
 * `find-ui-band.py --wide-solid --csv` 的输出**直接 tap**。判错 ⇒ 点空，而
 * 「点空」在这条链路上**不报错**（脚本自认为成功，继续往下拍矩阵）。
 *
 * 它自己的 docstring（`find_wide_solid()` 的 docstring）交代了为什么值得钉：
 * 第一版只按「每行有多少饱和像素」找带，返回值却**编造**了
 * `x1=0, x2=width-1, width=width, cx=width//2, uniform=1.0, peak=1.0`
 * —— 六个字段全是没量过的数。登录卡片居中、按钮两边明明有留白，输出却报
 * 「横贯整屏、实心度 100%」。**修好了，但没有防线**：下次重构把字段改回编造值，
 * 门禁不会响。
 *
 * 所以本门禁的核心不是「能不能检出」，而是**返回值是不是量出来的**：
 * 每条阳性都断言 `x1/x2/width/cx/uniform/peak` 落在**画进去的几何**上，
 * 并单列一条用例把六个字段与编造值逐个对撞。
 *
 * ## 判别力靠反事实：每条判据都要有「是它在拒」的证据
 *
 * 只断言 `NOTFOUND` 的用例**没有判别力** —— 它与「脚本整体坏了」完全同形。所以分两类：
 *   · **拒绝关卡**（`min_h_frac` / `max_h_frac` / `min_margin_frac`）→ 实现里有对应的
 *     `_drop` 分支，断言 `--explain` 的拒因**文本包含该判据**（F4/F5/F6/F7）。
 *   · **成形关卡**（`width_frac` / `sat_min`）→ 它们决定「某行算不算带」，**在实现里根本
 *     没有 `_drop` 分支**（`find_wide_solid()` 的候选循环里，宽度/饱和不足只是 `continue`，不落 `_drop`），所以拿不到拒因
 *     文本。这类改断言「**一条候选都没产生**」（输出里没有 `拒：` 行），再配一张**只差
 *     一点点**的配对阳性把阈值夹住（F2↔F3、F8↔F9）。
 *
 * ## fixture 为什么在这里现画，而不是提交二进制 PNG
 *
 * 与 `helpers/rasterCanvas.ts` 文件头同一条理由：提交的 PNG 会陈旧（改了阈值、
 * 换画布、调圆角，PNG 还在而期望值已对不上），现画则**输入与期望写在同一处**。
 * 画布 / PNG 编码器复用 `helpers/rasterCanvas.ts`，**不另写一份编码器**。
 *
 * ## 颜色是真机实测值 + 令牌源值，不是「挑的好看的」
 *
 * emulator-5556、1080×2160、`io.pictelio.app` 登录页逐像素采样：
 *   - 天蓝 primary（登录按钮底色，实测 swatch 中心像素） (26, 111, 168)
 *   - 登录页卡片底                                     (255, 255, 255)
 *   - 页面外底                                         (248, 250, 255)
 *   - 控件描边                                         (113, 120, 126)
 *   - 文字                                             (25, 28, 32)
 *
 * ⚠️ **采样坐标没跟着记下来**（本次未逐像素复采）。风险与补偿：这 5 个值里
 * **4 个与 `src/styles/tokens.css` 的 sky 主题令牌逐字相同** ——
 *   `(248,250,255)` = `--md-surface`     tokens.css:32
 *   `(25,28,32)`    = `--md-on-surface`  tokens.css:33
 *   `(113,120,126)` = `--md-outline`     tokens.css:36
 *   `(26,111,168)`  = `--md-primary`     tokens.css:14
 * 坐标丢失不等于色值失去出处：**两个独立来源相同**比一个坐标更有力地钉住它。
 * 反过来说，本门禁**不覆盖**「真机登录页上按钮的实际 x 范围与圆角半径」——
 * 这两项在脚本注释里也没有记录，见 F1/F2 处那条「本次未取得真机值」的登记。
 *
 * 饱和度上下界（`sat_min = 40`）用两个**真实令牌源值**夹住，同样标出处：
 *   - `--md-secondary: #50606e` = (80, 96, 110)  → sat 30 < 40  ⇒ 不得检出（F8）
 *   - `--md-tertiary:  #3b6470` = (59, 100, 112) → sat 53 ≥ 40  ⇒ 须检出（F9）
 *   风险：secondary/tertiary 角色在真机登录页上**不会**以「宽实心块」出现，
 *   这一对只用来**夹阈值**，不用于模拟登录页布局。
 *
 * ## 复现命令
 *   cd packages/app-lynx && pnpm vitest run tests/findWideSolid.test.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Canvas, encodePng, H, W, type RGB } from './helpers/rasterCanvas'

const SCRIPT_REL = 'scripts/find-ui-band.py'
const rootDir = resolve(__dirname, '..')

// ─────────────────────────── 真机色值（出处见文件头） ───────────────────────────

const PRIMARY: RGB = [26, 111, 168] // 真机实测 swatch 中心 == tokens.css:14 --md-primary
const CARD: RGB = [255, 255, 255] // 登录页卡片底（== tokens.css:15 --md-on-primary）
const PAGE: RGB = [248, 250, 255] // 页面外底 == tokens.css:32 --md-surface
const OUTLINE: RGB = [113, 120, 126] // 控件描边 == tokens.css:36 --md-outline
const TEXT: RGB = [25, 28, 32] // 文字 == tokens.css:33 --md-on-surface
/** 令牌源值 tokens.css:18 --md-secondary —— sat = 110−80 = 30 < SAT_MIN */
const SECONDARY: RGB = [80, 96, 110]
/** 令牌源值 tokens.css:22 --md-tertiary —— sat = 112−59 = 53 ≥ SAT_MIN */
const TERTIARY: RGB = [59, 100, 112]

/** `find_wide_solid()` 里的饱和判据 `hi - lo >= sat_min`：`max(r,g,b) - min(r,g,b) >= sat_min` */
const sat = (c: RGB): number => Math.max(...c) - Math.min(...c)

// ─────────────────────── 被测阈值（照抄自 `find_wide_solid()` 的签名默认值） ───────────────────────
// 全部阈值都是**屏宽/屏高比例**，所以画布必须与真机同尺寸；
// `helpers/rasterCanvas.ts` 的 W/H 固定 1080×2160，改它就得重标定全部 fixture。
const SAT_MIN = 40
/** `need = int(width * width_frac) // 3 + 1` —— 单位是**抽样列数**不是像素
 *  （docstring :462-464 记的量纲陷阱：第一版两处打架 ⇒ 实际门槛掉到 0.10 屏宽） */
const NEED_SAMPLES = Math.floor(W * 0.3) / 3 + 1 // = 109
const MIN_H = Math.max(4, Math.floor(H * 0.012)) // = 25
const MAX_H = Math.floor(H * 0.15) // = 324
const MARGIN_MIN = Math.floor(W * 0.02) // = 21
/** 3px 抽样列总数（`xcols`） */
const XCOLS = Math.ceil(W / 3) // = 360
/** 一行里落在 [x0,x1] 内的抽样列数 —— 3px 步长的取点落在 x=0,3,6,… */
const samplesIn = (x0: number, x1: number): number => Math.floor(x1 / 3) - Math.floor((x0 - 1) / 3)

// ─────────────────────────────── 真机几何 ───────────────────────────────

/**
 * 登录按钮：**中心 y = 1195** 是真机实测值 ——
 * `capture-md3-matrix.sh` 的 `do_login()` 注释记「`--wide-solid` 实测：1080 命中 y=1195
 * （人工量得 1193）、720 命中 y=748（人工量得 747），两张差 1~2px」。
 * 输入框中心 0.495×2160 = 1069（`do_login()` 里的 `CUR_H * 495 / 1000`）与 1195 相距 126px，
 * 正好放得下一个 120px 高的按钮 ⇒ 这里取 y[1136..1255] 与真机自洽。
 */
const BTN_W = 720
const BTN_H = 120
const BTN_X0 = 180
/** 圆角半径。MD3 filled button 走 `corner-full`（= 半高 60px），这里取 48px。
 *  ⚠️ **本次未取得真机值**。取 48 而非 60 是有意的：探测行步长 `bh//6 = 20` 会落在
 *  y0+60；半径 ≤59 时该行是**直边区** ⇒ `x1/x2` 恰为画进去的边界；半径 60（药丸）时
 *  该行会内缩 1px。容差取 ±2 覆盖 r∈[0,60] 的整个取值域。 */
const BTN_R = 48
/** 按钮上的标签（真机是「登录」二字）：宽 120 × 高 50，居中。 */
const LABEL_W = 120
const LABEL_H = 50
/** 6 条探测行（步长 20）里恰好 3 条（y0+40 / y0+60 / y0+80）穿过标签。 */
const LABEL_Y0 = 33
const LABEL_Y1 = LABEL_Y0 + LABEL_H - 1 // = 82
const BTN_CY_1080 = 1195
/** 720×1280 真机实测的按钮中心是屏高 0.584（docstring :445）；实测命中值 748/1280
 *  = 0.584375（`do_login()` 同一条实测注释）。按 2160 高落点：round(0.584375×2160) = 1262。 */
const RATIO_720 = 748 / 1280
const BTN_CY_720 = Math.round(RATIO_720 * H) // = 1262
/** 带高 120 时「让 cy 落在目标值」的带顶。 */
const y0For = (cy: number): number => cy - Math.floor((BTN_H - 1) / 2) // 1195→1136, 1262→1203
const BTN_Y0_1080 = y0For(BTN_CY_1080)
const BTN_Y0_720 = y0For(BTN_CY_720)

// ─────────────────────────────── 画 fixture ───────────────────────────────

interface ButtonSpec {
  fill: RGB
  x0: number
  y0: number
  w?: number
  h?: number
  r?: number
  /** 画不画按钮上的标签（`false` ⇒ 实心无字） */
  label?: boolean
}

function drawButton(cv: Canvas, s: ButtonSpec): void {
  const w = s.w ?? BTN_W
  const h = s.h ?? BTN_H
  cv.roundRect(s.x0, s.y0, s.x0 + w - 1, s.y0 + h - 1, s.r ?? BTN_R, s.fill)
  if (s.label === false) return
  // 标签水平居中于按钮；垂直取 [y0+33, y0+82] —— **刻意**让 6 条探测行里的
  // y0+40 / y0+60 / y0+80 落在标签内、其余 3 条落在标签外。
  const lx0 = s.x0 + Math.floor((w - LABEL_W) / 2)
  cv.rect(lx0, s.y0 + LABEL_Y0, lx0 + LABEL_W - 1, s.y0 + LABEL_Y1, CARD)
}

/** 登录页全景：页面底 + 居中卡片 + 标题 + 输入框（描边）+ 按钮。`btn: null` ⇒ 还没有按钮。 */
function loginPage(btn: ButtonSpec | null): Canvas {
  const cv = new Canvas(PAGE)
  cv.rect(60, 300, 1019, 1800, CARD) // 居中卡片（宽 960）
  cv.rect(180, 400, 520, 470, TEXT) // 标题
  cv.rect(180, 520, 660, 570, TEXT) // 副标题
  // 输入框：3px 描边 + 卡片色填充。描边 sat=13、填充 sat=0，**在 SAT_MIN 下都不算饱和** ——
  // 这正是 x1/x2 能恰好落在按钮边界上的前提。
  cv.rect(180, 1009, 899, 1128, OUTLINE)
  cv.rect(183, 1012, 896, 1125, CARD)
  cv.rect(220, 1055, 420, 1090, TEXT) // 占位文字
  if (btn) drawButton(cv, btn)
  return cv
}

/** 裸页（只有页面底 + 色块）：给「只看得到色块本身」的合成关卡用。 */
function barePage(btn: ButtonSpec): Canvas {
  const cv = new Canvas(PAGE)
  drawButton(cv, btn)
  return cv
}

// ─────────────────────── 期望几何（从「我画了什么」读，不是抄实现） ───────────────────────

interface Band {
  x1: number
  x2: number
  y1: number
  y2: number
  cx: number
  cy: number
  w: number
  h: number
  uniform: number
  peak: number
  aspect: number
  gapL: number
  gapR: number
}

/**
 * `Canvas.roundRect` 在距顶 dy 处的内缩量。
 * ⚠️ 这复刻的是**本 fixture 自己的绘制原语**（`helpers/rasterCanvas.ts 的 Canvas.roundRect`，
 * 读得到的形状定义），**不是被测判据**。复刻它是因为 `uniform` 的期望值必须把
 * 「圆角把探测行削窄」算进去 —— 这是 fixture 的几何事实，漏掉它就会把期望值
 * 算成 0.611 而实测是 0.590（第一次跑就是这么红的）。
 */
function cornerShrink(dy: number, h: number, r: number): number {
  if (r <= 0) return 0
  if (dy < r) return r - Math.sqrt(Math.max(0, r * r - (r - dy) ** 2))
  if (dy > h - 1 - r) return r - Math.sqrt(Math.max(0, r * r - (dy - (h - 1 - r)) ** 2))
  return 0
}

/** 第 dy 行上按钮实际铺开的宽度（`roundRect` 左内缩 ceil、右内缩 floor）。 */
function rowWidth(dy: number, h: number, r: number, w: number): number {
  const s = cornerShrink(dy, h, r)
  return w - Math.ceil(s) - Math.floor(s)
}

/**
 * 一张**画出来的按钮**对应的期望返回值。全部由上面那组常量推出：
 *   · `x1/x2` = 画进去的左右边界（半径 <60 时中央探测行落在直边区，不削边）
 *   · `w` = `x2 − x1`，**没有 +1**（`find_wide_solid()` 返回字典的 width 字段就是 `sx2 - sx1`）
 *   · `cx` = `(x1 + x2) // 2`；按钮宽 720 ⇒ 偶数宽 ⇒ cx 落在半像素上
 *   · `uniform` = 探测行上的饱和像素总数 / (探测行数 × 屏宽)
 *     （注意分母是**屏宽**不是色块宽 —— 混用会算出 >1 的「实心度」，docstring
 *     :542-545 记的正是第一版这个错）
 *   · `peak` = 无标签的直边行里的抽样列数 / 抽样列总数
 *
 * 探测行取 `range(y0, y0+h, max(1, h//6))`；本函数**假设带的 y 边界没被抽样削掉**，
 * 那个假设由 `每条阳性的圆角行抽样列数 ≥ need` 断言单独钉住（见 F12 之后的自洽用例）。
 */
function expected(x0: number, y0: number, w: number, h: number, withLabel: boolean): Band {
  const x1 = x0 + w - 1
  const y1 = y0 + h - 1
  const step = Math.max(1, Math.floor(h / 6))
  const probeRows: number[] = []
  for (let y = y0; y <= y1; y += step) probeRows.push(y)
  let nsat = 0
  for (const y of probeRows) {
    const wid = rowWidth(y - y0, h, BTN_R, w)
    const label = withLabel && y >= y0 + LABEL_Y0 && y <= y0 + LABEL_Y1 ? LABEL_W : 0
    nsat += wid - label
  }
  // `peak` 取**带内所有行**的抽样列数最大值（`find_wide_solid()` 里 `peak = round(max(rows[y1:y2+1]) / xcols, 3)`），不是探测行的。
  // 逐行枚举圆角剖面**并扣掉标签挖走的抽样列**：120px 高的按钮直边区只有 24 行，
  // 而标签（[y0+33, y0+82]）恰好把直边区**整段盖住** ⇒ 峰值行落在标签之外的圆角区
  // （最宽 239 列），而不是「无标签的直边行」（那 24 行只有 240−40 = 200 列）。
  // 第一次跑就是这里把 0.667 算成了期望值、实测 0.664。
  const labelX0 = x0 + Math.floor((w - LABEL_W) / 2)
  let peakCols = 0
  for (let y = y0; y <= y1; y++) {
    const s = cornerShrink(y - y0, h, BTN_R)
    const left = x0 + Math.ceil(s)
    const right = x1 - Math.floor(s)
    const labelled = withLabel && y >= y0 + LABEL_Y0 && y <= y0 + LABEL_Y1
    const cols =
      samplesIn(left, right) - (labelled ? samplesIn(labelX0, labelX0 + LABEL_W - 1) : 0)
    peakCols = Math.max(peakCols, cols)
  }
  return {
    x1: x0,
    x2: x1,
    y1: y0,
    y2: y1,
    cx: (x0 + x1) >> 1,
    cy: (y0 + y1) >> 1,
    w: x1 - x0,
    h,
    uniform: Number((nsat / (probeRows.length * W)).toFixed(3)),
    peak: Number((peakCols / XCOLS).toFixed(3)),
    aspect: Number(((x1 - x0) / h).toFixed(2)),
    gapL: x0,
    gapR: W - 1 - x1,
  }
}

// ─────────────────────────────── fixture 定义 ───────────────────────────────

interface Fixture {
  name: string
  build: () => Canvas
  found: boolean
  /** 期望返回值（全字段）；`found: false` 时不需要 */
  want?: Band
  tol?: Partial<Record<keyof Band, number>>
  /** 拒绝关卡：拒因文本必须包含这些片段（空扫描面与「真零违规」不得同形） */
  rejectMustMention?: string[]
  /** 成形关卡：断言「一条候选都没产生」 */
  expectNoCandidate?: boolean
  /** 正向阳性的按钮几何，供「圆角行仍能成带」的自洽断言用 */
  solid?: { x0: number; w: number; y0: number; h: number }
}

const MAIN = expected(BTN_X0, BTN_Y0_1080, BTN_W, BTN_H, true)
/** F2 的色块：非居中、宽 460px（= 42.6% 屏宽）。
 *  ⚠️ 宽度选 460 而不是更窄是有原因的：420px 时**圆角行**只有 108 个抽样列
 *  （need 109）⇒ 带的顶行被抽样削掉 1px，`y1` 退到 y0+1，`uniform` 的分母跟着变。
 *  那个 1px 抖动本身没错，但会让期望值依赖抽样细节 ⇒ 本门禁统一把宽度取到
 *  「圆角行也稳过 need」，把带的 y 边界钉成**画进去的边界**。 */
const F2_X0 = 240
const F2_W = 460

const FIXTURES: Fixture[] = [
  {
    name: 'F1-primary-centered-1080',
    // 阳性主样本：真机 1080×2160 登录页上的登录按钮（中心 1195 = 真机实测命中值）。
    // 它同时是 F8/F9/F12 的**对照组** —— 与它们逐像素只差一个变量。
    //
    // 断「编造字段」：`x1/x2` 断言的是**画进去的 180/899**，编造值是 0/1079
    // （差 180px）；`w` 断言 719（= 899−180，**没有 +1**），编造值 1080。
    build: () => loginPage({ fill: PRIMARY, x0: BTN_X0, y0: BTN_Y0_1080 }),
    found: true,
    want: MAIN,
    tol: { x1: 2, x2: 2 },
    solid: { x0: BTN_X0, w: BTN_W, y0: BTN_Y0_1080, h: BTN_H },
  },
  {
    name: 'F2-off-center',
    // **证伪「cx = 屏心」**。第一版把 cx 写成 `width//2`（= 540）；这里把色块画在
    // x[240..699]（宽 460 = 42.6% 屏宽）⇒ 量出来的 cx 是 469，差 71px。
    // 居中按钮上 cx 只差 1px（539 vs 540）—— **天生没有判别力**，必须用非居中样本证伪。
    //
    // 顺带夹住 `width_frac` 的**上侧**：460px 宽必须能成带（154 个抽样列 ≥ need 109）。
    // 反事实：若 `need` 写成像素单位 `int(W*0.30)=324`，154 < 324 ⇒ 连候选都没有 ⇒ 转红
    //（这正是 docstring :462-464 记的量纲打架）。
    build: () => barePage({ fill: PRIMARY, x0: F2_X0, y0: 1000, w: F2_W, label: false }),
    found: true,
    want: expected(F2_X0, 1000, F2_W, 120, false),
    tol: { x1: 2, x2: 2 },
    solid: { x0: F2_X0, w: F2_W, y0: 1000, h: 120 },
  },
  {
    name: 'F3-too-narrow-width-frac',
    // `width_frac` 宽度过窄：300px = 27.8% 屏宽 < 30% ⇒ 只有 100 个抽样列 < need 109
    // ⇒ **一条候选都产生不了**。
    //
    // 反事实：把 `width_frac` 降到 0.27（need=98）⇒ 100 ≥ 98 ⇒ 成本带，且留白与高度
    // 都合规 ⇒ 被检出 ⇒ 本用例转红。配对的 F2（154 列，必须成带）把 need 夹在 (100,154]。
    build: () => barePage({ fill: PRIMARY, x0: 390, y0: 1000, w: 300, label: false }),
    found: false,
    expectNoCandidate: true,
  },
  {
    name: 'F4-band-too-short-min-h',
    // `min_h_frac`：20px = 0.93% 屏高 < min_h(25px) ⇒ 拒。真实对应物：卡片里的细饱和横条。
    //
    // 反事实：删掉 min_h 检查 ⇒ 20px 的细条会被当成「按钮」⇒ 本用例转红。
    build: () => barePage({ fill: PRIMARY, x0: BTN_X0, y0: 1000, h: MIN_H - 5, r: 0, label: false }),
    found: false,
    rejectMustMention: [`带高 ${MIN_H - 5}px < ${MIN_H}px`],
  },
  {
    name: 'F5-band-too-tall-max-h',
    // `max_h_frac`：400px = 18.5% 屏高 > 15% ⇒ 拒。真实对应物：通栏横幅 / 主视觉大色块。
    //
    // 反事实：删掉 max_h 检查 ⇒ 大色块被当成按钮 ⇒ 本用例转红。
    build: () => barePage({ fill: PRIMARY, x0: BTN_X0, y0: 900, h: MAX_H + 76, label: false }),
    found: false,
    rejectMustMention: ['屏高 > 15%'],
  },
  {
    name: 'F6-fullbleed-min-margin',
    // **`min_margin_frac` —— 最容易漏的一条，也是「编造字段」的同一个形状**。
    // 把按钮画成**通栏**（左右不留白）：第一版正是把这种图报成
    // `x1=0, x2=width-1, width=width, cx=width//2` ——
    // 也就是说**「报通栏」与「漏掉贴边判据」在输出上完全同形**。
    // 这里要求它必须被拒，且拒因**指名留白那条判据**。
    //
    // 反事实：删掉 margin 检查 ⇒ 本用例返回的正是那六个编造值 ⇒ 转红。
    build: () => barePage({ fill: PRIMARY, x0: 0, w: W, y0: BTN_Y0_1080, label: false }),
    found: false,
    rejectMustMention: ['贴边', '左留白 0px / 右留白 0px', `要求各 ≥${MARGIN_MIN}px`],
  },
  {
    name: 'F7-right-flush-min-margin',
    // 贴边的**另一侧**：`width - 1 - sx2 < margin_min` 分支（右留白 0px、左留白 340px）。
    // 只钉左侧会把这条分支漏掉。
    //
    // 反事实：只留左侧判断（或整条删掉）⇒ 右贴边块被检出 ⇒ 本用例转红。
    build: () => barePage({ fill: PRIMARY, x0: 340, y0: 1000, w: 740, label: false }),
    found: false,
    rejectMustMention: ['贴边', '左留白 340px / 右留白 0px'],
  },
  {
    name: 'F8-grayblue-sat-too-low',
    // 饱和度不足：整块按钮是 `--md-secondary #50606e`（灰蓝，sat = 30 < 40）
    // ⇒ 全图零饱和像素 ⇒ 零候选。
    //
    // 反事实：`sat_min` 降到 30 及以下 ⇒ 本块成带、留白与高度都合规 ⇒ 被检出 ⇒ 转红。
    build: () => loginPage({ fill: SECONDARY, x0: BTN_X0, y0: BTN_Y0_1080 }),
    found: false,
    expectNoCandidate: true,
  },
  {
    name: 'F9-tertiary-sat-just-above',
    // 饱和度门槛的**上侧**：与 F1/F8 逐像素只差填充色 ——
    // `--md-tertiary #3b6470` sat = 53 ≥ 40 ⇒ 必须检出，几何与 F1 完全相同。
    // F8(30) 与 F9(53) 把 `sat_min` 夹在 [31, 53]：改到 30 或 54 都会让本门禁转红。
    build: () => loginPage({ fill: TERTIARY, x0: BTN_X0, y0: BTN_Y0_1080 }),
    found: true,
    want: MAIN,
    tol: { x1: 2, x2: 2 },
    solid: { x0: BTN_X0, w: BTN_W, y0: BTN_Y0_1080, h: BTN_H },
  },
  {
    name: 'F10-blank-login-page',
    // 纯白 / 无饱和页面：登录页的卡片、输入框、占位文字**全在**，就是**还没有按钮**
    // （未渲染 / 加载中）。全图零饱和像素 ⇒ 零候选 ⇒ **全空扫描面**。
    //
    // 少这条，「脚本整体失灵」与「页面上真的没有按钮」就同形了。
    build: () => loginPage(null),
    found: false,
    expectNoCandidate: true,
  },
  {
    name: 'F11-two-bands-area-scoring',
    // 两条都合规的带，**面积大的必须胜出**（`find_wide_solid()` 里 `area = sum(rows[y1:y2+1])` 后按面积取最大）：
    // A = 720×120 在 y[600..719]，B = 720×200 在 y[1300..1499]。
    //
    // 反事实：取第一条 / 取最小面积 ⇒ 返回 A（cy=659）⇒ 与期望的 1399 差 740px ⇒ 转红。
    build: () => {
      const cv = barePage({ fill: PRIMARY, x0: BTN_X0, y0: 600, label: false })
      drawButton(cv, { fill: PRIMARY, x0: BTN_X0, y0: 1300, h: 200, label: false })
      return cv
    },
    found: true,
    want: expected(BTN_X0, 1300, BTN_W, 200, false),
    tol: { x1: 2, x2: 2 },
    solid: { x0: BTN_X0, w: BTN_W, y0: 1300, h: 200 },
  },
  {
    name: 'F12-same-page-at-720-ratio',
    // 与 F1 **逐像素只差按钮的纵向位置**：y0 从 1136 挪到 1203（cy=1262），落点取自
    // 720×1280 的真机实测（748/1280 = 0.584375）按 2160 高的映射。见下面「比例不守恒」那条。
    build: () => loginPage({ fill: PRIMARY, x0: BTN_X0, y0: BTN_Y0_720 }),
    found: true,
    want: expected(BTN_X0, BTN_Y0_720, BTN_W, BTN_H, true),
    tol: { x1: 2, x2: 2 },
    solid: { x0: BTN_X0, w: BTN_W, y0: BTN_Y0_720, h: BTN_H },
  },
]

// ─────────────────────────────── 跑脚本 ───────────────────────────────

/**
 * `find-ui-band.py` 里 `main()` 的 `--csv` / 完整输出行。断言 `x1/x2/uniform` 等字段**只能**从这里读
 * —— `--csv` 只给 `cx,cy`，而 cx 在居中场景下没有判别力（见 F2 注释）。
 * 格式若变，这里会红 —— 那时该改的是这个契约，不是期望值。
 */
const BAND_RE =
  /控件 x\[(\d+)\.\.(\d+)\] y\[(\d+)\.\.(\d+)\] 中心=\((\d+),(\d+)\) 尺寸=(\d+)x(\d+) 实心度=([\d.]+) 峰值=([\d.]+) 宽高比=([\d.]+) 两侧间隙=(\d+)\/(\d+)px/

interface RunResult {
  rc: number
  band: Band | null
  stdout: string
  stderr: string
  /** 拒因行（`  拒：…`）：NOTFOUND 走 stderr（`:590-591`），检出走 stdout（`:607-608`） */
  drops: string[]
}

let dir = ''
const runs = new Map<string, RunResult>()

/** 找不到 python 就**硬失败**，不静默 skip —— skip 会让门禁变成永远绿的空壳。 */
function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' })
    if (probe.status === 0) return bin
  }
  throw new Error(
    'findWideSolid 门禁需要 python3 —— 找不到可用的解释器。' +
      '本门禁**故意不 skip**：skip 等于让判据回归永远绿灯。',
  )
}

function runOn(bin: string, png: string, opts: { csv?: boolean } = {}): RunResult {
  const flags = ['--wide-solid']
  // `--csv` 单独跑：带 `--explain` 时会多打 `[通过全部判据]` 与拒因两行，
  // 输出就不再是 bash 那边 `read bx, by` 期待的纯 CSV。
  if (opts.csv) flags.push('--csv')
  else flags.push('--explain')
  const res = spawnSync(bin, [SCRIPT_REL, png, ...flags], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  const m = stdout.match(BAND_RE)
  const band: Band | null = m
    ? {
        x1: Number(m[1]),
        x2: Number(m[2]),
        y1: Number(m[3]),
        y2: Number(m[4]),
        cx: Number(m[5]),
        cy: Number(m[6]),
        w: Number(m[7]),
        h: Number(m[8]),
        uniform: Number(m[9]),
        peak: Number(m[10]),
        aspect: Number(m[11]),
        gapL: Number(m[12]),
        gapR: Number(m[13]),
      }
    : null
  return {
    rc: res.status ?? -1,
    band,
    stdout,
    stderr,
    drops: `${stderr}\n${stdout}`
      .split('\n')
      .filter((l) => l.includes('拒：')),
  }
}

// 12 张 fixture 全部在 `beforeAll` 里跑完（解码 + 两遍全图扫描是纯 Python，约 0.2~0.3s/张），
// 单条 `it` 只做断言 ⇒ 无需逐条加超时；瓶颈全在 beforeAll。
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'widesolid-'))
  const bin = pythonBin()
  for (const f of FIXTURES) {
    const png = join(dir, `${f.name}.png`)
    writeFileSync(png, encodePng(f.build().px))
    runs.set(f.name, runOn(bin, png))
  }
  // `--csv` 契约：`capture-md3-matrix.sh` 的 `do_login()` 靠它拿 tap 坐标，只认 `cx,cy` 两列。
  // 这是跨端契约（bash 读 Python 输出），故单列一条用例钉住。
  runs.set('__csv__', runOn(bin, join(dir, 'F1-primary-centered-1080.png'), { csv: true }))
}, 180_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** 逐字段比对，容差逐字段给（默认只有 `aspect` 给 0.01，其余必须精确命中）。 */
function expectBand(
  actual: Band | null,
  want: Band,
  tol: Partial<Record<keyof Band, number>>,
  who: string,
) {
  expect(actual, `${who}：应检出并输出几何行（输出格式变了？）`).not.toBeNull()
  const a = actual!
  for (const k of Object.keys(want) as (keyof Band)[]) {
    const t = tol[k] ?? (k === 'aspect' ? 0.01 : 0)
    expect(
      Math.abs(a[k] - want[k]),
      `${who} 字段 ${k}：实测 ${a[k]}，期望 ${want[k]}±${t}`,
    ).toBeLessThanOrEqual(t)
  }
}

describe('find-ui-band · find_wide_solid 判据', () => {
  for (const f of FIXTURES) {
    it(`${f.name}：${f.found ? '应检出并返回画进去的几何' : '应 NOTFOUND'}`, () => {
      const r = runs.get(f.name)!
      if (!r) throw new Error(`fixture ${f.name} 没有跑出结果`)
      if (!f.found) {
        expect(r.stderr, `${f.name} 必须被拒`).toContain('NOTFOUND')
        // 退出码是对外契约：capture-md3-matrix.sh 的 `do_login()` 靠 `||` 在 NOTFOUND 时中止
        expect(r.rc, `${f.name} 退出码应为 1`).toBe(1)
        if (f.expectNoCandidate) {
          // 成形关卡（width_frac / sat_min）：连候选都不产生。断言「零候选」而不是
          // 「有拒因」—— 这些判据在实现里没有 `_drop` 分支，拒因文本无从谈起。
          expect(r.drops.length, `${f.name} 不应产生任何候选`).toBe(0)
        } else {
          // 拒绝关卡：必须指名是哪条判据。只断言 NOTFOUND 的话，
          // 「有条候选被正确拒绝」与「扫完全图一条候选都没有」完全同形。
          expect(r.drops.length, `${f.name} 应产生候选并给出拒因`).toBeGreaterThanOrEqual(1)
          for (const must of f.rejectMustMention ?? []) {
            expect(
              r.stderr,
              `${f.name} 拒因应包含「${must}」（实际：${r.stderr.trim()}）`,
            ).toContain(must)
          }
        }
        return
      }
      expect(r.stderr, `${f.name} 不该被拒`).not.toContain('NOTFOUND')
      expect(r.rc, `${f.name} 退出码应为 0`).toBe(0)
      expectBand(r.band, f.want!, f.tol ?? {}, f.name)
    })
  }

  it('六个字段都不是第一版那组编造值', () => {
    // docstring :449-453 记的编造输出：x1=0, x2=W-1, width=W, cx=W//2, uniform=1.0, peak=1.0。
    //
    // 用 F2（**非居中**）而不是 F1 对撞：F1 的按钮居中，量出来的 cx=539 而编造值
    // `W//2=540`，**只差 1px** ⇒ 居中场景下 cx 这条判据天生没有判别力
    // （review 报告 STD-2 也点了这一条：断言要落在真实量出的 x1/x2/uniform 上）。
    // F2 把色块画在 x[240..699]，cx 差 71px、其余字段差得更远。
    const b = runs.get('F2-off-center')!.band!
    const FABRICATED = { x1: 0, x2: W - 1, w: W, cx: W >> 1, uniform: 1.0, peak: 1.0 }
    // 40px 远大于圆角 / 采样步长带来的 1~2px 抖动
    for (const k of ['x1', 'x2', 'w', 'cx'] as const) {
      expect(
        Math.abs(b[k] - FABRICATED[k]),
        `${k} 不得等于编造值 ${FABRICATED[k]}（实测 ${b[k]}）`,
      ).toBeGreaterThanOrEqual(40)
    }
    for (const k of ['uniform', 'peak'] as const) {
      expect(
        Math.abs(b[k] - FABRICATED[k]),
        `${k} 不得等于编造值 1.0（实测 ${b[k]}）`,
      ).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('同样 9:16 的两个分辨率，按比例算位置 ≠ 实际位置', () => {
    // 钉 docstring :444-447 那个事实：真机实测按钮中心在 720×1280 是屏高 0.584、
    // 在 1080×2160 是 0.552 —— 同样 9:16，**比例不守恒**。「写死比例」的实现在一个
    // 分辨率上正好命中、在另一个上偏 70px，且**不报错**。
    //
    // F1 = 1080×2160 真机位置（cy 1195，真机实测命中值）；
    // F12 = 同一张页面、只把按钮挪到 720×1280 实测比例的落点（cy 1262）。
    // 两张除按钮纵向位置外**逐像素相同** ⇒ 差值只能来自位置本身。
    const a = runs.get('F1-primary-centered-1080')!.band!
    const b = runs.get('F12-same-page-at-720-ratio')!.band!
    expect(a.cy, 'F1 的 cy 应落在 1080 真机实测命中值 1195 上').toBe(BTN_CY_1080)
    expect(b.cy, 'F12 的 cy 应落在 720 比例落点 1262 上').toBe(BTN_CY_720)
    // 差 67px（= (0.584375 − 1195/2160) × 2160 = 67.3）
    expect(b.cy - a.cy, '两分辨率落点之差应约 67px').toBeGreaterThanOrEqual(60)
    // 写死比例会怎么表现：在 F1 上「看起来对」（0.552×2160 = 1192，与 1195 差 3px，
    // 落在检测器 ±2~4px 的抖动里 ⇒ **分不出来**），在 F12 上偏 70px
    //（docstring :447 自己写的那个数）⇒ 转红。
    expect(
      Math.abs(b.cy - Math.round(0.552 * H)),
      '按 1080 的 0.552 比例推算与 720 落点相差甚远 ⇒ 写死比例必然点空',
    ).toBeGreaterThanOrEqual(60)
    // 反过来 0.584 比例在 F1 上同样偏 60px 以上 ⇒ **两个常量都不能写死**。
    expect(
      Math.abs(a.cy - BTN_CY_720),
      '按 720 的 0.584 比例推算同样偏 60px 以上 ⇒ 两个常量都不能写死',
    ).toBeGreaterThanOrEqual(60)
  })

  it('--csv 只输出 cx,cy 两列（capture-md3-matrix.sh 的 tap 契约）', () => {
    const r = runs.get('__csv__')!
    expect(r.stdout.trim(), 'CSV 模式应只有一行 cx,cy').toMatch(/^\d+,\d+$/)
    const [cx, cy] = r.stdout.trim().split(',').map(Number)
    const geo = runs.get('F1-primary-centered-1080')!.band!
    expect(cx, 'CSV 的 cx 应等于几何行的 cx').toBe(geo.cx)
    expect(cy, 'CSV 的 cy 应等于几何行的 cy').toBe(geo.cy)
  })

  it('「零候选」与「有候选被指名拒」被清楚区分开', () => {
    // 防最危险的同形失效：抽取器整体失灵 ⇒ 所有 fixture 都零候选 ⇒ 阴性断言全绿。
    // 反过来若把「零候选」写成「有拒因」，真正的空扫描面又会伪装成「有判据在工作」。
    // 零候选 3 张（F3 宽度过窄 / F8 饱和不足 / F10 无按钮页），
    // 指名拒 4 张（F4 过矮 / F5 过高 / F6 通栏 / F7 右贴边）。
    for (const n of [
      'F3-too-narrow-width-frac',
      'F8-grayblue-sat-too-low',
      'F10-blank-login-page',
    ]) {
      expect(runs.get(n)!.drops.length, `${n} 应为零候选`).toBe(0)
    }
    for (const n of [
      'F4-band-too-short-min-h',
      'F5-band-too-tall-max-h',
      'F6-fullbleed-min-margin',
      'F7-right-flush-min-margin',
    ]) {
      expect(runs.get(n)!.drops.length, `${n} 应指名拒因`).toBeGreaterThanOrEqual(1)
    }
    // 阳性至少 3 张 ⇒ 整条流水线（解码 + 抽样 + 几何）确实在工作
    const positives = FIXTURES.filter((f) => f.found)
    expect(positives.length, '本门禁必须有阳性用例').toBeGreaterThanOrEqual(3)
    for (const f of positives) {
      expect(runs.get(f.name)!.band, `${f.name} 应有几何输出`).not.toBeNull()
    }
  })

  it('被测阈值与 fixture 几何自洽（need / sat_min 的夹逼 + 带的 y 边界）', () => {
    // 成形关卡只能靠「零候选 vs 必成带」来钉，所以这里把**阈值本身**与 fixture 的
    // 抽样列数、饱和度摆在一起，让夹逼关系写在断言里而不是只写在注释里。
    // F2(460px → 154 列) 必须 ≥ need，F3(300px → 100 列) 必须 < need ⇒ need ∈ (100,154]，
    // 正确的 109 在内、被指控的「像素单位 324」在外。
    expect(samplesIn(F2_X0, F2_X0 + F2_W - 1), 'F2 的抽样列数').toBe(154)
    expect(samplesIn(390, 689), 'F3 的抽样列数').toBe(100)
    expect(samplesIn(F2_X0, F2_X0 + F2_W - 1), 'F2 必须够宽以成带').toBeGreaterThanOrEqual(
      NEED_SAMPLES,
    )
    expect(samplesIn(390, 689), 'F3 必须不够宽以零候选').toBeLessThan(NEED_SAMPLES)
    // 饱和度：F8(sat 30) 在门槛下、F9(sat 53) 在门槛上 ⇒ sat_min ∈ [31, 53]。
    expect(sat(SECONDARY), 'F8 灰蓝必须在门槛下').toBeLessThan(SAT_MIN)
    expect(sat(TERTIARY), 'F9 必须在门槛上').toBeGreaterThanOrEqual(SAT_MIN)
    // 真机 primary 必须远在门槛之上（否则主阳性会整体失效而无提示）
    expect(sat(PRIMARY), '真机 primary 饱和度').toBeGreaterThan(SAT_MIN * 2)
    // 其余页面元素（描边 / 卡片 / 页面底 / 文字）**必须**都在门槛下 ——
    // 这是 x1/x2 能恰好落在按钮边界上的前提：描边 sat=13，若门槛被降到 13，
    // 输入框描边会被算进横向外沿，F1 的 x1/x2 断言即失效。
    for (const [name, c] of [
      ['OUTLINE', OUTLINE],
      ['CARD', CARD],
      ['PAGE', PAGE],
      ['TEXT', TEXT],
    ] as const) {
      expect(sat(c), `${name} 的饱和度必须低于门槛`).toBeLessThan(SAT_MIN)
    }
    // `expected()` 假设「带的 y 边界 = 画进去的边界」。这条假设成立的条件是
    // **最窄的一行（圆角行）也够宽以成带**。它不是显然成立的：420px 宽的色块
    // 圆角行只有 108 列（need 109）⇒ 带顶被削掉 1px，`y1` 与 `uniform` 跟着变。
    // 把它写成断言：将来谁改了 fixture 的宽度/圆角，这条会先红并说明原因，
    // 而不是让 `y1` 断言抛出一个「期望 1000 实测 1001」的费解数字。
    for (const f of FIXTURES) {
      if (!f.solid) continue
      const s = f.solid
      const worst = rowWidth(0, s.h, BTN_R, s.w) // 顶行/底行：圆角削得最狠
      const sh = cornerShrink(0, s.h, BTN_R)
      const cols = samplesIn(s.x0 + Math.ceil(sh), s.x0 + s.w - 1 - Math.floor(sh))
      expect(worst, `${f.name} 圆角行仍应有可见宽度`).toBeGreaterThan(0)
      expect(
        cols,
        `${f.name} 圆角行抽样列数 ${cols} < need ${NEED_SAMPLES} ⇒ 带的 y 边界会被削掉，` +
          `请把色块加宽（而不是放宽 y 断言）`,
      ).toBeGreaterThanOrEqual(NEED_SAMPLES)
    }
    // 留白阈值与主阳性的 180px 留白留足余量（阈值改动不至于让主阳性突然翻面）
    expect(MARGIN_MIN, '留白阈值应远小于主阳性的 180px 留白').toBeLessThanOrEqual(180)
  })
})
