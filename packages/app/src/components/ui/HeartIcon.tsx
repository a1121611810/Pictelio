import type { Component } from "solid-js";

export interface HeartIconProps {
  filled: boolean;
  size?: number;
}

/**
 * Fluent-style heart icon for bookmark/收藏 state.
 *
 * 填充态 = 实心爱心, 未填态 = 描边爱心.
 * 使用 currentColor 以继承父元素颜色.
 */
const HeartIcon: Component<HeartIconProps> = (props) => {
  const s = props.size ?? 24;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      aria-hidden="true"
    >
      {props.filled ? (
        <path
          d="M12.82 5.58l-.82.82-.82-.82a4.5 4.5 0 0 0-6.36 6.36l.82.82L12 20.06l6.36-6.36.82-.82a4.5 4.5 0 0 0-6.36-6.36z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M12.82 5.58l-.82.82-.82-.82a4.5 4.5 0 0 0-6.36 6.36l.82.82L12 20.06l6.36-6.36.82-.82a4.5 4.5 0 0 0-6.36-6.36z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      )}
    </svg>
  );
};

export default HeartIcon;
