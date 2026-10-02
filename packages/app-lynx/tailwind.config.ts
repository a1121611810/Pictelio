import type { Config } from 'tailwindcss'
import lynxPreset from '@lynx-js/tailwind-preset'

// Tailwind v3 + @lynx-js/tailwind-preset（vue-lynx 官方集成方案）
// 单位策略（经原型实测 + 决策）：
// - spacing → vw 档位：间距随屏宽缩放（1 档 = 4px @375 设计稿，vw 值 = px/375×100）
// - fontSize → rpx 档位：字号随屏宽缩放（沿用现有字号语义）
// - colors → Material Design 3 语义色板：引用 tokens.css 的 M3 变量（单一事实源），
//   旧 Fluent 语义名（background/foreground/brand/stroke…）保留为兼容别名，
//   新代码优先用 M3 语义名（primary/secondary/surface/outline…）。
// 注意：
// - spacing/fontSize 用「顶层替换」而非 extend——extend 深合并会残留 Tailwind
//   默认档位（72/80/96 等 rem 值），页面一旦用到就踩 web-core 的 rem 塌陷坑
// - web-core 预览下 rem 布局属性不可靠，全配置禁止 rem
const config: Config = {
  content: ['./src/**/*.{vue,js,ts}'],
  presets: [lynxPreset],
  theme: {
    spacing: {
      // 375 设计稿：N 档 = N×4px，vw 值 = px/375×100
      0: '0',
      0.5: '0.533vw', // 2px
      1: '1.067vw', // 4px
      1.5: '1.600vw', // 6px
      2: '2.133vw', // 8px
      2.5: '2.667vw', // 10px
      3: '3.200vw', // 12px
      3.5: '3.733vw', // 14px
      4: '4.267vw', // 16px
      5: '5.333vw', // 20px
      6: '6.400vw', // 24px
      8: '8.533vw', // 32px
      // 8.5 = 34px —— 推荐页 B 变体标题胶囊高度（沉浸式浮层内的药丸，票 #906）。
      // 不是 4px 整数档：胶囊高度由「title-medium 单行文字 + 上下留白」倒推而来，
      // 而非间距累加所得；给它一档是为了让 `h-8.5` 可用，而不是让页面回退到手写 vw 字面量。
      8.5: '9.067vw',
      10: '10.667vw', // 40px
      12: '12.800vw', // 48px
      // GlobalFab 占位带（#873）：本体 56dp + 右距 16dp = 72px。
      // 这两档此前缺失，导致「FAB 压住末屏内容」只能靠页面各自硬编码魔数去让位
      // （实测 24 个页面 scroll-view 类名各异，无共享类）。登记成档位后，
      // 页面容器用 `pb-18` 一处让位，FAB 本体用 `size-14` / `right-4`，
      // **19.2vw 这个数只写一次**，两侧不会各自漂移。
      14: '14.933vw', // 56px —— FAB 本体
      16: '17.067vw', // 64px
      18: '19.200vw', // 72px —— FAB 占位带（14 + 4）
      20: '21.333vw', // 80px
      24: '25.600vw', // 96px
      32: '34.133vw', // 128px
      40: '42.667vw', // 160px
      48: '51.200vw', // 192px
      56: '59.733vw', // 224px
      64: '68.267vw', // 256px
    },
    // ── M3 形状档位（ADR-0207 决策 1）：6 档全部指向 tokens.css 的 --md-shape-* 令牌 ──
    // 顶层替换而非 extend，两条理由：
    //  ① extend 会与 Tailwind 3 的默认**根字号相对单位**档位深合并，残留 rounded-md=6px、
    //     rounded-3xl=24px 等**不在 M3 shape scale 上**的档位（构建产物实测），
    //     那些单位在 web-core 预览下不可靠（同文件头「全配置禁止该单位」的约定）；
    //     ⚠️ 此处故意不写出该单位的三字母缩写 —— tests/unit.test.ts 的 spacing 用例用
    //     `split('spacing: {')[1]` 切到文件末尾再 `not.toMatch(/…/)`，本段落在它的切片里，
    //     注释里写出该缩写会让那条用例误红（同段还有 `3.2vw` 等，必须保留）。
    //  ② 28dp 的 extra-large 在 Tailwind 默认档位里无对应项 ⇒ 此前无法用任何类名表达。
    // 意图不是减少 arbitrary 写法，而是**让写错能失败**：令牌名写错在构建期暴露，
    // 而不是渲染出一个没圆角的元素（存量 274 处 rounded-[var(--md-shape-*)] 不迁移，
    // 它们当前就是对的；新代码一律用下面的档位名）。
    //
    // 档位名 ←→ M3 shape 档位对应（**全配置只有这一套 M3 形状档位**）：
    //   rounded-xs    4dp  → --md-shape-extra-small
    //   rounded-sm    8dp  → --md-shape-small
    //   rounded      12dp  → --md-shape-medium   （DEFAULT；方向类 rounded-t/-b 取 DEFAULT）
    //   rounded-lg   16dp  → --md-shape-large
    //   rounded-xl   28dp  → --md-shape-extra-large
    //   rounded-full 9999  → --md-shape-full
    // **2xl / 3xl 有意不定义**：28dp 已由 xl 表达，再挂一个同值别名会让人以为存在
    // 「xl=24 / 2xl=28」两级 Tailwind 惯例，实际 M3 shape scale 只有 6 档。
    borderRadius: {
      none: '0px',
      xs: 'var(--md-shape-extra-small)',
      sm: 'var(--md-shape-small)',
      DEFAULT: 'var(--md-shape-medium)',
      lg: 'var(--md-shape-large)',
      xl: 'var(--md-shape-extra-large)',
      full: 'var(--md-shape-full)',
    },
    // ── M3 缓动曲线（ADR-0207 决策 6）──
    // 顶层替换而非 extend，为的是清掉 ②：Tailwind 3 默认档位里的
    // `in-out: cubic-bezier(0.4, 0, 0.2, 1)`（= MD2 legacy），否则 `ease-in-out`
    // 仍是越界曲线。全配置只保留官方 M3 四条曲线对应的项目令牌，命名即 M3 曲线名
    // （utility：ease-standard / ease-emphasized / ease-emphasized-decelerate /
    //        ease-emphasized-accelerate）。
    //
    // ⚠️ 但**默认缓动 DEFAULT 必须在下方 extend 里再声明一次**才能生效：
    // @lynx-js/tailwind-preset 的 `extend.transitionTimingFunction.DEFAULT`
    // = `cubic-bezier(0.4, 0, 0.2, 1)`，而 preset 的 extend 会在本配置的顶层 theme 键
    // **之后**合并覆盖（实测 resolveConfig 出的 DEFAULT 仍是 legacy 值）——
    // 这正是「项目令牌对的、但默认消费路径拿到 MD2 曲线」的根因。
    //
    // ⚠️ 官方事实提醒（曾被误判过一次，勿再改反）：material-web v0.192 的
    // **easing-standard 与 easing-emphasized 同为 cubic-bezier(0.2, 0, 0, 1)**，
    // tokens.css 的 --motion-standard 取值本就正确；(0.4,0,0.2,1) 才是 legacy。
    transitionTimingFunction: {
      standard: 'var(--motion-standard)',
      emphasized: 'var(--motion-emphasized)',
      'emphasized-decelerate': 'var(--motion-emphasized-decelerate)',
      'emphasized-accelerate': 'var(--motion-emphasized-accelerate)',
    },
    // ── Material Design 3 type scale 四元组（ADR-0206 决策 1）──
    // 每档 = size + lineHeight + letterSpacing（weight 走 fontWeight 档位，见决策 2：
    // Tailwind 的 fontSize 数组第三位是 fontWeight 而非 letterSpacing，本处按
    // `['<size>', { lineHeight, letterSpacing }]` 两元素形式给全三要素）。
    // 官方值（material-web v0.192 `_md-sys-typescale.scss`）单位为 sp，
    // 项目换算固定为 **rpx = sp × 2**（375 设计稿，1sp = 2rpx，见 glossary-lynx-units.md）。
    // tracking 官方区间 0–0.5sp ⇒ 项目 0–1rpx，1x 屏上亚像素、几乎不可见；
    // 仍照官方填（数值可回源核对 + rpx 随屏宽缩放，宽屏上会放大到可见量级）。
    //
    // ⚠️ 档位名不变 ⇒ 存量 .vue 的 `text-body-medium` 等类名**零改动**即获得正确行高。
    // ⚠️ weight 不随字号档位派生：label-* 与 title-small/medium 是 medium(500)，
    //    其余是 regular(400)（ADR-0206 决策 2）。
    //
    // 语义档位 15 档（sp：size / line-height / tracking / weight）：
    //   display-large   57/64  -0.25  regular
    //   display-medium  45/52   0     regular
    //   display-small   36/44   0     regular
    //   headline-large  32/40   0     regular
    //   headline-medium 28/36   0     regular
    //   headline-small  24/32   0     regular
    //   title-large     22/28   0     regular
    //   title-medium    16/24   0.15  medium
    //   title-small     14/20   0.1   medium
    //   body-large      16/24   0.5   regular
    //   body-medium     14/20   0.25  regular
    //   body-small      12/16   0.4   regular
    //   label-large     14/20   0.1   medium
    //   label-medium    12/16   0.5   medium
    //   label-small     11/16   0.5   medium
    fontSize: {
      // ── Display（此前三档全缺，rounded/text-display-* 无任何类名可表达） ──
      'display-large': ['114rpx', { lineHeight: '128rpx', letterSpacing: '-0.5rpx' }],
      'display-medium': ['90rpx', { lineHeight: '104rpx', letterSpacing: '0' }],
      'display-small': ['72rpx', { lineHeight: '88rpx', letterSpacing: '0' }],
      // ── Headline ──
      'headline-large': ['64rpx', { lineHeight: '80rpx', letterSpacing: '0' }],
      'headline-medium': ['56rpx', { lineHeight: '72rpx', letterSpacing: '0' }],
      'headline-small': ['48rpx', { lineHeight: '64rpx', letterSpacing: '0' }],
      // ── Title ──
      'title-large': ['44rpx', { lineHeight: '56rpx', letterSpacing: '0' }],
      'title-medium': ['32rpx', { lineHeight: '48rpx', letterSpacing: '0.3rpx' }],
      'title-small': ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.2rpx' }],
      // ── Body ──
      'body-large': ['32rpx', { lineHeight: '48rpx', letterSpacing: '1rpx' }],
      'body-medium': ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.5rpx' }],
      'body-small': ['24rpx', { lineHeight: '32rpx', letterSpacing: '0.8rpx' }],
      // ── Label ──
      'label-large': ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.2rpx' }],
      'label-medium': ['24rpx', { lineHeight: '32rpx', letterSpacing: '1rpx' }],
      'label-small': ['22rpx', { lineHeight: '32rpx', letterSpacing: '1rpx' }],
      // ── 旧档位兼容别名：逐条取「最接近的 M3 档位」的完整四元组（ADR-0206 决策 4）──
      // 定位：**存量兼容层，应逐步下线**。语义档位补齐后新代码一律用 text-<md3-tier>；
      // 这 10 个类名留在这里是因为存量引用面未统计（ADR-0205 决策 7 口径），
      // 删名比留名风险大。size 沿用对齐后的既有值（**本次不改任何 size，避免存量观感位移**），
      // lineHeight / letterSpacing 从映射目标档整档取全。
      // 注意 base/lg/xl 三档 size 同为 28rpx、5xl/6xl 同为 56rpx，是**有意塌陷**：
      // 塌陷是既成事实，塌陷后靠 line-height/tracking 仍能区分部分层次。
      xs: ['22rpx', { lineHeight: '32rpx', letterSpacing: '1rpx' }], // → label-small（11sp）
      sm: ['24rpx', { lineHeight: '32rpx', letterSpacing: '1rpx' }], // → label-medium（12sp）
      base: ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.5rpx' }], // → body-medium（14sp）
      lg: ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.2rpx' }], // → title-small（14sp）
      xl: ['28rpx', { lineHeight: '40rpx', letterSpacing: '0.2rpx' }], // → label-large（14sp）
      '2xl': ['32rpx', { lineHeight: '48rpx', letterSpacing: '0.3rpx' }], // → title-medium（16sp）
      '3xl': ['44rpx', { lineHeight: '56rpx', letterSpacing: '0' }], // → title-large（22sp）
      '4xl': ['48rpx', { lineHeight: '64rpx', letterSpacing: '0' }], // → headline-small（24sp）
      '5xl': ['56rpx', { lineHeight: '72rpx', letterSpacing: '0' }], // → headline-medium（28sp）
      '6xl': ['56rpx', { lineHeight: '72rpx', letterSpacing: '0' }], // → headline-medium（28sp，与 5xl 同值）
    },
    extend: {
      // 全站默认缓动（transition-* 实际生效的 timing function）。
      // 必须在 extend 里再声明：preset 的同名 extend 键在本配置顶层 theme 键**之后**
      // 合并，会把顶层清干净的 DEFAULT 又覆盖回 MD2 legacy 值（见上方注释）。
      // 少了这一行 ⇒ resolveConfig 出的 DEFAULT = cubic-bezier(0.4, 0, 0.2, 1)。
      transitionTimingFunction: {
        DEFAULT: 'var(--motion-emphasized)',
      },
      // ── M3 字重档位（ADR-0206 决策 2）──
      // 官方 15 档里 label-* 与 title-small/medium = medium(500)，其余 regular(400)。
      // 用 extend 而非顶层替换：顶层替换会连带删掉 `bold`(700)，而 `font-bold` 在存量
      // 14 个文件里有 18 处（不属于任何 M3 档位），删名会让这些元素静默失去字重。
      // `font-bold` 的清理属 ADR-0206 决策 2 的后半段，与逐组件 leading-* 清理同批做
      // （.vue 层，不在本票范围）。
      fontWeight: {
        regular: '400',
        medium: '500',
      },
      colors: {
        // ── Material Design 3 语义色板（单一事实源 = tokens.css M3 变量） ──
        primary: {
          DEFAULT: 'var(--md-primary)',
          on: 'var(--md-on-primary)',
          container: 'var(--md-primary-container)',
          'on-container': 'var(--md-on-primary-container)',
        },
        secondary: {
          DEFAULT: 'var(--md-secondary)',
          on: 'var(--md-on-secondary)',
          container: 'var(--md-secondary-container)',
          'on-container': 'var(--md-on-secondary-container)',
        },
        tertiary: {
          DEFAULT: 'var(--md-tertiary)',
          on: 'var(--md-on-tertiary)',
          container: 'var(--md-tertiary-container)',
          'on-container': 'var(--md-on-tertiary-container)',
        },
        error: {
          DEFAULT: 'var(--md-error)',
          on: 'var(--md-on-error)',
          container: 'var(--md-error-container)',
          'on-container': 'var(--md-on-error-container)',
        },
        surface: {
          DEFAULT: 'var(--md-surface)',
          on: 'var(--md-on-surface)',
          variant: 'var(--md-surface-variant)',
          'on-variant': 'var(--md-on-surface-variant)',
          'container-lowest': 'var(--md-surface-container-lowest)',
          'container-low': 'var(--md-surface-container-low)',
          container: 'var(--md-surface-container)',
          'container-high': 'var(--md-surface-container-high)',
          'container-highest': 'var(--md-surface-container-highest)',
          // M3 层级表达「主」手段的色相（ADR-0207 决策 7）：surface tint = 以 primary
          // 对表面着色，MD3 用它表达 elevation 的色调倾向，box-shadow 仅为「辅」。
          // 此前该令牌全仓零引用（只在色板生成脚本里出现）⇒ 死代码；登记进颜色档位后
          // 才有 `bg-surface-tint` 这条可达路径。**组件级消费属 .vue 层，本票只到「可消费」。**
          tint: 'var(--md-surface-tint)',
        },
        inverse: {
          surface: 'var(--md-inverse-surface)',
          'on-surface': 'var(--md-inverse-on-surface)',
          primary: 'var(--md-inverse-primary)',
        },
        // ── 状态层四态（ADR-0207 决策 4）：登记在**颜色档位顶层** ──
        // ⚠️ 为什么在顶层而不是 `state` 组内：Tailwind 的 utility 名 = `bg-` + **完整键路径**，
        // 放进 `state` 组会得到 `bg-state-layer-hover-primary`。而 ADR-0207 决策 4 规定的
        // utility 名是 `bg-layer-hover-*`，且**存量代码正是按这个名写的** ——
        // `active:bg-layer-pressed-on-surface` / `active:bg-layer-pressed-primary` 实测
        // **在改动前不产出任何 CSS**（`state` 嵌套下的真实类名是 `bg-state-layer-*`），
        // 即约 15 处组件的 pressed alpha 反馈一直是静默失效的。本票把四态登记到顶层，
        // 既落实 ADR 规定的 utility 名，也顺带让这 15 处真正生效（**属可见视觉变化，
        // 必须进截图回归**）。
        //
        // 下方 `state` 组**原样保留**（`bg-state-pressed-*` 约 20 处在用，`bg-state-layer-*`
        // 作为嵌套写法别名一并留着）：两套并存是存量现实，不是重复设计。
        //
        // 四态 opacity = 官方 v0.192 `_md-sys-state.scss`：hover .08 / focus .12 /
        // pressed .12 / dragged .16。语义色四档口径见 tokens.css 同名注释。
        //
        // `*-on-primary` 档（#866）：MD3 语义 = 实心 primary 容器上的状态层用
        // **on-primary** 作色。存量代码两处（SettingsEndpoint / TranslateButton 的
        // `active:bg-layer-pressed-on-primary`）此前是**死类名**——写在这里的登记之前，
        // 该 utility 与对应的 `--md-state-layer-*-on-primary` 令牌都不存在，产物零规则、
        // 按压反馈静默失效。⚠️ **四态中当前只有 pressed 有消费方**（就那 2 处）；
        // 其余三态一并登记是为了让下一个写 hover 的人不必再踩同一个坑。
        'layer-hover-primary': 'var(--md-state-layer-hover-primary)',
        'layer-hover-on-surface': 'var(--md-state-layer-hover-on-surface)',
        'layer-hover-error': 'var(--md-state-layer-hover-error)',
        'layer-hover-surface': 'var(--md-state-layer-hover-surface)',
        'layer-hover-on-primary': 'var(--md-state-layer-hover-on-primary)',
        'layer-focus-primary': 'var(--md-state-layer-focus-primary)',
        'layer-focus-on-surface': 'var(--md-state-layer-focus-on-surface)',
        'layer-focus-error': 'var(--md-state-layer-focus-error)',
        'layer-focus-surface': 'var(--md-state-layer-focus-surface)',
        'layer-focus-on-primary': 'var(--md-state-layer-focus-on-primary)',
        'layer-pressed-primary': 'var(--md-state-layer-pressed-primary)',
        'layer-pressed-on-surface': 'var(--md-state-layer-pressed-on-surface)',
        'layer-pressed-error': 'var(--md-state-layer-pressed-error)',
        'layer-pressed-surface': 'var(--md-state-layer-pressed-surface)',
        'layer-pressed-on-primary': 'var(--md-state-layer-pressed-on-primary)',
        'layer-dragged-primary': 'var(--md-state-layer-dragged-primary)',
        'layer-dragged-on-surface': 'var(--md-state-layer-dragged-on-surface)',
        'layer-dragged-error': 'var(--md-state-layer-dragged-error)',
        'layer-dragged-surface': 'var(--md-state-layer-dragged-surface)',
        'layer-dragged-on-primary': 'var(--md-state-layer-dragged-on-primary)',
        // ── 状态层：预计算实色（视觉近似 + 仅作伪类受限时的兜底）──
        state: {
          'pressed-primary': 'var(--md-state-pressed-primary)',
          'pressed-on-surface': 'var(--md-state-pressed-on-surface)',
          'pressed-error': 'var(--md-state-pressed-error)',
          'pressed-surface': 'var(--md-state-pressed-surface)',
          // 嵌套写法别名：真实类名是 bg-state-layer-*（存量与新代码都可用）
          'layer-pressed-primary': 'var(--md-state-layer-pressed-primary)',
          'layer-pressed-on-surface': 'var(--md-state-layer-pressed-on-surface)',
          'layer-pressed-error': 'var(--md-state-layer-pressed-error)',
          'layer-pressed-surface': 'var(--md-state-layer-pressed-surface)',
          // on-primary 档与上方四态同构（#866）：同样只有 pressed 有消费方，
          // 其余三态补齐以免嵌套写法再出现「按 state 有、按 role 缺」的半残档位
          'layer-hover-on-primary': 'var(--md-state-layer-hover-on-primary)',
          'layer-focus-on-primary': 'var(--md-state-layer-focus-on-primary)',
          'layer-pressed-on-primary': 'var(--md-state-layer-pressed-on-primary)',
          'layer-dragged-on-primary': 'var(--md-state-layer-dragged-on-primary)',
          // Disabled（官方 12% 容器 / 38% 内容，与四态并存，互不替代）
          'disabled-container': 'var(--md-state-disabled-container)',
          'disabled-on-surface': 'var(--md-state-disabled-on-surface)',
        },
        outline: {
          DEFAULT: 'var(--md-outline)',
          variant: 'var(--md-outline-variant)',
        },
        scrim: 'var(--md-scrim)',
        // ── 兼容别名：旧 Fluent 语义名 → 同一 M3 令牌（存量引用不断） ──
        background: {
          DEFAULT: 'var(--colorNeutralBackground1)',
          2: 'var(--colorNeutralBackground2)',
          3: 'var(--colorNeutralBackground3)',
        },
        foreground: {
          DEFAULT: 'var(--colorNeutralForeground1)',
          2: 'var(--colorNeutralForeground2)',
          3: 'var(--colorNeutralForeground3)',
        },
        stroke: {
          DEFAULT: 'var(--colorNeutralStroke1)',
          2: 'var(--colorNeutralStroke2)',
          3: 'var(--colorNeutralStroke3)',
        },
        brand: {
          DEFAULT: 'var(--colorBrandBackground)',
          hover: 'var(--colorBrandBackgroundHover)',
          pressed: 'var(--colorBrandBackgroundPressed)',
          foreground: 'var(--colorBrandForeground1)',
          foreground2: 'var(--colorBrandForeground2)',
          foregroundInverted: 'var(--colorBrandForegroundInverted)',
          stroke: 'var(--colorBrandStroke1)',
        },
        onBrand: 'var(--colorNeutralForegroundOnBrand)',
        danger: 'var(--colorPaletteRedBackground3)',
        warning: 'var(--colorPaletteYellowBackground3)',
        success: 'var(--colorPaletteGreenBackground3)',
        overlay: 'var(--colorOverlayDark)',
      },
    },
  },
}

export default config
