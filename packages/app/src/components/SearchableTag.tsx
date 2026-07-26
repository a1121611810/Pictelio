import { type Component } from "solid-js";

interface SearchableTagProps {
  /** 标签名（搜索关键词） */
  name: string;
  /** 翻译后的标签名（显示文本） */
  translatedName?: string;
  /** 额外 CSS class — 视觉样式（bg、text、rounded、font-size、padding 等）由调用方传入 */
  class?: string;
}

/**
 * 可点击的标签 chip，点击后导航到搜索页并触发搜索。
 * 自带 Fluent 交互状态（hover/active/focus-visible）、键盘支持、stopPropagation。
 * 视觉样式（背景色、文字色、字号、圆角、间距等）由调用方通过 `class` 传入。
 */
const SearchableTag: Component<SearchableTagProps> = (props) => {
  const navigate = useNavigate();

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    navigate({ to: "/search", search: { word: props.name } });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      navigate({ to: "/search", search: { word: props.name } });
    }
  };

  return (
    <span
      class={`cursor-pointer inline-flex items-center active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:-outline-offset-2 ${props.class ?? ""}`}
      role="button"
      tabIndex={0}
      aria-label={`搜索标签：${props.name}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {props.translatedName ? `${props.name}（${props.translatedName}）` : props.name}
    </span>
  );
};

export default SearchableTag;
