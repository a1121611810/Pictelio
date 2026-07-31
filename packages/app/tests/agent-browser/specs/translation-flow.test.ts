/**
 * 翻译流程 E2E — agent-browser 版
 *
 * 覆盖「设置页配置 key → 小说详情页翻译 → 译文注入 → 原文/译文切换」链路
 * （S1-S7 回归防护：注入点 displayBlocks、底部翻译按钮、面板、切换）。
 *
 * 翻译请求通过 driver.mockFetch 拦截（返回固定译文），不依赖真实 DEEPSEEK_API_KEY、
 * 不产生真实 token 费用（AGENTS.md：依赖外部状态的路径用 mockFetch 构造）。
 *
 * 依赖：
 * - PIXIV_REFRESH_TOKEN：详情页/设置页受登录守卫保护，无 token 时跳过
 * - 小说 Feed 需有可点击的卡片（账号无小说推荐时跳过翻译断言）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentBrowserDriver } from "../driver";
import { createLoggedInDriver } from "../fixtures";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DeepSeek chat.completion 响应（官方 schema 样例，固定 10 段译文供对齐） */
const MOCK_TRANSLATE_RESPONSE = JSON.stringify({
  id: "chatcmpl-e2e-translate",
  object: "chat.completion",
  created: 1770000000,
  model: "deepseek-v4-flash",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: [
          "这是第一段的译文。",
          "这是第二段的译文。",
          "这是第三段的译文。",
          "这是第四段的译文。",
          "这是第五段的译文。",
          "这是第六段的译文。",
          "这是第七段的译文。",
          "这是第八段的译文。",
          "这是第九段的译文。",
          "这是第十段的译文。",
        ].join("\n\n"),
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
});

const DEEPSEEK_PATTERN = "api.deepseek.com/chat/completions";
const TRANSLATED_MARKER = "这是第一段的译文";

/** 小说详情 mock（PixivNovelDetailResponse，最小必需字段） */
const MOCK_NOVEL_DETAIL = JSON.stringify({
  novel: {
    id: 20814743,
    title: "E2E 翻译测试小说",
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

/** 小说正文 mock（/webview/v2/novel 返回 HTML，内含 "text" 字段，\n 分隔段落） */
const MOCK_NOVEL_HTML =
  'window.pixiv = { novel: { "text": "ある日のこと、図書館で本を読んでいた。\\n隣に座った少女が声をかけてきた。\\n二人は一緒に物語を読み始めた。" } }';

/** 通过 evaluate 点击文本匹配的按钮（兼容原生 button 与 fluent-button） */
async function clickButtonByText(driver: AgentBrowserDriver, text: string): Promise<boolean> {
  const js = `(() => {
    const btn = [...document.querySelectorAll('button, fluent-button, [role="button"]')]
      .find((el) => el.textContent && el.textContent.includes('${text}'));
    if (btn) { btn.click(); return 'clicked'; }
    return 'not-found';
  })()`;
  const result = await driver.evaluate(js);
  try {
    return JSON.parse(result) === "clicked";
  } catch {
    return false;
  }
}

/** 页面是否包含文本（innerText 检查） */
async function pageHasText(driver: AgentBrowserDriver, text: string): Promise<boolean> {
  try {
    const t = await driver.evaluate(`document.body.innerText.includes('${text}') ? 'yes' : 'no'`);
    return t.includes("yes");
  } catch {
    return false;
  }
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 翻译流程", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    // 注入请求 mock（页面级 fetch 拦截；SPA 导航不清空）：
    // 1) 翻译请求（DeepSeek，返回固定译文）
    // 2) 小说详情 / 正文（不依赖账号小说推荐，完全自包含）
    await driver.mockFetch(DEEPSEEK_PATTERN, MOCK_TRANSLATE_RESPONSE);
    await driver.mockFetch("novel/detail", MOCK_NOVEL_DETAIL);
    await driver.mockFetch("webview/v2/novel", MOCK_NOVEL_HTML);

    // ── 进入设置页配置 key（SPA 导航直达 /settings，绕过启动导航覆盖） ──
    await driver.navigateSpa("/settings");
    await SLEEP(2000);

    // 等待「翻译设置」分组出现
    let onSettings = false;
    for (let i = 0; i < 10; i++) {
      if (await pageHasText(driver, "翻译设置")) {
        onSettings = true;
        break;
      }
      await SLEEP(1500);
    }
    expect(onSettings, "应进入设置页并显示「翻译设置」分组").toBe(true);

    // 填写 API key 并保存（evaluate 注入 input 值 + input 事件；保存按钮轮询重试）
    let keySaved = false;
    for (let i = 0; i < 5 && !keySaved; i++) {
      await driver.evaluate(
        `(() => {
          const inp = document.querySelector('input[placeholder="sk-..."]');
          if (!inp) return 'no-input';
          inp.value = 'sk-e2e-test';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return 'filled';
        })()`,
      );
      await SLEEP(800);
      keySaved = await clickButtonByText(driver, "保存");
      if (!keySaved) {
        await SLEEP(1500);
      }
    }
    expect(keySaved, "设置页应能找到「保存」按钮").toBe(true);
    await SLEEP(1500);

    // ── 进入 mock 小说详情页（SPA 导航，绕过启动导航覆盖） ──
    await driver.navigateSpa("/novel/20814743");
    await SLEEP(4000);
  }, 240_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("详情页翻译：译文注入正文并可切回原文", async () => {
    const path = await driver.evaluate(`location.pathname`);
    if (!path.includes("/novel/")) {
      console.log("[翻译流程] 未进入小说详情，跳过");
      return;
    }
    // 等待详情渲染（mock 标题出现）
    let rendered = false;
    for (let i = 0; i < 10; i++) {
      if (await pageHasText(driver, "E2E 翻译测试小说")) {
        rendered = true;
        break;
      }
      await SLEEP(1500);
    }
    if (!rendered) {
      const t = await driver
        .evaluate(`document.body.innerText.slice(0, 600)`)
        .catch(() => "(eval failed)");
      console.log("[翻译流程] 详情页未渲染，页面文本:", JSON.stringify(t));
      const p = await driver.evaluate(`location.pathname`).catch(() => "(?)");
      console.log("[翻译流程] 当前路径:", p);
    }
    expect(rendered, "mock 小说详情应渲染（标题可见）").toBe(true);
    // 点击底部「翻译」按钮 → 面板弹出
    const opened = await clickButtonByText(driver, "翻译");
    expect(opened, "底部工具栏应能找到「翻译」按钮").toBe(true);
    await SLEEP(1500);

    // 点击「开始翻译」（mock 立即返回译文）
    const started = await clickButtonByText(driver, "开始翻译");
    expect(started, "翻译面板应能找到「开始翻译」按钮").toBe(true);

    // 等待译文注入（mock 响应 + 渐进注入）
    let injected = false;
    for (let i = 0; i < 15; i++) {
      await SLEEP(2000);
      if (await pageHasText(driver, TRANSLATED_MARKER)) {
        injected = true;
        break;
      }
    }
    expect(injected, "正文应注入 mock 译文（第一段译文 marker）").toBe(true);

    // 切回原文：底部按钮变为「原文」（译文模式下）
    const toggled = await clickButtonByText(driver, "原文");
    expect(toggled, "译文模式下底部应显示「原文」切换按钮").toBe(true);
    await SLEEP(1500);
    expect(await pageHasText(driver, TRANSLATED_MARKER), "切回原文后译文 marker 应消失").toBe(false);
  }, 120_000);
});
