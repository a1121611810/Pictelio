/**
 * 服务端「内容策略拒绝」的形态识别（issue #1063 · ADR-0173 D7a）。
 *
 * <p>**为什么是独立模块**：native 路径（`classifyNativeError`，读 Java 侧终态消息全文）
 * 与 web 路径（`translate.ts` 的 HTTP 错误处理，读 `error.code` / `error.message`）
 * 都要判「这次失败是不是服务商内容策略拦的」。两份判据若各写一份 ⇒ 必然漂移：
 * 同一个服务端响应，native 判 `content_filter` 而 web 判 `unknown` ⇒ 用户在真机与
 * web-core 预览看到两套说法。⇒ **单一事实源在此，两条路径都引它**。
 *
 * <p>**为什么需要这一层**：服务端拦截有两种形态，UI 必须给同一语义
 * （`content_filter` → 「服务端未返回译文：内容可能被内容策略拦截」）：
 * <ul>
 *   <li>**空流**：HTTP 200 但零译文 —— Java 侧终态消息「LLM 未返回任何译文
 *       （可能被服务端内容策略拦截）」（#654）。</li>
 *   <li>**显式拒绝**：HTTP 4xx + 错误体明说内容策略 —— 本模块要认的就是它。</li>
 * </ul>
 *
 * <p>旧实现只认「content policy」（**空格**）与「content_filter`」两个串。真实服务商
 * 返回的不是这两个形态：OpenAI 兼容层用下划线的 `content_policy_violation`
 * （MiniMax 兼容层实测返回 `image_content_policy_violation`），MiniMax 自有语义则是
 * `new_sensitive` + 错误码 1026（官方错误码表：1026 = 输入内容涉敏）。
 * ⇒ 全部命不中 ⇒ 落到 HTTP 状态码分支 ⇒ 400 ⇒ `invalid_request` ⇒ UI 展示
 * 「请求参数无效（400）：请检查模型与 endpoint 配置」—— **归因错误**：让用户去改
 * endpoint / model，而真实原因是正文被内容策略拦了，换任何 endpoint 都不会好。
 *
 * <p>oracle 来源：2026-10-23 真机实跑（MiniMax-M3.1-Flash-Preview + 模拟器 debug 包）
 * 的 logcat 原文 `translateStream HTTP 400 body=HTTP 400: {"error":{"message":
 * "input new_sensitive (1026)","code":"image_content_policy_violation"}}`。
 *
 * <p>⚠️ **顺序纪律（两条路径都适用）**：拦截识别**必须**在 HTTP 状态码分流**之前** ——
 * 拦截也可能带 4xx（实测 400；Azure 用 403、部分服务商用 422），先按状态码判就会
 * 把它吞成 `invalid_request` / `unauthorized`。
 */

/** 判定「任意文本」是否表明服务端内容策略拒绝（native 路径：读终态消息全文）。 */
export function isContentPolicyRejection(text: string | undefined): boolean {
  const m = text ?? ""
  // ① 既有形态（保留）：空格版 + 裸 code + Java 侧空流中文串
  if (m.includes("content policy") || m.includes("content_filter") || m.includes("未返回任何译文")) {
    return true
  }
  // ② OpenAI 兼容层 code（下划线形态）：content_policy_violation / image_content_policy_violation
  if (m.includes("content_policy_violation")) return true
  // ③ MiniMax 自有涉敏语义：new_sensitive（对应官方错误码 1026 输入涉敏 / 1027 输出涉敏）
  if (m.includes("new_sensitive")) return true
  return false
}

/**
 * 判定「服务商错误 code」是否表明内容策略拒绝（web 路径：读 `error.code ?? error.type`）。
 *
 * <p>用**后缀**匹配而非全等：OpenAI 兼容层允许服务商在 code 前加领域前缀
 * （MiniMax 实测 `image_content_policy_violation`），后缀匹配可一并覆盖
 * `content_policy_violation` / `image_content_policy_violation` / `text_content_policy_violation`。
 *
 * <p>裸 `content_filter`（部分服务商用它当 code）也归入。
 */
export function isContentPolicyCode(code: string | undefined): boolean {
  if (!code) return false
  if (code === "content_filter") return true
  return code.endsWith("content_policy_violation")
}
