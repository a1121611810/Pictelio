import type { Component } from "solid-js";

interface FilterChipProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * 共享筛选 chip（单/多选过滤行的切换按钮，aria-pressed 语义）。
 * SearchFilterSheet 与榜单维度控件共用，避免各自自绘 chip 样式。
 * Fluent 三态齐全（hover / active:scale-98 / focus-visible），触控目标 ≥40px。
 */
const FilterChip: Component<FilterChipProps> = (props) => (
  <button
    type="button"
    class={[
      "min-h-10 cursor-pointer appearance-none rounded-[var(--borderRadiusMedium)] border-none px-3 outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-98 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] disabled:cursor-not-allowed disabled:opacity-40",
      {
        "bg-[var(--colorBrandBackground)] font-semibold text-[var(--colorNeutralForegroundOnBrand)]":
          props.active,
        "bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground3)]":
          !props.active,
      },
    ]}
    disabled={props.disabled ?? false}
    aria-pressed={props.active ? "true" : "false"}
    onClick={() => {
      if (!props.disabled) props.onClick();
    }}
  >
    {props.label}
  </button>
);

export default FilterChip;
