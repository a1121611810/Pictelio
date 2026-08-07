import type { Component } from "solid-js";

interface AvatarProps {
  src: string;
  errored: boolean;
  name: string;
  sizeClass?: string;
}

/** 圆形用户头像：正常显示图片，加载失败/无图时回退为品牌色首字母底。 */
export const Avatar: Component<AvatarProps> = (props) => {
  const size = props.sizeClass ?? "w-14 h-14";
  return (
    <>
      {!props.errored && props.src ? (
        <img
          src={props.src}
          alt={props.name}
          class={`${size} rounded-full object-cover flex-shrink-0`}
        />
      ) : (
        <div
          class={`${size} rounded-full bg-[var(--colorBrandBackground)] flex items-center justify-center text-[var(--colorNeutralForegroundOnBrand)] font-semibold flex-shrink-0`}
        >
          <span class="[font-size:var(--fontSizeBase500)]">{props.name.charAt(0) || "P"}</span>
        </div>
      )}
    </>
  );
};
