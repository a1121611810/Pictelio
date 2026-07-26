import type { Component, Accessor } from "solid-js";

interface Props {
  trigger: Accessor<number>;
  size?: number;
  particleCount?: number;
}

const HeartBurstEffect: Component<Props> = (props) => {
  const size = () => props.size ?? 80;
  const particleCount = () => props.particleCount ?? 6;
  let containerRef: HTMLDivElement | undefined;

  function burst() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (!containerRef) {
      return;
    }
    const s = size();
    const count = particleCount();
    const angleStep = (Math.PI * 2) / count;
    const color =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--colorStatusDangerForeground1")
        .trim() || "#c42b1c";

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const angle = angleStep * i + Math.random() * angleStep * 0.5;
      const dist = 20 + Math.random() * 30;
      const rotate = (Math.random() - 0.5) * 120;
      const scale = 0.4 + Math.random() * 0.4;
      const duration = 400 + Math.random() * 300;

      const span = document.createElement("span");
      span.textContent = "♥";
      span.style.cssText = [
        "position:absolute",
        "top:50%",
        "left:50%",
        `width:${s}px`,
        `height:${s}px`,
        `font-size:${Math.round(s * scale)}px`,
        `color:${color}`,
        "line-height:1",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "pointer-events:none",
        "will-change:transform,opacity",
        `animation:heart-burst ${duration}ms var(--curveAccelerateMax) both`,
        `--hb-tx:${Math.cos(angle) * dist}px`,
        `--hb-ty:${Math.sin(angle) * dist}px`,
        `--hb-rot:${rotate}deg`,
        `--hb-scale:${scale}`,
      ].join(";");
      span.addEventListener("animationend", () => span.remove(), { once: true });
      frag.appendChild(span);
    }
    containerRef.appendChild(frag);
  }

  createEffect(() => {
    const count = props.trigger();
    if (count === 0) {
      return;
    }
    burst();
  });

  onCleanup(() => {
    if (containerRef) {
      containerRef.innerHTML = "";
    }
  });

  return (
    <div
      ref={containerRef}
      class="absolute pointer-events-none"
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
    />
  );
};

export default HeartBurstEffect;
