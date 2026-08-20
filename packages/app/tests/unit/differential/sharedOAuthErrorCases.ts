// 共享差分契约表：classifyError（OAuth 400 错误分类）输入 → 期望 type。
// 期望值来源 = 真实 OAuth 快照（pixivpy#374 / gallery-dl#9331）+ 契约语义
// （独立 oracle，非从实现反推）：字符串 error 形态 invalid_grant 与对象形态
// （error.message 含 OAuth/invalid_request/invalid_grant）→ UNAUTHORIZED（两端一致）；
// 非 OAuth 400 → 非 UNAUTHORIZED（UNKNOWN）；proxy_error → PROXY；TypeError → NETWORK。
// 期望 type 以字符串键记录（UNAUTHORIZED/UNKNOWN/PROXY/NETWORK），两端测试用
// ApiErrorType[key] 映射为枚举成员断言（T4 已统一两端枚举为大写，规避历史大小写差异）。
// 本文件在 app（packages/app/tests/unit/differential/）与 app-lynx
// （packages/app-lynx/tests/differential/）各存一份，内容须逐字节一致；
// 一致性由 oauthErrorCasesConsistency.test.ts（readFileSync 比对）守护。
// 纯 TS、零框架依赖（不 import vue/solid/@capacitor）——两端测试直接消费。

/** 真实 Pixiv OAuth 400 快照原始字节（refresh_token 失效，pixivpy#374 / gallery-dl#9331） */
export const PIXIV_OAUTH_400_RAW_SNAPSHOT =
  '{"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}';

export type OAuthErrorTypeKey = "UNAUTHORIZED" | "UNKNOWN" | "PROXY" | "NETWORK";

export interface OAuthErrorClassifyCase {
  /** 稳定用例 id（测试标题可读性） */
  id: string;
  /** classifyError 第一个入参 status */
  status: number;
  /** classifyError 第二个入参 error 形态："none" 传 null；"TypeError" 由测试侧构造 new TypeError */
  errorKind: "none" | "TypeError";
  /** classifyError 第三个入参 responseBody；快照行由 JSON.parse(PIXIV_OAUTH_400_RAW_SNAPSHOT) 得出 */
  responseBody: unknown;
  /** 期望 type 的字符串键（两端 ApiErrorType 成员名一致） */
  expectedTypeKey: OAuthErrorTypeKey;
  /** 期望值出处（oracle 溯源，逐行注明） */
  oracle: string;
}

export const OAUTH_ERROR_CLASSIFY_CASES: OAuthErrorClassifyCase[] = [
  {
    id: "oauth-snapshot-string-invalid-grant",
    status: 400,
    errorKind: "none",
    responseBody: JSON.parse(PIXIV_OAUTH_400_RAW_SNAPSHOT),
    expectedTypeKey: "UNAUTHORIZED",
    oracle:
      "真实 OAuth 400 快照（pixivpy#374 / gallery-dl#9331）：has_error + errors.system + error 字符串 invalid_grant",
  },
  {
    id: "oauth-object-invalid-request",
    status: 400,
    errorKind: "none",
    responseBody: {
      error: {
        message:
          "Error occurred at the OAuth process. Please check your Access Token to fix this. Error Message: invalid_request",
      },
    },
    expectedTypeKey: "UNAUTHORIZED",
    oracle: "对象形态：error.message 含 invalid_request（isOAuthTokenErrorResponse 对象分支契约）",
  },
  {
    id: "oauth-object-invalid-grant",
    status: 400,
    errorKind: "none",
    responseBody: { error: { message: "invalid_grant" } },
    expectedTypeKey: "UNAUTHORIZED",
    oracle: "对象形态：error.message 含 invalid_grant",
  },
  {
    id: "non-oauth-400-error-object",
    status: 400,
    errorKind: "none",
    responseBody: { error: { message: "not found" } },
    expectedTypeKey: "UNKNOWN",
    oracle: "非 OAuth 400 普通体：error.message 不含 OAuth 关键字 → 非 UNAUTHORIZED（UNKNOWN）",
  },
  {
    id: "non-oauth-400-plain-body",
    status: 400,
    errorKind: "none",
    responseBody: { message: "not found" },
    expectedTypeKey: "UNKNOWN",
    oracle: "非 OAuth 400 普通体：顶层 message → 非 UNAUTHORIZED（UNKNOWN）",
  },
  {
    id: "proxy-error",
    status: 502,
    errorKind: "none",
    responseBody: { error: "proxy_error", message: "代理连接失败" },
    expectedTypeKey: "PROXY",
    oracle: "Vite 代理层错误体 { error: 'proxy_error' }，优先于状态码分类",
  },
  {
    id: "network-typeerror",
    status: 0,
    errorKind: "TypeError",
    responseBody: null,
    expectedTypeKey: "NETWORK",
    oracle: "fetch 网络拒绝（TypeError）→ NETWORK（测试侧按 errorKind 构造 new TypeError）",
  },
];
