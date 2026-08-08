/**
 * VariantL2 — 布局方案 2：插画双列网格（3:4 等距卡）+ 小说单列行卡。
 * 插画用固定 3:4 封面卡（整齐网格感），小说用 A2 行卡。
 */
import type { Component } from "solid-js";
import { contentType } from "@/stores/uiStore";
import { SideNavShell, IllustLayoutGrid, NovelFeedSlot, type HomeTab } from "./shared";

const VariantL2: Component = () => (
  <SideNavShell
    renderPanel={(tab: HomeTab) => {
      if (tab === "history") return null;
      return contentType() === "illust" ? (
        <IllustLayoutGrid tab={tab} />
      ) : (
        <NovelFeedSlot tab={tab} layout="grid" />
      );
    }}
  />
);

export default VariantL2;
