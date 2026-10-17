// 错误呈现域（presentError + API 层 classifyError 主文案）。
// zh 值**原则上**是存量文案逐字快照，迁移期禁改写；{{detail}} 为服务端错误详情
// （数据非文案，不翻译）。
// ⚠️ 例外已存在 2 条，均由 #807 引入并有意为之（判据改动要求文案跟着变）：
//   error.hint.network（补「去哪查」）、error.api.network（新增 {{detail}} 槽）。
//   新增改动前请先回到 `classifyError`（src/api/client.ts）看判据有没有一起动。
const zhError = {
  "error.hint.unauthorized": "请重新登录",
  // #807：网络类补「去哪查」——网络自检页是应用内唯一能定位到 DNS/链路层失败的入口
  // （走「高级设置 → 网络自检」），无此指引时用户拿不到任何下一步。
  "error.hint.network": "请检查网络连接是否正常，或到「高级设置 → 网络自检」查看诊断",
  "error.hint.proxy": "请检查本地代理是否已运行",
  "error.hint.server": "Pixiv 服务器暂时不可用，请稍后重试",
  "error.fallback.loadFailed": "加载失败",
  "error.fallback.sessionExpired": "登录已过期",
  "error.hintSeparator": "。",
  "error.api.proxy": "本地代理连接失败，请检查代理软件是否运行",
  // #807：{{detail}} 承载传输层诊断原文（原生侧为 Java 异常消息），旧模板无此槽 ⇒ 该文本被丢弃
  "error.api.network": "网络不可用，请检查连接{{detail}}",
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
