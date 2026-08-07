import type { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { A2FeedFrame, A2Header, FeedPanels, type HomeVariantProps } from "./shared";

/**
 * /home 页面 UI 原型 — 变体 D：深度统一版（A2-Deep）
 *
 * A2 语言贯彻到 header 与卡片内部：
 * - header 为 A2 卡片式（圆角 2XLarge + elevation2，内含头像/名字 + 切换器）；
 * - 子 Tab（综合/插画/漫画）容器去毛玻璃、按钮圆角对齐 A2（由 .a2-feed 覆盖）；
 * - 图片区通边（取消内层图圆角）、info 区 padding 放宽 L；
 * - 骨架卡去边框。
 */
const VariantDeep: Component<HomeVariantProps> = (props) => {
  const navigate = useNavigate();
  return (
    <div class="pb-16 a2-deep">
      <A2Header headerVisible={props.headerVisible} onNavigateMe={() => void navigate("/me")} />

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

export default VariantDeep;
