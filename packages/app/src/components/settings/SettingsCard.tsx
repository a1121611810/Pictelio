import type { Component, JSX } from "solid-js";

interface SettingsCardProps {
  /** elevated=柔和阴影无边框（默认）；danger=危险操作卡片 */
  tone?: "elevated" | "danger";
  class?: string;
  children?: JSX.Element;
}

/**
 * 设置区块卡片容器（Fluent 2 卡片化分组）。
 * 设计依据（原型 A2 选定）：圆角用 --borderRadiusXLarge（8px，ADR-0074 修正），
 * 浮起用单级 --elevation2（不叠多级阴影），表面用 --colorNeutralBackground1；
 * 危险操作独立 danger 色调卡片（--colorStatusDangerBackground2）。
 */
const SettingsCard: Component<SettingsCardProps> = (props) => {
  const toneClass = () =>
    props.tone === "danger"
      ? // border 与 bg 同令牌：行 hover 时卡片内容区与卡片边界保持区分（避免 hover 背景溢出到圆角外）
        "rounded-[var(--borderRadiusXLarge)] bg-[var(--colorStatusDangerBackground2)] border border-[var(--colorStatusDangerBackground2)]"
      : "rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)]";

  return (
    <section
      class={`px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)] ${toneClass()} ${props.class ?? ""}`}
    >
      {props.children}
    </section>
  );
};

export default SettingsCard;
