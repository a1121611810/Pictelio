import type { Component } from "solid-js";
import FluentIcon from "@/components/ui/FluentIcon";

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  /** Callback ref 暴露内部 <input>，用于从外部聚焦 */
  inputRef?: (el: HTMLInputElement) => void;
  /** 输入框获得焦点时的回调（紧凑头部→主搜索框聚焦用） */
  onInputFocus?: () => void;
}

const TagInput: Component<TagInputProps> = (props) => {
  const [inputValue, setInputValue] = createSignal("");

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    // 去重
    if (props.tags.includes(trimmed)) return;
    props.onTagsChange([...props.tags, trimmed]);
    setInputValue("");
  }

  function removeTag(index: number) {
    props.onTagsChange(props.tags.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      addTag(input.value);
    } else if (e.key === "Backspace" && input.value === "" && props.tags.length > 0) {
      removeTag(props.tags.length - 1);
    }
  }

  return (
    <div class="flex flex-wrap items-center gap-1 flex-1 min-w-0">
      <For each={props.tags}>
        {(tag, index) => (
          <span class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-[var(--borderRadiusSmall)] bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)] text-sm select-none max-w-[140px]">
            <span class="truncate">{tag}</span>
            <button
              class="flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--colorBrandBackground1Hover)] active:scale-[0.98] transition-all duration-[var(--durationFast)] flex-shrink-0"
              onClick={() => removeTag(index())}
              aria-label={`移除标签 ${tag}`}
            >
              <FluentIcon name="dismiss" size={10} />
            </button>
          </span>
        )}
      </For>
      <input
        ref={(el) => props.inputRef?.(el)}
        type="text"
        class="flex-1 min-w-[80px] bg-transparent border-none outline-none text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] placeholder:text-[var(--colorNeutralForeground3)]"
        placeholder={
          props.tags.length === 0
            ? (props.placeholder ?? "输入标签，空格/回车添加")
            : "继续添加标签"
        }
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => props.onInputFocus?.()}
      />
    </div>
  );
};

export default TagInput;
