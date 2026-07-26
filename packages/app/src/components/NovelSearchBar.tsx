import type { Component, Accessor } from "solid-js";
import FluentIcon from "./ui/FluentIcon";

interface Props {
  query: Accessor<string>;
  setQuery: (value: string) => void;
  matchCount: Accessor<number>;
  activeIndex: Accessor<number>;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

const iconButtonClass =
  "w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer disabled:opacity-30";

const NovelSearchBar: Component<Props> = (props) => {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  function handleClear() {
    props.setQuery("");
    inputRef?.focus();
  }

  return (
    <div class="flex-1 flex items-center gap-1 min-w-0" role="search">
      <span class="text-[var(--colorNeutralForeground3)]">
        <FluentIcon name="search" size={20} />
      </span>
      <input
        ref={(el) => (inputRef = el)}
        type="search"
        value={props.query()}
        onInput={(e) => props.setQuery(e.currentTarget.value)}
        placeholder="搜索小说内容"
        aria-label="搜索小说内容"
        class="flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] placeholder:text-[var(--colorNeutralForeground3)]"
      />

      <Show when={props.query().length > 0}>
        <button
          type="button"
          class={iconButtonClass}
          onClick={handleClear}
          aria-label="清除"
          title="清除"
        >
          <FluentIcon name="dismiss" size={18} />
        </button>
      </Show>

      <Show when={props.matchCount() > 0}>
        <span
          class="text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)] px-1"
          aria-live="polite"
        >
          {props.activeIndex() + 1}/{props.matchCount()}
        </span>
      </Show>

      <button
        type="button"
        class={iconButtonClass}
        onClick={props.onPrev}
        disabled={props.matchCount() === 0}
        aria-label="上一处"
        title="上一处"
      >
        <FluentIcon name="chevronLeft" size={20} />
      </button>
      <button
        type="button"
        class={iconButtonClass}
        onClick={props.onNext}
        disabled={props.matchCount() === 0}
        aria-label="下一处"
        title="下一处"
      >
        <FluentIcon name="chevronRight" size={20} />
      </button>
      <button
        type="button"
        class={iconButtonClass}
        onClick={props.onClose}
        aria-label="关闭搜索"
        title="关闭搜索"
      >
        <FluentIcon name="dismiss" size={20} />
      </button>
    </div>
  );
};

export default NovelSearchBar;
