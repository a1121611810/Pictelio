import type { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { A2FeedFrame, A2Header, FeedPanels, type HomeVariantProps } from "./shared";

/**
 * /home 页面 UI 原型 — 变体 C：紧凑高效版（A2-Compact）
 *
 * 密度优先：A2 卡片式 header 用 compact 切换器（更矮），
 * info 区 padding 收紧（S）、隐藏标签行——一屏呈现更多内容，A2 卡片语言不变。
 */
const VariantCompact: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16 a2-compact">
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

export default VariantCompact;
