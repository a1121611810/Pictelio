// 共享差分契约表：rewriteUrl（web 分支）输入 → 期望输出（app / app-lynx 分列）。
// 期望值来源 = 差分契约（spec #187 决策 2 / ticket #194）：两端同语义模块
// （rewriteUrl web 分支，app: Capacitor.isNativePlatform()=false / lynx: isNativeMode()=false）
// 对同一输入的独立实现输出。每行含两端独立期望列，任一端的实际行为与契约不符即红灯
// （AGENTS.md「期望值出处可追溯」：独立实现差分 oracle，非从单端实现反推）。
// 记录的两处契约差异（分列记录，防"以为同构"的假象）：
// - evil 伪后缀域（evil-suffix-app-api）：app 用无边界 startsWith(PIXIV_API_BASE)
//   前缀匹配 → 误重写为 /pixiv-api.evil.com/...；lynx 用边界检查（base + "/" 或 ===）
//   白名单（#165 security review 修复）→ 原样放行。
// - auth URL 带 query（oauth-with-query）：两端输出一致（query 被剥离）；机制不同——
//   app 无边界 startsWith(PIXIV_AUTH_URL) 顺带捕获 query 形态，lynx 的 "/" 分支带边界检查、
//   另设显式 + "?" 分支。
// 本文件在 app（packages/app/tests/unit/differential/）与 app-lynx
// （packages/app-lynx/tests/differential/）各存一份，内容须逐字节一致；
// 一致性由 urlRewriteCasesConsistency.test.ts（readFileSync 比对）守护。
// 纯 TS、零框架依赖（不 import vue/solid/@capacitor）——两端测试直接消费。

export interface UrlRewriteCase {
  /** 稳定用例 id（测试标题可读性） */
  id: string;
  /** rewriteUrl 输入 path（web 模式） */
  input: string;
  /** app（packages/app/src/api/client.ts）web 分支期望输出 */
  expectedWebApp: string;
  /** app-lynx（packages/app-lynx/src/api/client.ts）web 分支期望输出 */
  expectedWebLynx: string;
  /** 契约差异说明（仅两端行为/机制不一致的行） */
  note?: string;
}

export const URL_REWRITE_CASES: UrlRewriteCase[] = [
  {
    id: "relative-path",
    input: "/v1/illust/detail",
    expectedWebApp: "/pixiv-api/v1/illust/detail",
    expectedWebLynx: "/pixiv-api/v1/illust/detail",
  },
  {
    id: "absolute-app-api",
    input: "https://app-api.pixiv.net/v1/illust/recommended",
    expectedWebApp: "/pixiv-api/v1/illust/recommended",
    expectedWebLynx: "/pixiv-api/v1/illust/recommended",
  },
  {
    id: "absolute-oauth",
    input: "https://oauth.secure.pixiv.net/auth/token",
    expectedWebApp: "/pixiv-oauth/auth/token",
    expectedWebLynx: "/pixiv-oauth/auth/token",
  },
  {
    id: "oauth-with-query",
    input: "https://oauth.secure.pixiv.net/auth/token?grant_type=refresh_token",
    expectedWebApp: "/pixiv-oauth/auth/token",
    expectedWebLynx: "/pixiv-oauth/auth/token",
    note: "契约差异（机制）：两端输出一致（query 被剥离）；app 无边界 startsWith(PIXIV_AUTH_URL) 顺带捕获 query 形态，lynx 的 '/' 分支带边界检查、另设显式 + '?' 分支",
  },
  {
    id: "proxied-image",
    input: "/pixiv-img/x.jpg",
    expectedWebApp: "/pixiv-img/x.jpg",
    expectedWebLynx: "/pixiv-img/x.jpg",
  },
  {
    id: "proxied-api-path",
    input: "/pixiv-api/v1/illust/recommended",
    expectedWebApp: "/pixiv-api/v1/illust/recommended",
    expectedWebLynx: "/pixiv-api/v1/illust/recommended",
  },
  {
    id: "evil-suffix-app-api",
    input: "https://app-api.pixiv.net.evil.com/v1/illust",
    expectedWebApp: "/pixiv-api.evil.com/v1/illust",
    expectedWebLynx: "https://app-api.pixiv.net.evil.com/v1/illust",
    note: "契约差异（行为）：app 无边界 startsWith(PIXIV_API_BASE) → 伪后缀域被误重写为 /pixiv-api.evil.com/...；lynx 边界检查白名单（base + '/' 或 ===，#165 security review 修复）→ 原样放行",
  },
  {
    id: "non-pixiv-absolute",
    input: "https://example.com/image.jpg",
    expectedWebApp: "https://example.com/image.jpg",
    expectedWebLynx: "https://example.com/image.jpg",
  },
];
