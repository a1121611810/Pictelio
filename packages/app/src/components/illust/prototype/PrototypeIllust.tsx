import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import PrototypeSwitcher from "@/components/ui/PrototypeSwitcher";
import VariantA from "./VariantA";
import VariantC from "./VariantC";
import type { IllustDetailVariantProps } from "./shared";

const PROTOTYPE_VARIANTS = [
  { key: "A", label: "A2 统一" },
  { key: "C", label: "底部操作条" },
] as const;

type PrototypeKey = (typeof PROTOTYPE_VARIANTS)[number]["key"];

/**
 * /illust 详情页 UI 原型容器（仅开发模式）。
 * IllustDetail.tsx 通过 `import.meta.env.DEV ? lazy(import(...)) : null` 引用：
 * 生产构建不加载（独立 chunk）。按 `?variant=A|C` 渲染对应变体 + 浮动切换条。
 */
const PrototypeIllust: Component<IllustDetailVariantProps> = (props) => {
  const [searchParams] = useSearchParams();

  const variantKey = () => {
    const raw = (searchParams as Record<string, string | undefined>).variant;
    return (PROTOTYPE_VARIANTS.some((v) => v.key === raw) ? raw : "A") as PrototypeKey;
  };

  return (
    <>
      <Show when={variantKey() === "A"}>
        <VariantA {...props} />
      </Show>
      <Show when={variantKey() === "C"}>
        <VariantC {...props} />
      </Show>
      <PrototypeSwitcher variants={[...PROTOTYPE_VARIANTS]} />
    </>
  );
};

export default PrototypeIllust;
