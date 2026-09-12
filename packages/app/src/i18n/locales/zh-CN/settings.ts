// 设置域（SettingsAppearance 等 settings/ 子组件）。
const zhSettings = {
  "settings.appearance.sectionTitle": "显示与交互",
  "settings.appearance.theme": "明暗主题",
  "settings.appearance.detailStairs": "详情页楼梯导航",
  "settings.appearance.detailStairsDesc": "在多页作品中显示右侧页码导航条，方便快速跳转",
  "settings.appearance.autoHideNav": "自动隐藏导航栏",
  "settings.appearance.autoHideNavDesc": "在个人页与关注列表等页面向下滚动时收起导航栏，上滑时重新显示",
  "settings.appearance.persistScroll": "持久化滚动恢复",
  "settings.appearance.persistScrollDesc": "关闭时重新打开应用始终从列表顶部开始（默认）；开启后恢复上次浏览位置",
  "settings.appearance.language": "语言",
  "settings.appearance.languageDesc": "切换界面显示语言，立即生效",
} as const;

export default zhSettings;
export type SettingsKey = keyof typeof zhSettings;
