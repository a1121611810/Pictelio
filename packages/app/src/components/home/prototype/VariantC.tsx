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
 * /home 页面 UI 原型 — 变体 C：沉浸版
 *
 * 顶部栏极简：单行（头像/名字 + 紧凑小切换器），无右侧大控件；
 * 页面边距收窄（px-3），Feed 卡片 A2 化——内容优先的沉浸浏览。
 */
const VariantC: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16">
      <header
        class="sticky top-0 z-20 h-12 flex items-center justify-between px-3 bg-[var(--colorNeutralBackground3)] transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
        classList={{
          "translate-y-0": props.headerVisible(),
          "-translate-y-full": !props.headerVisible(),
        }}
        onDblClick={() => window.scrollTo({ top: 0 })}
      >
        <UserHeader onNavigateMe={() => void navigate("/me")} />
        <Show when={currentTab() !== "history"}>
          <ContentTypeToggle compact />
        </Show>
      </header>

      <div class="px-3">
        <A2FeedFrame>
          <FeedPanels
            effectiveTab={props.effectiveTab}
            isDomActive={props.isDomActive}
            headerVisible={props.headerVisible}
          />
        </A2FeedFrame>
      </div>
    </div>
  );
};

export default VariantC;
