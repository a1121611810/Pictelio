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
 * /illust 详情页 UI 原型 — 变体 C：底部操作条版
 *
 * 顶部栏 A2 卡片式；图片卡片化；信息区紧凑单卡（作者+标题+统计+标签说明）；
 * 底部固定 A2 操作条（收藏 / 评论 / 关注入口常驻），主操作显性化。
 */
const VariantC: Component<IllustDetailVariantProps> = (props) => {
  const i = props.illust;

  return (
    <Show when={i()}>
      <div class="pb-24">
        <A2DetailHeader
          title={i()!.title}
          onBack={() => window.history.back()}
          onMore={() => props.setShowActionMenu(true)}
        />

        {/* 图片区 — A2 卡片化 */}
        <div class="px-4 mt-4">
          {i()!.page_count > 1 ? (
            i()!.meta_pages.map((p, idx) => (
              <div
                class="rounded-[var(--borderRadius2XLarge)] overflow-hidden shadow-[var(--elevation2)] mb-[var(--spacingVerticalL)] cursor-pointer bg-[var(--colorNeutralBackground1)]"
                onClick={() => props.openViewer(idx)}
              >
                <PixivImage
                  src={props.imageUrls()[idx] || p.image_urls.medium}
                  alt={`${i()!.title} ${idx + 1}`}
                  loading="eager"
                  class="w-full object-contain"
                />
              </div>
            ))
          ) : (
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
          )}
        </div>

        {/* 信息区 — 紧凑单卡 */}
        <div class="px-4 mt-4">
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
              <TagsAndCaption illust={i} handleCaptionClick={props.handleCaptionClick} />
            </div>
          </DetailCard>
        </div>

        {/* 底部固定操作条 — A2 卡片条 */}
        <div class="fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div class="pointer-events-auto w-full max-w-md rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation8)] border border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalL)] h-14 flex items-center justify-between gap-2">
            <BookmarkButton
              illust={i}
              bookmarking={props.bookmarking}
              onBookmarkPointerDown={props.onBookmarkPointerDown}
              onBookmarkPointerUp={props.onBookmarkPointerUp}
            />
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] hover:bg-[var(--colorBrandBackgroundHover)] active:scale-95 transition-all select-none appearance-none border-none outline-none cursor-pointer"
              onClick={() => props.setShowComments(true)}
            >
              💬 评论
              {i()!.total_comments !== undefined ? ` ${i()!.total_comments?.toLocaleString()}` : ""}
            </button>
          </div>
        </div>

        {/* 底部占位内的统计行 */}
        <div class="px-4 mt-3">
          <StatsRow illust={i} setShowComments={props.setShowComments} />
        </div>
      </div>
    </Show>
  );
};

export default VariantC;
