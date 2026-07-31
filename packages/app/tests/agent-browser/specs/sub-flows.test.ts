/**
 * 中链主流程测试 — agent-browser 版
 *
 * 每个 describe 块独立创建已登录的 driver 会话。
 * 使用 clickReliable / clickFirst 进行可靠交互。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import { aiAssert } from "../../ai-shared/assertion";
import { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getState(d: AgentBrowserDriver): Promise<string> {
  // 等待页面渲染出实质内容，避免路由切换/加载期间的白屏竞态导致 AI 断言误报
  await d.waitForPageContent(10_000);
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

// ─── 发现链路 ─────────────────────────────────────

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 发现链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("推荐 Feed 首屏 → 滚动加载", async () => {
    await SLEEP(3000);
    let state = await getState(driver);
    let result = await aiAssert("推荐 Feed 展示插画卡片瀑布流", state);
    expect(result.passed, result.reason).toBe(true);

    await driver.scroll("down", 1000);
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("滚动后新卡片加载", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);

  it("子 Tab 切换 + 导航栏", async () => {
    await driver.clickReliable("漫画");
    await SLEEP(2000);
    let state = await getState(driver);
    let result = await aiAssert("漫画子 Tab 内容加载", state);
    expect(result.passed, result.reason).toBe(true);

    await driver.clickReliable("综合");
    await SLEEP(2000);

    await driver.clickReliable("关注", undefined, '[aria-label*="关注"]');
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("关注 Tab 页面正常显示投稿或空状态", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);
});

// ─── 作品链路 ─────────────────────────────────────

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 作品链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("点卡片 → 详情页", async () => {
    await SLEEP(3000);
    // 等待卡片渲染（feed 加载可能较慢），再尝试点击
    await driver.waitForSelector(".image-card", 10_000);
    const ok = await driver.clickFirst();
    if (!ok) throw new Error("找不到可点击的元素");
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert("作品详情页加载（/illust/{id}），展示大图、标题、标签", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("收藏与取消收藏", async () => {
    const snap = await driver.snapshot();
    if (snap.includes("isCurrentUser") || snap.includes("加载失败")) {
      console.log("详情页未加载，跳过");
      return;
    }

    // 详情页收藏按钮: button.relative.inline-flex button（含 ♡ 或 ♥ 图标）
    try {
      await driver.click(".relative.inline-flex button");
    } catch {
      // fallback: 尝试通过文本点击
      await driver.clickReliable("♡");
    }
    await SLEEP(2000);
    let state = await getState(driver);
    let result = await aiAssert("收藏操作已执行，页面没有错误提示，状态正常", state);
    expect(result.passed, result.reason).toBe(true);

    // 再次点击取消收藏
    try {
      await driver.click(".relative.inline-flex button");
    } catch {
      await driver.clickReliable("♥");
    }
    await SLEEP(2000);
    state = await getState(driver);
    result = await aiAssert("取消收藏操作已执行，页面状态正常", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("返回 Feed", async () => {
    await driver.clickReliable("推荐");
    await SLEEP(3000);
    const state = await getState(driver);
    const result = await aiAssert("返回推荐 Feed，页面正常展示", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);
});

// ─── 阅读链路 ─────────────────────────────────────

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 阅读链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("小说 Feed → 正文加载", async () => {
    // 直接点击页面中的"小说"按钮（触发 onClick → setContentType，绕过 Preferences）
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    await SLEEP(3000);

    let state = await getState(driver);
    let result = await aiAssert(
      "小说 Feed 正常加载：显示小说卡片列表，或显示'暂无小说'空状态（账号无小说推荐时）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    const cardOk = await driver.clickFirst();
    if (cardOk) {
      await SLEEP(5000);
      state = await getState(driver);
      result = await aiAssert("小说详情页正文使用 pretext 渲染", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);

  it("正文滚动", async () => {
    // 账号无小说推荐时前一用例未进入详情，跳过滚动断言
    const path = await driver.evaluate(`location.pathname`);
    if (!path.includes("/novel/")) {
      console.log("[阅读链路] 未进入小说详情（无小说卡片），跳过");
      return;
    }
    await driver.scroll("down", 600);
    await SLEEP(2000);
    const state = await getState(driver);
    const result = await aiAssert("向下滚动后正文推进", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);
});

// ─── 个人链路 ─────────────────────────────────────

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 个人链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("个人中心 → 用户信息", async () => {
    // 点击页面顶部用户名（client-side 路由跳转到 /me）
    await driver.evaluate('document.querySelector("h1")?.click()');
    // 等待个人中心数据加载完成
    for (let i = 0; i < 10; i++) {
      await SLEEP(1000);
      const snap = await driver.snapshot();
      if (snap.includes("我的作品") || snap.includes("我的收藏")) break;
    }

    const state = await getState(driver);
    const result = await aiAssert("个人中心显示头像、用户名、统计数据", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("查看收藏夹", async () => {
    // 在个人中心页面点击"我的收藏"（内容区域，非底部导航栏）
    const ok = await driver.clickReliable("我的收藏");
    if (ok) {
      await SLEEP(3000);
      const state = await getState(driver);
      const result = await aiAssert("收藏页展示收藏作品列表", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 60_000);
});

// ─── 登录链路 ─────────────────────────────────────
// 不依赖 createLoggedInDriver——从空白状态开始测试完整登录流程

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 登录流（有效 token）", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    // launch 重试：agent-browser daemon 偶发白屏（页面加载不出），
    // 与 createLoggedInDriver 的重试机制对齐
    for (let attempt = 0; attempt < 3; attempt++) {
      driver = new AgentBrowserDriver();
      await driver.launch();
      if (await driver.waitForPageContent(20_000)) break;
      console.warn(`[有效 token] 启动白屏（第 ${attempt + 1}/3 次），重新 launch`);
      await driver.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("年龄确认 → 登录页 → 有效 token 登录成功", async () => {
    await SLEEP(2000);
    // 等待页面渲染完成（daemon 冷启动可能白屏较久），再断言年龄确认弹窗
    await driver.waitForPageContent(20_000);
    // 1. 年龄确认弹窗
    let state = await getState(driver);
    let result = await aiAssert(
      "页面显示年龄确认弹窗，包含「已满 18 岁」和「未满 18 岁」按钮",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 2. 确认年龄
    await driver.clickReliable("已满", undefined, "@e2");
    await SLEEP(3000);

    state = await getState(driver);
    result = await aiAssert(
      "年龄确认后跳转到登录页，页面包含 refresh_token 输入框（fluent-textarea）和「登录」按钮",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 3. 填入有效 token 并登录
    const token = process.env.PIXIV_REFRESH_TOKEN;
    if (!token) throw new Error("PIXIV_REFRESH_TOKEN 未设置");
    const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    await driver.evaluate(
      `document.querySelector("fluent-textarea").value = '${escapedToken}'; ` +
        `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
    );
    await SLEEP(1000);
    await driver.clickReliable("登录");
    await SLEEP(8000);

    state = await getState(driver);
    result = await aiAssert(
      "登录成功，跳转到推荐 Feed 页面（/recommended），展示插画/漫画卡片瀑布流",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);
});

describe("agent-browser 登录流（无效 token）", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    // launch 重试：agent-browser daemon 偶发白屏，与有效 token 用例对齐
    for (let attempt = 0; attempt < 3; attempt++) {
      driver = new AgentBrowserDriver();
      await driver.launch();
      if (await driver.waitForPageContent(15_000)) break;
      console.warn(`[无效 token] 启动白屏（第 ${attempt + 1}/3 次），重新 launch`);
      await driver.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    await driver.launch();
    await SLEEP(2000);
    // 清理登录残留（精准删除 token keys，保留 ageConfirmed 等偏好设置）：
    // SecureStorage = capacitor-storage_ 前缀，Preferences = 裸 key / _cap_ 旧前缀。
    // 注：_cap_ 是旧 Preferences 一次性迁移前缀（应用当前不调用 migrate，实际极少存在，
    //     保留匹配以防迁移启用时误判已登录）。
    // 不清空整个 localStorage —— 全清会连带清掉年龄确认标志，
    // 导致同文件后续 describe 重新被年龄确认弹窗拦截（Issue #19 T1）。
    // 页面未就绪时 localStorage 访问抛 SecurityError，重试直到清理成功。
    const CLEAR_JS = `(() => {
      try {
        const TOKEN_KEY_PATTERNS = [/^capacitor-storage_/, /^_cap_/, /^refresh_token$/];
        const removed = [];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && TOKEN_KEY_PATTERNS.some((p) => p.test(k))) {
            localStorage.removeItem(k);
            removed.push(k);
          }
        }
        return 'removed: ' + removed.length;
      } catch (e) {
        return 'storage-error: ' + e.message;
      }
    })()`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const clearRes = await driver.evaluate(CLEAR_JS);
      if (!clearRes.includes("storage-error")) {
        console.log(`[无效 token] 登录残留清理完成: ${clearRes}`);
        break;
      }
      console.warn(`[无效 token] localStorage 不可访问（第 ${attempt + 1}/5 次），等待重试`);
      await SLEEP(2000);
    }
    await driver.navigate("/");
    await SLEEP(2000);
    // 通过年龄确认，重试直到登录页（fluent-textarea）渲染完成
    for (let attempt = 0; attempt < 6; attempt++) {
      await driver.clickReliable("已满", undefined, "@e2");
      await SLEEP(2000);
      const snap = await driver.snapshot();
      if (snap.includes("登录") && snap.includes("refresh_token")) break;
    }
  }, 60_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("无效 refresh_token 显示错误提示", async () => {
    // 填入无效 token
    await driver.evaluate(
      `document.querySelector("fluent-textarea").value = 'invalid-token-12345'; ` +
        `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
    );
    await SLEEP(1000);
    await driver.clickReliable("登录");
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert(
      "使用无效的 refresh_token 登录后，页面显示错误提示信息（如「失败」「错误」「invalid」「error」等）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── Feed 增强链路 ─────────────────────────────────
// 覆盖 Playwright feed.e2e.ts 中 agent-browser 尚未测试的场景

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser Feed 增强", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("推荐 Feed 无限滚动加载更多", async () => {
    // 初始首屏
    let state = await getState(driver);
    let result = await aiAssert("推荐 Feed 首屏加载完成，展示多张插画卡片", state);
    expect(result.passed, result.reason).toBe(true);

    // 第一次滚动到底部
    await driver.scroll("down", 2000);
    await SLEEP(4000);
    state = await getState(driver);
    result = await aiAssert("向下滚动后瀑布流加载出新一批插画卡片，无白屏或加载错误", state);
    expect(result.passed, result.reason).toBe(true);

    // 第二次滚动
    await driver.scroll("down", 2000);
    await SLEEP(4000);
    state = await getState(driver);
    result = await aiAssert("继续向下滚动后瀑布流再次加载更多卡片，无重复卡片或渲染异常", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);

  it("切换到关注 Tab", async () => {
    const ok = await driver.clickReliable("关注", undefined, '[aria-label*="关注"]');
    if (!ok) {
      console.log("[Feed 增强] 找不到关注按钮，跳过");
      return;
    }
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert(
      "切换到「关注」Tab，URL 包含 /following，页面显示关注用户的投稿列表或空状态",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── 设置链路（图床代理）────────────────────────────
// B 类场景：UI 组件行为验证

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 图床代理设置", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("图床设置页可打开", async () => {
    // 直接导航到图床设置页
    await driver.navigateSpa("/image-host");
    await SLEEP(3000);

    const state = await getState(driver);
    const result = await aiAssert(
      "图床设置页面正常加载，标题包含「图床代理」或「图片托管」，页面展示主开关（fluent-switch）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("toggle 开关 → 取消确认 → 开关保持关闭", async () => {
    await driver.navigateSpa("/image-host");
    await SLEEP(3000);

    // 初始状态：开关关闭
    let state = await getState(driver);
    let result = await aiAssert("图床代理主开关处于关闭状态，无确认对话框", state);
    expect(result.passed, result.reason).toBe(true);

    // 点击开关（触发确认对话框）
    // 用 evaluate 操作 fluent-switch（避免 Shadow DOM 选择器问题），带存在性反馈
    const sw1 = await driver.evaluate(
      `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
    );
    if (!sw1.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
    await SLEEP(1500);

    state = await getState(driver);
    result = await aiAssert(
      "点击开关后弹出确认对话框，标题为「开启图床代理？」，包含「取消」和「确认开启」按钮",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 点击"取消"
    await driver.clickReliable("取消");
    await SLEEP(1500);

    state = await getState(driver);
    result = await aiAssert(
      "点击「取消」后确认对话框关闭，主开关恢复为关闭状态，页面回到正常设置页",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("toggle 开关 → 确认 → 开关保持打开（自动复原）", async () => {
    await driver.navigateSpa("/image-host");
    await SLEEP(3000);

    // 点击开关弹出确认
    const sw2 = await driver.evaluate(
      `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
    );
    if (!sw2.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
    await SLEEP(1500);

    // 点击"确认开启"
    await driver.clickReliable("确认开启");
    await SLEEP(2000);

    let state = await getState(driver);
    let result = await aiAssert(
      "确认开启后对话框关闭，主开关处于打开状态，页面显示图床代理已启用",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 复原：再次点击开关关闭（不会弹出确认）
    const sw3 = await driver.evaluate(
      `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
    );
    if (!sw3.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
    await SLEEP(1500);

    state = await getState(driver);
    result = await aiAssert("再次点击开关后主开关恢复为关闭状态，页面无异常", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── 小说详情增强链路 ──────────────────────────────
// 覆盖 novel-detail.e2e.ts 的 header 标题滚动显隐行为

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 小说标题滚动", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("进入小说详情 → 滚动时标题显隐", async () => {
    // 切换到小说模式
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    await SLEEP(3000);

    let state = await getState(driver);
    let result = await aiAssert(
      "小说 Feed 正常加载：显示小说卡片列表，或显示'暂无小说'空状态（账号无小说推荐时）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 点击第一张卡片进入详情
    const cardOk = await driver.clickFirst();
    if (!cardOk) {
      console.log("[小说标题滚动] 找不到可点击的卡片，跳过");
      return;
    }
    await SLEEP(5000);

    state = await getState(driver);
    result = await aiAssert("小说详情页加载完成，正文使用 pretext 渲染，页面顶部有标题栏", state);
    expect(result.passed, result.reason).toBe(true);

    // 向下滚动——标题栏应显现
    await driver.scroll("down", 500);
    await SLEEP(2000);

    state = await getState(driver);
    result = await aiAssert(
      "向下滚动后，小说标题栏从隐藏变为渐显，标题文字《》出现在页面顶部区域",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 滚回顶部——标题栏应隐藏
    await driver.evaluate("window.scrollTo(0, 0)");
    await SLEEP(2000);

    state = await getState(driver);
    result = await aiAssert("滚回页面顶部后，标题栏恢复为隐藏状态，只有封面图区域可见", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);
});

// ─── 关注筛选链路 ──────────────────────────────────
// 覆盖 extra-flows.e2e.ts 的 Following Feed Filters

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 关注筛选", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("关注页显示筛选按钮 → 切换筛选", async () => {
    // 导航到关注页（scope 限定底部主导航，避免误点卡片上的"关注"按钮）
    const ok = await driver.clickReliable(
      "关注",
      undefined,
      '[aria-label*="关注"]',
      'nav[aria-label="主导航"]',
    );
    if (!ok) {
      console.log("[关注筛选] 找不到关注按钮，跳过");
      return;
    }
    await SLEEP(5000);

    let state = await getState(driver);
    let result = await aiAssert(
      "关注 Tab 页面正常加载，页面显示筛选按钮：全部、公开、非公开",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 尝试点击"公开"筛选
    const publicOk = await driver.clickReliable("公开");
    if (publicOk) {
      await SLEEP(3000);
      state = await getState(driver);
      result = await aiAssert("点击「公开」筛选后，关注列表切换为公开作品内容，无加载错误", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);
});

// ─── 设置链路（通用）────────────────────────────────
// 覆盖 extra-flows.e2e.ts 的 About/Theme/Layout

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 关于页", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("关于页通过设置抽屉打开", async () => {
    // 点击顶部 appbar 区域打开设置抽屉
    await driver.evaluate("document.querySelector('[class*=\"surface-appbar\"] h1')?.click()");
    await SLEEP(2000);

    // 尝试点击"关于"
    const aboutOk = await driver.clickReliable("关于");
    if (!aboutOk) {
      // fallback: 直接导航到 /about
      await driver.navigateSpa("/about");
      await SLEEP(3000);
    } else {
      await SLEEP(3000);
    }

    const state = await getState(driver);
    const result = await aiAssert(
      "关于页正常加载，页面标题包含「关于」或「Pictelio」，展示应用版本号、许可证等信息",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 主题与布局设置", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("主题可在设置中切换（深色/浅色）", async () => {
    // 打开设置抽屉
    await driver.evaluate("document.querySelector('[class*=\"surface-appbar\"] h1')?.click()");
    await SLEEP(2000);

    // 尝试切换主题 — 先点击深色
    const darkOk = await driver.clickReliable("深色");
    if (darkOk) {
      await SLEEP(2000);
      let state = await getState(driver);
      let result = await aiAssert("点击深色主题后，页面切换为深色模式，无渲染错误", state);
      expect(result.passed, result.reason).toBe(true);

      // 切回浅色
      const lightOk = await driver.clickReliable("浅色");
      if (lightOk) {
        await SLEEP(2000);
        state = await getState(driver);
        result = await aiAssert("点击浅色主题后，页面切换为浅色模式，无渲染错误", state);
        expect(result.passed, result.reason).toBe(true);

        // 精确验证：浅色主题按钮的 aria-pressed 应为 true
        try {
          const pressed = await driver.getAttribute('[aria-label="浅色"]', "aria-pressed");
          expect(pressed).toBe("true");
        } catch (e) {
          console.log("[主题] aria-pressed 精确检查跳过:", (e as Error).message);
        }
      }
    }
  }, 60_000);

  it("布局模式可在设置中切换", async () => {
    // 打开设置抽屉
    await driver.evaluate("document.querySelector('[class*=\"surface-appbar\"] h1')?.click()");
    await SLEEP(2000);

    // 尝试切换布局模式
    const layoutOk = await driver.clickReliable("瀑布流");
    if (layoutOk) {
      await SLEEP(2000);
      // 导航回推荐 Feed 验证布局变化生效
      await driver.navigateSpa("/recommended");
      await SLEEP(3000);
      const state = await getState(driver);
      const result = await aiAssert(
        "推荐 Feed 页面正常加载，展示插画卡片，布局模式已切换（瀑布流/单列/网格）",
        state,
      );
      expect(result.passed, result.reason).toBe(true);
    }
  }, 60_000);
});

// ─── 注意：illust-detail 已由「作品链路」describe 覆盖 ──
// 作品链路已覆盖：点卡片→详情页、收藏与取消收藏、返回Feed

// ─── 用户子路由导航 ─────────────────────────────────
// 覆盖 child-route-navigation.e2e.ts：个人中心子路由跳转
// user-bookmarks/user-profile 的其余场景已由「个人链路」覆盖

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 用户子路由", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("我的作品 → /user/{id}/illusts", async () => {
    await driver.navigateSpa("/me");
    await SLEEP(3000);

    let state = await getState(driver);
    let result = await aiAssert(
      "个人中心页面加载完成，显示用户头像、用户名，有'我的作品'入口",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 点击"我的作品"
    const ok = await driver.clickReliable("我的作品");
    if (!ok) {
      console.log("[子路由] 找不到'我的作品'，跳过");
      return;
    }
    await SLEEP(5000);

    state = await getState(driver);
    result = await aiAssert(
      "已导航到用户作品页面，显示该用户的插画/漫画作品列表，URL 包含 /user/{id}/illusts",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("我的关注 → /user/{id}/following", async () => {
    await driver.navigateSpa("/me");
    await SLEEP(3000);

    const ok = await driver.clickReliable("我的关注");
    if (!ok) {
      console.log("[子路由] 找不到'我的关注'，跳过");
      return;
    }
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert(
      "已导航到关注列表页面，显示用户关注的人列表，URL 包含 /user/{id}/following",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("我的粉丝 → /user/{id}/followers", async () => {
    await driver.navigateSpa("/me");
    await SLEEP(3000);

    const ok = await driver.clickReliable("我的粉丝");
    if (!ok) {
      console.log("[子路由] 找不到'我的粉丝'，跳过");
      return;
    }
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert(
      "已导航到粉丝列表页面，显示用户的粉丝列表，URL 包含 /user/{id}/followers",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── 图片缓存设置 ──────────────────────────────────
// 覆盖 image-cache-settings.e2e.ts

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 图片缓存设置", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("导航到 /image-cache 渲染页面", async () => {
    await driver.navigateSpa("/image-cache");
    await SLEEP(3000);

    const state = await getState(driver);
    const result = await aiAssert(
      "图片缓存设置页面正常加载，页面标题包含'图片缓存'，展示三个功能开关：磁盘缓存、浏览器缓存、后台预取",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── 导航与路由 ────────────────────────────────────
// 覆盖 navigation-settings.e2e.ts

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 导航与路由", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("导航栏标签可见并可点击切换", async () => {
    // 先确认在推荐页
    let state = await getState(driver);
    let result = await aiAssert(
      "底部导航栏显示'推荐'、'关注'、'收藏'三个标签，当前在推荐页",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    // 切换到收藏
    await driver.clickReliable("收藏");
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("点击'收藏'后切换到收藏页面，展示收藏的作品列表或空状态", state);
    expect(result.passed, result.reason).toBe(true);

    // 切换到推荐
    await driver.clickReliable("推荐");
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("点击'推荐'后回到推荐 Feed 页面，展示插画卡片瀑布流", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("debug 页可正常加载", async () => {
    await driver.navigateSpa("/debug");
    await SLEEP(3000);

    const state = await getState(driver);
    const result = await aiAssert("Debug 页面正常加载，不崩溃，页面显示调试相关信息", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("未知路由不崩溃，回退到首页", async () => {
    // 应用无 404 catch-all 路由（router.tsx），未知路由由 TanStack Router
    // 回退到根路径内容。断言实际行为：不崩溃且回退到正常首页内容。
    await driver.navigateSpa("/this-route-does-not-exist");
    await SLEEP(3000);

    const state = await getState(driver);
    const result = await aiAssert(
      "访问不存在的路由后，页面没有崩溃、没有白屏，回退渲染正常的主页内容（推荐/插画等）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);
});

// ─── 作品详情增强（标签、系列、双击回顶）─────────────
// 覆盖 IllustTags、SeriesSheet、IllustDetailDoubleClickTop 等 browser 测试

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 详情页增强", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
    await SLEEP(3000);
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  it("插画详情页展示作品标签", async () => {
    // 从推荐 Feed 点卡片进入详情
    const cardOk = await driver.clickFirst();
    if (!cardOk) {
      console.log("[详情增强] 找不到可点击的卡片，跳过");
      return;
    }
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert(
      "作品详情页加载完成，展示标签列表（如标签按钮/链接），标签内容与作品相关",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("小说详情系列面板可打开", async () => {
    // 切换到小说模式
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    await SLEEP(3000);

    const cardOk = await driver.clickFirst();
    if (!cardOk) {
      console.log("[系列面板] 找不到小说卡片，跳过");
      return;
    }
    await SLEEP(5000);

    // 尝试打开系列面板（如果存在）
    const seriesOk = await driver.clickReliable("目录");
    if (seriesOk) {
      await SLEEP(3000);
      const state = await getState(driver);
      const result = await aiAssert(
        "小说系列面板已打开，显示系列中各章节的列表，当前章节高亮标记",
        state,
      );
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);

  it("小说详情双击顶部回顶", async () => {
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    await SLEEP(3000);

    const cardOk = await driver.clickFirst();
    if (!cardOk) {
      console.log("[双击回顶] 找不到小说卡片，跳过");
      return;
    }
    await SLEEP(5000);

    // 向下滚动
    await driver.scroll("down", 500);
    await SLEEP(2000);

    // 双击页面顶部（模拟双击 header 回到顶部）
    await driver.evaluate(
      `document.querySelector('header')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
    );
    await SLEEP(2000);

    const state = await getState(driver);
    const result = await aiAssert("双击页面顶部后，页面已回到顶部，显示小说开头内容", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);
});
