import type { Component } from "solid-js";
import type { PixivIllustTag } from "../api/types";
import SearchableTag from "./SearchableTag";

interface IllustTagsProps {
  tags: PixivIllustTag[];
  size?: "small" | "medium";
  class?: string;
}

const sizeClasses: Record<NonNullable<IllustTagsProps["size"]>, string> = {
  small:
    "[font-size:var(--fontSizeBase100)] [line-height:var(--lineHeightBase100)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)]",
  medium:
    "[font-size:var(--fontSizeBase200)] [line-height:var(--lineHeightBase200)] px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalXS)]",
};

const IllustTags: Component<IllustTagsProps> = (props) => {
  const size = () => props.size ?? "small";

  return (
    <div
      class={`flex flex-wrap gap-[var(--spacingHorizontalXXS)] ${props.class ?? ""}`}
      role="list"
      aria-label="作品标签"
    >
      <For each={props.tags}>
        {(tag) => (
          <SearchableTag
            name={tag.name}
            translatedName={tag.translated_name}
            class={`rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground3Hover)] ${sizeClasses[size()]}`}
          />
        )}
      </For>
    </div>
  );
};

export default IllustTags;
