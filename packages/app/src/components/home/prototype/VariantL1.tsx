/**
 * VariantL1 — 布局方案 1：插画双列瀑布流 + 小说单列行卡。
 * 插画沿用现有瀑布流（VirtualFeed，不等高马赛克），小说用 A2 行卡。
 * 基于 C 框架（SideNavShell：侧边导航 + 页面标题 + contentType）。
 */
import type { Component } from "solid-js";
import { contentType } from "@/stores/uiStore";
import { SideNavShell, IllustFeedSlot, NovelFeedSlot, type HomeTab } from "./shared";

const VariantL1: Component = () => (
  <SideNavShell
    renderPanel={(tab: HomeTab) => {
      if (tab === "history") return null; // shell 内建历史
      return contentType() === "illust" ? (
        <IllustFeedSlot tab={tab} />
      ) : (
        <NovelFeedSlot tab={tab} layout="rows" />
      );
    }}
  />
);

export default VariantL1;
