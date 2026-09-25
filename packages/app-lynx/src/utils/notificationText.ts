// ─── 通知文本 HTML 剥离（ADR-0188 D4 / spec 边界 4）───
// content.text 是含 <b> 的 HTML 片段（日文为主）；lynx 无 HTML 渲染能力且注入面风险，
// v1 一律剥标签为纯文本渲染（bold 语义损失已接受，富文本挂账）。
// 与 webview 端（packages/app）同语义双端各自实现，differential 测试钉住。
//
// 语义（三步，与 DOM 文本化对齐的最小实现）：
//   ① 剔除所有标签（<b> 保留内文 = 标签本身删除、内文不动；自闭合/带属性标签同法）；
//   ② HTML 实体解码（单趟替换——`&amp;lt;` 只解一层，对齐 DOM 行为，防双重解码）；
//   ③ trim。
// null/undefined → ""（空串安全，调用方据 content 判空渲染占位）。
// 禁止把返回前的 HTML 塞进任何渲染通道（innerHTML/v-html 在 lynx 亦不存在）。

/** 实体表：抓包样本与 WHATWG 命名实体的高频子集；未收录实体保持原样（不解码不吞字） */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

const ENTITY_RE = /&(?:amp|lt|gt|quot|#39|apos|nbsp);/g
const TAG_RE = /<[^>]*>/g

/** 剥离 HTML 标签为纯文本：<b> 保留内文、其余标签剔除、实体解码、trim；null/undefined → "" */
export function notificationPlainText(text: string | null | undefined): string {
  if (!text) return ""
  const stripped = text.replace(TAG_RE, "")
  // 单趟实体解码：避免 &amp;lt; 被解码两层（DOM 语义为一层）
  return stripped.replace(ENTITY_RE, (m) => ENTITIES[m] ?? m).trim()
}
