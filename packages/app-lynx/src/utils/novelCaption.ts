// 小说简介纯文本化（spec #585 / 票 #587）：Pixiv caption 是富文本片段（含 <br>/<a>/<strong>
// 与 HTML 实体），介绍页 scrim 内 2 行截断与全文面板均按纯文本渲染——直接上屏会漏出
// `<br />` 字面量（2026-09-18 模拟器实证）。清洗顺序：块级换行 → 剥标签 → 实体解码 → 收尾。
export function stripNovelCaptionHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim()
}
