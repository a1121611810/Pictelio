import type { Component, JSXElement } from "solid-js";

/**
 * Page container — 本地 APP 无需入场动画，直接显示。
 */
const PageTransition: Component<{ children: JSXElement }> = (props) => {
  return (
    <div
      style={{
        opacity: "1",
      }}
    >
      {props.children}
    </div>
  );
};

export default PageTransition;
