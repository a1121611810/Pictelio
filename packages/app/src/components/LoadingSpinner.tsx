import { type Component } from "solid-js";
import PictelioIcon from "./PictelioIcon";

interface Props {
  size?: "sm" | "md" | "lg";
  text?: string;
}

const sizeMap = { sm: 64, md: 80, lg: 96 } as const;
const CHAR_POP_DURATION = 0.3; // 每个字蹦出动画时长 (300ms = Fluent gentle)
const CHAR_STAGGER = 0.1; // 字间交错延迟 (s)

/**
 * Pictelio 品牌 loading — Fluent Design 2 风格
 *
 * 布局：Pictelio logo + 白底品牌色扫光 + 可选文字（逐个蹦出循环）
 * 无独立 spinner，loading 状态通过 logo 表面的光泽扫光表达
 */
const LoadingSpinner: Component<Props> = (props) => {
  const size = () => props.size ?? "md";

  return (
    <div
      class="flex flex-col items-center justify-center gap-3"
      style={{
        animation: "fluent-scale-enter var(--durationNormal) var(--curveDecelerateMid) both",
      }}
    >
      {/* ── Logo + Shimmer 扫光 ── */}
      <div
        class="relative"
        style={{
          width: `${sizeMap[size()]}px`,
          height: `${sizeMap[size()]}px`,
        }}
      >
        <PictelioIcon class="absolute inset-0 w-full h-full" />

        {/* Shimmer 扫光层 — 覆盖白色徽章区域 */}
        <div
          class="absolute overflow-hidden pointer-events-none"
          style={{
            left: "calc(12 / 192 * 100%)",
            top: "calc(12 / 192 * 100%)",
            width: "calc(168 / 192 * 100%)",
            height: "calc(168 / 192 * 100%)",
            "border-radius": "calc(44 / 168 * 100%)",
          }}
        >
          {/* 滑动的渐变条 — 从左侧扫入，右侧扫出 */}
          <div
            class="absolute inset-0 shimmer-gradient"
            style={{
              animation: "fluent-shimmer-sweep var(--durationSlower) var(--curveEasyEase) infinite",
            }}
          />
        </div>
      </div>

      {/* ── 可选文字（逐个蹦出，循环播放） ── */}
      {props.text && (
        <p class="text-[var(--colorNeutralForegroundDisabled)] text-[var(--fontSizeBase200)]">
          {props.text.split("").map((char, i) => (
            <span
              class="inline-block"
              style={{
                animation: `char-pop ${CHAR_POP_DURATION}s ${CHAR_STAGGER + i * CHAR_STAGGER}s both`,
              }}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          ))}
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;
