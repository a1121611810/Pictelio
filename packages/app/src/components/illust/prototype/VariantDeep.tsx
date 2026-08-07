import type { Component } from "solid-js";
import { Show } from "solid-js";
import PixivImage from "../../PixivImage";
import {
  A2DetailHeader,
  AuthorRow,
  BookmarkButton,
  DetailCard,
  MetadataRow,
  ShareButton,
  StatsRow,
  TagsAndCaption,
  TypeBadge,
  type IllustDetailVariantProps,
} from "./shared";

/**
 * /illust 详情页 UI 原型 — 变体 D：信息加深版（A 深入加强）
 *
 * 在 A（A2 统一版）基础上深入：
 * - 顶栏卡片内加作品类型 badge（动图/AI/R18）；
 * - 作者卡加元数据行（发布时间 / 尺寸 / 页数）；
 * - 统计数字大字化（--fontSizeBase500）+ 收藏/分享按钮并排；
 * - 图片区 A2 卡片化（同 A）。
 */
const VariantDeep: Component<IllustDetailVariantProps> = (props) => {
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

        {/* 信息区 — 分区多卡片（加深） */}
        <div class="px-4 mt-4 space-y-3">
          {/* 标题 + 类型 badge */}
          <DetailCard>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {i()!.title}
            </p>
            <div class="mt-2">
              <TypeBadge illust={i} />
            </div>
          </DetailCard>

          {/* 作者卡 + 元数据 */}
          <DetailCard>
            <AuthorRow
              illust={i}
              isFollowed={props.isFollowed}
              following={props.following}
              toggleFollow={props.toggleFollow}
            />
            <div class="mt-3 border-t border-[var(--colorNeutralStroke2)] pt-3">
              <MetadataRow illust={i} />
            </div>
          </DetailCard>

          {/* 统计卡 — 大字 + 收藏/分享 */}
          <DetailCard>
            <div class="flex items-center justify-between gap-2">
              <div class="flex-1">
                <p class="[font-size:var(--fontSizeBase500)] font-bold text-[var(--colorNeutralForeground1)] leading-none tabular-nums">
                  {i()!.total_bookmarks.toLocaleString()}
                </p>
                <p class="mt-1 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                  收藏
                </p>
              </div>
              <StatsRow illust={i} setShowComments={props.setShowComments} />
            </div>
            <div class="mt-3 flex items-center gap-2">
              <BookmarkButton
                illust={i}
                bookmarking={props.bookmarking}
                onBookmarkPointerDown={props.onBookmarkPointerDown}
                onBookmarkPointerUp={props.onBookmarkPointerUp}
              />
              <ShareButton />
            </div>
          </DetailCard>

          {/* 标签 + 说明 */}
          <DetailCard>
            <TagsAndCaption illust={i} handleCaptionClick={props.handleCaptionClick} />
          </DetailCard>
        </div>
      </div>
    </Show>
  );
};

export default VariantDeep;
