import type { Accessor, Component, JSX } from "solid-js";
import { Show } from "solid-js";
import { contentType, setContentType, currentTab } from "@/stores/uiStore";
import { user, isLoggedIn } from "@/stores/authStore";
import UserAvatar from "../../UserAvatar";
import RecommendedFeed from "../../RecommendedFeed";
import FollowFeed from "../../FollowFeed";
import BookmarksFeed from "../../BookmarksFeed";
import HistoryFeed from "../../HistoryFeed";

/** /home 页面 UI 原型变体公共 props（数据/逻辑保持在 HomePage 路由内） */
export interface HomeVariantProps {
  headerVisible: Accessor<boolean>;
  effectiveTab: Accessor<string>;
  isDomActive: (tab: string) => boolean;
}

/** 4 个 Tab 面板（与 HomePage 现状 LRU DOM 管理一致，仅渲染子树） */
export const FeedPanels: Component<{
  effectiveTab: Accessor<string>;
  isDomActive: (tab: string) => boolean;
  headerVisible: Accessor<boolean>;
}> = (props) => {
  const tab = props.effectiveTab;
  const dom = props.isDomActive;
  return (
    <>
      <Show when={dom("recommended")}>
        <div style={{ display: tab() === "recommended" ? "block" : "none" }}>
          <RecommendedFeed headerVisible={props.headerVisible()} />
        </div>
      </Show>
      <Show when={dom("follow")}>
        <div style={{ display: tab() === "follow" ? "block" : "none" }}>
          <FollowFeed headerVisible={props.headerVisible()} />
        </div>
      </Show>
      <Show when={dom("bookmarks")}>
        <div style={{ display: tab() === "bookmarks" ? "block" : "none" }}>
          <BookmarksFeed />
        </div>
      </Show>
      <Show when={dom("history")}>
        <div style={{ display: tab() === "history" ? "block" : "none" }}>
          <HistoryFeed />
        </div>
      </Show>
    </>
  );
};

/** 头像 + 用户名（点击进入个人中心，与现状一致） */
export const UserHeader: Component<{ onNavigateMe: () => void }> = (props) => {
  return (
    <h1
      class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0"
      classList={{ "cursor-pointer": isLoggedIn() }}
      onClick={() => isLoggedIn() && props.onNavigateMe()}
    >
      <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
        <UserAvatar />
        <span class="truncate max-w-[120px]">{user()!.name}</span>
      </Show>
    </h1>
  );
};

/** 插画/小说切换器（A2 segmented：NeutralBackground2 容器 + 激活项浮起 elevation2，圆角 Medium） */
export const ContentTypeToggle: Component<{ compact?: boolean }> = (props) => {
  const itemClass = (active: boolean) =>
    `${props.compact ? "px-2.5 py-1" : "px-3 py-1.5"} rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer ${
      active
        ? "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]"
        : "bg-transparent text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)]"
    }`;
  return (
    <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-0.5 gap-0.5">
      <button
        type="button"
        class={itemClass(contentType() === "illust")}
        onClick={() => setContentType("illust")}
      >
        插画
      </button>
      <button
        type="button"
        class={itemClass(contentType() === "novel")}
        onClick={() => setContentType("novel")}
      >
        小说
      </button>
    </div>
  );
};

/** A2 Feed 容器：内部 .image-card 由 PrototypeHome 的 style 覆盖为 A2 卡片（去边框/大圆角） */
export const A2FeedFrame: Component<{ class?: string; children?: JSX.Element }> = (props) => {
  return <div class={`a2-feed ${props.class ?? ""}`}>{props.children}</div>;
};

/**
 * A2 卡片式 header（深度统一版）：sticky 容器为页面背景色，
 * 内容是一张 A2 圆角卡片（2XLarge + elevation2 + NeutralBackground1），
 * 内含头像/名字 + 插画/小说切换器——header 本身 A2 化，与设置页/me 卡片同族。
 */
export const A2Header: Component<{
  headerVisible: Accessor<boolean>;
  onNavigateMe: () => void;
  compact?: boolean;
  class?: string;
}> = (props) => {
  return (
    <div
      class={`sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-1 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)] ${props.class ?? ""}`}
      classList={{
        "translate-y-0": props.headerVisible(),
        "-translate-y-full": !props.headerVisible(),
      }}
      onDblClick={() => window.scrollTo({ top: 0 })}
    >
      <div class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] h-12 flex items-center justify-between gap-2">
        <UserHeader onNavigateMe={props.onNavigateMe} />
        <Show when={currentTab() !== "history"}>
          <ContentTypeToggle compact={props.compact} />
        </Show>
      </div>
    </div>
  );
};
