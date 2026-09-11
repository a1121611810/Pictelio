// Oracle: docs/specs/novel-export.md §3.3/§3.4（extractNovelTextFromHtml / extractNovelDataFromHtml 行为契约）
//         真实样例复用自 packages/app/tests/unit/api/novel.test.ts（真实 Pixiv /webview/v2/novel HTML 结构）
//         + packages/app/tests/unit/routes/NovelDetail.test.tsx（真实 images 映射字段）
import { describe, expect, it } from "vitest";
import { extractNovelDataFromHtml, extractNovelTextFromHtml } from "../src/index";

// 真实 Pixiv HTML：正文藏于 window.pixiv.novel.text；seriesNavigation 与 images 为嵌套大括号对象。
const REAL_HTML = `<!DOCTYPE html><html><head><script>
Object.defineProperty(window, 'pixiv', { value: { sessionUserId: 123, novel: { "id": "24980988", "title": "测试标题", "text": "我在一片软绵绵的黑暗里浮着。\\n\\n最先回来的不是视觉，是触觉。\\n\\n[uploadedimage:24980988]", "seriesNavigation": {"nextNovel": {"id": 3, "title": "Next"}, "prevNovel": {"id": 1, "title": "Prev"}}, "images": {"24980988": {"novelImageId": "24980988", "sl": "2", "urls": {"240mw": "https://example.com/240.jpg", "480mw": "https://example.com/480.jpg", "1200x1200": "https://example.com/1200.jpg", "128x128": "https://example.com/128.jpg", "original": "https://example.com/original.png"}}} } } });
</script></head><body></body></html>`;

describe("extractNovelTextFromHtml（真实 Pixiv HTML）", () => {
  it("提取 window.pixiv.novel.text 正文", () => {
    const text = extractNovelTextFromHtml(REAL_HTML);
    expect(text).toContain("我在一片软绵绵的黑暗里浮着");
    expect(text).toContain("最先回来的不是视觉，是触觉。");
    expect(text).toContain("[uploadedimage:24980988]");
  });

  it("解义 JSON 转义序列", () => {
    const html = `<script>Object.defineProperty(window, 'pixiv', { value: { novel: { "text": "她说:\\u201c你好\\u201d" } } });</script>`;
    expect(extractNovelTextFromHtml(html)).toBe("她说:“你好”");
  });

  it("无 text 返回空串", () => {
    expect(extractNovelTextFromHtml("<html><body>no script</body></html>")).toBe("");
  });
});

describe("extractNovelDataFromHtml（真实 Pixiv HTML）", () => {
  it("同时提取 text + seriesNavigation + images", () => {
    const result = extractNovelDataFromHtml(REAL_HTML);
    expect(result.text).toContain("我在一片软绵绵的黑暗里浮着");
    expect(result.navigation.nextNovel).toEqual({ id: 3, title: "Next" });
    expect(result.navigation.prevNovel).toEqual({ id: 1, title: "Prev" });
    expect(result.images["24980988"].novelImageId).toBe("24980988");
    expect(result.images["24980988"].sl).toBe("2");
    expect(result.images["24980988"].urls["1200x1200"]).toBe("https://example.com/1200.jpg");
    expect(result.images["24980988"].urls.original).toBe("https://example.com/original.png");
  });

  it("大括号平衡：嵌套 urls 对象完整解析（不被首个 } 截断）", () => {
    const result = extractNovelDataFromHtml(REAL_HTML);
    // urls 有 5 个键，若被首个 } 截断则键数会不足
    expect(Object.keys(result.images["24980988"].urls)).toHaveLength(5);
  });

  it("仅 prev/next 全有的样例", () => {
    const html = `<script>Object.defineProperty(window, 'pixiv', { value: { novel: { "id": "2", "text": "middle", "seriesNavigation": {"nextNovel": {"id": 3, "title": "Next"}, "prevNovel": {"id": 1, "title": "Prev"}} } } });</script>`;
    const result = extractNovelDataFromHtml(html);
    expect(result.navigation.prevNovel?.id).toBe(1);
    expect(result.navigation.nextNovel?.id).toBe(3);
    expect(result.text).toBe("middle");
  });

  it("缺失 seriesNavigation 时 navigation.nextNovel 为 undefined，images 为空对象", () => {
    const result = extractNovelDataFromHtml(`<script>window.pixiv={novel:{"text":"no nav"}};</script>`);
    expect(result.text).toBe("no nav");
    expect(result.navigation.nextNovel).toBeUndefined();
    expect(result.images).toEqual({});
  });

  it("空 HTML 返回空 text / 空 navigation / 空 images", () => {
    const result = extractNovelDataFromHtml("<html></html>");
    expect(result.text).toBe("");
    expect(result.navigation.nextNovel).toBeUndefined();
    expect(result.images).toEqual({});
  });
});
