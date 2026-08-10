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
      10: '10.667vw', // 40px
      12: '12.800vw', // 48px
      16: '17.067vw', // 64px
      20: '21.333vw', // 80px
      24: '25.600vw', // 96px
      32: '34.133vw', // 128px
      40: '42.667vw', // 160px
      48: '51.200vw', // 192px
      56: '59.733vw', // 224px
      64: '68.267vw', // 256px
    },
    fontSize: {
      // ── Material Design 3 type scale（sp → rpx @375：1sp = 2rpx） ──
      // 语义档位（新代码优先使用）：
      //   label-small 11sp=22rpx / label-medium 12sp=24rpx / body-small 12sp=24rpx /
      //   label-large 14sp=28rpx / body-medium 14sp=28rpx / title-small 14sp=28rpx /
      //   body-large 16sp=32rpx / title-medium 16sp=32rpx / title-large 22sp=44rpx /
      //   headline-small 24sp=48rpx / headline-medium 28sp=56rpx / headline-large 32sp=64rpx
      'label-small': '22rpx',
      'label-medium': '24rpx',
      'body-small': '24rpx',
      'label-large': '28rpx',
      'body-medium': '28rpx',
      'title-small': '28rpx',
      'body-large': '32rpx',
      'title-medium': '32rpx',
      'title-large': '44rpx',
      'headline-small': '48rpx',
      'headline-medium': '56rpx',
      'headline-large': '64rpx',
      // ── 旧档位兼容别名（值已对齐 M3 最接近档位，存量类名自动获得合法 M3 值） ──
      xs: '22rpx', // 10sp → label-small 11sp
      sm: '24rpx', // 11sp → label-medium 12sp
      base: '28rpx', // 12sp → body-medium 14sp
      lg: '28rpx', // 13sp → title-small/body-medium 14sp
      xl: '28rpx', // 14sp → body-medium/label-large 14sp
      '2xl': '32rpx', // 15sp → title-medium/body-large 16sp
      '3xl': '44rpx', // 18sp → title-large 22sp
      '4xl': '48rpx', // 旧档 18sp → headline-small 24sp
      '5xl': '56rpx', // 20sp → headline-medium 28sp
      '6xl': '56rpx', // 28sp → headline-medium 28sp
    },
    extend: {
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
        },
        inverse: {
          surface: 'var(--md-inverse-surface)',
          'on-surface': 'var(--md-inverse-on-surface)',
          primary: 'var(--md-inverse-primary)',
        },
        state: {
          'pressed-primary': 'var(--md-state-pressed-primary)',
          'pressed-on-surface': 'var(--md-state-pressed-on-surface)',
          'pressed-error': 'var(--md-state-pressed-error)',
          'pressed-surface': 'var(--md-state-pressed-surface)',
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
