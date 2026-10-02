// ─── 状态栏遮罩对比度的**判定**逻辑与常量（与像素取样分离，供单测执行）───
//
// 分离理由与 `topInsetVerdict.mjs` 同源：本仓的度量跑在 **adb + 嵌入式 python** 里，
// vitest 跑不动；而「这个数该判成什么」恰恰是最该有门禁的部分。
// 脚本与 `tests/statusBarContrast.test.ts` 共用这一份 ——
// 常量留在脚本里、测试里另抄一份的话，改了阈值而门禁按旧值测，就是一道**静默失效**的门禁。
//
// ## 这条判据量的是什么（别与幅值判据混为一谈）
//
// `verify-top-inset.mjs` 量的是**几何**（让位了多少 px）。本模块量的是**颜色**：
// 状态栏区域里，**系统状态栏文字**压在**遮罩+封面**实际合成出的底色上，对比度够不够。
// 前者答「让位对不对」，后者答「看不清」。两者互不替代 —— 「有遮罩」不等于「看得清」，
// 而本仓的痛点恰恰是文档里那个对比度数字**无复现手段**（票 #909）。

/** WCAG 2.x AA 正文阈值。系统状态栏时间/电量属于常规正文（非大字）。 */
export const MIN_STATUS_BAR_CONTRAST = 4.5

/**
 * 采样竖带在**屏宽**上的横向区间（比例）。
 *
 * ## 为什么是中间这一条，为什么不能取全宽
 *
 * 全宽会把**应用自己的内容**一起量进来：沉浸式首页右上角的通知铃铛是
 * `--md-scrim` 的半透明暗底圆钮，落在状态栏带内。全宽取极值 ⇒ 量到的是**铃铛**，
 * 不是遮罩的效果 ⇒ 报出一个与判据无关的数。
 *
 * 中间这一条（0.42W–0.58W）刻意避开右上角铃铛，也避开左侧运营商信息。
 * ⚠️ 它在 Android 上正好是**系统时钟**的位置 —— 见 `status_bar_contrast_metrics.py`
 *    的说明：窗内若真有字形，靠 `MIN_COLUMN_FLATNESS` 闸门显式 REJECT，而不是硬算。
 */
export const CENTER_COLUMN = [0.42, 0.58]

/**
 * 采样窗上下边缘相对状态栏 inset 的内缩（物理 px）。
 *
 * 实测取值 4：状态栏带最上一圈像素可能被系统圆角/刘海裁切，最下一圈紧贴
 * 遮罩渐变的**最不透明端**（`to bottom` ⇒ y=0 最实）。留 4px 让采样落在带的主体上。
 * 该值与 `recommendedBleedHeader.template.test.ts` 记录的取证条件一致（y∈[4,68)）。
 */
export const EDGE_MARGIN = 4

/**
 * 横向平色度下限 —— **REJECT 闸门**。
 *
 * 判据只在「窗内只有遮罩+封面」时成立。窗内一旦有实心内容（铃铛暗底圆钮、
 * 标题胶囊、系统字形铺满），逐行的众数就不再是背景，量到的极值是**那个内容的颜色**。
 * 实测（emulator-5554 / 1080×2160 / 竖带 x∈[454,626) / y∈[4,68)）：
 *
 *
 * ⚠️ 这道闸门是**第二道**防线，不是主判据。主防线是 `CENTER_COLUMN`：
 *    铃铛在右上角、运营商信息在左侧，正中竖带**按设计就不含它们**。
 *    实测（emulator-5554 / 1080×2160 / 竖带 x∈[454,626) / y∈[4,68)）：
 *    沉浸式首页 8 张不同轮播图 flatness **恒为 1.0000**。
 *
 * | 样本                              | flatness | 判定 |
 * |-----------------------------------|----------|------|
 * | 沉浸式首页·遮罩生效（8 张轮播图）   | 1.0000   | 放行 |
 * | 实心内容压住采样窗 ~60% 宽         | 0.5988   | 拦截 |
 * | 实心内容**占满**整条采样窗         | 1.0000   | **放行 ❌** |
 *
 * ⚠️ 两条已知失效面（AGENTS.md「门禁冻结线」#5：显式登记，不得只记它抓到了什么）：
 *   ① **稀疏**字形（系统时钟）只吃掉每行少数像素，众数仍是背景 ⇒ flatness 仍高
 *      ⇒ 放行。此时逐像素极值会取到**字形自己**的颜色，对比度塌到 ≈1.0。
 *      之所以真机上没命中：沉浸式首页**状态栏是隐藏的**
 *      （`LynxActivity.resolveStatusBarAppearance` 在全屏模式返回 null，压根不画字形）。
 *      ⇒ 真机跑出**恰好 1.0000** 才可信；不是 1.0000 就先别信这个数。
 *   ② 实心内容**占满**整条采样窗时，每行内部仍然同色 ⇒ flatness = 1.0000 ⇒ 放行。
 *      这在颜色统计上与「干净的平色遮罩」**同形**，本闸门在原理上拦不住。
 */
export const MIN_COLUMN_FLATNESS = 0.9

/**
 * 状态栏文字色 —— **手抄常量，不从 `tokens.css` 现读**。
 *
 * ## 为什么不现读
 *
 * 现读会变成**同义反复**：令牌与判定在同一处取数，判定就永远与令牌自洽。
 * 手抄 + 下方自检是本仓既有做法（`scrim-contrast.py` 的 `ANCHOR` 同款理由）。
 *
 * ## 极性从哪来（跨端契约，不是猜的）
 *
 * `LynxActivity.isAppearanceLightStatusBarsFor(isDarkMode)` 返回 `!isDarkMode`：
 *   · 明外观（isDarkMode=false）→ true = `setAppearanceLightStatusBars(true)` = **深图标**
 *   · 暗外观（isDarkMode=true） → false = **浅图标**
 * 故图标颜色 = 本主题的 `--md-on-surface`：
 *   · 亮色 sky 板 `--md-on-surface: #191c20` = rgb(25,28,32)   ← 与
 *     `recommendedBleedHeader.template.test.ts` 取证记录里的图标色**逐字相同**；
 *   · 暗色 sky 板 `--md-on-surface: #e0e2e8` = rgb(224,226,232)。
 */
export const STATUS_BAR_TEXT = {
  light: [25, 28, 32],
  dark: [224, 226, 232],
}

// ── WCAG 相对亮度（2.x 原文算法）─────────────────────────────────────────

/** sRGB 分量线性化：`c/12.92`（c ≤ 0.04045）否则 `((c+0.055)/1.055)^2.4` */
export function linearize(channel) {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** 相对亮度 `L = 0.2126R' + 0.7152G' + 0.0722B'` */
export function relativeLuminance([r, g, b]) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** 对比度 `(L_light + 0.05) / (L_dark + 0.05)`，结果恒 ≥ 1 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * 由平台真值推出采样窗。
 *
 * @param {object} p
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} p.frame `dumpsys window` 的
 *   `type=statusBars frame=[x0,y0][x1,y1]`；null = 没找到 ⇒ 判据不可用。
 * @param {number} p.screenWidth `wm size` 的物理宽。
 * @returns {{x0:number,x1:number,y0:number,y1:number,inset:number}|null}
 *   null = 状态栏带太薄到取不到内部像素（⇒ REJECT，不落进比较运算）。
 */
export function deriveStatusBarWindow({ frame, screenWidth }) {
  if (!frame) return null
  const inset = frame.y1 - frame.y0
  // 守卫：inset 必须是有限正数。≤ 0 时窗会退化成空区间，而后续的极值会在空集上
  // 取到 `None`/陈旧值 —— 与 `classifyTopInsetVerdict` 的 non-finite 守卫同源。
  if (!Number.isFinite(inset) || inset <= 0) return null
  const y0 = frame.y0 + EDGE_MARGIN
  const y1 = frame.y1 - EDGE_MARGIN
  if (y1 - y0 < 1) return null
  if (!Number.isFinite(screenWidth) || screenWidth <= 0) return null
  return {
    x0: Math.round(CENTER_COLUMN[0] * screenWidth),
    x1: Math.round(CENTER_COLUMN[1] * screenWidth),
    y0,
    y1,
    inset,
  }
}

/**
 * 判定一次状态栏对比度取样。
 *
 * @param {object} p
 * @param {number[]} p.foreground 状态栏文字色（`STATUS_BAR_TEXT` 之一）
 * @param {number[]} p.darkestBg  窗内最暗像素（真机量得）
 * @param {number[]} p.lightestBg 窗内最亮像素（真机量得）
 * @param {number} p.flatness 窗内横向平色度（真机量得）
 * @param {number} [p.threshold] 阈值，缺省 `MIN_STATUS_BAR_CONTRAST`
 * @returns {{kind:'pass'|'fail'|'reject', branch:string, worst:number, best:number,
 *            worstAgainst:'darkest'|'lightest'}}
 *   - `pass`   两端都过阈（判据取**最坏**一端，故两端都过才算过）。
 *   - `fail`   样本适用，但最坏一端低于阈值。
 *   - `reject` **本判据在此样本上给不出答案** —— 既不是通过也不是缺陷。
 */
export function classifyStatusBarContrast({
  foreground,
  darkestBg,
  lightestBg,
  flatness,
  threshold = MIN_STATUS_BAR_CONTRAST,
}) {
  const reject = (branch) => ({ kind: 'reject', branch, worst: NaN, best: NaN })

  // ── 守卫：非有限数一律显式拒绝，不能落进比较运算 ──
  // `NaN < 4.5` 是 false ⇒ 阈值闸门被**静默旁路**，直接给出自信的 pass。
  // NaN 的来源很现实：python 崩了、输出被截断、窗内空集。
  // 宁可拒绝，不可旁路（与 `classifyTopInsetVerdict` 的 non-finite 守卫同源）。
  //
  // ⚠️ 必须校验**全部 9 个通道**，不能只看每个色的第 0 通道。
  //    首版写成 `[fg?.[0], bg?.[0], ...]` ⇒ `rgb(25,28,NaN)` 能穿过守卫，
  //    掉进 `relativeLuminance` 产出 NaN，再被 `Math.min/max` 吞成 NaN。
  //    而 `NaN >= 4.5` 是 false ⇒ 报出 fail —— 一个「样本有污染」的假诊断，
  //    且**不是** reject，运维会照着 fail 去查遮罩，而真因是取样崩了。
  const chans = [
    ...(Array.isArray(foreground) ? foreground : []),
    ...(Array.isArray(darkestBg) ? darkestBg : []),
    ...(Array.isArray(lightestBg) ? lightestBg : []),
  ]
  if (
    chans.length !== 9 ||
    !chans.every(Number.isFinite) ||
    !Number.isFinite(flatness) ||
    !Number.isFinite(threshold)
  ) {
    return reject('non-finite-input')
  }

  // ── 前置条件：窗内必须只有遮罩+封面（横向平色）──
  // 不先确认前提就去比色，比的是**窗内某个内容自己的颜色**，与判据无关。
  if (flatness < MIN_COLUMN_FLATNESS) return reject('column-not-flat')

  const vsDarkest = contrastRatio(foreground, darkestBg)
  const vsLightest = contrastRatio(foreground, lightestBg)
  // 取**最坏**一端而不是「挑好看的报」：极性由原生契约决定（暗图标 or 浅图标），
  // 落到哪一端不由本脚本选；报最小值才是诚实的口径。
  const worstAgainst = vsDarkest <= vsLightest ? 'darkest' : 'lightest'
  const worst = Math.min(vsDarkest, vsLightest)
  const best = Math.max(vsDarkest, vsLightest)
  return {
    kind: worst >= threshold ? 'pass' : 'fail',
    branch: worstAgainst,
    worst,
    best,
    vsDarkest,
    vsLightest,
  }
}

/**
 * 解析 `scripts/status_bar_contrast_metrics.py` 的单行输出。
 *
 * ## 为什么单独抽出来
 *
 * 它是 **Python 取样 ↔ JS 判定之间的接缝**，而这类接缝在本仓整段零覆盖过：
 * `metricsParse.test.ts` 记着前例 —— `OK` 分支取错字段位，于是两道平色闸门被
 * **无条件旁路**，而全量测试照样全绿。
 *
 * ⚠️ 字段序：`OK <dr> <dg> <db> <lr> <lg> <lb> <flatness> <rows>`
 *    `flatness` 在**倒数第二位**，不是第二位。取错 ⇒ 闸门拿到颜色分量而恒真。
 *
 * @param {string} out python 的单行 stdout
 * @returns {{kind:'ok', darkestBg:number[], lightestBg:number[], flatness:number, rows:number}
 *          | {kind:'empty'} | {kind:'malformed', raw:string}}
 */
export function parseContrastMetricsOutput(out) {
  const p = String(out).trim().split(/\s+/)
  if (p[0] === 'EMPTY') return { kind: 'empty' }
  if (p[0] !== 'OK') return { kind: 'malformed', raw: String(out) }
  const n = p.slice(1).map(Number)
  if (n.length !== 8 || !n.every(Number.isFinite)) {
    return { kind: 'malformed', raw: String(out) }
  }
  const [dr, dg, db, lr, lg, lb, flatness, rows] = n
  return {
    kind: 'ok',
    darkestBg: [dr, dg, db],
    lightestBg: [lr, lg, lb],
    flatness,
    rows,
  }
}
