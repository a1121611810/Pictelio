import type { Component } from "solid-js";
import { Show } from "solid-js";
import PixivImage from "../../PixivImage";
import {
  A2DetailHeader,
  AuthorRow,
  BookmarkButton,
  DetailCard,
  StatsRow,
  TagsAndCaption,
  type IllustDetailVariantProps,
} from "./shared";

/**
 * /illust 详情页 UI 原型 — 变体 E：操作加强版（A 深入加强）
 *
 * 在 A（A2 统一版）基础上深入：
 * - 图片区每图下方紧跟 A2 操作行（收藏 / 评论 / 关注三个大按钮），
 *   主操作紧贴内容、常驻可见；
 * - 信息区紧凑单卡（作者 + 统计 + 标签说明）。
 */
const VariantEnhance: Component<IllustDetailVariantProps> = (props) => {
  const i = props.illust;

  return (
    <Show when={i()}>
      <div class="pb-10">
        <A2DetailHeader
          title={i()!.title}
          onBack={() => window.history.back()}
          onMore={() => props.setShowActionMenu(true)}
        />

        {/* 图片区 — A2 卡片化 + 图下操作行 */}
        <div class="px-4 mt-4">
          {i()!.page_count > 1 ? (
            i()!.meta_pages.map((p, idx) => (
              <div class="mb-[var(--spacingVerticalL)]">
                <div
                  class="rounded-[var(--borderRadius2XLarge)] overflow-hidden shadow-[var(--elevation2)] cursor-pointer bg-[var(--colorNeutralBackground1)]"
                  onClick={() => props.openViewer(idx)}
                >
                  <PixivImage
                    src={props.imageUrls()[idx] || p.image_urls.medium}
                    alt={`${i()!.title} ${idx + 1}`}
                    loading="eager"
                    class="w-full object-contain"
                  />
                </div>
                {idx === 0 && <ActionRow {...props} />}
              </div>
            ))
          ) : (
            <div class="mb-[var(--spacingVerticalL)]">
              <div
                class="relative rounded-[var(--borderRadius2XLarge)] overflow-hidden shadow-[var(--elevation2)] cursor-pointer bg-[var(--colorNeutralBackground1)]"
                onClick={() => props.openViewer(0)}
              >
                <PixivImage
                  src={props.coverUrl()}
                  alt={i()!.title}
                  width={i()!.width}
                  height={i()!.height}
                  loading="eager"
                  class="w-full object-contain"
                />
              </div>
              <ActionRow {...props} />
            </div>
          )}
        </div>

        {/* 信息区 — 紧凑单卡 */}
        <div class="px-4">
          <DetailCard>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-3">
              {i()!.title}
            </p>
            <div class="space-y-4">
              <AuthorRow
                illust={i}
                isFollowed={props.isFollowed}
                following={props.following}
                toggleFollow={props.toggleFollow}
              />
              <StatsRow illust={i} setShowComments={props.setShowComments} />
              <TagsAndCaption illust={i} handleCaptionClick={props.handleCaptionClick} />
            </div>
          </DetailCard>
        </div>
      </div>
    </Show>
  );
};

/** 图片下 A2 操作行（收藏 / 评论 / 关注） */
const ActionRow: Component<IllustDetailVariantProps> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <div class="flex items-center gap-2 mt-2">
        <BookmarkButton
          illust={i}
          bookmarking={props.bookmarking}
          onBookmarkPointerDown={props.onBookmarkPointerDown}
          onBookmarkPointerUp={props.onBookmarkPointerUp}
        />
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all select-none appearance-none border-none outline-none cursor-pointer"
          onClick={() => props.setShowComments(true)}
        >
          💬 评论
          {i()!.total_comments !== undefined ? ` ${i()!.total_comments?.toLocaleString()}` : ""}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all select-none appearance-none border-none outline-none cursor-pointer ml-auto"
          onClick={props.toggleFollow}
          disabled={props.following()}
        >
          {props.following() ? "…" : props.isFollowed() ? "已关注" : "关注"}
        </button>
      </div>
    </Show>
  );
};

export default VariantEnhance;
