import type { Component } from "solid-js";
import { Show } from "solid-js";
import PixivImage from "../../PixivImage";
import {
  AuthorRow,
  BookmarkButton,
  DetailCard,
  StatsRow,
  TagsAndCaption,
  type IllustDetailVariantProps,
} from "./shared";

/**
 * /illust 详情页 UI 原型 — 变体 B：图片沉浸版
 *
 * 顶部栏极简（仅返回 + 更多，标题并入信息卡）；图片区通边沉浸
 * （无卡片容器，大图全宽、间距紧凑）；信息区单张 A2 卡
 * （标题 + 作者 + 统计 + 收藏 + 标签 + 说明全部一体）。
 */
const VariantB: Component<IllustDetailVariantProps> = (props) => {
  const i = props.illust;

  return (
    <Show when={i()}>
      <div class="pb-10">
        {/* 极简顶部栏 */}
        <div class="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-[var(--colorNeutralBackground3)]">
          <fluent-button
            appearance="subtle"
            aria-label="返回"
            on:click={() => window.history.back()}
            class="w-9 h-9 p-0 min-w-9"
          >
            ←
          </fluent-button>
          <fluent-button
            appearance="subtle"
            aria-label="更多操作"
            on:click={() => props.setShowActionMenu(true)}
            class="w-9 h-9 p-0 min-w-9"
          >
            ⋯
          </fluent-button>
        </div>

        {/* 图片区 — 通边沉浸 */}
        <div>
          {i()!.page_count > 1 ? (
            i()!.meta_pages.map((p, idx) => (
              <div
                class="mb-[var(--spacingVerticalS)] cursor-pointer"
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
            <div class="cursor-pointer" onClick={() => props.openViewer(0)}>
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

        {/* 信息区 — 单卡一体 */}
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
              <StatsRow illust={i} setShowComments={props.setShowComments} />
              <BookmarkButton
                illust={i}
                bookmarking={props.bookmarking}
                onBookmarkPointerDown={props.onBookmarkPointerDown}
                onBookmarkPointerUp={props.onBookmarkPointerUp}
              />
              <TagsAndCaption illust={i} handleCaptionClick={props.handleCaptionClick} />
            </div>
          </DetailCard>
        </div>
      </div>
    </Show>
  );
};

export default VariantB;
