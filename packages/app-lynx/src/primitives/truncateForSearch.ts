// 「搜索选中词」关键词截断（spec docs/specs/app-lynx-novel-text-selection.md §ID 7）。
// 规则：取**首个非空行**（多行选区只带走第一行），上限 30 字符；按 **code point** 截断，
// 不劈开代理对（emoji / 生僻字）。
export const SEARCH_KEYWORD_MAX_CHARS = 30

export function truncateForSearch(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const chars = Array.from(firstLine)
  return chars.length > SEARCH_KEYWORD_MAX_CHARS ? chars.slice(0, SEARCH_KEYWORD_MAX_CHARS).join('') : firstLine
}
