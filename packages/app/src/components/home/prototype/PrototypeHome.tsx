/**
 * /home 首页 UI 原型容器（C 框架下插画/小说布局变体）。
 *
 * 切换于现有 /home 路由（?variant=，仅开发模式渲染）：
 *  - L5 终版组合（默认）：插画单列大图 + 小说单列行卡（用户选定）+ 分页
 *  - L1 双列瀑布流 + 小说行卡
 *  - L2 双列网格 + 小说双列封面卡
 *  - L3 插画单列大图 + 小说单列大封面卡
 *  - L4 紧凑行（插画/小说统一列表感）
 * 背景：设置页布局模式设置（layoutMode）将砍除，插画/小说各用固定最适布局。
 * 生产构建经 HomePage 的 `import.meta.env.DEV ? lazy(import(...)) : null` 隔离，零残留。
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import PrototypeSwitcher from "@/components/ui/PrototypeSwitcher";
import VariantL1 from "./VariantL1";
import VariantL2 from "./VariantL2";
import VariantL3 from "./VariantL3";
import VariantL4 from "./VariantL4";
import VariantL5 from "./VariantL5";

const VARIANTS = [
  { key: "L5", label: "终版组合" },
  { key: "L1", label: "双列瀑布流" },
  { key: "L2", label: "双列网格" },
  { key: "L3", label: "单列大图" },
  { key: "L4", label: "紧凑行" },
];

const PrototypeHome: Component = () => {
  const [searchParams] = useSearchParams();
  const v = () => (searchParams as Record<string, string | undefined>).variant;

  return (
    <>
      <Show when={!v() || v() === "L5"}>
        <VariantL5 />
      </Show>
      <Show when={v() === "L1"}>
        <VariantL1 />
      </Show>
      <Show when={v() === "L2"}>
        <VariantL2 />
      </Show>
      <Show when={v() === "L3"}>
        <VariantL3 />
      </Show>
      <Show when={v() === "L4"}>
        <VariantL4 />
      </Show>
      <PrototypeSwitcher variants={VARIANTS} param="variant" />
    </>
  );
};

export default PrototypeHome;
