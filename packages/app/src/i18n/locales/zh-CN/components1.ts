// components 域 I（home/illust/ui/skeletons 子组件，工单 #503 B4）。
// zh 值 = 抽取前源文案逐字节一致（含模板串拼接形态），测试断言依赖。
const zhComponents1 = {
  // ── SideNavShell：Tab 与导航列 ──
  "home.tab.recommended": "推荐",
  "home.tab.follow": "关注",
  "home.tab.bookmarks": "收藏",
  "home.tab.history": "历史",
  "home.sidenav.mainNavAria": "主导航",
  "home.sidenav.searchAria": "搜索",
  "home.sidenav.settingsAria": "设置",
  "home.sidenav.meAria": "我的",
  "home.sidenav.homeTitle": "{{name}} 的首页",

  // ── SideNavShell：历史面板 ──
  "home.history.title": "浏览历史",
  "home.history.clear": "清空",
  "home.history.clearAria": "清空浏览历史",
  "home.history.empty": "暂无浏览记录",
  "home.history.emptyHint": "浏览过的作品会出现在这里",

  // ── ContentTypeToggle ──
  "home.contentToggle.illust": "插画",
  "home.contentToggle.novel": "小说",

  // ── HistoryRowCard ──
  "home.historyCard.meta": "{{userName}} · {{time}} · {{count}}次",
  "home.historyCard.deleteAria": "删除 {{title}}",

  // ── IllustSingleCard ──
  "home.illustSingle.aiAssisted": "AI辅助",

  // ── NovelRowCard ──
  "home.novelRow.series": "系列",
  "home.novelRow.stats": "★{{bookmarks}} · {{words}}k 字",

  // ── RelatedStripRow ──
  "home.related.title": "相关作品",
  "home.related.dismissAria": "收起相关作品",
  "home.related.listAria": "相关作品列表",
  "home.related.viewAria": "查看相关作品：{{title}}",

  // ── AdaptiveTags ──
  "home.adaptiveTags.searchTagAria": "搜索标签：{{name}}",
  "home.adaptiveTags.moreTagsAria": "还有 {{count}} 个标签，查看详情",

  // ── FeedList ──
  "home.feedList.loadingMore": "加载中…",

  // ── illust/DetailHeader ──
  "illust.header.backAria": "返回",
  "illust.header.moreAria": "更多操作",

  // ── illust/BottomActionBar ──
  "illust.actionBar.bookmark": "♡ 收藏",
  "illust.actionBar.bookmarked": "♥ 已收藏",
  "illust.actionBar.bookmarkAria": "收藏",
  "illust.actionBar.unbookmarkAria": "取消收藏",
  "illust.actionBar.save": "保存",
  "illust.actionBar.saving": "保存中…",
  "illust.actionBar.saveAria": "保存到相册",
  "illust.actionBar.comments": "💬 评论",

  // ── illust/PagePickerSheet ──
  "illust.pagePicker.title": "选择要保存的页",
  "illust.pagePicker.dialogAria": "选择要保存的页",
  "illust.pagePicker.pageAria": "第 {{page}} 页",
  "illust.pagePicker.pageSelectedAria": "第 {{page}} 页（已选）",
  "illust.pagePicker.selectAll": "全选",
  "illust.pagePicker.clearAll": "清除全选",
  "illust.pagePicker.selectedCount": "已选 {{selected}} / {{total}} 页",
  "illust.pagePicker.saveCount": "保存（{{count}}）",
  "illust.pagePicker.saving": "保存中…",

  // ── ui/InlineRetryBar ──
  "ui.inlineRetry.loadMoreFailed": "加载更多失败",
  "ui.inlineRetry.retry": "重试",

  // ── ui/TagInput ──
  "ui.tagInput.removeTagAria": "移除标签 {{name}}",
  "ui.tagInput.placeholder": "输入标签，空格/回车添加",
  "ui.tagInput.placeholderMore": "继续添加标签",
} as const;

export default zhComponents1;
export type ZhComponents1Key = keyof typeof zhComponents1;
