// components 域 II（novel/me/search 子组件，工单 #504 B5）。
// zh 值 = 抽取前源文案逐字节一致（含模板串拼接形态），测试断言依赖。
const zhComponents2 = {
  // ── novel/NovelTopBar ──
  "novel.topBar.backAria": "返回",
  "novel.topBar.searchAria": "搜索",
  "novel.topBar.novelLabel": "小说",
  "novel.topBar.titleWrapped": "《{{title}}》",

  // ── novel/NovelCoverCard ──
  "novel.coverCard.seriesAria": "打开系列目录：{{title}}",
  "novel.coverCard.seriesLabel": "系列：{{title}}",
  "novel.coverCard.expandAria": "展开封面",
  "novel.coverCard.collapseAria": "收起封面",
  "novel.coverCard.statsWords": "📖 {{count}}字",

  // ── search/SearchFilterSheet：头部 ──
  "search.filterSheet.title": "筛选",
  "search.filterSheet.clearAll": "清除全部",
  "search.filterSheet.clearAllAria": "清除全部筛选",
  "search.filterSheet.closeAria": "关闭",

  // ── search/SearchFilterSheet：期间 ──
  "search.filterSheet.periodGroupAria": "投稿期间",
  "search.filterSheet.periodLabel": "期间",
  "search.filterSheet.all": "全部",
  "search.filterSheet.custom": "自定义",
  "search.filterSheet.startDateAria": "开始日期",
  "search.filterSheet.endDateAria": "结束日期",
  "search.filterSheet.period24h": "24 小时内",
  "search.filterSheet.period1w": "一周内",
  "search.filterSheet.period1m": "一个月内",
  "search.filterSheet.period6m": "半年内",
  "search.filterSheet.period1y": "一年内",

  // ── search/SearchFilterSheet：收藏数 ──
  "search.filterSheet.bookmarkGroupAria": "收藏数",
  "search.filterSheet.bookmarkLabel": "收藏数",
  "search.filterSheet.any": "不限",
  "search.filterSheet.bookmarkDisabledHint": "热门榜不支持按收藏数筛（切回最新/最早恢复）",

  // ── search/SearchFilterSheet：比例 ──
  "search.filterSheet.ratioGroupAria": "比例",
  "search.filterSheet.ratioLabel": "比例",
  "search.filterSheet.illustOnly": "仅插画",
  "search.filterSheet.ratioLandscape": "横图",
  "search.filterSheet.ratioPortrait": "竖图",
  "search.filterSheet.ratioSquare": "方图",
  "search.filterSheet.ratioDisabledHint": "切到「插画」范围后可用（已设的值会保留）",

  // ── search/SearchFilterSheet：分辨率 ──
  "search.filterSheet.resolutionGroupAria": "分辨率",
  "search.filterSheet.resolutionLabel": "分辨率",

  // ── search/SearchFilterSheet：AI 作品 ──
  "search.filterSheet.aiGroupAria": "AI 作品",
  "search.filterSheet.aiLabel": "AI 作品",
  "search.filterSheet.aiFollow": "跟随设置",
  "search.filterSheet.aiShowAll": "全部显示",
  "search.filterSheet.aiHide": "隐藏 AI",
  "search.filterSheet.aiHint": "只影响本次搜索，不改动设置里的 AI 偏好",
} as const;

export default zhComponents2;
export type ZhComponents2Key = keyof typeof zhComponents2;
