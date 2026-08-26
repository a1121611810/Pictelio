// ─── Pixiv API 类型（app-lynx MVP 子集，字段名与现有 app 同源） ───

export interface PixivUser {
  id: number;
  name: string;
  account: string;
  profile_image_urls: {
    medium?: string;
    px_16x16?: string;
    px_50x50?: string;
    px_170x170?: string;
  };
  is_followed?: boolean;
}

export interface PixivAuthResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  user: PixivUser;
}

export interface PixivIllustImageUrls {
  square_medium: string;
  medium: string;
  large: string;
  original?: string;
}

export interface PixivIllustMetaPage {
  image_urls: PixivIllustImageUrls;
}

export interface PixivIllustTag {
  name: string;
  translated_name?: string;
}

export interface PixivIllust {
  id: number;
  title: string;
  type: "illust" | "manga" | "ugoira";
  user: PixivUser;
  image_urls: PixivIllustImageUrls;
  width: number;
  height: number;
  page_count: number;
  is_bookmarked: boolean;
  total_bookmarks: number;
  total_view?: number;
  tags: PixivIllustTag[];
  x_restrict: number;
  create_date: string;
  caption?: string;
  total_comments?: number;
  meta_pages: PixivIllustMetaPage[];
  meta_single_page: { original_image_url?: string };
}

export interface PixivIllustListResponse {
  illusts: PixivIllust[];
  next_url: string | null;
}

export interface PixivIllustDetailResponse {
  illust: PixivIllust;
}

export interface PixivNovel {
  id: number;
  title: string;
  user: PixivUser;
  image_urls: PixivIllustImageUrls;
  tags: { name: string; translated_name?: string }[];
  page_count: number;
  text_length: number;
  series?: { id: number; title: string };
  is_bookmarked: boolean;
  total_bookmarks: number;
  total_view?: number;
  x_restrict: number;
  create_date: string;
  caption?: string;
  total_comments?: number;
}

export interface PixivNovelListResponse {
  novels: PixivNovel[];
  next_url: string | null;
}

export interface PixivNovelDetailResponse {
  novel: PixivNovel;
}

// ─── 小说系列追更（watchlist，issue #220 / spec app-lynx-novel-series-watchlist §3） ───
// 字段名逐字对齐 Pixiv-Shaft ceui/loxia/Models.kt（NovelSeriesDetail / WatchlistSeries /
// WatchlistResponse），端点对齐 ceui/lisa/http/AppApi.kt 与 ceui/loxia/API.kt。

/** 系列详情响应（GET /v2/novel/series）：追更状态与是否完结从这里取 */
export interface NovelSeriesDetailResponse {
  novel_series_detail: {
    id: number;
    title: string;
    content_count: number;
    /** 已完结（追更弹窗不据此过滤，D3：完结系列也弹） */
    is_concluded: boolean;
    /** 是否已加入追更列表 */
    watchlist_added: boolean;
  };
}

/**
 * 追更列表的一个条目 —— 注意它是一个**系列**，不是单个作品：
 * `GET /v1/watchlist/novel` 响应顶层字段就叫 `series`，[id] 是系列 id，
 * 要开「最新一话」得用 [latest_content_id]（那才是作品 id）。
 */
export interface WatchlistSeries {
  id: number;
  title: string;
  /** 系列封面。被屏蔽的条目为 null。 */
  url: string | null;
  /** 非空 = 被屏蔽/下架，此时只显示这句话。 */
  mask_text?: string | null;
  published_content_count: number;
  /** 最新一话的作品 id（小说 id） */
  latest_content_id: number;
  /** ISO 时间串；卡片只显示前 10 位（日期部分）。 */
  latest_content_date: string;
  user: PixivUser;
}

export interface WatchlistNovelListResponse {
  /** 服务端字段名就是 series —— 追更列表装的是系列。 */
  series: WatchlistSeries[];
  next_url: string | null;
}

/**
 * mask（被屏蔽/下架）占位条目判定，对齐 Shaft Models.kt `WatchlistSeries.isMasked`：
 * 标题空 + 无封面 + 有 mask 文案 + user.id=0。T7 列表页据此只读展示 mask_text。
 * 偏离说明：Shaft 原版只查 `mask_text != null`，此处额外排除空串——
 * 对齐 spec §3「mask_text 非空 = 被屏蔽」语义（空串无文案可展示，不算占位）。
 */
export function isWatchlistSeriesMasked(s: WatchlistSeries): boolean {
  return s.title === "" && s.url == null && s.mask_text != null && s.mask_text !== "" && s.user.id === 0;
}

// ─── Ugoira（T5，字段与现有 app 同源） ───
export interface PixivUgoiraFrame {
  file: string;
  delay: number;
}

export interface PixivUgoiraMetadata {
  zip_urls: {
    medium: string;
  };
  frames: PixivUgoiraFrame[];
}

export interface PixivUgoiraMetadataResponse {
  ugoira_metadata: PixivUgoiraMetadata;
}

// ─── 用户详情（P0-T1，字段与现有 app 同源） ───
export interface PixivProfile {
  webpage?: string;
  total_follow_users?: number;
  total_mypixiv_users?: number;
  // 其余字段（gender/birth/region 等）MVP 不消费，不声明
}

export interface PixivUserDetailResponse {
  user: PixivUser;
  profile: PixivProfile;
  profile_publicity: Record<string, string>;
  workspace: Record<string, string>;
}

export interface PixivUserPreview {
  user: PixivUser;
  illusts: PixivIllust[];
  is_muted: boolean;
}

export interface PixivUserFollowingResponse {
  user_previews: PixivUserPreview[];
  next_url: string | null;
}

// ─── 错误类型 ───

export enum ApiErrorType {
  NETWORK = "NETWORK",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  RATE_LIMIT = "RATE_LIMIT",
  SERVER = "SERVER",
  PROXY = "PROXY",
  UNKNOWN = "UNKNOWN",
}

export interface ApiError {
  type: ApiErrorType;
  message: string;
  status?: number;
}

// ─── 评论（issue #162，字段与现有 app 同源） ───

export interface PixivCommentUser {
  id: number;
  name: string;
  account: string;
  profile_image_urls?: {
    medium?: string;
    px_16x16?: string;
    px_50x50?: string;
    px_170x170?: string;
  };
}

export interface PixivCommentStamp {
  stamp_id: number;
  stamp_url: string;
}

export interface PixivCommentParent {
  id: number;
  comment: string;
  date: string;
  user: PixivCommentUser;
}

export interface PixivComment {
  id: number;
  comment: string;
  date: string;
  user: PixivCommentUser;
  has_replies: boolean;
  reply_count?: number;
  stamp?: PixivCommentStamp | null;
  parent_comment?: PixivCommentParent | Record<string, never>;
}

export interface PixivCommentRootResponse {
  comments: PixivComment[];
  next_url: string | null;
}

export interface PixivCommentReplyResponse {
  comments: PixivComment[];
  next_url: string | null;
}
