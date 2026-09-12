// components 域 II（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出；R9：占位符与 zh 完全一致。
import type { ZhComponents2Key } from "../zh-CN/components2";

const enComponents2 = {
  // ── novel/NovelTopBar ──
  "novel.topBar.backAria": "Back",
  "novel.topBar.searchAria": "Search",
  "novel.topBar.novelLabel": "Novel",
  "novel.topBar.titleWrapped": "{{title}}",

  // ── novel/NovelCoverCard ──
  "novel.coverCard.seriesAria": "Open series: {{title}}",
  "novel.coverCard.seriesLabel": "Series: {{title}}",
  "novel.coverCard.expandAria": "Expand cover",
  "novel.coverCard.collapseAria": "Collapse cover",
  "novel.coverCard.statsWords": "📖 {{count}} characters",

  // ── search/SearchFilterSheet: header ──
  "search.filterSheet.title": "Filters",
  "search.filterSheet.clearAll": "Clear all",
  "search.filterSheet.clearAllAria": "Clear all filters",
  "search.filterSheet.closeAria": "Close",

  // ── search/SearchFilterSheet: post date ──
  "search.filterSheet.periodGroupAria": "Date posted",
  "search.filterSheet.periodLabel": "Date posted",
  "search.filterSheet.all": "All",
  "search.filterSheet.custom": "Custom",
  "search.filterSheet.startDateAria": "Start date",
  "search.filterSheet.endDateAria": "End date",
  "search.filterSheet.period24h": "Past 24 hours",
  "search.filterSheet.period1w": "Past week",
  "search.filterSheet.period1m": "Past month",
  "search.filterSheet.period6m": "Past 6 months",
  "search.filterSheet.period1y": "Past year",

  // ── search/SearchFilterSheet: bookmarks ──
  "search.filterSheet.bookmarkGroupAria": "Bookmarks",
  "search.filterSheet.bookmarkLabel": "Bookmarks",
  "search.filterSheet.any": "Any",
  "search.filterSheet.bookmarkDisabledHint":
    "Bookmark count filters aren't available for Popular. Switch to Newest or Oldest to restore them.",

  // ── search/SearchFilterSheet: aspect ratio ──
  "search.filterSheet.ratioGroupAria": "Aspect ratio",
  "search.filterSheet.ratioLabel": "Aspect ratio",
  "search.filterSheet.illustOnly": "Illustrations only",
  "search.filterSheet.ratioLandscape": "Landscape",
  "search.filterSheet.ratioPortrait": "Portrait",
  "search.filterSheet.ratioSquare": "Square",
  "search.filterSheet.ratioDisabledHint":
    "Available after switching to the Illustrations scope. Your selection is kept.",

  // ── search/SearchFilterSheet: resolution ──
  "search.filterSheet.resolutionGroupAria": "Resolution",
  "search.filterSheet.resolutionLabel": "Resolution",

  // ── search/SearchFilterSheet: AI works ──
  "search.filterSheet.aiGroupAria": "AI works",
  "search.filterSheet.aiLabel": "AI works",
  "search.filterSheet.aiFollow": "Follow app setting",
  "search.filterSheet.aiShowAll": "Show all",
  "search.filterSheet.aiHide": "Hide AI",
  "search.filterSheet.aiHint":
    "Only applies to this search. Doesn't change your AI preference in Settings.",
} as const satisfies Record<ZhComponents2Key, string>;

export default enComponents2;
