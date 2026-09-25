import { type Component } from "solid-js";
import { muteTag } from "../stores/muteTagStore";
import { t } from "../i18n";

/** 长按静音时长（ADR-0187 D5；与 IllustDetail 收藏面板长按同值） */
const LONG_PRESS_MUTE_MS = 500;

interface SearchableTagProps {
  /** 标签名（搜索关键词） */
  name: string;
  /** 翻译后的标签名（仅作 title 悬浮提示，不显示在 chip 内——避免 chip 宽度翻倍） */
  translatedName?: string;
  /** 原生 title 提示（覆盖 translatedName 生成的提示） */
  title?: string;
  /** 额外 CSS class — 视觉样式（bg、text、rounded、font-size、padding 等）由调用方传入 */
  class?: string;
  /** 长按静音开关（ADR-0187 D5，默认开）；个别场景不需要时可传 false 关闭手势 */
  muteEnabled?: boolean;
}

/**
 * 可点击的标签 chip，点击后导航到搜索页并触发搜索；长按（500ms）将标签加入静音词表
 * （轻提示经 __root 宿主 MuteTagHint 展示，ADR-0187 D5）。
 * 自带 Fluent 交互状态（hover/active/focus-visible）、键盘支持、stopPropagation。
 * 视觉样式（背景色、文字色、字号、圆角、间距等）由调用方通过 `class` 传入。
 */
const SearchableTag: Component<SearchableTagProps> = (props) => {
  const navigate = useNavigate();

  // 长按静音（IllustDetail longPressTimer 先例）：触发后抑制紧随的 click，
  // 避免长按静音的同时又跳转搜索页。
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressFired = false;

  function startLongPress() {
    if (props.muteEnabled === false) return;
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      longPressFired = true;
      void muteTag(props.name);
    }, LONG_PRESS_MUTE_MS);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (longPressFired) {
      // 长按已静音：消费掉标记并抑制本次 click（不跳转搜索）
      longPressFired = false;
      return;
    }
    navigate(`/search?word=${encodeURIComponent(props.name)}`);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      navigate(`/search?word=${encodeURIComponent(props.name)}`);
    }
  };

  return (
    <span
      title={props.title}
      class={`cursor-pointer select-none inline-flex items-center active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:-outline-offset-2 ${props.class ?? ""}`}
      role="button"
      tabindex={0}
      aria-label={t("searchableTag.searchAria", { name: props.name })}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      {props.translatedName
        ? t("searchableTag.translatedLabel", { name: props.name, translated: props.translatedName })
        : props.name}
    </span>
  );
};

export default SearchableTag;
