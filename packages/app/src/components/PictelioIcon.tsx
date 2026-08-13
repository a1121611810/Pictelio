import { type Component } from "solid-js";

interface PictelioIconProps {
  size?: string | number;
  class?: string;
}

const PictelioIcon: Component<PictelioIconProps> = (props) => {
  return (
    <svg
      width={props.size ?? "1em"}
      height={props.size ?? "1em"}
      viewBox="0 0 192 192"
      fill="none"
      aria-hidden="true"
      class={props.class}
    >
      <rect x="12" y="12" width="168" height="168" rx="44" fill="#ffffff" />
      <svg x="36" y="36" width="120" height="120" viewBox="0 0 64 64">
        <path
          d="M18 12 C18 12 16 28 19 52 C19 52 22 54 24 50 C26 47 24 39 26 33 C26 33 37 35 45 27 C51 21 47 13 38 11 C31 9 24 12 18 12 Z"
          fill="var(--colorBrandBackground, #2b579a)"
        />
        <path
          d="M22 16 C22 16 21 28 23 46"
          fill="none"
          stroke="var(--colorBrandForeground1, #5a9fd4)"
          stroke-width="3"
          stroke-linecap="round"
        />
        <circle cx="42" cy="19" r="2" fill="var(--colorBrandForegroundLinkHover, #7ab8e8)" />
        <circle cx="46" cy="25" r="1.5" fill="var(--colorBrandForegroundLinkHover, #7ab8e8)" />
      </svg>
    </svg>
  );
};

export default PictelioIcon;
