import type { Component, JSX } from "solid-js";

interface DetailCardProps {
  class?: string;
  children?: JSX.Element;
}

/**
 * 详情页信息分区卡片容器（A2 视觉语言，ADR-0071）：
 * 圆角 2XLarge + 单级 elevation2 柔和阴影 + NeutralBackground1 表面，
 * 与设置页 SettingsCard 视觉同族。
 */
const DetailCard: Component<DetailCardProps> = (props) => (
  <section
    class={`rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)] ${props.class ?? ""}`}
  >
    {props.children}
  </section>
);

export default DetailCard;
