/**
 * Pixiv /webview/v2/novel 返回 HTML 的正文/导航/内嵌图片提取。
 * 从 packages/app/src/api/novel.ts 迁移而来，行为不变；替换 @/utils/tryAsync 的
 * trySync 为包内本地等价实现（零 @/ 别名依赖）。
 */
import type { NovelImagesMap, SeriesNavigation } from "./types";

/** 本地错误元组包装（等价于 app 的 trySync；不引入 @/ 别名依赖） */
function trySync<T, E = Error>(fn: () => T): [null, T] | [E, undefined] {
  try {
    return [null, fn()];
  } catch (err) {
    return [err as E, undefined];
  }
}

/**
 * 按大括号平衡从 HTML 中提取指定 key 对应的 JSON 对象。
 * 会跳过字符串内部的引号和转义字符，能处理任意层嵌套。
 */
function extractBalancedObject(html: string, key: string): unknown {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\{`, "u");
  const match = pattern.exec(html);
  if (!match) {
    return undefined;
  }

  const start = html.indexOf("{", match.index);
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          const [parseErr, parsed] = trySync(() => JSON.parse(html.slice(start, i + 1)));
          if (parseErr) return undefined;
          return parsed;
        }
      }
    }
  }

  return undefined;
}

/**
 * 从 /webview/v2/novel 返回的 HTML 中提取小说正文。
 * 正文数据藏在 <script> 标签的 window.pixiv.novel.text 中。
 */
export function extractNovelTextFromHtml(html: string): string {
  // 匹配 window.pixiv = { ..., novel: { ..., "text": "...", ... }, ... }
  const match = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/u);
  if (!match) {
    return "";
  }
  // 解义 JSON 转义序列
  const [parseErr, parsed] = trySync(() => JSON.parse(`"${match[1]}"`) as string);
  if (parseErr) {
    return match[1].replace(/\\n/gu, "\n").replace(/\\r/gu, "").replace(/\\t/gu, " ");
  }
  return parsed;
}

/**
 * 从 /webview/v2/novel 返回的 HTML 中提取正文 + 系列导航数据 + 内嵌图片映射。
 */
export function extractNovelDataFromHtml(html: string): {
  text: string;
  navigation: SeriesNavigation;
  images: NovelImagesMap;
} {
  // 复用已有的 text 提取
  const text = extractNovelTextFromHtml(html);

  // 单独提取 seriesNavigation（简单对象结构，用正则即可）
  let navigation: SeriesNavigation = {};
  const navMatch = html.match(/"seriesNavigation"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})/u);
  if (navMatch) {
    const [navErr, parsed] = trySync(() => JSON.parse(navMatch[1]));
    if (!navErr) {
      navigation = {
        nextNovel: parsed.nextNovel ?? null,
        prevNovel: parsed.prevNovel ?? null,
      };
    }
  }

  // 提取内嵌图片映射
  const images = (extractBalancedObject(html, "images") as NovelImagesMap | undefined) ?? {};

  return { text, navigation, images };
}
