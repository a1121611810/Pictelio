import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import PrototypeSwitcher from "@/components/ui/PrototypeSwitcher";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import type { PersonalCenterVariantProps } from "./shared";

const PROTOTYPE_VARIANTS = [
  { key: "A", label: "统一版" },
  { key: "B", label: "统计增强" },
  { key: "C", label: "英雄头像" },
] as const;

type PrototypeKey = (typeof PROTOTYPE_VARIANTS)[number]["key"];

/**
 * /me 页面 UI 原型容器（仅开发模式）。
 * PersonalCenter.tsx 通过 `import.meta.env.DEV ? lazy(import(...)) : null` 引用：
 * 生产构建不加载（独立 chunk），原型不会泄漏到用户包。
 * 按 `?variant=A|B|C` 渲染对应变体 + 底部浮动切换条。
 */
const PrototypePersonalCenter: Component<PersonalCenterVariantProps> = (props) => {
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
      <Show when={variantKey() === "B"}>
        <VariantB {...props} />
      </Show>
      <Show when={variantKey() === "C"}>
        <VariantC {...props} />
      </Show>
      <PrototypeSwitcher variants={[...PROTOTYPE_VARIANTS]} />
    </>
  );
};

export default PrototypePersonalCenter;
