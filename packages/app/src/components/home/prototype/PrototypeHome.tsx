import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import PrototypeSwitcher from "@/components/ui/PrototypeSwitcher";
import VariantA from "./VariantA";
import VariantDeep from "./VariantDeep";
import VariantCompact from "./VariantCompact";
import VariantImmersive from "./VariantImmersive";
import type { HomeVariantProps } from "./shared";

const PROTOTYPE_VARIANTS = [
  { key: "A", label: "A2 基线" },
  { key: "D", label: "深度统一" },
  { key: "C", label: "紧凑高效" },
  { key: "I", label: "沉浸" },
] as const;

type PrototypeKey = (typeof PROTOTYPE_VARIANTS)[number]["key"];

/**
 * /home 页面 UI 原型容器（仅开发模式）。
 * HomePage.tsx 通过 `import.meta.env.DEV ? lazy(import(...)) : null` 引用：
 * 生产构建不加载（独立 chunk）。按 `?variant=A|D|C|I` 渲染对应变体 + 浮动切换条。
 *
 * Feed 卡片 A2 化通过 CSS 覆盖 .a2-feed 内 .image-card 实现（去边框、大圆角），
 * 不改动生产 ImageCard 组件；D/C/I 在 A2 基础上深化卡片内部（图通边/padding/密度）。
 */
const PrototypeHome: Component<HomeVariantProps> = (props) => {
  const [searchParams] = useSearchParams();

  const variantKey = () => {
    const raw = (searchParams as Record<string, string | undefined>).variant;
    return (PROTOTYPE_VARIANTS.some((v) => v.key === raw) ? raw : "A") as PrototypeKey;
  };

  return (
    <>
      <style>{`
        /* 通用 A2 卡片：去边框 + 大圆角 */
        .a2-feed .image-card {
          border: none;
          border-radius: var(--borderRadius2XLarge);
        }
        /* 子 Tab（综合/插画/漫画）A2 化：容器去毛玻璃边框，按钮圆角对齐 A2 */
        .a2-feed .surface-appbar {
          background: transparent;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border-bottom: none;
        }
        .a2-feed .surface-appbar button {
          border-radius: var(--borderRadiusMedium);
        }
        /* D 深度统一：图片区通边（取消内层图圆角）、info 区 padding 放宽 */
        .a2-deep .image-card > div:first-child {
          border-radius: 0;
        }
        .a2-deep .image-card > div:last-child {
          padding: var(--spacingHorizontalL) var(--spacingHorizontalL) var(--spacingVerticalL);
        }
        /* C 紧凑高效：info 区 padding 收紧、隐藏标签行 */
        .a2-compact .image-card > div:last-child {
          padding: var(--spacingHorizontalS) var(--spacingHorizontalS) var(--spacingVerticalS);
        }
        .a2-compact .image-card > div:last-child > div:last-child {
          display: none;
        }
      `}</style>

      <Show when={variantKey() === "A"}>
        <VariantA {...props} />
      </Show>
      <Show when={variantKey() === "D"}>
        <VariantDeep {...props} />
      </Show>
      <Show when={variantKey() === "C"}>
        <VariantCompact {...props} />
      </Show>
      <Show when={variantKey() === "I"}>
        <VariantImmersive {...props} />
      </Show>
      <PrototypeSwitcher variants={[...PROTOTYPE_VARIANTS]} />
    </>
  );
};

export default PrototypeHome;
