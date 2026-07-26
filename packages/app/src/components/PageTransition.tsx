import type { Component, JSXElement } from "solid-js";

/**
 * Fluent 2 page transition: quick fade on mount.
 * Uses opacity only (no transform!) because CSS transforms create a new
 * containing block that breaks position:fixed children (e.g. NavBar).
 * This follows Fluent 2's top-level navigation rule exactly:
 * "use a quick fade transition instead of moving or sliding UI elements."
 */
const PageTransition: Component<{ children: JSXElement }> = (props) => {
  const [enter, setEnter] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setEnter(true));
  });

  return (
    <div
      style={{
        opacity: enter() ? "1" : "0",
        transition: `opacity var(--durationNormal) var(--curveEasyEase)`,
      }}
    >
      {props.children}
    </div>
  );
};

export default PageTransition;
