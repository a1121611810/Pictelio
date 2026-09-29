// 行为真值表 fixture：rewriteUrl（web 分支）输入 → 期望输出。
// 期望值来源 = URL 边界契约（spec #187 决策 2 / ticket #194 / ADR-0100），独立 oracle，
// 非从实现反推。**单端**：WebView 客户端源码随 ADR-0203 删除后对侧消失，
// 本表是 Lynx 侧 rewriteUrl 的行为基准，跨端比对语义不再成立（ADR-0203 决策 5）。
//
// ADR-0100 修复记录：evil 伪后缀域（evil-suffix-app-api）早期两端无严格边界，
// startsWith(PIXIV_API_BASE) 前缀匹配会把它误重写为 /pixiv-api.evil.com/...；
// 修复后改为严格边界（base + "/" 或 ===）并对 auth 显式 "?" 分支原样放行，
// 8 行现已全部收敛为 Lynx 侧唯一基准，**无契约差异行**（note 字段留空即该语义的机器钉）。
//
// 纯 TS、零框架依赖（不 import vue/solid/@capacitor）——Lynx 侧测试直接消费。
export interface UrlRewriteCase {
  /** 稳定用例 id（测试标题可读性） */
  id: string;
  /** rewriteUrl 输入 path（web 模式：isNativeMode() 为 false） */
  input: string;
  /** Lynx（packages/app-lynx/src/api/client.ts）web 分支期望输出 */
  expectedWeb: string;
  /** 契约差异说明（ADR-0100 修复后无差异行，留空即「无差异」也是被断言的状态） */
  note?: string;
}

export const URL_REWRITE_CASES: UrlRewriteCase[] = [
  {
    id: "relative-path",
    input: "/v1/illust/detail",
    expectedWeb: "/pixiv-api/v1/illust/detail",
  },
  {
    id: "absolute-app-api",
    input: "https://app-api.pixiv.net/v1/illust/recommended",
    expectedWeb: "/pixiv-api/v1/illust/recommended",
  },
  {
    id: "absolute-oauth",
    input: "https://oauth.secure.pixiv.net/auth/token",
    expectedWeb: "/pixiv-oauth/auth/token",
  },
  {
    id: "oauth-with-query",
    input: "https://oauth.secure.pixiv.net/auth/token?grant_type=refresh_token",
    expectedWeb: "/pixiv-oauth/auth/token",
  },
  {
    id: "proxied-image",
    input: "/pixiv-img/x.jpg",
    expectedWeb: "/pixiv-img/x.jpg",
  },
  {
    id: "proxied-api-path",
    input: "/pixiv-api/v1/illust/recommended",
    expectedWeb: "/pixiv-api/v1/illust/recommended",
  },
  {
    id: "evil-suffix-app-api",
    input: "https://app-api.pixiv.net.evil.com/v1/illust",
    expectedWeb: "https://app-api.pixiv.net.evil.com/v1/illust",
  },
  {
    id: "non-pixiv-absolute",
    input: "https://example.com/image.jpg",
    expectedWeb: "https://example.com/image.jpg",
  },
];
