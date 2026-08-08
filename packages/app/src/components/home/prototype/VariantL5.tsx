/**
 * VariantL5 — 终版组合（用户选定：插画 L3 单列大图 + 小说 L1 单列行卡）。
 *  - 插画：单列 16:10 大图卡（图片优先沉浸，★收藏）
 *  - 小说：单列行卡（56px 封面 + 标题/作者/★统计）
 *  - 滚动到底自动分页加载（IntersectionObserver 哨兵）
 * 基于 C 框架（SideNavShell：侧边导航 + 页面标题 + contentType）。
 */
import type { Component } from "solid-js";
import { contentType } from "@/stores/uiStore";
import { SideNavShell, IllustLayoutSingle, NovelFeedSlot, type HomeTab } from "./shared";

const VariantL5: Component = () => (
  <SideNavShell
    renderPanel={(tab: HomeTab) => {
      if (tab === "history") return null; // shell 内建历史
      return contentType() === "illust" ? (
        <IllustLayoutSingle tab={tab} />
      ) : (
        <NovelFeedSlot tab={tab} layout="rows" />
      );
    }}
  />
);

export default VariantL5;
