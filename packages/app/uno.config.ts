import { defineConfig, presetUno, presetIcons } from "unocss";
// Fluent Design System 2 — precise token-based shortcuts
// Uses bracket syntax [property:value] to avoid UnoCSS text- ambiguity with CSS variables

export default defineConfig({
  presets: [presetUno(), presetIcons()],

  // ── Fluent Design Typography Tokens (fluid clamp: rem for accessibility, vw for responsive) ──
  preflights: [
    {
      getCSS: () => `
        :root {
          --fontSizeBase100: clamp(0.5rem, 0.5rem + 0.5vw, 0.75rem);
          --fontSizeBase200: clamp(0.625rem, 0.625rem + 0.5vw, 0.875rem);
          --fontSizeBase300: clamp(0.75rem, 0.75rem + 0.5vw, 1rem);
          --fontSizeBase400: clamp(0.875rem, 0.875rem + 0.5vw, 1.125rem);
          --fontSizeBase500: clamp(1rem, 1rem + 0.75vw, 1.5rem);
          --fontSizeBase600: clamp(1.25rem, 1.25rem + 0.75vw, 1.75rem);
        }
      `,
    },
  ],

  // Safelist: 强制生成 NavBar 容器类（UnoCSS 提取器可能遗漏）
  safelist: [
    "floating-nav",
    "floating-nav-capsule",
    "floating-nav-capsule-compact",
    "floating-nav-center",
    "floating-nav-item",
    "floating-nav-group",
    "scroll-top-anim",
    "glass-tab-bar",
    "glass-tab-bar-capsule",
    "glass-tab-bar-segmented",
    "glass-tab-bar-highlight",
    "glass-tab-item",
    "glass-tab-item-active",
    "glass-tab-highlight",
  ],

  shortcuts: {
    // ── Page (full-height root surface) ──
    page: "min-h-screen bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground1)]",

    // ── Surfaces ──
    "surface-card": "shadow-[var(--pageCardShadow,var(--elevation2))]",
    "surface-card-elevated":
      "bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusMedium)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)]",
    "surface-flyout":
      "bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)]",
    "surface-appbar":
      "bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[30px] backdrop-saturate-[125%] border-b border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusNone)]",
    "surface-overlay":
      "bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusXLarge)] shadow-[var(--elevation16)]",
    "surface-dialog":
      "bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadius2XLarge)] shadow-[var(--elevation28)]",

    "surface-glass":
      "bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[30px] backdrop-saturate-[125%] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)]",

    // ── Image card (feed thumbnail) ──
    "image-card":
      "bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusMedium)] overflow-hidden shadow-[var(--elevation2)] border border-[var(--colorNeutralStroke2)] cursor-pointer transition-all active:scale-[0.98] select-none max-w-full",

    // ── Input fields (Fluent 2) ──
    input:
      "w-full px-[var(--spacingHorizontalMNudge)] py-[var(--spacingVerticalSNudge)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] text-[var(--fontSizeBase300)] leading-[var(--lineHeightBase300)] border border-[var(--colorNeutralStroke1)] placeholder:text-[var(--colorNeutralForegroundDisabled)] focus:outline-none focus:border-[var(--colorBrandStroke1)] focus:shadow-[0_0_0_1px_var(--colorBrandStroke1)] transition-all disabled:opacity-50 disabled:bg-[var(--colorNeutralBackground2)]",
    "input-mono": "input font-mono [font-size:var(--fontSizeBase200)]",

    // ── Form label (Caption 1: 12px/400) ──
    label:
      "text-[var(--fontSizeBase200)] font-400 text-[var(--colorNeutralForeground2)] leading-[var(--lineHeightBase200)]",

    // ── Segmented control (Fluent toggle buttons) ──
    segmented:
      "flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1",
    "segmented-item":
      "flex-1 flex flex-col items-center justify-center py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 select-none cursor-pointer",
    "segmented-item-active":
      "segmented-item bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]",
    "segmented-item-inactive":
      "segmented-item bg-transparent text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)]",

    // ── Glass Tab Bar (ADR-0044) ──
    "glass-tab-bar":
      "relative flex items-center gap-1 bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)] border border-[var(--colorNeutralStroke2)]",
    "glass-tab-bar-capsule":
      "glass-tab-bar rounded-[var(--borderRadiusCircular)] px-2 py-1.5 shadow-[var(--elevation8)]",
    "glass-tab-bar-segmented": "glass-tab-bar rounded-[var(--borderRadiusMedium)] p-1",
    "glass-tab-bar-highlight":
      "pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-[inherit] [background:linear-gradient(180deg,var(--glassTopHighlight),transparent)]",
    "glass-tab-item":
      "relative z-10 flex flex-col items-center justify-center gap-[var(--spacingHorizontalXXS)] min-h-[44px] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] text-[var(--fontSizeBase200)] font-medium leading-none text-[var(--colorNeutralForeground3)] cursor-pointer select-none appearance-none border-none outline-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:bg-[var(--colorNeutralBackground1Pressed)] active:scale-[0.96] focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2),0_0_0_calc(var(--strokeWidthThick)+var(--strokeWidthThin))_var(--colorStrokeFocus1)] disabled:opacity-50 disabled:cursor-not-allowed",
    "glass-tab-item-active":
      "glass-tab-item bg-[var(--colorNeutralBackgroundAlpha2)] backdrop-blur-[var(--backdropBlurDefault)] text-[var(--colorCompoundBrandForeground1)] shadow-[var(--elevation2),inset_0_1px_0_var(--glassTopHighlight)] font-semibold",
    "glass-tab-highlight":
      "pointer-events-none absolute inset-0 z-0 rounded-[inherit] [background:var(--glassHighlightGradient)] opacity-0 transition-opacity duration-[var(--durationSlow)] ease-[var(--curveEasyEase)]",

    // ── Floating Navigation Bar (Fluent 2 floating capsule) ──
    "floating-nav": "fixed bottom-6 left-0 right-0 z-30 flex justify-center pointer-events-none",
    "floating-nav-capsule":
      "pointer-events-auto flex items-center justify-center gap-1 bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[30px] backdrop-saturate-[125%] rounded-[var(--borderRadiusCircular)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation8)] px-2 py-1.5 transition-all duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]",
    "floating-nav-capsule-compact": "!px-0 !py-0 !gap-0 shadow-[var(--elevation4)]!",
    "floating-nav-group":
      "flex items-center gap-1 overflow-hidden transition-all duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]",
    "floating-nav-group-hidden":
      "max-w-0! min-w-0! w-0! opacity-0! invisible! px-0! py-0! m-0! pointer-events-none overflow-hidden!",
    "floating-nav-group-visible": "max-w-40! opacity-100! visible!",
    "floating-nav-item":
      "flex flex-col items-center justify-center gap-[var(--spacingHorizontalXXS)] min-w-14 min-h-[44px] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] text-[var(--fontSizeBase200)] font-medium leading-none border-none outline-none appearance-none cursor-pointer select-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] text-[var(--colorNeutralForeground3)] hover:text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:bg-[var(--colorNeutralBackground1Pressed)] active:scale-[0.96] focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2),0_0_0_calc(var(--strokeWidthThick)+var(--strokeWidthThin))_var(--colorStrokeFocus1)]",
    "floating-nav-item-active":
      "text-[var(--colorCompoundBrandForeground1)] font-semibold active:scale-[0.97]",
    "floating-nav-center":
      "min-w-[52px] min-h-[52px] flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] cursor-pointer select-none [touch-action:manipulation] transition-[opacity,transform,box-shadow] duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:shadow-[var(--elevation8)] hover:scale-[1.05] active:scale-[0.95] active:bg-[var(--colorNeutralBackground1Pressed)] focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2),0_0_0_calc(var(--strokeWidthThick)+var(--strokeWidthThin))_var(--colorStrokeFocus1)] z-10",
    "scroll-top-anim": "animate-[scroll-top-pulse_600ms_var(--curveEasyEase)]",

    // ── History page ──
    "history-delete-btn":
      "min-w-10 min-h-10 flex items-center justify-center flex-shrink-0 rounded-[var(--borderRadiusSmall)] bg-transparent border-none text-[var(--colorNeutralForeground4)] cursor-pointer transition-colors duration-[var(--durationFast)] hover:text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)] active:scale-90",
    "history-clear-btn":
      "px-2 py-1 rounded-[var(--borderRadiusSmall)] border-none bg-transparent text-[var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)] cursor-pointer transition-colors duration-[var(--durationFast)] hover:text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)] font-[var(--fontWeightRegular)]",
    "history-clear-btn-confirm":
      "text-[var(--colorDangerForeground)] font-[var(--fontWeightSemibold)]",

    // ── History search & filter ──
    "history-search-bar":
      "flex items-center gap-2 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)]",
    "history-search-input":
      "flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] placeholder:text-[var(--colorNeutralForeground3)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]",
    "history-date-input":
      "bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] rounded-[var(--borderRadiusSmall)] px-2 py-1 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] outline-none appearance-none focus-visible:border-[var(--colorBrandStroke1)] focus-visible:shadow-[0_0_0_1px_var(--colorBrandStroke1)] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 hover:[&::-webkit-calendar-picker-indicator]:opacity-100",
    "history-search-highlight":
      "bg-[var(--colorBrandStroke2)] text-[var(--colorBrandForeground1)] rounded-[var(--borderRadiusSmall)] px-0.5",
  },
});
