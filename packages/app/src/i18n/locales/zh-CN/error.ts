// 错误呈现域（ErrorDisplay 动作与提示层）。zh 值 = 存量文案逐字快照，迁移期禁改写。
const zhError = {
  "error.action.checkProxy": "检查代理设置",
  "error.action.relogin": "重新登录",
  "error.action.backHome": "返回首页",
  "error.action.retry": "重试",
  "error.hint.proxy": "请确保本地代理 127.0.0.1:10808 已运行",
  "error.hint.network": "请检查网络连接是否正常",
  "error.hint.unauthorized": "登录已过期，需要重新登录",
  "error.hint.rateLimit": "请求过于频繁，请稍后重试",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
} as const;

export default zhError;
export type ErrorKey = keyof typeof zhError;
