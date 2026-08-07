import type { Accessor, Component, JSX } from "solid-js";
import { Show } from "solid-js";
import type { PixivIllust } from "@/api/types";
import PixivImage from "../../PixivImage";
import IllustTags from "../../IllustTags";
import { sanitizeHtml } from "@/utils/html";

/** /illust 详情页 UI 原型变体公共 props（数据/逻辑保持在 IllustDetail 路由内） */
export interface IllustDetailVariantProps {
  illust: Accessor<PixivIllust | null>;
  imageUrls: Accessor<string[]>;
  coverUrl: Accessor<string>;
  isUgoira: () => boolean;
  isFollowed: Accessor<boolean>;
  following: Accessor<boolean>;
  bookmarking: Accessor<boolean>;
  openViewer: (startPage?: number) => void;
  toggleBookmark: () => void;
  onBookmarkPointerDown: (e: PointerEvent) => void;
  onBookmarkPointerUp: (e: PointerEvent) => void;
  toggleFollow: () => void;
  setShowActionMenu: (v: boolean) => void;
  setShowComments: (v: boolean) => void;
  handleCaptionClick: (e: MouseEvent) => void;
}

/** A2 卡片容器（详情页信息分区，与设置页 SettingsCard 视觉同族） */
export const DetailCard: Component<{ class?: string; children?: JSX.Element }> = (props) => (
  <section
    class={`rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)] ${props.class ?? ""}`}
  >
    {props.children}
  </section>
);

/** A2 卡片式顶部栏（同 /home header）：sticky 容器背景色 + 内部圆角卡片 */
export const A2DetailHeader: Component<{
  title: string;
  onBack: () => void;
  onMore: () => void;
}> = (props) => {
  return (
    <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-1">
      <div class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] h-12 flex items-center gap-2">
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          on:click={props.onBack}
          class="w-9 h-9 p-0 min-w-9 flex-shrink-0"
        >
          ←
        </fluent-button>
        <h1 class="flex-1 min-w-0 [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate">
          {props.title}
        </h1>
        <fluent-button
          appearance="subtle"
          aria-label="更多操作"
          on:click={props.onMore}
          class="w-9 h-9 p-0 min-w-9 flex-shrink-0"
        >
          ⋯
        </fluent-button>
      </div>
    </div>
  );
};

/** 作者行（头像 + 名字/account + 关注按钮） */
export const AuthorRow: Component<
  Pick<IllustDetailVariantProps, "illust" | "isFollowed" | "following" | "toggleFollow">
> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <div class="flex items-center gap-3">
        <PixivImage
          src={i()!.user.profile_image_urls.medium ?? ""}
          alt={i()!.user.name}
          width={40}
          height={40}
          class="w-10 h-10 rounded-[var(--borderRadiusCircular)] object-cover ring-[var(--strokeWidthThin)] ring-[var(--colorNeutralStroke1)]"
        />
        <div class="min-w-0">
          <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate leading-snug">
            {i()!.user.name}
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] truncate leading-snug">
            @{i()!.user.account}
          </p>
        </div>
        <button
          class="inline-flex items-center justify-center gap-[var(--spacingHorizontalXS)] rounded-[var(--borderRadiusMedium)] font-semibold [font-size:var(--fontSizeBase200)] min-h-8 px-[var(--spacingHorizontalM)] border transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.97] appearance-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] flex-shrink-0 ml-auto"
          classList={{
            "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-[var(--colorBrandBackground)] hover:bg-[var(--colorBrandBackgroundHover)]":
              !props.isFollowed(),
            "bg-transparent text-[var(--colorNeutralForeground2)] border-[var(--colorNeutralStroke2)]":
              props.isFollowed(),
          }}
          onClick={props.toggleFollow}
          disabled={props.following()}
          aria-label={props.isFollowed() ? "取消关注" : "关注"}
        >
          {props.following() ? "…" : props.isFollowed() ? "已关注" : "关注"}
        </button>
      </div>
    </Show>
  );
};

/** 统计行（收藏/浏览/评论/页数） */
export const StatsRow: Component<Pick<IllustDetailVariantProps, "illust" | "setShowComments">> = (
  props,
) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <div class="flex gap-4 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
        <span class="flex items-center gap-1">
          <span>♡</span>
          <span>{i()!.total_bookmarks.toLocaleString()}</span>
        </span>
        {i()!.total_view !== undefined && (
          <span class="flex items-center gap-1">
            <span>👁</span>
            <span>{i()!.total_view?.toLocaleString()}</span>
          </span>
        )}
        {i()!.total_comments !== undefined && (
          <span
            class="flex items-center gap-1 cursor-pointer hover:text-[var(--colorBrandForeground1)] transition-colors"
            onClick={() => props.setShowComments(true)}
          >
            <span>💬</span>
            <span>{i()!.total_comments?.toLocaleString()}</span>
          </span>
        )}
        {i()!.page_count > 1 && (
          <span class="flex items-center gap-1">
            <span>📄</span>
            <span>{i()!.page_count}P</span>
          </span>
        )}
      </div>
    </Show>
  );
};

/** 收藏按钮（长按私藏，同现状） */
export const BookmarkButton: Component<
  Pick<
    IllustDetailVariantProps,
    "illust" | "bookmarking" | "onBookmarkPointerDown" | "onBookmarkPointerUp"
  >
> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <button
        class={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium transition-all active:scale-95 select-none ${
          i()!.is_bookmarked
            ? "bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)]"
            : "bg-[var(--colorBrandStroke2)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorBrandBackground)] hover:text-[var(--colorNeutralForegroundOnBrand)]"
        }`}
        onPointerDown={props.onBookmarkPointerDown}
        onPointerUp={props.onBookmarkPointerUp}
        onPointerLeave={props.onBookmarkPointerUp}
        disabled={props.bookmarking()}
      >
        {i()!.is_bookmarked ? "♥ 已收藏" : "♡ 收藏"}
      </button>
    </Show>
  );
};

/** 标签 + 说明 */
export const TagsAndCaption: Component<
  Pick<IllustDetailVariantProps, "illust" | "handleCaptionClick">
> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <IllustTags tags={i()!.tags} size="medium" />
      {i()!.caption && (
        <p
          class="mt-3 [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)] leading-relaxed whitespace-pre-wrap"
          innerHTML={sanitizeHtml(i()!.caption ?? "")}
          onClick={props.handleCaptionClick}
        />
      )}
    </Show>
  );
};

/** 作品类型 badge（插画/漫画/动图 + AI + R18） */
export const TypeBadge: Component<Pick<IllustDetailVariantProps, "illust">> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <div class="flex items-center gap-1.5">
        {i()!.type === "ugoira" && (
          <span class="px-2 py-0.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase100)] font-semibold">
            动图
          </span>
        )}
        {i()!.type === "manga" && (
          <span class="px-2 py-0.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase100)] font-semibold">
            漫画
          </span>
        )}
        {i()!.illust_ai_type === 1 && (
          <span class="px-2 py-0.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase100)] font-semibold">
            AI
          </span>
        )}
        {i()!.x_restrict > 0 && (
          <span class="px-2 py-0.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorStatusDangerForeground1)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase100)] font-semibold">
            R18
          </span>
        )}
      </div>
    </Show>
  );
};

/** 元数据行（发布时间 / 尺寸），D 信息加深版使用 */
export const MetadataRow: Component<Pick<IllustDetailVariantProps, "illust">> = (props) => {
  const i = props.illust;
  return (
    <Show when={i()}>
      <div class="flex flex-wrap gap-x-4 gap-y-1 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
        <span>{i()!.create_date.slice(0, 10)}</span>
        <span>
          {i()!.width}×{i()!.height}
        </span>
        {i()!.page_count > 1 && <span>{i()!.page_count} 页</span>}
      </div>
    </Show>
  );
};

/** 分享按钮（原型 stub：仅视觉，点击无副作用） */
export const ShareButton: Component = () => {
  return (
    <button
      type="button"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all select-none appearance-none border-none outline-none cursor-pointer"
      aria-label="分享"
    >
      ↗ 分享
    </button>
  );
};
