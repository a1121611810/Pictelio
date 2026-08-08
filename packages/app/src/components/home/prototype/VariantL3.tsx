/**
 * VariantL3 — 布局方案 3：插画单列大图（16:10 全宽）+ 小说单列行卡。
 * 插画图片优先（大图沉浸），信息在卡内；小说用 A2 行卡。
 */
import type { Component } from "solid-js";
import { contentType } from "@/stores/uiStore";
import { SideNavShell, IllustLayoutSingle, NovelFeedSlot, type HomeTab } from "./shared";

const VariantL3: Component = () => (
  <SideNavShell
    renderPanel={(tab: HomeTab) => {
      if (tab === "history") return null;
      return contentType() === "illust" ? (
        <IllustLayoutSingle tab={tab} />
      ) : (
        <NovelFeedSlot tab={tab} layout="single" />
      );
    }}
  />
);

export default VariantL3;
