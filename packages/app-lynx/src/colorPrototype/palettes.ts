// ─── 配色原型数据（throwaway，见 src/colorPreview.ts 顶部说明） ───
//
// 问题：「app-lynx 的配色（M3 baseline seed #6750A4 紫）与项目 logo 不搭」。
// logo（packages/app/assets/logo/pictelio-logo.svg）是白底蓝色画笔：
//   主笔触 #2b579a / 高光 #5a9fd4 / 点 #7ab8e8。
// 本文件给出 5 套候选：0=当前紫（对照），A/B/C/D 为四套蓝色系方向。
//
// 每套覆盖 tokens.css 中影响观感的 M3 语义色（亮色 baseline 结构），
// 保留 error 红为语义色不随品牌变。

export interface PaletteVariant {
  key: string
  name: string
  note: string
  seed: string
  swatches: string[]
  vars: Record<string, string>
}

/** 与配色无关的 base 变量（形状/高度/动画/scrim）——web-core 预览可能没有 page 规则时兜底 */
export const BASE_VARS: Record<string, string> = {
  '--md-shape-extra-small': '1.067vw',
  '--md-shape-small': '2.133vw',
  '--md-shape-medium': '3.2vw',
  '--md-shape-large': '4.267vw',
  '--md-shape-extra-large': '7.467vw',
  '--md-shape-full': '9999px',
  '--md-elevation-1': '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15)',
  '--md-elevation-2': '0 1px 2px rgba(0,0,0,0.3), 0 2px 6px 2px rgba(0,0,0,0.15)',
  '--md-elevation-3': '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)',
  '--md-scrim': 'rgba(0, 0, 0, 0.5)',
  '--durationFast': '150ms',
  '--durationNormal': '200ms',
  '--durationGentle': '300ms',
}

interface Scheme {
  primary: string
  onPrimary?: string
  primaryContainer: string
  onPrimaryContainer: string
  secondary: string
  onSecondary?: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiary: string
  onTertiary?: string
  tertiaryContainer: string
  onTertiaryContainer: string
  surface: string
  onSurface: string
  surfaceVariant: string
  onSurfaceVariant: string
  outline: string
  outlineVariant: string
  containers: [string, string, string, string, string] // lowest/low/base/high/highest
  inverseSurface: string
  inverseOnSurface: string
  inversePrimary: string
  pressedPrimary: string
}

/** 把紧凑 Scheme 展开成 CSS 变量表（保留 error 红为语义色） */
function vars(s: Scheme): Record<string, string> {
  const [lowest, low, base, high, highest] = s.containers
  const hex = (c: string) => {
    const n = parseInt(c, 16)
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
  }
  return {
    '--md-primary': s.primary,
    '--md-on-primary': s.onPrimary ?? '#ffffff',
    '--md-primary-container': s.primaryContainer,
    '--md-on-primary-container': s.onPrimaryContainer,
    '--md-secondary': s.secondary,
    '--md-on-secondary': s.onSecondary ?? '#ffffff',
    '--md-secondary-container': s.secondaryContainer,
    '--md-on-secondary-container': s.onSecondaryContainer,
    '--md-tertiary': s.tertiary,
    '--md-on-tertiary': s.onTertiary ?? '#ffffff',
    '--md-tertiary-container': s.tertiaryContainer,
    '--md-on-tertiary-container': s.onTertiaryContainer,
    '--md-error': '#b3261e',
    '--md-on-error': '#ffffff',
    '--md-error-container': '#f9dedc',
    '--md-on-error-container': '#410e0b',
    '--md-surface': s.surface,
    '--md-on-surface': s.onSurface,
    '--md-surface-variant': s.surfaceVariant,
    '--md-on-surface-variant': s.onSurfaceVariant,
    '--md-outline': s.outline,
    '--md-outline-variant': s.outlineVariant,
    '--md-surface-container-lowest': lowest,
    '--md-surface-container-low': low,
    '--md-surface-container': base,
    '--md-surface-container-high': high,
    '--md-surface-container-highest': highest,
    '--md-inverse-surface': s.inverseSurface,
    '--md-inverse-on-surface': s.inverseOnSurface,
    '--md-inverse-primary': s.inversePrimary,
    '--md-surface-tint': s.primary,
    '--md-state-pressed-primary': s.pressedPrimary,
    '--md-state-pressed-on-surface': s.primary,
    '--md-state-pressed-surface': high,
    '--md-state-layer-pressed-primary': `rgba(${hex(s.primary.slice(1))}, 0.12)`,
    '--colorBrandBackgroundHover': s.primary,
    '--colorBrandBackgroundPressed': s.pressedPrimary,
    '--colorBrandForeground2': s.pressedPrimary,
  }
}

const CURRENT: Scheme = {
  primary: '#6750a4', primaryContainer: '#eaddff', onPrimaryContainer: '#21005d',
  secondary: '#625b71', secondaryContainer: '#e8def8', onSecondaryContainer: '#1d192b',
  tertiary: '#7d5260', tertiaryContainer: '#ffd8e4', onTertiaryContainer: '#31111d',
  surface: '#fef7ff', onSurface: '#1d1b20', surfaceVariant: '#e7e0ec', onSurfaceVariant: '#49454f',
  outline: '#79747e', outlineVariant: '#cac4d0',
  containers: ['#ffffff', '#f7f2fa', '#f3edf7', '#ece6f0', '#e6e0e9'],
  inverseSurface: '#322f35', inverseOnSurface: '#f5eff7', inversePrimary: '#d0bcff', pressedPrimary: '#59408f',
}

const A: Scheme = {
  primary: '#2b579a', primaryContainer: '#d7e3ff', onPrimaryContainer: '#001b3f',
  secondary: '#4a6187', secondaryContainer: '#dae3f9', onSecondaryContainer: '#051c3f',
  tertiary: '#3f6378', tertiaryContainer: '#c2e8ff', onTertiaryContainer: '#001e2c',
  surface: '#f9f9ff', onSurface: '#1a1b20', surfaceVariant: '#e1e2ec', onSurfaceVariant: '#44474f',
  outline: '#74777f', outlineVariant: '#c4c6d0',
  containers: ['#ffffff', '#f3f3fa', '#ededf4', '#e7e8ee', '#e2e2e9'],
  inverseSurface: '#2f3036', inverseOnSurface: '#f1f0f7', inversePrimary: '#aac7ff', pressedPrimary: '#1f4376',
}

const B: Scheme = {
  primary: '#1a6fa8', primaryContainer: '#cfe5ff', onPrimaryContainer: '#001d33',
  secondary: '#50606e', secondaryContainer: '#d3e5f5', onSecondaryContainer: '#0c1d29',
  tertiary: '#3b6470', tertiaryContainer: '#bee9f8', onTertiaryContainer: '#001f28',
  surface: '#f8faff', onSurface: '#191c20', surfaceVariant: '#dde3ea', onSurfaceVariant: '#41474e',
  outline: '#71787e', outlineVariant: '#c1c7ce',
  containers: ['#ffffff', '#f2f4fa', '#eceef4', '#e6e8ee', '#e1e3e9'],
  inverseSurface: '#2e3136', inverseOnSurface: '#eff1f7', inversePrimary: '#93ccff', pressedPrimary: '#155b8a',
}

const C: Scheme = {
  primary: '#1c3f6e', primaryContainer: '#d6e3ff', onPrimaryContainer: '#001b3d',
  secondary: '#555f71', secondaryContainer: '#d9e2f6', onSecondaryContainer: '#121c2b',
  tertiary: '#456179', tertiaryContainer: '#cde5ff', onTertiaryContainer: '#001d33',
  surface: '#fbfbfd', onSurface: '#1a1c1e', surfaceVariant: '#dfe2e6', onSurfaceVariant: '#43474b',
  outline: '#73777b', outlineVariant: '#c3c6ca',
  containers: ['#ffffff', '#f5f5f7', '#efeff1', '#e9e9eb', '#e3e3e6'],
  inverseSurface: '#2f3133', inverseOnSurface: '#f1f0f2', inversePrimary: '#a9c7ff', pressedPrimary: '#12325b',
}

const D: Scheme = {
  primary: '#00629e', primaryContainer: '#cfe5ff', onPrimaryContainer: '#001d33',
  secondary: '#4f6070', secondaryContainer: '#d2e4f4', onSecondaryContainer: '#0b1d2a',
  tertiary: '#3d6373', tertiaryContainer: '#c0e8fc', onTertiaryContainer: '#001f2a',
  surface: '#f7f9fc', onSurface: '#191c1e', surfaceVariant: '#dde3e8', onSurfaceVariant: '#41484d',
  outline: '#71787d', outlineVariant: '#c1c7cc',
  containers: ['#ffffff', '#f1f4f8', '#ebf0f4', '#e5eaee', '#e0e5e9'],
  inverseSurface: '#2e3133', inverseOnSurface: '#eff1f3', inversePrimary: '#93ccff', pressedPrimary: '#004f80',
}

export const PALETTES: PaletteVariant[] = [
  { key: '0', name: 'Current（当前）', note: 'M3 baseline seed #6750A4（紫）——不搭的现状，留作对照', seed: '#6750A4', swatches: ['#6750a4', '#625b71', '#7d5260'], vars: vars(CURRENT) },
  { key: 'A', name: 'Logo Blue', note: '直接取 logo 主笔触 #2b579a，最忠实、稳重', seed: '#2b579a', swatches: ['#2b579a', '#4a6187', '#3f6378'], vars: vars(A) },
  { key: 'B', name: 'Sky', note: '偏 logo 高光 #5a9fd4，更亮更清爽，年轻感', seed: '#1a6fa8', swatches: ['#1a6fa8', '#50606e', '#3b6470'], vars: vars(B) },
  { key: 'C', name: 'Ink Navy', note: '深墨蓝 + 近中性表面，克制、护眼、文字优先', seed: '#1c3f6e', swatches: ['#1c3f6e', '#555f71', '#456179'], vars: vars(C) },
  { key: 'D', name: 'Azure', note: '青蓝 #00629e，更现代、对比清晰', seed: '#00629e', swatches: ['#00629e', '#4f6070', '#3d6373'], vars: vars(D) },
]
