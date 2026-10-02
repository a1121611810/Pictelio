// ─── 对拍判定逻辑的门禁（scripts/topInsetVerdict.mjs）───
//
// ## 这道门禁为什么存在
//
// 首版把判定内联在 `verify-top-inset.mjs` 里，像素探测跑在嵌入式 python + adb 中，
// 单测跑不动 ⇒ 判定部分**零门禁**。后果在真机上立刻兑现：把脚本停在
// **B 变体首页**（顶栏已取消、封面出血到 y=0，恰恰是 app 的默认落地页），
// 脚本报：
//
//     反推应用 inset = -1.5 物理 px   FAIL 偏差 -73.5 超出容差
//     ⇐ 明显偏小：页面自让位但让位没生效 —— 根容器已不补偿、页面那侧也没补上
//
// 这是一个**自信的错误诊断**：那一页压根没有顶栏，让位「没生效」这句话无从谈起。
// 机理：搜索窗 [inset+10, inset+barH−10] = [82, 246] 落在**封面图**上，深色头发的
// 稀疏深色像素（行内占比 6.3%）被当成了「标题文字」——过不了 60% 的连续背景闸门，
// 却完全够得上「稀疏文字」。
//
// ## 为什么判据**不能**简单加个数值闸门把它变红
//
// 「反推 inset ≤ 0」这一族里同时住着两类完全不同的页面：
//   ① 本页没有顶栏（首页 bleed）      → 实测 −1.5
//   ② 顶栏在但让位完全失效（spacer 缺）→ 实测 ≈ −3.5（顶栏贴在 y=0）
// 两者在本判据下**不可区分**。所以正确的做法不是「猜一个根因」，而是
// 显式判定 `inconclusive`（判据不可用），把区分权交回给人看截图。
// 自动化误诊（把排查引向错误方向）的代价 > 拒绝（多看一眼截图）。
//
// 期望值来源：**真机实测**（emulator-5554 / 1080×2160 / density 480），
// 坐标与数值都记在下面各条用例的注释里，可原样复采；不是从实现反推。
import { describe, expect, it } from 'vitest'
import {
  classifyTopInsetVerdict,
  MIN_FLAT_SURFACE_UNIFORMITY,
  TITLE_GLYPH_BIAS,
  DEFAULT_TOLERANCE,
  resolveDeclaredTopInset,
} from '../scripts/topInsetVerdict.mjs'

// 真机平台真值（dumpsys / wm，emulator-5554）
const INSET = 72 // 状态栏 inset，物理 px
const TOL = DEFAULT_TOLERANCE // 12，脚本默认容差
// 顶栏高 17.067vw × 1080 = 184.32 物理 px，其半 = 92.16
const BAR_HALF = 92.16
// 真机实测：7 个有顶栏页窗内中位行均匀度恒为 1.000
const FLAT = 1.0
// 真机实测：B 变体首页（无顶栏，封面出血）0.102 ~ 0.400
const NOT_FLAT = 0.4

/** 由「标题中心」构造一次判定的输入。
 *  ⚠️ 偏置**不写死 3.3**，而是 import 生产用的 `TITLE_GLYPH_BIAS`：
 *  写死的话，改了偏置而门禁按旧值算 `CENTER_PERFECT` 与全部 ±11.5/±12.5 用例，
 *  整套容差语义会**静默按旧偏置**测下去且照样全绿 —— 一道自己察觉不到的失效门禁。 */
const fromTitleCenter = (center: number, medianUniformity: number = FLAT) => ({
  impliedInset: center - BAR_HALF - TITLE_GLYPH_BIAS,
  insetPhysical: INSET,
  tolerance: TOL,
  medianUniformity,
})

/** 标题中心的**精确**基准值：让位正确时中心应落在 inset + 顶栏半高 + 字形偏置。 */
const CENTER_PERFECT = INSET + BAR_HALF + 3.3

describe('反推 inset 为正 —— 判据适用', () => {
  it('与平台真值一致 ⇒ pass', () => {
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT)).kind).toBe('pass')
  })

  it('容差内 ⇒ pass；刚出容差 ⇒ fail', () => {
    // ⚠️ **不要**在这里钉「恰好 ±12」那个刀刃。两个原因：
    //   ① 浮点：(72+92.16+3.3)+12 减回去得到 12.000000000000014，`<= 12` 判 fail。
    //      钉它等于钉一个由浮点表示决定的偶然。
    //   ② 真实数据里**不可达**：中心来自像素扫描（(start+end)/2，必为 0.5 的倍数），
    //      而 barPhysical = 17.067vw × 1080 = 184.3236 ⇒ 半高 92.1618。
    //      要让 delta 恰为 12，中心得是 179.4618 —— 不是 0.5 的倍数，取不到。
    //    首版两条用例就是在这里把自己判红的（用了四舍五入的 167.5）。
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT + 11.5)).kind).toBe('pass')
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT - 11.5)).kind).toBe('pass')
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT + 12.5)).kind).toBe('fail')
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT - 12.5)).kind).toBe('fail')
  })

  it('让位部分失效（只让位一半）⇒ fail / too-small', () => {
    // 真实缺陷形态：顶栏在，但只让位 36 物理 px（平台真值 72 的一半）⇒ 标题偏上
    const v = classifyTopInsetVerdict(fromTitleCenter(36 + BAR_HALF + 3.3))
    expect(v.kind).toBe('fail')
    expect(v.branch, '必须是「偏小」而不是「密度错」—— 判别顺序反了会把排查引向错误方向').toBe(
      'too-small',
    )
  })

  it('物理像素未换算（3× 历史缺陷）⇒ fail / density-multiple', () => {
    // 状态栏 72 物理 px 被当逻辑 px 用 ⇒ 实际让位 216 物理 px
    const v = classifyTopInsetVerdict(fromTitleCenter(216 + BAR_HALF + 3.3))
    expect(v.kind).toBe('fail')
    expect(v.branch).toBe('density-multiple')
  })

  it('「偏小」必须优先于「整数倍」判别（spacer=0 的倍率约 0.10）', () => {
    // 约 0.10 倍：若先判整数倍分支，`Math.round(0.10)=0` 会被排除，但一旦有人
    // 把阈值调松让它命中，就会把「让位没生效」误指成「密度没换算」。
    // 这里锁住顺序：倍率 0.10 ⇒ too-small。
    const v = classifyTopInsetVerdict({
      impliedInset: INSET * 0.1,
      insetPhysical: INSET,
      tolerance: TOL,
    })
    expect(v.branch).toBe('too-small')
  })
})

describe('反推 inset ≤ 0 —— 判据不可用，必须 inconclusive 而非 fail', () => {
  it('首页 bleed 页实测值（−1.5）⇒ inconclusive', () => {
    // 真机实测：emulator-5554 首页，标题带中心 y=94.0，行内峰值暗占比 6.3%
    //   盒中心 = 94.0 − 3.3 = 90.7 ⇒ 反推 inset = 90.7 − 92.16 = −1.46
    const v = classifyTopInsetVerdict({
      impliedInset: 94.0 - 3.3 - BAR_HALF,
      insetPhysical: INSET,
      tolerance: TOL,
    })
    expect(v.impliedInset).toBeCloseTo(-1.46, 1)
    expect(v.kind, '首页没有顶栏，判据不可用 —— 不能报「让位没生效」').toBe('inconclusive')
  })

  it('「让位完全失效」（顶栏贴 y=0，反推 ≈ −3.5）同样 inconclusive', () => {
    // 这两条**必须**给出同一个 kind：它们在本判据下不可区分。
    // 若哪天有人给它们分了不同判定，就是在假装本判据能区分一件它区分不了的事。
    const spacerFailed = classifyTopInsetVerdict(fromTitleCenter(BAR_HALF + 3.3))
    expect(spacerFailed.kind).toBe('inconclusive')
    expect(classifyTopInsetVerdict(fromTitleCenter(94.0)).kind).toBe(spacerFailed.kind)
  })

  it('inconclusive 分支名固定为 nonpositive-inset', () => {
    expect(classifyTopInsetVerdict(fromTitleCenter(10)).branch).toBe('nonpositive-inset')
  })

  it('恰好 0 也算 inconclusive（inset 是距离，不可能为 0 以外的正数缺口）', () => {
    const v = classifyTopInsetVerdict({ impliedInset: 0, insetPhysical: INSET, tolerance: TOL })
    expect(v.kind).toBe('inconclusive')
  })

  it('回归防线：inconclusive 不得携带 fail 的诊断分支', () => {
    // 首版就是在这里出的事：给了 fail + 「让位没生效」的**自信**诊断。
    // 门禁的作用是：任何人想把它改回 fail，必须先让这条转红并重新想一遍。
    const v = classifyTopInsetVerdict(fromTitleCenter(94.0))
    expect(v.branch, '不可判别的样本不得复用 fail 的根因分支').not.toBe('too-small')
    expect(v.branch).not.toBe('density-multiple')
  })
})

describe('前置条件：窗内必须真的有平色 surface', () => {
  it('阈值把真机实测的两族分在两侧（不是与自身比较的同义反复）', () => {
    // ⚠️ 这两条**曾经是同义反复**：FLAT / NOT_FLAT 是本文件里的字面量，
    // 与真机数据零关联，拿它们和阈值比只是自证（code-review 第 5 轮 Spec 轴指出）。
    // 现在真值由 tests/topInsetMetrics.test.ts 对**合成 fixture 实跑度量**得到，
    // 本条只断言「阈值确实把两族分开了」—— 若度量变了、阈值没跟上，这里会红。
    expect(NOT_FLAT).toBeLessThan(MIN_FLAT_SURFACE_UNIFORMITY)
    expect(MIN_FLAT_SURFACE_UNIFORMITY).toBeLessThan(FLAT)
    // 两侧余量都要够：阈值挪 ±0.1 不该改变任何一族的归属
    expect(MIN_FLAT_SURFACE_UNIFORMITY - NOT_FLAT).toBeGreaterThan(0.2)
    expect(FLAT - MIN_FLAT_SURFACE_UNIFORMITY).toBeGreaterThan(0.2)
    // 且分类器确实按这个阈值把两族分到了不同的 branch
    const pass = classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT, FLAT))
    const reject = classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT, NOT_FLAT))
    expect(pass.branch).not.toBe('not-flat-surface')
    expect(reject.branch).toBe('not-flat-surface')
  })

  it('无顶栏页实测均匀度 ⇒ inconclusive / not-flat-surface', () => {
    // 同一张首页实测出现过 −1.5 与 +9.5 两种反推值。
    // **两个都必须**是 inconclusive —— 只拦住负的那个，正是首版的漏网之处。
    for (const center of [94.0, 101.0]) {
      const v = classifyTopInsetVerdict(fromTitleCenter(center, NOT_FLAT))
      expect(v.kind, `标题中心 ${center} 仍未被拦住`).toBe('inconclusive')
      expect(v.branch).toBe('not-flat-surface')
    }
  })

  it('均匀度不够时，偏差多大都不得判 fail（噪声不能当缺陷）', () => {
    // 反推值恰好落在平台真值上（delta = 0）也一样拒绝：此时 pass 也没意义，
    // 因为这个「吻合」是封面图凑出来的，不是让位做对了。
    const v = classifyTopInsetVerdict({
      impliedInset: INSET,
      insetPhysical: INSET,
      tolerance: TOL,
      medianUniformity: 0.2,
    })
    expect(v.kind).toBe('inconclusive')
    expect(v.branch).toBe('not-flat-surface')
  })

  it('有顶栏页实测均匀度 1.000 ⇒ 前置条件放行', () => {
    expect(classifyTopInsetVerdict(fromTitleCenter(CENTER_PERFECT, FLAT)).kind).toBe('pass')
  })

  it('未提供均匀度时不检查这一条（保持对既有调用方的兼容）', () => {
    const v = classifyTopInsetVerdict({
      impliedInset: INSET,
      insetPhysical: INSET,
      tolerance: TOL,
    })
    expect(v.kind).toBe('pass')
  })
})

describe('边界：容差本身被误传时不得静默通过', () => {
  it('容差为 Infinity ⇒ 任何值都 pass（说明容差必须来自 CLI 且有默认值）', () => {
    // 不是缺陷，是把「容差可被任意放大」这件事记下来：脚本的 TOLERANCE 默认 12，
    // 只有显式 --tolerance 才会改。这条锁住「容差是判据的一部分」。
    const v = classifyTopInsetVerdict({
      impliedInset: INSET * 3,
      insetPhysical: INSET,
      tolerance: Number.POSITIVE_INFINITY,
    })
    expect(v.kind).toBe('pass')
  })
})

// ── 路由声明解析：判据「跑不跑」的决定点，必须可测 ──
//
// 期望值来源：`src/router.ts` 的**真实两行**（逐字抄录，见下），
// 不是从实现反推的 mock。
const ROUTER_SRC = [
  "export const RECOMMENDED_PATH = '/recommended'",
  "  { path: '/illust', name: 'illust', component: IllustList, meta: { requiresAuth: true, topInset: 'self' } },",
  "  { path: RECOMMENDED_PATH, name: 'recommended', component: Recommended, meta: { requiresAuth: true, topInset: __HOME_BLEED_HEADER__ ? 'bleed' : 'self' } },",
].join('\n')

// 产物里引号是「反斜杠+引号」的字面串；实测缺省构建 bleed 出现 2 次
const BUNDLE_BLEED = 'x topInset:\\"bleed\\" y topInset:\\"self\\" z topInset:\\"self\\"'
const BUNDLE_SELF = 'topInset:\\"self\\"'.repeat(24)

describe('resolveDeclaredTopInset：按应用自己的路由声明判「有没有顶栏」', () => {
  it('字面量 self 的路由 ⇒ self（不依赖构建）', () => {
    expect(resolveDeclaredTopInset('illust', ROUTER_SRC, BUNDLE_BLEED)).toBe('self')
    expect(resolveDeclaredTopInset('illust', ROUTER_SRC, BUNDLE_SELF)).toBe('self')
  })

  it('首页在缺省构建 ⇒ bleed（判据据此直接拒绝，不再靠像素猜）', () => {
    expect(resolveDeclaredTopInset('recommended', ROUTER_SRC, BUNDLE_BLEED)).toBe('bleed')
  })

  it('首页在回退构建 ⇒ self（同一份源码，产物决定极性）', () => {
    expect(resolveDeclaredTopInset('recommended', ROUTER_SRC, BUNDLE_SELF)).toBe('self')
  })

  it('**不许把「读不到」当成「没有顶栏」**', () => {
    // 没构建过（bundleSrc = null）⇒ 不知道，必须放行后续像素判据。
    // 若这里返回 'bleed'，真缺陷页会被判成「不适用」—— 比误报危险得多。
    expect(resolveDeclaredTopInset('recommended', ROUTER_SRC, null)).toBeNull()
    // 路由名不存在 / 源码里没有该路由 ⇒ 同样不知道
    expect(resolveDeclaredTopInset('nonexistent', ROUTER_SRC, BUNDLE_BLEED)).toBeNull()
    expect(resolveDeclaredTopInset('recommended', '', BUNDLE_BLEED)).toBeNull()
  })

  it('形态不认识时返回 null 而不是瞎猜', () => {
    // 将来有人把路由表改成数组字面量或多行对象，这里必须老实说「不知道」
    const weird = "  { name: 'recommended', topInset: someHelper() },"
    expect(resolveDeclaredTopInset('recommended', weird, BUNDLE_BLEED)).toBeNull()
  })

  it('产物里 bleed 出现次数异常 ⇒ null（不猜是哪种构建）', () => {
    const odd = 'topInset:\\"bleed\\"'.repeat(9)
    expect(resolveDeclaredTopInset('recommended', ROUTER_SRC, odd)).toBeNull()
  })
})
