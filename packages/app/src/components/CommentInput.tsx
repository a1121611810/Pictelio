import { type Component, Show, createSignal, createEffect } from "solid-js";
import type { PixivComment } from "../api/types";

export interface CommentInputProps {
  posting: boolean;
  postError: string | null;
  replyingTo: PixivComment | null;
  onPost: (text: string) => void;
  onCancelReply: () => void;
}

const CommentInput: Component<CommentInputProps> = (props) => {
  const [inputText, setInputText] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  async function handleSubmit() {
    const text = inputText().trim();
    if (!text || props.posting) return;
    props.onPost(text);
    setInputText("");
  }

  // Focus input when replying
  createEffect(() => {
    if (props.replyingTo && inputRef) {
      inputRef.focus();
    }
  });

  return (
    <div class="flex-shrink-0 border-t border-[var(--colorNeutralStroke2)] px-3 py-2.5 surface-appbar">
      <Show when={props.replyingTo}>
        <div class="flex items-center gap-1 mb-1.5 px-1 text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
          <span class="truncate">回复 @{props.replyingTo!.user.name}</span>
          <button
            class="text-[var(--colorBrandForeground1)] font-medium bg-transparent border-none p-0 cursor-pointer flex-shrink-0 ml-auto text-[var(--fontSizeBase100)]"
            onClick={props.onCancelReply}
          >
            取消回复
          </button>
        </div>
      </Show>

      <Show when={props.postError}>
        <div class="text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase200)] mb-1">
          {props.postError}
        </div>
      </Show>

      <div class="flex items-center gap-2 border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusMedium)] px-3 has-[input:focus-visible]:border-[var(--colorBrandStroke1)] has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-[var(--colorBrandStroke1)] transition-all">
        <input
          ref={inputRef!}
          type="text"
          class="flex-1 h-9 bg-transparent text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] outline-none border-none placeholder:text-[var(--colorNeutralForeground3)] p-0"
          placeholder={props.replyingTo ? `回复 @${props.replyingTo!.user.name}...` : "写下评论..."}
          value={inputText()}
          onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />
        <button
          class="h-7 px-3 rounded-[var(--borderRadiusSmall)] bg-[var(--colorBrandBackground)] text-white [font-size:var(--fontSizeBase100)] font-medium border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] transition-all flex-shrink-0"
          disabled={!inputText().trim() || props.posting}
          onClick={handleSubmit}
        >
          {props.posting ? "···" : "发送"}
        </button>
      </div>
    </div>
  );
};

export default CommentInput;
