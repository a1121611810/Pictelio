// User-Agent 伪装（与现有 app 一致，来自 credentials.json5 公开字段）
export const PIXIV_USER_AGENT: string = __PUBLIC_CONFIG__.userAgent
export const PIXIV_REFERER: string = __PUBLIC_CONFIG__.referer
export const PIXIV_CONTENT_TYPE: string = __PUBLIC_CONFIG__.contentType
export const PIXIV_API_BASE: string = __PUBLIC_CONFIG__.apiBaseUrl
export const PIXIV_AUTH_BASE: string = __PUBLIC_CONFIG__.authUrl
