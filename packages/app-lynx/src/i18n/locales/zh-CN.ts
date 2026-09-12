// 源语言字典（简中）。扁平点号 key，规范与主端一致：<域>.<区块>.<语义>。
// 副端手写 message 模块（选型票 #494：Lynx 无 Intl，vue-i18n 的 $d/$n 不可用）。
const zhCN = {
  "error.hint.unauthorized": "请重新登录",
  "error.hint.network": "请检查网络连接是否正常",
  "error.hint.proxy": "请检查本地代理是否已运行",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
  "error.fallback.loadFailed": "加载失败",
  "error.fallback.sessionExpired": "登录已过期",
  "error.hintSeparator": "。",
} as const;

export default zhCN;
export type I18nKey = keyof typeof zhCN;
export type Dict = Record<I18nKey, string>;
