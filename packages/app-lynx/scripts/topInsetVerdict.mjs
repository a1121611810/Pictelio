// ─── 顶部让位对拍的**判定**逻辑（与像素探测分离，供单测执行）───
//
// 分离理由：本脚本的像素探测跑在**嵌入式 python + adb** 里，单测跑不动；
// 而「这个数该判成什么」恰恰是真正会出错、也最该有门禁的部分。
// 于是把判定抽成无依赖纯函数，脚本与 `tests/topInsetVerdict.test.ts` 共用同一份。

/**
 * 搜索窗内「平色 surface」的中位行均匀度下限。
 *
 * 真机实测（emulator-5554 / 1080×2160，窗 = [inset+10, inset+barH−10] = [82, 246]）：
 *   有 M3 顶栏的 7 页        → 窗内中位行均匀度 **1.000**（顶栏是平色 surface）
 *   B 变体首页（无顶栏）    → 窗内中位行均匀度 **0.10 ~ 0.40**（封面图）
 * 空档极大，0.75 落在空档正中：离无顶栏族最高值 0.40 尚有 0.35 余量，
 * 离有顶栏族 1.000 也有 0.25 余量。两侧都不是刀刃。
 */
export const MIN_FLAT_SURFACE_UNIFORMITY = 0.75

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
}) {
  const delta = impliedInset - insetPhysical

  // ── 前置条件 ①：窗内必须真的有平色 surface（＝有顶栏）──
  // 无顶栏页（B 变体首页，封面出血到 y=0）的搜索窗落在**封面图**上，深色头发/
  // 阴影的稀疏深色像素会被当成「文字」，反推出的 inset 完全取决于**画的是谁**：
  // 同一张首页实测出现过 −1.5 与 +9.5 两个值 ⇒ 纯噪声。
  // ⇒ 必须在反推**之前**先确认前提，否则后面所有判定都建立在噪声上。
  if (
    medianUniformity !== undefined &&
    medianUniformity < MIN_FLAT_SURFACE_UNIFORMITY
  ) {
    return {
      kind: 'inconclusive',
      delta,
      impliedInset,
      branch: 'not-flat-surface',
      medianUniformity,
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
