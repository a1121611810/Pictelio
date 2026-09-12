// 错误呈现域（ErrorDisplay 动作与提示层 + API 层 classifyError 主文案）。
// zh 值 = 存量文案逐字快照，迁移期禁改写；{{detail}} 为服务端错误详情（数据非文案，不翻译）。
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
  "error.api.proxy": "本地代理连接失败（127.0.0.1:10808），请检查代理软件是否运行",
  "error.api.network": "网络不可用，请检查连接",
  "error.api.unauthorized": "登录已过期 (HTTP {{status}}){{detail}}",
  "error.api.forbidden": "没有权限访问 (HTTP {{status}}){{detail}}",
  "error.api.rateLimit": "请求过于频繁，请稍后重试 (HTTP 429)",
  "error.api.invalidGrant": "登录凭证已失效，请重新登录",
  "error.api.server": "服务器错误 (HTTP {{status}}){{detail}}",
  "error.api.unknownStatus": "请求失败 (HTTP {{status}}){{detail}}",
  "error.api.unknown": "未知错误{{detail}}",
  "error.fallback.loadFailed": "加载失败",
} as const;

export default zhError;
export type ErrorKey = keyof typeof zhError;
