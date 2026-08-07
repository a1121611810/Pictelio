import type { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { A2FeedFrame, A2Header, FeedPanels, type HomeVariantProps } from "./shared";

/**
 * /home 页面 UI 原型 — 变体 I：沉浸版（A2-Immersive）
 *
 * 极简 + 沉浸：A2 卡片式 header 用 compact 切换器、页面窄边距，
 * 卡片间距更大气（info padding 适中），内容优先的沉浸浏览。
 */
const VariantImmersive: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16 a2-immersive">
      <A2Header
        headerVisible={props.headerVisible}
        onNavigateMe={() => void navigate("/me")}
        compact
        class="px-3"
      />

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

export default VariantImmersive;
