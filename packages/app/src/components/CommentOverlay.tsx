import type { Component } from "solid-js";
import type { PixivComment } from "../api/types";
import { type CommentContentType } from "../api/comment";
import { useComments } from "../primitives/useComments";
import CommentList from "./CommentList";
import CommentInput from "./CommentInput";

interface CommentOverlayProps {
  type: CommentContentType;
  targetId: number;
  isOpen: boolean;
  onClose: () => void;
}

const CommentOverlay: Component<CommentOverlayProps> = (props) => {
  const navigate = useNavigate();
  const [replyingTo, setReplyingTo] = createSignal<PixivComment | null>(null);

  const result = useComments(
    () => props.type,
    () => props.targetId,
    () => props.isOpen,
  );

  function handleReply(comment: PixivComment) {
    setReplyingTo(comment);
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  function goToUser(userId: number) {
    props.onClose();
    void navigate(`/user/${userId}`);
  }

  // 发表/回复
  async function handleSubmit(text: string) {
    await result.post(text, replyingTo()?.id);
    setReplyingTo(null);
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50"
        style={{ "background-color": "var(--colorOverlayBackground)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            props.onClose();
          }
        }}
      >
        <div
          class="absolute bottom-0 left-0 right-0 h-[80vh] rounded-t-[var(--borderRadiusXLarge)] surface-appbar flex flex-col"
          style={{
            "background-color": "var(--colorNeutralBackground1)",
            "box-shadow": "var(--elevation8)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header class="flex items-center justify-between px-4 h-12 flex-shrink-0 border-b border-[var(--colorNeutralStroke2)]">
            <h2 class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)]">
              评论
            </h2>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={props.onClose}
              aria-label="关闭"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          {/* Error banner */}
          <Show when={result.error()}>
            <div class="px-4 py-2 text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase200)] flex items-center gap-2">
              <span>{result.error()}</span>
              <button
                class="underline bg-transparent border-none p-0 cursor-pointer text-[var(--colorBrandForeground1)]"
                onClick={() => window.location.reload()}
              >
                重试
              </button>
            </div>
          </Show>

          {/* Comment list */}
          <CommentList
            comments={result.comments()}
            hasLoaded={result.hasLoaded()}
            deletingId={result.deletingId()}
            onDelete={(id) => result.remove(id)}
            onReply={handleReply}
            onClickUser={goToUser}
            sentinelAttach={result.sentinelAttach}
          />

          {/* Input bar */}
          <CommentInput
            posting={result.posting()}
            postError={result.postError()}
            replyingTo={replyingTo()}
            onPost={handleSubmit}
            onCancelReply={cancelReply}
          />
        </div>
      </div>
    </Show>
  );
};

export default CommentOverlay;
