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
}

export interface PixivNovelListResponse {
  novels: PixivNovel[];
  next_url: string | null;
}

export interface PixivNovelDetailResponse {
  novel: PixivNovel;
}

// ─── 错误类型 ───

export enum ApiErrorType {
  NETWORK = "network",
  UNAUTHORIZED = "unauthorized",
  FORBIDDEN = "forbidden",
  RATE_LIMIT = "rate_limit",
  SERVER = "server",
  PROXY = "proxy",
  UNKNOWN = "unknown",
}

export interface ApiError {
  type: ApiErrorType;
  message: string;
  status?: number;
}
