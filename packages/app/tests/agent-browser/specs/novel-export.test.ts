/**
 * 小说导出 E2E（spec docs/specs/novel-export.md §7）—— agent-browser 版。
 *
 * 场景：登录 → 设置页导出格式 → 小说详情导出入口 → 面板选格式 → 确认入队 → 下载页可见。
 *
 * 确定性设计：
 * - 小说详情 JSON 与 /webview/v2/novel 正文 HTML 经 driver.mockFetch 拦截（页面级 fetch mock，
 *   SPA 导航不清空），种子小说始终渲染「非受限且正文非空」详情 → 「导出小说」入口确定性可达，
 *   不再逐卡重试、更不静默跳过（AGENTS.md 测试硬约束 #5 用户可达路径 / #6 禁止同义反复断言）；
 * - 设置页/面板格式芯片用 aria-label 定位（driver.getAttribute / clickReliable）；
 * - 面板确认按钮 aria-label="开始导出"，与底部「导出小说」入口不歧义；
 * - 原生编码在浏览器不可用（显式失败，不伪造成功）——本 spec 只验证「可达路径 → 入队 →
 *   下载页出现任务」，不验证产物字节（由 Java 单测承担）。
 *
 * Oracle 溯源：期望值来自本文件 mock 规格（MOCK_NOVEL_TITLE）与 spec §7.1 的入队提示文案，
 * 不从被测实现反推。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";
import { NOVEL_EXPORT_FORMATS, NOVEL_EXPORT_FORMAT_LABELS } from "@pictelio/novel-export";

const settingsChip = (fmt: (typeof NOVEL_EXPORT_FORMATS)[number]) =>
  `小说导出格式 ${NOVEL_EXPORT_FORMAT_LABELS[fmt]}`;

/** 种子小说 ID：取超出真实 ID 区间的合成值，避免命中 IndexedDB 里的真实缓存导致 mock 失效 */
const NOVEL_ID = 999_999_999;
/** 种子小说标题——下载页任务标题的 oracle（buildNovelExportTaskDraft 透传 novel.title） */
const MOCK_NOVEL_TITLE = "E2E 导出测试小说";

/** 小说详情 mock（PixivNovelDetailResponse，最小必需字段；字段形态对齐 translation-flow 真实样例） */
const MOCK_NOVEL_DETAIL = JSON.stringify({
  novel: {
    id: NOVEL_ID,
    title: MOCK_NOVEL_TITLE,
    user: {
      id: 999999,
      name: "E2E 作者",
      account: "e2e-author",
      profile_image_urls: {},
    },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 60,
    is_bookmarked: false,
    total_bookmarks: 0,
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00+09:00",
  },
});

/**
 * /webview/v2/novel 正文 HTML mock。
 * 结构与 packages/novel-export/tests/extract.test.ts 的「真实 Pixiv HTML」样例一致
 * （window.pixiv.novel.text + seriesNavigation + images），保证三路提取都被覆盖。
 */
const MOCK_NOVEL_HTML = `<!DOCTYPE html><html><head><script>
Object.defineProperty(window, 'pixiv', { value: { sessionUserId: 123, novel: { "id": "${NOVEL_ID}", "title": "${MOCK_NOVEL_TITLE}", "text": "这是导出 E2E 种子的第一段正文。\\n\\n这是第二段正文，用于确认正文解析非空。", "seriesNavigation": {"nextNovel": null, "prevNovel": null}, "images": {"${NOVEL_ID}": {"novelImageId": "${NOVEL_ID}", "sl": "2", "urls": {"240mw": "https://example.com/240.jpg", "480mw": "https://example.com/480.jpg", "1200x1200": "https://example.com/1200.jpg", "128x128": "https://example.com/128.jpg", "original": "https://example.com/original.png"}}} } } });
</script></head><body></body></html>`;

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 小说导出", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();

    // 页面级 fetch mock（登录后注入；SPA 导航不清空）：
    // 详情 JSON + 正文 HTML，使种子小说详情始终「非受限、正文非空」。
    await driver.mockFetch("novel/detail", MOCK_NOVEL_DETAIL);
    await driver.mockFetch("webview/v2/novel", MOCK_NOVEL_HTML);

    // 设置页应存在导出卡片（全局格式的唯一配置处）
    await driver.navigateSpa("/settings");
    await driver.waitForSelector('[aria-label="小说导出格式 TXT"]', 15_000);

    // 种子小说详情：确定性渲染有正文的详情，导出入口必须出现（否则 beforeAll 失败，不放行）
    await driver.navigateSpa(`/novel/${NOVEL_ID}`);
    await driver.waitForText(MOCK_NOVEL_TITLE, 15_000);
    const hasEntry = await driver.waitForSelector('[aria-label="导出小说"]', 15_000);
    expect(hasEntry, "种子小说正文就绪后导出入口应确定性渲染（禁止静默跳过）").toBe(true);
  }, 240_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[S1] 设置页展示 9 种导出格式并可切换", async () => {
    await driver.navigateSpa("/settings");
    await driver.waitForSelector('[aria-label="小说导出格式 TXT"]', 15_000);
    for (const fmt of NOVEL_EXPORT_FORMATS) {
      const present = await driver.waitForSelector(`[aria-label="${settingsChip(fmt)}"]`, 5_000);
      expect(present, `设置页应有格式芯片：${settingsChip(fmt)}`).toBe(true);
    }

    await driver.clickReliable("EPUB", "小说导出格式 EPUB");
    await driver.waitForJs(
      "document.querySelector('[aria-label=\"小说导出格式 EPUB\"]')?.getAttribute('aria-pressed') === 'true'",
      5_000,
    );
    const pressed = await driver.getAttribute('[aria-label="小说导出格式 EPUB"]', "aria-pressed");
    expect(pressed, "点击 EPUB 后应处于选中态").toBe("true");
  }, 60_000);

  it("[S2] 详情导出：入口 → 面板 → 确认入队 → 下载页可见", async () => {
    // 种子小说详情（mock 正文非空 → 导出入口必在）
    await driver.navigateSpa(`/novel/${NOVEL_ID}`);
    const hasEntry = await driver.waitForSelector('[aria-label="导出小说"]', 15_000);
    expect(hasEntry, "小说详情应渲染导出入口（正文非空）").toBe(true);

    // 打开导出面板
    await driver.clickReliable("导出小说", "导出小说");
    const panelOpen = await driver.waitForSelector('[aria-label="开始导出"]', 10_000);
    expect(panelOpen, "点击导出入口后应出现导出面板").toBe(true);

    // 选本次格式（临时覆盖，不写回设置）
    await driver.clickReliable("EPUB", "导出格式 EPUB");
    const formatSelected = await driver.getAttribute(
      '[aria-label="导出格式 EPUB"]',
      "aria-pressed",
    );
    expect(formatSelected, "面板内 EPUB 应被选中").toBe("true");

    // 确认导出 → 入队提示（spec §7.1 文案）
    await driver.clickReliable("开始导出", "开始导出");
    const queued = await driver.waitForJs(
      "document.body.innerText.includes('已加入下载队列')",
      10_000,
    );
    expect(queued, "确认导出后应提示已加入下载队列").toBe(true);

    // 下载页应出现该导出任务（标题来自 mock 小说）
    await driver.navigateSpa("/downloads");
    const onDownloads = await driver.waitForText("下载管理", 15_000);
    expect(onDownloads, "应进入下载管理页").toBe(true);
    const pageText = await driver.pageText();
    expect(
      pageText.includes(MOCK_NOVEL_TITLE),
      `下载页应列出小说导出任务（标题：${MOCK_NOVEL_TITLE}）`,
    ).toBe(true);
  }, 90_000);
});
