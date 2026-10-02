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
 * ⚠️ 本判据**有一族已登记的盲区**，登记在下方 `KNOWN_BLIND_SPOTS` 里 —— 它是**代码**，
 *   不是注释。那两个阈值在原理上就分不开它，所以走的是「登记 + 会红的断言」，
 *   而不是「再调一个阈值」（调阈值对它无效，见下方登记里的说明）。
 */
export const MIN_FLAT_SURFACE_UNIFORMITY = 0.75
export const MIN_CROSS_ROW_AGREEMENT = 0.9

/**
 * 本判据的**已登记失效面**（AGENTS.md「门禁冻结线」#5：必须显式登记，不得只记它抓到了什么）。
 *
 * ## 为什么登记成**数据**而不是注释
 *
 * 注释版的失效面登记是**静默失效**的：改个措辞、挪个位置、把「整屏浅纯色底」简写成
 * 「整屏纯色」，任何基于子串的检查照样绿，而读代码的人已经看不出登记说的是哪一族。
 * 写成导出对象后，登记的**完整性**由门禁逐字段断言（`tests/topInsetVerdict.test.ts`）、
 * **行为**由门禁实测断言（`tests/topInsetMetrics.test.ts` 对合成 fixture 实跑度量脚本），
 * 且它被脚本报 REJECT 的文案**实际消费**（`verify-top-inset.mjs` 的 fail 分支调
 * `blindSpotAdvisory`）—— 删掉登记，operator 就收不到那句可执行的指令，脚本输出随之一变。
 *
 * ## 为什么**不加**第三个颜色信号去覆盖它
 *
 * 门禁冻结线 #5 与 ADR-0215 决策 3 都点名了这一条：这一族与浅色顶栏在**颜色统计上同形**
 * （两个度量同时饱和到 1.000）。颜色维度已经没有信号可用，再加一个只会制造一道
 * 「看起来更全」而判别力同样是零的门禁。真要分离它得用**颜色以外**的事实
 * （顶栏下边缘那条硬边界、路由声明），那属于换判据，不是本登记该做的事。
 *
 * ## 字段契约（门禁逐字段断言：删掉、改名、清空任一字段都会红）
 *   - `id`    稳定标识。门禁按它查找，不按下标 —— 追加新条目不会打乱既有断言。
 *   - `name`  必须**逐字**出现在脚本报 REJECT 的文案里，operator 靠它对上截图。
 *   - `undetectableBecause`  为什么原理上测不出来（因果，不是标签）。
 *   - `hits`  这一族命中时判据给出的**自信**结论，分工如下：
 *              `kind`   = 告警的**触发条件**（见 `blindSpotAdvisory`）；
 *              `branch` = 对**规范探针输入**的实测结果，门禁拿它跟实测分类结果对照，
 *                        两者不等 ⇒ 失效面**缩小**了（判据被真正改好了），必须同步更新登记。
 *   - `operatorAction`  操作者下一步做什么。空串等于「没登记」，门禁会红。
 */
export const KNOWN_BLIND_SPOTS = Object.freeze([
  Object.freeze({
    id: 'flat-fullscreen-light-cover',
    name: '整屏浅纯色底',
    undetectableBecause:
      '与浅色顶栏在颜色统计上同形：逐行横向均匀度与跨行一致性同时饱和到 1.000，' +
      '两个颜色维度对它都没有判别力。命中时前置条件放行，窗内的稀疏深色像素' +
      '（角色、描边）被当成标题 ⇒ 给出自信的 fail，把排查引向「让位没生效」这个错误根因。',
    // ⚠️ 同族在 pass 侧一样不可判别（也会自信地报「通过」），但两者危害不同：
    //   「自信的错误根因」会把人引去查错地方，危害 >「看起来对了」，
    //   且报 REJECT 的只有 fail 侧 —— 故只登记会误导排查的那一侧。
    //   `branch` 取**规范探针**（前置放行 + 反推值像缺陷）的实测结果。
    hits: Object.freeze({ kind: 'fail', branch: 'too-small' }),
    operatorAction:
      '看一眼截图，确认顶栏标题真的在那儿；标题不在 ⇒ 这一族不是缺陷，换到有 M3 顶栏的页面再测。',
  }),
])

/**
 * 给一条 verdict 生成「可能命中已登记盲区」的告警块；没有命中返回 `''`。
 *
 * ## 为什么要它
 *
 * 盲区登记若只活在注释里，**操作者是看不到的** —— 而这一族的危害恰恰落在操作者身上：
 * 脚本报一个自信的 FAIL，人照着去查让位。`blindSpotAdvisory` 是登记与 REJECT 文案之间
 * 唯一的通道：脚本调它、门禁也调它，两边共用同一份措辞 ⇒ 登记不可能只在一处更新。
 *
 * ## 触发条件只比 `kind`，不比 `branch`
 *
 * 这一族命中时，「文字带」落在封面里的**哪个位置**决定了反推值、进而决定了 branch，
 * 而那个位置事先不可知（封面长什么样与判据无关）。所以每一条 `fail` 都有可能是它 ——
 * 告警按 kind 触发，代价只是多提醒看一眼截图，漏发则会把人送去查错根因。
 *
 * @param {{kind: string, branch?: string}} verdict `classifyTopInsetVerdict` 的返回值
 * @returns {string} 多行告警块；无命中时为空串
 */
export function blindSpotAdvisory(verdict) {
  const hits = KNOWN_BLIND_SPOTS.filter((s) => s.hits.kind === verdict.kind)
  if (hits.length === 0) return ''
  return hits
    .map(
      (s) =>
        `  ⚠️ 已登记的失效面命中：「${s.name}」（${s.id}）\n` +
        `     ${s.undetectableBecause}\n` +
        `     ⇒ ${s.operatorAction}`,
    )
    .join('\n')
}

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
 * 1.000，与浅色顶栏在颜色统计上同形（见上方 `KNOWN_BLIND_SPOTS` 的已登记失效面）。而 `router.ts` 里
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

/**
 * 解析 `scripts/top_inset_metrics.py` 的单行输出。
 *
 * ## 为什么单独抽出来
 *
 * 它是 **Python 度量 ↔ JS 判定之间的接缝**，而这道接缝曾整段零测试覆盖：
 * 解析内联在 `verify-top-inset.mjs` 里，三个测试文件分别验 Python 输出、验分类器，
 * **没有任何一条把两者接起来**。后果（code-review 第 6 轮 Spec 轴实测）：
 * `OK` 分支按 `p[1]/p[2]` 取度量，而 python 的 `OK` 行是
 * `OK <center> <start> <end> <peak> <median_unif> <cross_agree>` —— 取到的是
 * **center(167.5) 与 start(139)**，两个都远大于阈值 ⇒ **两道平色闸门被无条件旁路**，
 * 而全量 3568 条测试照样全绿。commit 自称「堵住渐变封面漏网」，脚本路径上并未达成。
 *
 * `NONE` / `BG` 两行恰好只有 3 个字段（`kind median_unif cross_agree`），
 * 所以那两条分支当时是对的 —— **唯独 `OK` 错，而 `OK` 是唯一进入分类器的分支。**
 *
 * 抽成纯函数后，`tests/metricsParse.test.ts` 用**真实 python 输出**逐 kind 钉住字段序。
 *
 * @param {string} out python 的单行 stdout
 * @returns {{kind: 'ok', center: number, start: number, end: number, peak: number,
 *            medianUniformity: number, crossRowAgreement: number}
 *          | {kind: 'none'|'background', medianUniformity: number, crossRowAgreement: number}
 *          | {kind: 'malformed', raw: string}}
 */
export function parseMetricsOutput(out) {
  const p = String(out).trim().split(/\s+/)
  if (p[0] === 'NONE' || p[0] === 'BG') {
    return {
      kind: p[0] === 'NONE' ? 'none' : 'background',
      medianUniformity: Number(p[1]),
      crossRowAgreement: Number(p[2]),
    }
  }
  if (p[0] === 'OK') {
    // ⚠️ 字段序：OK <center> <start> <end> <peak> <median_unif> <cross_agree>
    //    两个度量在**最后两位**，不是前两位。写错会让闸门拿到 center/start 而恒真。
    const [center, start, end, peak, medianUniformity, crossRowAgreement] = p.slice(1).map(Number)
    return { kind: 'ok', center, start, end, peak, medianUniformity, crossRowAgreement }
  }
  return { kind: 'malformed', raw: String(out) }
}
