// 错误呈现域（presentError + API 层 classifyError 主文案）。
// zh 值 = 存量文案逐字快照，迁移期禁改写；{{detail}} 为服务端错误详情（数据非文案，不翻译）。
const zhError = {
  "error.hint.unauthorized": "请重新登录",
  "error.hint.network": "请检查网络连接是否正常",
  "error.hint.proxy": "请检查本地代理是否已运行",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
  "error.fallback.loadFailed": "加载失败",
  "error.fallback.sessionExpired": "登录已过期",
  "error.hintSeparator": "。",
  "error.api.proxy": "本地代理连接失败，请检查代理软件是否运行",
  "error.api.network": "网络不可用，请检查连接",
  "error.api.unauthorized": "登录已过期 (HTTP {{status}}){{detail}}",
  "error.api.forbidden": "没有权限访问 (HTTP {{status}}){{detail}}",
  "error.api.rateLimit": "请求过于频繁，请稍后重试 (HTTP 429)",
  "error.api.invalidGrant": "登录凭证已失效，请重新登录",
  "error.api.server": "服务器错误 (HTTP {{status}}){{detail}}",
  "error.api.unknownStatus": "请求失败 (HTTP {{status}}){{detail}}",
  "error.api.unknown": "未知错误{{detail}}",
} as const;

export default zhError;
export type ErrorKey = keyof typeof zhError;
