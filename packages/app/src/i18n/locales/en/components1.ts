// components 域 I（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出；R9：占位符与 zh 完全一致。
import type { ZhComponents1Key } from "../zh-CN/components1";

const enComponents1 = {
  // ── SideNavShell: tabs & nav rail ──
  "home.tab.recommended": "Recommended",
  "home.tab.follow": "Following",
  "home.tab.bookmarks": "Bookmarks",
  "home.tab.history": "History",
  "home.sidenav.mainNavAria": "Main navigation",
  "home.sidenav.searchAria": "Search",
  "home.sidenav.settingsAria": "Settings",
  "home.sidenav.meAria": "Me",
  "home.sidenav.homeTitle": "{{name}}'s home",

  // ── SideNavShell: history panel ──
  "home.history.title": "Browsing history",
  "home.history.clear": "Clear",
  "home.history.clearAria": "Clear browsing history",
  "home.history.empty": "No browsing history yet",
  "home.history.emptyHint": "Works you view will appear here",

  // ── ContentTypeToggle ──
  "home.contentToggle.illust": "Illustrations",
  "home.contentToggle.novel": "Novels",

  // ── HistoryRowCard ──
  "home.historyCard.meta": "{{userName}} · {{time}} · {{count}} views",
  "home.historyCard.deleteAria": "Delete {{title}}",

  // ── IllustSingleCard ──
  "home.illustSingle.aiAssisted": "AI-assisted",

  // ── NovelRowCard ──
  "home.novelRow.series": "Series",
  "home.novelRow.stats": "★{{bookmarks}} · {{words}}k characters",

  // ── RelatedStripRow ──
  "home.related.title": "Related works",
  "home.related.dismissAria": "Hide related works",
  "home.related.listAria": "Related works",
  "home.related.viewAria": "View related work: {{title}}",

  // ── AdaptiveTags ──
  "home.adaptiveTags.searchTagAria": "Search tag: {{name}}",
  "home.adaptiveTags.moreTagsAria": "{{count}} more tags. View details",

  // ── FeedList ──
  "home.feedList.loadingMore": "Loading…",

  // ── illust/DetailHeader ──
  "illust.header.backAria": "Back",
  "illust.header.moreAria": "More actions",

  // ── illust/BottomActionBar ──
  "illust.actionBar.bookmark": "♡ Bookmark",
  "illust.actionBar.bookmarked": "♥ Bookmarked",
  "illust.actionBar.bookmarkAria": "Bookmark",
  "illust.actionBar.unbookmarkAria": "Remove bookmark",
  "illust.actionBar.save": "Save",
  "illust.actionBar.saving": "Saving…",
  "illust.actionBar.saveAria": "Save to photos",
  "illust.actionBar.comments": "💬 Comments",

  // ── illust/PagePickerSheet ──
  "illust.pagePicker.title": "Select pages to save",
  "illust.pagePicker.dialogAria": "Select pages to save",
  "illust.pagePicker.pageAria": "Page {{page}}",
  "illust.pagePicker.pageSelectedAria": "Page {{page}} (selected)",
  "illust.pagePicker.selectAll": "Select all",
  "illust.pagePicker.clearAll": "Clear all",
  "illust.pagePicker.selectedCount": "{{selected}} / {{total}} pages selected",
  "illust.pagePicker.saveCount": "Save ({{count}})",
  "illust.pagePicker.saving": "Saving…",

  // ── ui/InlineRetryBar ──
  "ui.inlineRetry.loadMoreFailed": "Load more failed",
  "ui.inlineRetry.retry": "Retry",

  // ── ui/TagInput ──
  "ui.tagInput.removeTagAria": "Remove tag {{name}}",
  "ui.tagInput.placeholder": "Add tags with space or Enter",
  "ui.tagInput.placeholderMore": "Add another tag",
} as const satisfies Record<ZhComponents1Key, string>;

export default enComponents1;
