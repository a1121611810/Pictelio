// ─── 认证 ───
import type { IllustId, NovelId, SeriesId, UserId } from "./id";

export interface PixivAuthResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  user: PixivUser;
}

export interface PixivUser {
  id: UserId;
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

// ─── 作品 ───
export interface PixivIllustImageUrls {
  square_medium: string;
  medium: string;
  large: string;
  /** 全尺寸原图，只在 meta_pages 下有（meta_single_page 用单独的 original_image_url） */
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
  id: IllustId;
  title: string;
  type: "illust" | "manga" | "ugoira";
  user: PixivUser;
  image_urls: PixivIllustImageUrls;
  width: number;
  height: number;
  page_count: number;
  is_bookmarked: boolean;
  total_bookmarks: number;
  total_comments?: number;
  total_view?: number;
  /** Pixiv AI 类型：0/undefined=非 AI，1=AI 辅助，2=纯 AI（判定见 utils/aiFilter.ts，ADR-0155） */
  illust_ai_type?: number;
  tags: PixivIllustTag[];
  x_restrict: number;
  create_date: string;
  caption?: string;
  meta_pages: PixivIllustMetaPage[];
  meta_single_page: { original_image_url?: string };
}

// ─── 小说 ───
export interface PixivNovel {
  id: NovelId;
  title: string;
  user: PixivUser;
  image_urls: PixivIllustImageUrls;
  tags: { name: string; translated_name?: string }[];
  page_count: number;
  text_length: number;
  series?: { id: SeriesId; title: string };
  has_chapters?: boolean;
  is_original?: boolean;
  is_bookmarked: boolean;
  total_bookmarks: number;
  total_comments?: number;
  total_view?: number;
  x_restrict: number;
  create_date: string;
  caption?: string;
  /** Pixiv AI 类型：0/undefined=非 AI，1=AI 辅助，2=纯 AI（判定见 utils/aiFilter.ts，ADR-0155） */
  novel_ai_type?: number;
}

export interface PixivNovelListResponse {
  novels: PixivNovel[];
  next_url: string | null;
}

export interface PixivNovelDetailResponse {
  novel: PixivNovel;
}

// ─── 小说导航（系列章节导航；id 是 NovelId 而非 ChapterId，因 Pixiv 序列里章节等同独立小说 ID）───
interface NovelNavItem {
  id: NovelId;
  title: string;
  viewable?: boolean;
}

export interface SeriesNavigation {
  nextNovel?: NovelNavItem | null;
  prevNovel?: NovelNavItem | null;
}

// ─── 响应包装 ───
export interface PixivIllustListResponse {
  illusts: PixivIllust[];
  next_url: string | null;
}

export interface PixivIllustDetailResponse {
  illust: PixivIllust;
}

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

// ─── 收藏标签（ADR-0160 收藏加标签，spec docs/specs/bookmark-tags.md D4） ───
/**
 * 收藏详情中的单个标签。
 *
 * `is_registered` 语义（2026-09-14 真机 + host 侧直连实测确证）：`true` = **该条收藏已保存的
 * 标签**（面板据此预填已选）；`false` = 作品自身标签（未收藏时返回，仅作建议）。
 * _Avoid_：把 `is_registered` 读成「标签库已注册」——新建的收藏标签也会为 true（实证见 spec 验收节）。
 */
export interface PixivBookmarkDetailTag {
  name: string;
  is_registered?: boolean;
}

/**
 * GET /v2/illust/bookmark/detail 的 bookmark_detail（内层字段 optional 宽容解析）。
 *
 * 响应形状（2026-09-14 真机 probe）：**未收藏时并非 null**，而是返回对象且 `is_bookmarked:false`
 * + 作品自身标签（`is_registered:false`）。调用方一律以 `is_bookmarked` / `is_registered` 判定；
 * 类型上的 `| null` 仅作防御（字段显式 null / 缺字段由 API 层区分处理）。
 */
export interface PixivBookmarkDetail {
  is_bookmarked?: boolean;
  restrict?: RestrictType;
  tags?: PixivBookmarkDetailTag[];
}

export interface PixivBookmarkDetailResponse {
  bookmark_detail: PixivBookmarkDetail | null;
}

/** GET /v1/user/bookmark-tags/illust 的单个标签库条目 */
export interface PixivBookmarkTag {
  name: string;
  count?: number;
}

export interface PixivUserBookmarkTagsResponse {
  bookmark_tags: PixivBookmarkTag[];
  next_url: string | null;
}

// ─── 评论 ───
export interface PixivCommentUser {
  id: UserId;
  name: string;
  account: string;
  profile_image_urls: { medium?: string };
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

// ─── 请求参数 ───
export type ContentType = "illust" | "manga" | "novel";
export type RestrictType = "public" | "private";

// ─── 搜索 ───
export type SearchSort = "date_desc" | "date_asc" | "popular_desc";
export type SearchTarget = "partial_match_for_tags" | "exact_match_for_tags" | "title_and_caption";
export type SearchScope = "all" | "illust" | "novel"; // Phase 2 搜索页使用

export interface PixivAutocompleteResponse {
  tags: PixivIllustTag[];
}

/** 搜索结果合流后的统一条目 */
export type SearchResultItem =
  | {
      type: "illust";
      entity: PixivIllust;
      date: string;
    }
  | {
      type: "novel";
      entity: PixivNovel;
      date: string;
    };

// ─── 用户关注/粉丝 ───
export interface PixivUserPreview {
  user: PixivUser;
  illusts: PixivIllust[];
  novels: unknown[];
  is_muted: boolean;
}

export interface PixivUserFollowingResponse {
  user_previews: PixivUserPreview[];
  next_url: string | null;
}

export interface PixivProfile {
  webpage?: string;
  gender: string;
  birth: string;
  birth_day: string;
  birth_year: number;
  region: string;
  country_code: string;
  job: string;
  total_follow_users: number;
  total_mypixiv_users: number;
  total_illusts: number;
  total_manga: number;
  total_novels: number;
  total_illust_bookmarks_public: number;
  background_image_url?: string;
  twitter_account?: string;
  is_premium: boolean;
}

export interface PixivUserDetailResponse {
  user: PixivUser;
  profile: PixivProfile;
  profile_publicity: Record<string, string>;
  workspace: Record<string, string>;
}

// ─── 通知中心（ADR-0188 D2 / spec docs/specs/notification-center.md）───
// schema = 2026-09-26 真实抓包实证（脱敏 fixture 见 tests/unit/api/fixtures/notification-*.json）。
// 宽容解析姿态：除 id/created_datetime 外全 optional（对齐 PixivBookmarkDetail 先例）——
// `type` 仅两个实测样本值（7=すき！/8=フォロー），渲染必须看 content.text、type 只作 hint，
// 未来新增类型不得破坏解析。

/** 通知正文片段：`text` 是含 `<b>` 的 HTML 片段——渲染必须经 notificationPlainText 剥标签，禁注入 HTML 通道 */
export interface PixivNotificationContent {
  text?: string;
  left_icon?: string;
  left_image?: string;
  right_icon?: string;
  right_image?: string;
}

/** 组头（view_more 非空的条目，如「フォローされた」）：点击经 view-more 端点摊平子列表 */
export interface PixivNotificationViewMore {
  unread_exists?: boolean;
  title?: string;
}

/**
 * 单条通知。`view_more` 非空 = 组头；子条目（view-more 响应内）`view_more` 为 null。
 * `is_read` 为服务端只读字段（v1 不消费，未读由本地已读时间戳推导，ADR-0188 D5）。
 */
export interface PixivNotificationItem {
  id: number;
  /** +09:00 ISO 时间串（Date.parse 可解析；解析失败该条不计未读并 warn） */
  created_datetime: string;
  type?: number;
  content?: PixivNotificationContent | null;
  view_more?: PixivNotificationViewMore | null;
  /** pixiv:// scheme（users/illusts/novels）或 http(s) 外链；解析见 utils/notificationTarget */
  target_url?: string;
  is_read?: boolean;
}

/** GET /v1/notification/list 与 /v1/notification/view-more 同构 envelope；next_url 透传分页（后者携带 older_than 游标） */
export interface PixivNotificationListResponse {
  notifications: PixivNotificationItem[];
  next_url: string | null;
}

// ─── 错误 ───
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
  /** 非响应式上下文的快照文案（简中）：日志、兜底展示用；展示层优先 messageKey */
  message: string;
  status?: number;
  /** i18n：展示层优先用 messageKey + params 渲染（B1）；string 避免 api 层反向依赖 i18n 类型 */
  messageKey?: string;
  params?: Record<string, string | number>;
}
