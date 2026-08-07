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
 * /illust 详情页 UI 原型 — 变体 A：A2 统一版
 *
 * 顶部栏 A2 卡片式（同 /home header）；图片卡片化（每图 A2 卡片）；
 * 信息区分区多卡片（作者卡 / 统计+收藏卡 / 标签+说明卡），与设置页/me 卡片同族。
 */
const VariantA: Component<IllustDetailVariantProps> = (props) => {
  const i = props.illust;

  return (
    <Show when={i()}>
      <div class="pb-10">
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
              {props.isUgoira() && (
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span class="px-3 py-1.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] backdrop-blur-[var(--backdropBlurDefault)] text-[var(--colorOverlayForeground)] [font-size:var(--fontSizeBase200)] font-semibold shadow-[var(--elevation4)]">
                    ▶ 动图
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 信息区 — 分区多卡片 */}
        <div class="px-4 mt-4 space-y-3">
          <DetailCard>
            <AuthorRow
              illust={i}
              isFollowed={props.isFollowed}
              following={props.following}
              toggleFollow={props.toggleFollow}
            />
          </DetailCard>

          <DetailCard>
            <div class="flex items-center justify-between gap-2">
              <StatsRow illust={i} setShowComments={props.setShowComments} />
              <BookmarkButton
                illust={i}
                bookmarking={props.bookmarking}
                onBookmarkPointerDown={props.onBookmarkPointerDown}
                onBookmarkPointerUp={props.onBookmarkPointerUp}
              />
            </div>
          </DetailCard>

          <DetailCard>
            <TagsAndCaption illust={i} handleCaptionClick={props.handleCaptionClick} />
          </DetailCard>
        </div>
      </div>
    </Show>
  );
};

export default VariantA;
