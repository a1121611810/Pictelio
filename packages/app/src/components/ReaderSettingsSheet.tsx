import type { Component } from "solid-js";
import {
  fontSize,
  setReaderFontSize,
  fontWeight,
  setReaderFontWeight,
  fontFamily,
  setReaderFontFamily,
  lineHeight,
  setReaderLineHeight,
  fontColor,
  bgColor,
  setReaderFontColor,
  setReaderBgColor,
  FONT_SIZES,
  FONT_WEIGHTS,
  FONT_FAMILIES,
  LINE_HEIGHTS,
  FONT_COLORS,
  BG_COLORS,
} from "../stores/readerSettingsStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function PillRow<T extends string | number>(props: {
  options: readonly { value: T; label: string }[];
  value: () => T;
  onChange: (v: T) => void;
}) {
  return (
    <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-0.5 gap-0.5">
      {props.options.map((opt) => (
        <button
          class="flex-1 py-1.5 px-2 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-medium transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer text-center"
          classList={{
            "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
              props.value() === opt.value,
            "bg-transparent text-[var(--colorNeutralForeground2)]": props.value() !== opt.value,
          }}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const ReaderSettingsSheet: Component<Props> = (props) => {
  function close() {
    props.onClose();
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        {/* Scrim */}
        <div class="absolute inset-0" style="background-color:var(--colorScrim)" onClick={close} />

        {/* Sheet panel */}
        <div
          class="absolute bottom-0 left-0 right-0 surface-appbar rounded-t-[var(--borderRadius4XLarge)] shadow-[var(--elevation28)]"
          style="max-height:80vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          {/* Header */}
          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              阅读设置
            </h2>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={close}
              aria-label="关闭"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>

          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)"></fluent-divider>

          <div class="px-5 py-3 flex flex-col gap-5">
            {/* ── Font size ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                字号
              </p>
              <div class="flex items-center gap-3">
                <button
                  class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer disabled:opacity-30"
                  onClick={() => {
                    const idx = FONT_SIZES.indexOf(fontSize() as (typeof FONT_SIZES)[number]);
                    if (idx > 0) {
                      setReaderFontSize(FONT_SIZES[idx - 1] as (typeof FONT_SIZES)[number]);
                    }
                  }}
                  disabled={fontSize() <= FONT_SIZES[0]}
                  aria-label="减小字号"
                >
                  A⁻
                </button>
                <div class="flex-1 flex items-center gap-1">
                  {FONT_SIZES.map((s) => (
                    <button
                      class="flex-1 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] transition-all text-center appearance-none border-none outline-none cursor-pointer"
                      classList={{
                        "bg-[var(--colorBrandBackground)] text-white font-semibold":
                          fontSize() === s,
                        "bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground3)]":
                          fontSize() !== s,
                      }}
                      onClick={() => setReaderFontSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer disabled:opacity-30"
                  onClick={() => {
                    const idx = FONT_SIZES.indexOf(fontSize() as (typeof FONT_SIZES)[number]);
                    if (idx < FONT_SIZES.length - 1) {
                      setReaderFontSize(FONT_SIZES[idx + 1] as (typeof FONT_SIZES)[number]);
                    }
                  }}
                  disabled={fontSize() >= FONT_SIZES[FONT_SIZES.length - 1]}
                  aria-label="增大字号"
                >
                  A⁺
                </button>
              </div>
            </div>

            {/* ── Font weight ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                字重
              </p>
              <PillRow
                options={FONT_WEIGHTS}
                value={fontWeight}
                onChange={(v) => setReaderFontWeight(v as number)}
              />
            </div>

            {/* ── Font family ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                字体
              </p>
              <PillRow
                options={FONT_FAMILIES}
                value={fontFamily}
                onChange={(v) => setReaderFontFamily(v as string)}
              />
            </div>

            {/* ── Line height ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                行距
              </p>
              <PillRow
                options={LINE_HEIGHTS.map((lh) => ({ value: lh, label: String(lh) }))}
                value={lineHeight}
                onChange={(v) => setReaderLineHeight(v as number)}
              />
            </div>

            {/* ── Text color ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                文字颜色
              </p>
              <div class="flex gap-2 items-center">
                {FONT_COLORS.map((c) => (
                  <div
                    role="button"
                    tabIndex={0}
                    class="w-8 h-8 rounded-[var(--borderRadiusCircular)] transition-all border-2 border-solid cursor-pointer overflow-hidden"
                    classList={{
                      "border-[var(--colorBrandStroke1)] scale-110": fontColor() === c,
                      "border-transparent hover:border-[var(--colorNeutralStroke2)]":
                        fontColor() !== c,
                    }}
                    style={`background-color: ${c}`}
                    onClick={() => setReaderFontColor(c)}
                    onKeyDown={(e) => e.key === "Enter" && setReaderFontColor(c)}
                    aria-label={`文字颜色 ${c}`}
                  />
                ))}
                <button
                  class="w-8 h-8 rounded-[var(--borderRadiusCircular)] border-2 border-dashed border-[var(--colorNeutralStroke2)] flex items-center justify-center [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] appearance-none bg-transparent cursor-pointer"
                  onClick={() => setReaderFontColor("")}
                  aria-label="重置"
                  title="重置"
                >
                  ↺
                </button>
                <label class="relative w-8 h-8 cursor-pointer">
                  <div class="w-8 h-8 rounded-[var(--borderRadiusCircular)] border-2 border-dashed border-[var(--colorBrandStroke1)] flex items-center justify-center [font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] bg-[var(--colorNeutralBackground2)]">
                    +
                  </div>
                  <input
                    type="color"
                    class="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    value={fontColor() || "#000000"}
                    onInput={(e) => setReaderFontColor(e.currentTarget.value)}
                    aria-label="自定义文字颜色"
                  />
                </label>
              </div>
            </div>

            {/* ── Background color ── */}
            <div>
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                背景色
              </p>
              <div class="flex gap-2 items-center flex-wrap">
                {BG_COLORS.map((c) => (
                  <div
                    role="button"
                    tabIndex={0}
                    class="w-8 h-8 rounded-[var(--borderRadiusCircular)] border-2 border-solid transition-all cursor-pointer overflow-hidden relative"
                    classList={{
                      "border-[var(--colorBrandStroke1)] scale-110": bgColor() === c,
                      "border-transparent hover:border-[var(--colorNeutralStroke2)]":
                        bgColor() !== c,
                    }}
                    style={`background-color: ${c || "var(--colorNeutralBackground1)"}`}
                    onClick={() => setReaderBgColor(c)}
                    onKeyDown={(e) => e.key === "Enter" && setReaderBgColor(c)}
                    aria-label={`背景色 ${c || "默认"}`}
                  >
                    {c === "" && (
                      <div
                        class="absolute inset-0"
                        style={{
                          "background-image":
                            "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)",
                          "background-size": "8px 8px",
                          "background-position": "0 0, 4px 4px",
                        }}
                      />
                    )}
                  </div>
                ))}
                <label class="relative w-8 h-8 cursor-pointer">
                  <div class="w-8 h-8 rounded-[var(--borderRadiusCircular)] border-2 border-dashed border-[var(--colorBrandStroke1)] flex items-center justify-center [font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] bg-[var(--colorNeutralBackground2)]">
                    +
                  </div>
                  <input
                    type="color"
                    class="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    value={bgColor() || "#ffffff"}
                    onInput={(e) => setReaderBgColor(e.currentTarget.value)}
                    aria-label="自定义背景色"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Footer padding */}
          <div class="h-4" />
        </div>
      </div>
    </Show>
  );
};

export default ReaderSettingsSheet;
