import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  calcNearestPage,
  calcSnapTarget,
  clampOffset,
  SNAP_THRESHOLD_RATIO,
  FLING_VELOCITY_PX_PER_MS,
} from '../primitives/swiperMath'

/**
 * `CarouselSwiper.vue` 的源码与**剥离注释后**的代码，供本文件的结构性判据使用。
 * ⚠️ 为什么必须剥注释：本组件头注里大量出现 `setStyleProperty`、`main-thread`、
 *    `.value` 等**被讨论的字样**（作为「不可用 / 不可这样写」的说明）。
 *    全文匹配这些 token 会让对应判据恒假 —— **判据报错先怀疑判据**。
 *    （同族坑：ADR-0119 门禁里 `h-\[\\s*...` 双层反斜杠导致派生集合恒空。）
 */
const vueSrc = readFileSync(fileURLToPath(new URL('./CarouselSwiper.vue', import.meta.url)), 'utf8')
const code = vueSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// oracle = vue-lynx 教程《商品详情页图片轮播》语义（吸附最近页 / 边界钳制）；
// calcSnapTarget 的 oracle = spec: app-lynx-recommended-carousel-polish-r2 §2.2/§3.1 + ADR-0118 决策 2
// （1/3 屏宽阈值 + fling 甩动，双向对称；未过阈值且低速回弹；fling 方向 = 速度方向）。
// 纯函数，node 可测；与 mergeByTime.test.ts 同「深模块纯逻辑就近测试」惯例。

describe('calcNearestPage', () => {
  it('吸附到最近页：round(offset / itemWidth) * itemWidth', () => {
    expect(calcNearestPage(-150, 100)).toBe(-100) // -1.5 → JS Math.round 向 +∞ → -1 页（教程语义）
    expect(calcNearestPage(-140, 100)).toBe(-100) // -1.4 → -1 页
    expect(calcNearestPage(0, 100)).toBe(0)
    expect(calcNearestPage(-260, 100)).toBe(-300) // -2.6 距 -3 页更近
    expect(calcNearestPage(-250, 100)).toBe(-200) // -2.5 四舍五入到 -3？→ Math.round(-2.5) = -2（JS 向零取整）
  })

  it('非法输入返回 0（避免 NaN 污染 transform）', () => {
    expect(calcNearestPage(NaN, 100)).toBe(0)
    expect(calcNearestPage(-100, 0)).toBe(0)
    expect(calcNearestPage(-100, -1)).toBe(0)
    expect(calcNearestPage(Infinity, 100)).toBe(0)
  })
})

describe('calcSnapTarget（1/3 阈值 + fling，ADR-0118 决策 2）', () => {
  const W = 100

  it('阈值：拖过 1/3 屏宽松手翻页（-0.34×W → -W），未过回弹（-0.32×W → 0）', () => {
    expect(calcSnapTarget(-34, W)).toBe(-100)
    expect(calcSnapTarget(-32, W)).toBe(0)
  })

  it('双向对称：右滑过阈值 → 上一张（0.34×W → +W）；未过 → 回弹（0.32×W → 0）', () => {
    expect(calcSnapTarget(34, W)).toBe(100)
    expect(calcSnapTarget(32, W)).toBe(0)
  })

  it('fling：快甩短距离（位移 -0.2×W 但速度 -0.8 px/ms）→ 沿速度方向翻页 -W', () => {
    expect(calcSnapTarget(-20, W, { velocityPxPerMs: -0.8 })).toBe(-100)
  })

  it('慢拖未过阈值 + 低速 → 回弹（位移 -0.2×W、速度 -0.2）', () => {
    expect(calcSnapTarget(-20, W, { velocityPxPerMs: -0.2 })).toBe(0)
  })

  it('停稳页上快甩（offset 0 + 速度 -0.8）→ -W（fling 独立于位置）', () => {
    expect(calcSnapTarget(0, W, { velocityPxPerMs: -0.8 })).toBe(-100)
  })

  it('fling 方向 = 速度方向：右甩 +0.8 → +W（上一张）', () => {
    expect(calcSnapTarget(20, W, { velocityPxPerMs: 0.8 })).toBe(100)
  })

  it('过阈值时以位置方向为准（不叠加速度方向）：-0.34×W 且速度 +0.8 → 仍 -W', () => {
    // 位置已过 1/3（左滑），速度却向右——翻页方向跟随位置（拖到哪算哪）
    expect(calcSnapTarget(-34, W, { velocityPxPerMs: 0.8 })).toBe(-100)
  })

  it('回归：位移跨过 50% 中点（offset -0.6×W，起点 0）→ 翻页 -W（frac 符号不得反转）', () => {
    // 旧实现：round(-0.6) = -1 → frac = +0.4 → sign(+)=+1 → 目标 0（错误回弹）。
    // 修复：以手势起点 startOffset 计算 dragFrac（-0.6），|−0.6| ≥ 1/3 → -1 页。
    expect(calcSnapTarget(-60, W, { startOffset: 0 })).toBe(-100)
  })

  it('回归：跨多页长拖（起点 -3W、再拖 -0.5W → offset -3.5W）→ 目标 -4W（相对起点翻一页）', () => {
    expect(calcSnapTarget(-350, W, { startOffset: -300 })).toBe(-400)
  })

  it('回归：起点非 0 时慢拖未过阈值 → 回起点（起点 -3W、拖 -0.2W → -3W）', () => {
    expect(calcSnapTarget(-320, W, { startOffset: -300 })).toBe(-300)
  })

  it('非法输入返回 0（防 NaN 污染 transform，沿用 calcNearestPage 惯例）', () => {
    expect(calcSnapTarget(NaN, W)).toBe(0)
    expect(calcSnapTarget(-100, 0)).toBe(0)
    expect(calcSnapTarget(-100, -1)).toBe(0)
    expect(calcSnapTarget(Infinity, W)).toBe(0)
  })
})

describe('clampOffset', () => {
  it('上界 0、下界 -(dataLength-1)*itemWidth，越界钳制', () => {
    // 5 条、宽 100：可滑范围 [-400, 0]
    expect(clampOffset(50, 5, 100)).toBe(0) // 正越界 → 0
    expect(clampOffset(-300, 5, 100)).toBe(-300) // 界内
    expect(clampOffset(-500, 5, 100)).toBe(-400) // 负越界 → 下界
    expect(clampOffset(0, 5, 100)).toBe(0)
  })

  it('单条/空数据：边界收敛到 0（无滑动空间）', () => {
    expect(clampOffset(-100, 1, 100)).toBe(0)
    expect(clampOffset(100, 1, 100)).toBe(0)
    expect(clampOffset(-100, 0, 100)).toBe(0)
  })

  it('非法输入返回 0', () => {
    expect(clampOffset(NaN, 5, 100)).toBe(0)
    expect(clampOffset(-100, 5, 0)).toBe(0)
    expect(clampOffset(-100, -1, 100)).toBe(0)
  })
})

// ─── 轮播 ↔ swiperMath 的接线门禁 ─────────────────────────────────────────
//
// ## 这道门禁在守什么
//
// 票 #920 期间曾尝试把轮播改成 vue-lynx 官方主线程（MTS）方案，并把吸附逻辑从本模块
// **内联**进 `CarouselSwiper.vue`。该方案**未落地**（ADR-0115:88 判定真机不可用），
// 代码已回退到后台线程方案 ⇒ `CarouselSwiper.vue` 直接 import `swiperMath`。
//
// 现状是健康的「单一实现 + 单测直接覆盖线上代码」。这道门禁守的是**别把接线改坏**：
// 有人为省事把吸附逻辑再抄一份进组件，或反过来把本模块的调用删掉，两边就会漂移。
//
// ## ⚠️ 为什么下面几条曾经写反（登记在此，避免重蹈）
//
// 首版门禁是照着**已废弃的 MTS 形态**写的，于是产生三条**反向假规则**——
// 它们禁止的恰恰是**当前正确代码**，一旦留下就会把正确实现教成 bug：
//   ① `not.toMatch(/import .*swiperMath/)` —— 而 import 本模块正是当前正确做法；
//   ② 「MT 函数区不得出现 `.value`」—— 而后台线程方案里 `.value` 正是正确写法；
//   ③ 「`main-thread-bindtouch*` 三绑定齐全」—— 而那组绑定正是 ADR-0115 判定会导致
//      真机整块空白的东西。
//
// 判据报错先怀疑判据（AGENTS.md 门禁冻结线 #5：会骗人的门禁会被人信）。

describe('CarouselSwiper 接线契约（吸附逻辑单一实现，票 #920 教训）', () => {
  it('吸附逻辑单一实现：BG 形态 import swiperMath，MTS 形态内联（不得出现第二副本）', () => {
    // ⚠️ 刻意**不断言具体形态**。两种合法形态：
    //   · BG（当前）：跨模块 import swiperMath —— 直接复用，单一实现；
    //   · MTS：helper 必须内联进本模块（MT 打包器剥离无指令模块的函数体）。
    //   首版曾把「必须 import」写成无条件正向断言，那会把 MTS 修法判红 —— 同类锁死方向的问题。
    // 这里只守**不变式**：吸附语义在本仓只应有一份实现来源。
    const usesMt = code.includes(':main-thread-bindtouchmove=')
    const importsMath = /import\s*\{[^}]*\bcalcSnapTarget\b[^}]*\}\s*from\s*['"][^'"]*swiperMath['"]/.test(code)
    if (usesMt) {
      // MTS：必须内联，且**不得**同时还 import 着（否则两份实现 ⇒ 漂移）
      expect(importsMath, 'MTS 形态下若内联了 helper 就不应再 import swiperMath（避免两份实现）').toBe(false)
    } else {
      expect(importsMath, 'BG 形态应复用 swiperMath（不要在组件里另抄一份吸附逻辑）').toBe(true)
      // BG 形态下 import 了就**不得**在组件里再定义同名本地实现（两份实现 = 漂移源）。
      // 这条是被变异测试逼出来的：首版只查了「import 存在」，把「import + 本地重定义」放过了。
      expect(code, 'BG 形态下不得在组件内另定义 clampOffset/calcSnapTarget（会与 swiperMath 形成两份实现）')
        .not.toMatch(/(function|const)\s+(clampOffset|calcSnapTarget)\b/)
    }
    // 无论哪种形态，都必须用上钳制（否则边界不收敛）
    const usesClamp = importsMath || code.includes('clampOffset')
    expect(usesClamp, '位移必须经过钳制（否则滑出边界无法回弹）').toBe(true)
  })

  it('吸附阈值常量由 swiperMath 单点定义（1/3 屏宽，ADR-0118 决策 2）', () => {
    // 期望值来源 = ADR-0118 决策 2 的规格原文，不是从实现反推。
    expect(SNAP_THRESHOLD_RATIO).toBe(1 / 3)
    // 组件内不得再定义同名常量（那会形成第二事实源）
    expect(code).not.toContain('const SNAP_THRESHOLD_RATIO')
  })

  it('fling 速度阈值由 swiperMath 单点定义（0.4 px/ms）', () => {
    expect(FLING_VELOCITY_PX_PER_MS).toBe(0.4)
    expect(code).not.toContain('const FLING_VELOCITY_PX_PER_MS')
  })

  it('吸附判定基于手势起点 startOffset，非仅最终 offset（跨 50% 中点回归）', () => {
    // 平台无关的语义不变量：ADR-0118 决策 2 修的就是「跨中点误回弹」。
    // 后台线程形态下读的是 `touchStartOffset.value`。
    expect(code).toMatch(/startOffset:\s*touchStartOffset\.value/)
    // 且必须把它透传给 calcSnapTarget（不传 = 退化回仅按最终 offset 判定）
    expect(code).toMatch(/startOffset:\s*touchStartOffset\.value\s*,?/)
    // 规格侧同款用例（跨中点不误回弹）必须仍绿
    expect(calcSnapTarget(-60, 100, { startOffset: 0 })).toBe(-100)
  })

  it('位移必须有驱动通道，且 BG 形态不得用 transform 平移（真机第 2 张起不渲染）', () => {
    // ⚠️ 本条**曾经是反向假规则**（code-review 2026-10-03 抓出）：原判据只要求
    //    「transform 被驱动」，于是把 `transform: translateX` 这个**真机不渲染的形态**
    //    锁成了门禁 —— 谁修好这个 bug，谁就先把门禁弄红。形态锁比 bug 判据更危险。
    // ⇒ 现在守**不变量**「位移有驱动通道」，并显式禁止真机已证伪的形态。
    //
    // 真机对照实验（emulator-5554 / Android 14 / 1080×2160，票 #920）：
    //   `transform: translateX()` → 第 2 张起**整个 slide** 不渲染（连注入的底色都不出现）
    //   `marginLeft: <px>`        → 第 2 张起完整渲染，连滑 4 页正常
    //   详见 CarouselSwiper.vue 头注与 ADR-0119 的 2026-10-03 订正块。
    const usesTransform = code.includes('transform') || code.includes("setStyleProperty('transform'")
    const usesMt = code.includes(':main-thread-bindtouchmove=')

    if (usesMt) {
      // MTS 形态：平移通道由主线程 setStyleProperty 提供。
      // ⚠️ MTS + transform 组合：**MTS 已于 2026-10-03 裁决为可用**（ADR-0115 裁决块），
      //    但「MTS + transform 平移」这个**组合**仍不宜采用 —— 独立的轮播 bug 已证：
      //    真机不为被 `transform: translateX` 平移的容器渲染子元素（票 #920）。
      //    故即使将来切 MTS，平移属性也须用 marginLeft（见组件头注）。不在此断言 MTS 分支对错。
      //    只要求「有驱动通道」，避免把未验证的判断写成门禁。
      expect(
        code.includes("setStyleProperty(") || code.includes('transform'),
        'MTS 形态下位移必须有驱动通道（setStyleProperty 或 :style）',
      ).toBe(true)
      return
    }

    // BG 形态（当前线上）：用 marginLeft 平移。
    // 判据锁**危险形态**（transform），不锁**键名/写法细节** —— 将来若换其它等价平移方式
    // （如 left/translate3d 并已真机验证），只需更新本条并附证据，不算门禁误伤。
    expect(
      code,
      'BG 形态下不得用 `transform` 平移：真机 LynxView 上被 transform: translateX 平移的' +
        '容器内子元素不渲染（首页轮播第 2 张起整张 slide 空白，票 #920 实测）。' +
        '改用 marginLeft 平移已验证有效。',
    ).not.toMatch(/transform/)
    expect(
      code,
      'BG 形态的位移必须由 marginLeft 驱动（`:style` 绑定 containerOffset）',
    ).toMatch(/marginLeft:\s*`\$\{containerOffset\}px`/)
  })

  it('.swiper-wrapper 必须裁切溢出（margin 参与布局流，不裁切会让相邻 slide 渗出）', () => {
    // ⚠️ 这条**曾经是隐式的**：改用 marginLeft 平移前，溢出由 transform 的
    //    「不改布局流」特性天然不存在，不需要显式裁切。换成 marginLeft 后
    //    容器盒会真的向左溢出 wrapper 边界，裁切责任落到 wrapper 身上。
    //    真机复验（票 #920 修复后，emulator-5554 / 1080×2160）：显式加上后
    //    左右缘最外 3 列逐像素均为页面底色 (11,15,18) ⇒ 无渗出，且图片/圆角/scrim 渲染不受影响。
    // ⇒ 这条样式**不是冗余**，删掉会让溢出防线消失（真机上表现为第 2 页从左缘渗出）。
    const style = vueSrc.slice(vueSrc.indexOf('<style>'))
    const wrapper = style.match(/\.swiper-wrapper\s*\{([^}]*)\}/)
    expect(wrapper, '未找到 .swiper-wrapper 规则（样式结构变了？）').not.toBeNull()
    // ⚠️ **必须剥注释再判**：本规则的捕获组会连注释一起吞进来
    //    （`.swiper-wrapper {` 之后到 `}` 之间的全部内容，含 /* */）。
    //    不剥的话，把 `overflow: hidden` 挪进注释里就会让本判据**假绿**——
    //    而「注释里写了它」与「代码里生效」是两回事。已实测该假绿存在。
    const decls = wrapper![1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
    expect(
      decls,
      '.swiper-wrapper 必须有 overflow: hidden —— marginLeft 平移参与布局流，' +
        '不裁切则相邻 slide 会渗出（票 #920 修复时新增）',
    ).toMatch(/overflow:\s*hidden/)
  })

  it('触摸三绑定齐全（少一个 = 拖拽或吸附断链）', () => {
    // ⚠️ 刻意**不**断言用哪种绑定（`@touch*` vs `:main-thread-bindtouch*`）。
    //   首版曾写 `not.toContain('main-thread-bind')`，理由是 ADR-0115:88 判主线程方案不可用——
    //   但票 #920 的真机复刻证明 **MTS 链路本身可用**（原型绿条 x=0~536→144~681 精确平移），
    //   且 #920 记录了「若改用 MTS，helper 必须内联或同模块带 'main thread' 指令」这一前提。
    //   那条反向断言等于**把可能的正确修法锁成红**，且它自己绿着（比红测更危险）。
    //   ⇒ 这里只守「三绑定都在」，把方案选择留给人；方案相关的约束另立条目。
    const bindCount = ['touchstart', 'touchmove', 'touchend'].filter((e) => {
      // 两种绑定前缀都算（后台线程 `@touch*` / 主线程 `:main-thread-bindtouch*`）
      return code.includes(`@${e}="`) || code.includes(`:main-thread-bind${e}="`)
    })
    expect(bindCount, '触摸三绑定必须齐全（少一个即拖拽或吸附断链）').toHaveLength(3)
  })

  it('若采用主线程（MTS）绑定，helper 必须在同模块内联（ADR-0115:88 的空白根因）', () => {
    // 这是**条件式**判据：只在真的用了 main-thread 绑定时才生效。
    // 根因（docs/research/vue-lynx-swiper-tutorial.md:23 §7）：MT 打包器对**不含
    // `'main thread'` 指令的模块**只保留 import、剥离函数体 ⇒ 跨模块 import 的 helper
    // 在主线程运行时是 `undefined` ⇒ 组件整块空白。
    // ⇒ 用 MTS 就必须内联（或把 helper 放进带指令的模块），且单位全程 px。
    const usesMt = code.includes(':main-thread-bindtouchmove=')
    if (!usesMt) {
      // 当前形态：后台线程。跨模块 import swiperMath 是**正确**做法。
      expect(code).toMatch(/import\s*\{[^}]*\bcalcSnapTarget\b[^}]*\}\s*from\s*['"][^'"]*swiperMath['"]/)
      return
    }
    // MTS 形态：禁止跨模块 import 本模块（否则主线程拿到 undefined）
    expect(code, 'MTS 形态下不得跨模块 import 无指令模块的 helper').not.toMatch(
      /import\s*\{[^}]*\bcalcSnapTarget\b[^}]*\}\s*from\s*['"][^'"]*swiperMath['"]/,
    )
  })

  it('clampOffset 边界语义：单条收敛 0 / 越界钳到界（期望值取自公式，非自洽反推）', () => {
    expect(clampOffset(-50, 1, 100)).toBe(0) // 单条：下界收敛到 0
    expect(clampOffset(-500, 3, 100)).toBe(-200) // 越界 → 下界 -(3-1)*100
    expect(clampOffset(50, 5, 100)).toBe(0) // 上越界 → 0
    expect(clampOffset(-300, 5, 100)).toBe(-300) // 界内原样
  })
})
