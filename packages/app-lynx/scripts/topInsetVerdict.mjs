// ─── 顶部让位对拍的**判定**逻辑与几何常量（与像素探测分离，供单测执行）───
//
// 分离理由：本脚本的像素探测跑在**嵌入式 python + adb** 里，单测跑不动；
// 而「这个数该判成什么」恰恰是真正会出错、也最该有门禁的部分。
// 于是把判定与它依赖的几何常量抽成无依赖纯函数，
// 脚本与 `tests/topInsetVerdict.test.ts` 共用同一份 ——
// 常量留在脚本里、测试里另抄一份的话，改了偏置而门禁按旧值测，就是一道**静默失效**的门禁。

/**
 * 标题字形盒相对文本盒中心的固有偏置（物理 px）。
 *
 * 溯源（emulator-5554 实测）：字形盒 `[y1,y2]` 比文本盒 `[y0,y3]` 窄 `2b`，
 * 故 `y2 − b = (y1 + b + y0 + 2b)/2` ⇒ `b = 3.3`。
 * 加上 8.7 的余量构成默认容差 12；历史缺陷量级（spacer 缺失 −60、3 倍 +576）都远超此值。
 */
export const TITLE_GLYPH_BIAS = 3.3

/** 容差 = 固有偏置 + 余量。真实缺陷量级 ≫ 此值。 */
export const DEFAULT_TOLERANCE = 12

/**
 * 搜索窗内「平色 surface」的两个下限。
 *
 * 真机实测（emulator-5554 / 1080×2160，窗 = [inset+10, inset+barH−10] = [82, 246]）：

 * | 样本                | median_unif | cross_agree | 只看 unif | 只看 agree |
 * |---------------------|-------------|-------------|-----------|------------|
 * | 平色顶栏（真机）      | 1.000       | 1.000       | 放行 ✅   | 放行 ✅    |
 * | 平色顶栏（合成）      | 1.000       | 1.000       | 放行 ✅   | 放行 ✅    |
 * | bleed 首页（真机）    | 0.117       | 0.817       | 拦截 ✅   | 拦截 ✅    |
 * | 噪声图               | 0.004       | 0.012       | 拦截 ✅   | 拦截 ✅    |
 * | **平滑纵向渐变封面**  | **1.000**   | **0.555**   | **放行 ❌** | 拦截 ✅  |
 * | 整屏浅纯色底          | 1.000       | 1.000       | 放行 ❌   | 放行 ❌    |
 *
 * ⚠️ 单一维度不够，是被合成 fixture 逼出来的：
 *   逐行**横向**均匀度对天空那种纵向渐变恒为 1.000（每行横向本就同色），
 *   而渐变封面在 Pixiv 推荐流里很常见。只留它 = 门禁看着在、实际漏一整族。
 *
 * ⚠️ **已知残留失效面**（AGENTS.md「门禁冻结线」#5：必须显式登记，不得只记它抓到了什么）：
 *   「整屏浅纯色底」这一族两个度量都测不出来 —— 它与浅色顶栏在颜色统计上**同形**。
 *   命中时本判据会放行、随后在窗内找「稀疏深色文字」，若画面里有深色元素
 *   （角色、描边）就会被当成标题 ⇒ 给出自信的 `fail`。
 *   ⇒ 脚本报 FAIL 时，**看一眼截图确认顶栏标题真的在那儿**；没有就换页。
 *   该残留无法在本判据内消除：颜色统计对「整屏纯色」与「纯色顶栏」本就无区别。
 */
export const MIN_FLAT_SURFACE_UNIFORMITY = 0.75
export const MIN_CROSS_ROW_AGREEMENT = 0.9

/**
 * 判定一次对拍结果。
 *
 * @param {object} p
 * @param {number} p.impliedInset  由标题中心反推出的应用 inset（物理 px）
 * @param {number} p.insetPhysical 平台真值（dumpsys，物理 px）
 * @param {number} p.tolerance     允许偏差（物理 px）
 * @param {number} [p.medianUniformity] 搜索窗内中位行均匀度；缺省视为不检查这一条。
 * @returns {{kind: 'pass'|'inconclusive'|'fail', branch?: string, approx?: number, delta: number, impliedInset: number}}
 *   - `pass`          在容差内。
 *   - `inconclusive`  **本判据在此样本上给不出答案**（不是「通过」，也不是「缺陷」）。
 *   - `fail`          偏差超出容差，且样本适用。
 */
export function classifyTopInsetVerdict({
  impliedInset,
  insetPhysical,
  tolerance,
  medianUniformity,
  crossRowAgreement,
}) {
  // ── 守卫：任何非有限数都必须显式拒绝，不能落进比较运算 ──
  // `NaN < 0.75` 是 false ⇒ 闸门被**静默旁路**，直接掉进下面的比较里给出
  // 一个自信的 verdict。而 NaN 的来源很现实：度量脚本崩了、输出被截断、
  // 窗口为空（hi <= lo）时 median 无从计算。宁可拒绝，不可旁路。
  if (!Number.isFinite(impliedInset) || !Number.isFinite(insetPhysical)) {
    return { kind: 'inconclusive', delta: NaN, impliedInset, branch: 'non-finite-input' }
  }
  // insetPhysical = 0（无状态栏的设备）会让 approx = x/0 = ±Infinity，
  // 且「偏差 = impliedInset − 0」恒等于 impliedInset，容差形同虚设。
  if (insetPhysical <= 0) {
    return { kind: 'inconclusive', delta: NaN, impliedInset, branch: 'no-platform-inset' }
  }

  const delta = impliedInset - insetPhysical

  // ── 前置条件：窗内必须真的有平色 surface（＝有顶栏）──
  // 无顶栏页（B 变体首页，封面出血到 y=0）的搜索窗落在**封面图**上，
  // 深色像素被当成「文字」，反推出的 inset 取决于**画的是谁**：同一张首页
  // 实测出现过 −1.5 与 +9.5 两个值 ⇒ 纯噪声。
  // ⇒ 必须在反推**之前**先确认前提，否则后面所有判定都建立在噪声上。
  //
  // 两个度量都要过：只看逐行横向均匀度会漏掉纵向渐变封面（恒 1.000），
  // 只看跨行一致性会漏掉高细节但整体同色的图。详见 MIN_* 常量的实测表。
  if (
    medianUniformity !== undefined &&
    (!Number.isFinite(medianUniformity) || medianUniformity < MIN_FLAT_SURFACE_UNIFORMITY)
  ) {
    return {
      kind: 'inconclusive',
      delta,
      impliedInset,
      branch: 'not-flat-surface',
      medianUniformity,
      crossRowAgreement,
    }
  }
  if (
    crossRowAgreement !== undefined &&
    (!Number.isFinite(crossRowAgreement) || crossRowAgreement < MIN_CROSS_ROW_AGREEMENT)
  ) {
    return {
      kind: 'inconclusive',
      delta,
      impliedInset,
      branch: 'not-flat-surface',
      medianUniformity,
      crossRowAgreement,
    }
  }

  // ── 不可判别的样本：反推出的 inset ≤ 0 ──
  // inset 是「屏幕边缘到顶栏的距离」，**不可能为负**。≤0 意味着量到的那个
  // 「文字带」不可能是顶栏标题 —— 它落在顶栏盒该在的位置**之上**。
  //
  // ⚠️ 这里必须 REJECT 而不是 FAIL，因为**两类完全不同的页面给出同一个数**：
  //   ① 本页压根没有顶栏（B 变体的首页，顶栏已取消、封面出血到 y=0）；
  //   ② 顶栏在，但让位完全失效（spacer 缺失，顶栏贴在 y=0）。
  // 实测：反推 inset 分别为 −1.5 与 ≈ −3.5，在本判据下不可区分。
  // 自动化误诊（把排查引向错误方向）的代价 > 拒绝（需要人看一眼截图确认顶栏在不在）。
  //
  // 注：前置 ① 已把「无顶栏」这一族拦在外面，所以到这里的 ≤0 大概率是 ②。
  // 保留它作为第二道独立防线 —— 两个判据依据的是**不同的物理事实**。
  if (impliedInset <= 0) {
    return { kind: 'inconclusive', delta, impliedInset, branch: 'nonpositive-inset' }
  }

  if (Math.abs(delta) <= tolerance) {
    return { kind: 'pass', delta, impliedInset }
  }

  // ⚠️ 判别顺序要紧：**先判「偏小」再判「整数倍」**。
  //   反过来写时，spacer=0 的实测倍率约 0.10 会先命中「接近 0 倍」那个整数分支，
  //   把根因误指成「物理像素未换算」—— 活设备上就是这样误报过的。
  //   「偏小」与「密度错」是两类完全不同的缺陷，误指会把排查引向错误方向。
  const approx = impliedInset / insetPhysical
  const isNearZeroish = approx < 0.8
  const isIntegerMultiple =
    !isNearZeroish && Math.abs(approx - Math.round(approx)) < 0.15 && Math.round(approx) > 1

  return {
    kind: 'fail',
    delta,
    impliedInset,
    approx,
    branch: isNearZeroish ? 'too-small' : isIntegerMultiple ? 'density-multiple' : 'unknown',
  }
}

/**
 * 从 `src/router.ts` 的**路由声明**解析某条路由的让位归属。
 *
 * ## 为什么要有它
 *
 * 「本页有没有顶栏」这件事，**像素只能猜**：浅色低细节插画的逐行均匀度能到
 * 1.000，与浅色顶栏在颜色统计上同形（见上方残留失效面）。而 `router.ts` 里
 * 早就写着每条路由的 `meta.topInset` —— 那是**应用自己的规格**，比启发式可靠。
 * 首页在 bleed 归属下就是靠这条直接拒掉的，不再依赖像素。
 *
 * ## 为什么要做成纯函数
 *
 * 它决定「判据跑不跑」。误解析一次 = 对拍在**不该跑的页上**给出自信结论，
 * 而那正是本脚本被反复修掉的那个失败模式。
 *
 * @param {string} routeName  `router.ts` 里 `name: '<x>'` 的那个 x
 * @param {string} routerSrc  `src/router.ts` 全文
 * @param {string|null} bundleSrc  `dist/main.web.bundle` 全文；null = 没构建过
 * @returns {'bleed'|'self'|null} null = **不知道**（调用方必须继续走像素判据）
 */
export function resolveDeclaredTopInset(routeName, routerSrc, bundleSrc) {
  const line = routerSrc
    .split('\n')
    .find((l) => l.includes(`name: '${routeName}'`) && l.includes('topInset'))
  if (!line) return null
  if (line.includes("topInset: 'self'")) return 'self'
  if (!/__HOME_BLEED_HEADER__\s*\?\s*'bleed'\s*:\s*'self'/.test(line)) return null
  // 首页：随构建极性。极性取自**已构建产物**，不从 process.env 重推 ——
  // 否则脚本会有一套自己的缺省，与 bundle 各算各的，那正是要防的静默分叉。
  if (bundleSrc === null) return null
  const bleed = (bundleSrc.match(/topInset:\\"bleed\\"/g) ?? []).length
  if (bleed === 0) return 'self'
  if (bleed <= 2) return 'bleed' // 实测：缺省构建恒为 2
  return null // 形态不认识，别猜
}
