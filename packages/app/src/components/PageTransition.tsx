import type { Component, JSXElement } from "solid-js";
import {
  BACK_EXIT_TRANSITION,
  ENTER_OFFSET,
  consumePendingBackEnter,
  prefersReducedMotion,
} from "@/services/backTransitionService";

/**
 * Page container — 页面容器（#364 A）。
 *
 * - 前进方向：保持直显（不引入进场动画，维持 tap→骨架 22ms 即时反馈的体检结论）。
 * - 返回方向：backTransitionService 在返回导航时置位进场标记，本组件挂载时消费——
 *   新页自左侧轻微滑入淡入进场（WinUI 返回视差方向），与旧页快照覆盖层的滑出
 *   构成完整返回过渡；reduced-motion 或无标记时行为与前进方向一致（直显）。
 * - `data-page-root` 标注路由根元素，供返回快照覆盖层定位（见 backTransitionService）。
 */

/** 进场动画清理兜底（transitionend 未触发时移除 will-change/transition） */
const ENTER_FALLBACK_MS = 700;

const PageTransition: Component<{ children: JSXElement }> = (props) => {
  let el: HTMLDivElement | undefined;

  // 同步消费返回标记：初始态必须在首帧绘制前确定（先渲染后加载，无 await）
  const animateBackEnter = !prefersReducedMotion() && consumePendingBackEnter();

  if (animateBackEnter) {
    // 双 rAF：确保初始态已提交一帧后再过渡（避免初始态与终态同帧合并为直切）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!el) return;
        el.style.transition = BACK_EXIT_TRANSITION;
        el.style.transform = "translate3d(0, 0, 0)";
        el.style.opacity = "1";
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          el?.style.setProperty("transition", "");
          el?.style.setProperty("will-change", "");
        };
        const timer = setTimeout(cleanup, ENTER_FALLBACK_MS);
        el.addEventListener("transitionend", () => {
          clearTimeout(timer);
          cleanup();
        });
      });
    });
  }

  return (
    <div
      ref={el}
      data-page-root=""
      style={
        animateBackEnter
          ? {
              transform: `translate3d(${ENTER_OFFSET}, 0, 0)`,
              opacity: "0",
              "will-change": "transform, opacity",
            }
          : {
              opacity: "1",
            }
      }
    >
      {props.children}
    </div>
  );
};

export default PageTransition;
