/**
 * 小说内嵌图片类型（单一事实源，移自 packages/app/src/api/novel.ts）。
 * 结构逐字对齐 Pixiv /webview/v2/novel 的 images 映射。
 */

/** Pixiv 小说内嵌图片的尺寸档位 */
export type NovelImageSize = "240mw" | "480mw" | "1200x1200" | "128x128" | "original";

/** 单张内嵌图片的全部尺寸 URL */
export type NovelImageUrls = Record<NovelImageSize, string>;

/** 单张内嵌图片条目 */
export interface NovelImageItem {
  novelImageId: string;
  sl: string;
  urls: NovelImageUrls;
}

/** 正文占位符 id → 图片条目的映射 */
export type NovelImagesMap = Record<string, NovelImageItem>;

/** 系列导航条目（结构同 app api/types.ts 的 NovelNavItem） */
export interface NovelNavItem {
  id: number;
  title: string;
  viewable?: boolean;
}

/** 小说系列上一篇/下一篇导航（结构同 app api/types.ts 的 SeriesNavigation） */
export interface SeriesNavigation {
  nextNovel?: NovelNavItem | null;
  prevNovel?: NovelNavItem | null;
}
