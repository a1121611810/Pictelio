import type { Component } from "solid-js";
import { Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { currentTab } from "@/stores/uiStore";
import {
  A2FeedFrame,
  ContentTypeToggle,
  FeedPanels,
  UserHeader,
  type HomeVariantProps,
} from "./shared";

/**
 * /home 页面 UI 原型 — 变体 A：A2 统一版
 *
 * 顶部栏保持现状布局（头像/名字左 + 插画/小说切换器右），但 A2 化：
 * 去毛玻璃边框（与页面背景同色）、切换器圆角对齐 A2（Medium）；
 * Feed 图片卡片 A2 化（去边框、大圆角 2XLarge、柔和阴影，由 .a2-feed 覆盖）。
 */
const VariantA: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16">
      <header
        class="sticky top-0 z-20 h-12 flex items-center justify-between px-4 bg-[var(--colorNeutralBackground3)] transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
        classList={{
          "translate-y-0": props.headerVisible(),
          "-translate-y-full": !props.headerVisible(),
        }}
        onDblClick={() => window.scrollTo({ top: 0 })}
      >
        <UserHeader onNavigateMe={() => void navigate("/me")} />
        <Show when={currentTab() !== "history"}>
          <ContentTypeToggle />
        </Show>
      </header>

      <A2FeedFrame>
        <FeedPanels
          effectiveTab={props.effectiveTab}
          isDomActive={props.isDomActive}
          headerVisible={props.headerVisible}
        />
      </A2FeedFrame>
    </div>
  );
};

export default VariantA;
