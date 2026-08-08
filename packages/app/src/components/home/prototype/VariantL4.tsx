/**
 * VariantL4 — 布局方案 4：插画紧凑行 + 小说紧凑行（统一列表感）。
 * 插画/小说均为紧凑行卡（40px 缩略 + 单行信息），列表密度最高，信息浏览效率优先。
 */
import type { Component } from "solid-js";
import { contentType } from "@/stores/uiStore";
import { SideNavShell, IllustLayoutRows, NovelCompactList, type HomeTab } from "./shared";

const VariantL4: Component = () => (
  <SideNavShell
    renderPanel={(tab: HomeTab) => {
      if (tab === "history") return null;
      return contentType() === "illust" ? (
        <IllustLayoutRows tab={tab} />
      ) : (
        <NovelCompactList tab={tab} />
      );
    }}
  />
);

export default VariantL4;
