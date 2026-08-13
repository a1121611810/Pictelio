import type { Component } from "solid-js";
import type { PixivComment } from "../api/types";
import { user } from "../stores/authStore";
import { resolveImageUrl } from "../utils/imageLoader";

// ─── Helpers ───

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;
  return d.toLocaleDateString("zh-CN");
}

// ─── CommentItem (internal sub-component) ───

interface CommentItemProps {
  comment: PixivComment;
  isDeleting: boolean;
  currentUserId?: number;
  onReply: () => void;
  onDelete: () => void;
  onClickUser: () => void;
}

const CommentItem: Component<CommentItemProps> = (props) => {
  const parent = () => {
    const p = props.comment.parent_comment as
      | { id: number; comment: string; user: { name: string } }
      | Record<string, never>
      | undefined;
    return p && "id" in p && p.id
      ? (p as { id: number; comment: string; user: { name: string } })
      : null;
  };

  return (
    <div
      class="border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusMedium)] overflow-hidden"
      classList={{ "opacity-50 pointer-events-none": props.isDeleting }}
    >
      {/* Header: avatar + username + time */}
      <div class="flex items-center gap-2 px-3 py-2 bg-[var(--colorNeutralBackground2)] border-b border-[var(--colorNeutralStroke2)]">
        <button
          class="w-6 h-6 rounded-[var(--borderRadiusCircular)] flex-shrink-0 overflow-hidden bg-[var(--colorNeutralBackground3)] border-none p-0 cursor-pointer active:scale-95 transition-all"
          onClick={props.onClickUser}
          aria-label={props.comment.user.name}
        >
          <Show when={props.comment.user.profile_image_urls?.medium}>
            <img
              src={resolveImageUrl(props.comment.user.profile_image_urls.medium!)}
              alt={props.comment.user.name}
              class="w-full h-full object-cover"
            />
          </Show>
        </button>
        <button
          class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] bg-transparent border-none p-0 cursor-pointer hover:underline active:scale-[0.98] transition-all truncate"
          onClick={props.onClickUser}
        >
          {props.comment.user.name}
        </button>
        <span class="[font-size:var(--fontSizeBase75)] text-[var(--colorNeutralForeground3)] ml-auto">
          {formatDate(props.comment.date)}
        </span>
      </div>

      {/* Body */}
      <div class="px-3 py-2">
        {/* Quote block for replies */}
        <Show when={parent()}>
          {(p) => (
            <div class="mb-2 pl-2.5 border-l-[var(--strokeWidthThicker)] border-[var(--colorBrandStroke1)] py-1">
              <span class="[font-size:var(--fontSizeBase75)] text-[var(--colorBrandForeground1)] font-medium">
                @{p().user.name}
              </span>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] mt-0.5 leading-relaxed break-words">
                {p().comment}
              </p>
            </div>
          )}
        </Show>

        {/* Comment text */}
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)] leading-relaxed break-words whitespace-pre-wrap">
          {props.comment.comment ||
            (props.comment.stamp && (
              <span class="inline-block w-6 h-6 bg-[var(--colorNeutralBackground3)] rounded" />
            ))}
        </p>

        {/* Actions */}
        <div class="flex items-center gap-3 mt-2 pt-1.5 border-t border-[var(--colorNeutralStroke2)]">
          <button
            class="[font-size:var(--fontSizeBase75)] text-[var(--colorNeutralForeground3)] hover:text-[var(--colorBrandForeground1)] font-medium bg-transparent border-none p-0 cursor-pointer transition-colors"
            onClick={props.onReply}
          >
            回复
          </button>
          <Show when={Number(props.currentUserId) === Number(props.comment.user.id)}>
            <button
              class="[font-size:var(--fontSizeBase75)] text-[var(--colorNeutralForeground3)] hover:text-[var(--colorStatusDangerForeground1)] font-medium bg-transparent border-none p-0 cursor-pointer transition-colors"
              onClick={props.onDelete}
            >
              删除
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};

// ─── CommentList ───

interface CommentListProps {
  comments: PixivComment[];
  hasLoaded: boolean;
  deletingId: number | null;
  onDelete: (commentId: number) => void;
  onReply: (comment: PixivComment) => void;
  onClickUser: (userId: number) => void;
  sentinelAttach: (el: HTMLDivElement) => void;
}

const CommentList: Component<CommentListProps> = (props) => {
  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={props.hasLoaded && props.comments.length === 0}>
        <div class="flex flex-col items-center justify-center py-12 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
          <p>还没有评论</p>
          <p class="mt-1">来写第一条吧</p>
        </div>
      </Show>

      <Show when={!props.hasLoaded}>
        <div class="px-4 py-2 space-y-5">
          {Array.from({ length: 4 }).map(() => (
            <div class="flex gap-3">
              <div
                class="w-8 h-8 rounded-[var(--borderRadiusCircular)] flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
                  "background-size": "200% 100%",
                  animation: "fluent-shimmer var(--durationSlower) var(--curveEasyEase) infinite",
                }}
              />
              <div class="flex-1 min-w-0 space-y-2">
                <div
                  class="h-3 rounded w-[120px]"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
                    "background-size": "200% 100%",
                    animation: "fluent-shimmer var(--durationSlower) var(--curveEasyEase) infinite",
                  }}
                />
                <div
                  class="h-3 rounded w-[60%]"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
                    "background-size": "200% 100%",
                    animation: "fluent-shimmer var(--durationSlower) var(--curveEasyEase) infinite",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Show>

      <div class="px-4 py-2 space-y-4">
        <For each={props.comments}>
          {(comment) => (
            <CommentItem
              comment={comment}
              isDeleting={props.deletingId === comment.id}
              currentUserId={user()?.id}
              onReply={() => props.onReply(comment)}
              onDelete={() => props.onDelete(comment.id)}
              onClickUser={() => props.onClickUser(comment.user.id)}
            />
          )}
        </For>

        {/* Sentinel for pagination */}
        <div ref={props.sentinelAttach} />
      </div>
    </div>
  );
};

export default CommentList;
