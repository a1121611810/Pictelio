import type { Config } from 'tailwindcss'
import lynxPreset from '@lynx-js/tailwind-preset'

// Tailwind v3 + @lynx-js/tailwind-preset（vue-lynx 官方集成方案）
// 单位策略（经原型实测 + 决策）：
// - spacing → vw 档位：间距随屏宽缩放（1 档 = 4px @375 设计稿，vw 值 = px/375×100）
// - fontSize → rpx 档位：字号随屏宽缩放（沿用现有字号语义）
// - colors → Fluent 语义色板：引用 tokens.css 现有 CSS 变量（单一事实源）
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
      // 沿用现有 rpx 字号档位（随屏宽缩放）
      xs: '20rpx',
      sm: '22rpx',
      base: '24rpx',
      lg: '26rpx',
      xl: '28rpx',
      '2xl': '30rpx',
      '3xl': '32rpx',
      '4xl': '36rpx',
      '5xl': '40rpx',
      '6xl': '56rpx',
    },
    extend: {
      colors: {
        // Fluent 语义色板：值引用 tokens.css 变量（单一事实源，改一处全生效）
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
