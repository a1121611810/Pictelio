// 源语言字典（简中）。扁平点号 key（官方推荐预扁平，免运行时 flatten 开销）。
// key 规范：<域>.<区块>.<语义>；新增 key 必须同步 en.ts（satisfies Dict 编译期强制，漂移即构建失败）。
const zhCN = {
  // 错误呈现（ErrorDisplay 动作与提示层）
  "error.action.checkProxy": "检查代理设置",
  "error.action.relogin": "重新登录",
  "error.action.backHome": "返回首页",
  "error.action.retry": "重试",
  "error.hint.proxy": "请确保本地代理 127.0.0.1:10808 已运行",
  "error.hint.network": "请检查网络连接是否正常",
  "error.hint.unauthorized": "登录已过期，需要重新登录",
  "error.hint.rateLimit": "请求过于频繁，请稍后重试",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
  // 设置 · 外观卡（SettingsAppearance）
  "settings.appearance.sectionTitle": "显示与交互",
  "settings.appearance.theme": "明暗主题",
  "settings.appearance.detailStairs": "详情页楼梯导航",
  "settings.appearance.detailStairsDesc": "在多页作品中显示右侧页码导航条，方便快速跳转",
  "settings.appearance.autoHideNav": "自动隐藏导航栏",
  "settings.appearance.autoHideNavDesc":
    "在个人页与关注列表等页面向下滚动时收起导航栏，上滑时重新显示",
  "settings.appearance.persistScroll": "持久化滚动恢复",
  "settings.appearance.persistScrollDesc":
    "关闭时重新打开应用始终从列表顶部开始（默认）；开启后恢复上次浏览位置",
  "settings.appearance.language": "语言",
  "settings.appearance.languageDesc": "切换界面显示语言，立即生效",
} as const;

export default zhCN;
export type I18nKey = keyof typeof zhCN;
export type Dict = Record<I18nKey, string>;
