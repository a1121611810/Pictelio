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
 * /home 页面 UI 原型 — 变体 B：切换器下行版
 *
 * 顶部栏只保留头像/名字（去掉右侧切换器），插画/小说切换器独立成
 * 顶部栏下方一行（sticky 跟随 header）——主控件显性化，一次操作直达；
 * Feed 卡片 A2 化。
 */
const VariantB: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16">
      <header
        class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
        classList={{
          "translate-y-0": props.headerVisible(),
          "-translate-y-full": !props.headerVisible(),
        }}
        onDblClick={() => window.scrollTo({ top: 0 })}
      >
        {/* 第一行：头像/名字 */}
        <div class="h-12 flex items-center justify-between px-4">
          <UserHeader onNavigateMe={() => void navigate("/me")} />
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            首页
          </span>
        </div>

        {/* 第二行：插画/小说切换器（隐藏于历史 tab） */}
        <Show when={currentTab() !== "history"}>
          <div class="px-4 pb-2 flex">
            <ContentTypeToggle />
          </div>
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

export default VariantB;
