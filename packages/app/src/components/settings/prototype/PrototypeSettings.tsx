import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import VariantA from "./VariantA";
import VariantA2 from "./VariantA2";
import VariantA3 from "./VariantA3";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import PrototypeSwitcher from "./PrototypeSwitcher";
import type { SettingsVariantProps } from "./shared";

const PROTOTYPE_VARIANTS = [
  { key: "A", label: "卡片分组" },
  { key: "A2", label: "精修版" },
  { key: "A3", label: "清爽版" },
  { key: "B", label: "分类 Tab" },
  { key: "C", label: "搜索索引" },
] as const;

type PrototypeKey = (typeof PROTOTYPE_VARIANTS)[number]["key"];

/**
 * 设置页 UI 原型容器（仅开发模式）。
 * Settings.tsx 通过 `import.meta.env.DEV ? lazy(import(...)) : null` 引用本模块：
 * 生产构建不加载（独立 chunk，运行时零引用），原型不会泄漏到用户包。
 * 按 `?variant=A|B|C` 渲染对应变体 + 底部浮动切换条。
 */
const PrototypeSettings: Component<SettingsVariantProps> = (props) => {
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
      <Show when={variantKey() === "A2"}>
        <VariantA2 {...props} />
      </Show>
      <Show when={variantKey() === "A3"}>
        <VariantA3 {...props} />
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

export default PrototypeSettings;
