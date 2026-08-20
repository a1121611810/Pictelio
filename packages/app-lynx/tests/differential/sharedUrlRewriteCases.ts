// 共享差分契约表：rewriteUrl（web 分支）输入 → 期望输出（app / app-lynx 分列）。
// 期望值来源 = 差分契约（spec #187 决策 2 / ticket #194）：两端同语义模块
// （rewriteUrl web 分支，app: Capacitor.isNativePlatform()=false / lynx: isNativeMode()=false）
// 对同一输入的独立实现输出。每行含两端独立期望列，任一端的实际行为与契约不符即红灯
// （AGENTS.md「期望值出处可追溯」：独立实现差分 oracle，非从单端实现反推）。
// 本表 8 行双端完全一致，无契约差异行：app 已按 ADR-0100 对齐 lynx #165（security review
// 修复）——evil 伪后缀域（evil-suffix-app-api）app 原无边界 startsWith(PIXIV_API_BASE)
// 前缀匹配误重写为 /pixiv-api.evil.com/...，现改严格边界（base + "/" 或 ===）+ auth 显式
// "?" 分支后原样放行；oauth-with-query 两端机制亦收敛一致（query 被剥离）。
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
    expectedWebApp: "https://app-api.pixiv.net.evil.com/v1/illust",
    expectedWebLynx: "https://app-api.pixiv.net.evil.com/v1/illust",
  },
  {
    id: "non-pixiv-absolute",
    input: "https://example.com/image.jpg",
    expectedWebApp: "https://example.com/image.jpg",
    expectedWebLynx: "https://example.com/image.jpg",
  },
];
