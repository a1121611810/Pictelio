// 错误呈现域（副端）。zh 值 = 存量文案逐字快照，迁移期禁改写。
const zhError = {
  "error.hint.unauthorized": "请重新登录",
  "error.hint.network": "请检查网络连接是否正常",
  "error.hint.proxy": "请检查本地代理是否已运行",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
  "error.fallback.loadFailed": "加载失败",
  "error.fallback.sessionExpired": "登录已过期",
  "error.hintSeparator": "。",
} as const;

export default zhError;
export type ErrorKey = keyof typeof zhError;
