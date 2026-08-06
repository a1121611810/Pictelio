#!/usr/bin/env node
// @ts-check
/**
 * Capture real-data screenshots for the Pictelio landing page (website).
 *
 * Driven by the agent-browser CLI (the project's automation stack, ADR-0034).
 * Outputs 540×960 PNGs to packages/website/public/screenshots/.
 *
 * Prerequisites:
 *   - Vite dev server running (cd packages/app && pnpm dev)
 *   - packages/app/.env with PIXIV_REFRESH_TOKEN (+ optional DEEPSEEK_API_KEY)
 *
 * Notes:
 *   - Sub-routes (/novel, /settings, /client-switch) are reached via SPA
 *     navigation (pushState) — a full page load reruns the startup flow,
 *     which redirects away from them.
 *   - The novel recommended feed is R18-only for this account by default, so
 *     the script enables the R18 / translate-R18 toggles in Settings first.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(scriptDir, "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");
const OUT_DIR = resolve(join(REPO_ROOT, "packages", "website", "public", "screenshots"));
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

const CMD_TIMEOUT = 60_000;

/** @param {string} message */
function log(message) {
  console.log(`[capture-website] ${message}`);
}

/** 运行 agent-browser CLI 命令，返回 stdout（trimmed） */
function ab(...args) {
  const result = spawnSync("agent-browser", args, {
    encoding: "utf-8",
    timeout: CMD_TIMEOUT,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `agent-browser exited ${result.status}: ${(result.stderr ?? "").trim() || (result.stdout ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析 packages/app/.env */
function loadEnv() {
  const envPath = join(APP_ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 在页面执行单行 JS 并返回结果 */
function evalJs(js) {
  try {
    const out = ab("eval", js);
    try {
      return JSON.parse(out);
    } catch {
      return out;
    }
  } catch {
    return null;
  }
}

/** 轮询 eval 直到返回的文本包含 expected */
async function waitForEval(js, expected, timeoutMs = 30_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = evalJs(js);
    if (r !== null && String(r).includes(expected)) return true;
    await sleep(1000);
  }
  log(`⚠ waitForEval 超时: ${label}`);
  return false;
}

/** 点击包含指定文本的按钮/可交互元素（注入 click，绕开 fluent 自定义元素问题） */
async function clickByText(text) {
  const js =
    `(() => { const els=[...document.querySelectorAll('button,fluent-button,[role="button"],a')]; ` +
    `const el=els.find(e=>e.textContent&&e.textContent.includes(${JSON.stringify(text)})); ` +
    `if(el){el.click();return 'clicked';} return 'not-found'; })()`;
  const r = evalJs(js);
  if (r === "clicked") return true;
  log(`⚠ clickByText("${text}") 未找到元素`);
  return false;
}

/** 点击 CSS 选择器匹配的第一个元素 */
async function clickCss(selector) {
  const r = evalJs(
    `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(el){el.click();return 'clicked';} return 'not-found'; })()`,
  );
  if (r === "clicked") return true;
  log(`⚠ clickCss("${selector}") 未找到元素`);
  return false;
}

/** 点击 aria-label 匹配的元素 */
async function clickAria(label) {
  const r = evalJs(
    `(() => { const el=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if(el){el.click();return 'clicked';} return 'not-found'; })()`,
  );
  if (r === "clicked") return true;
  log(`⚠ clickAria("${label}") 未找到元素`);
  return false;
}

/** SPA 内部导航（pushState + popstate，不重跑 startup） */
function spaNavigate(path) {
  evalJs(
    `(() => { window.history.pushState({}, '', ${JSON.stringify(path)}); ` +
      `window.dispatchEvent(new PopStateEvent('popstate')); return 'pushed'; })()`,
  );
}

/** 若页面出现年龄/风险确认弹窗则点掉 */
async function dismissConfirmDialogs() {
  const body = String(evalJs("document.body.innerText"));
  for (const label of ["已满 18 岁", "我已了解并继续"]) {
    if (body.includes(label)) {
      await clickByText(label);
      await sleep(1200);
    }
  }
}

async function main() {
  const env = loadEnv();
  const REFRESH_TOKEN = env.PIXIV_REFRESH_TOKEN || "";
  const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY || "";
  if (!REFRESH_TOKEN) {
    console.error("PIXIV_REFRESH_TOKEN 缺失（packages/app/.env）");
    process.exit(1);
  }
  if (!DEEPSEEK_API_KEY) {
    log("DEEPSEEK_API_KEY 缺失 → 跳过 AI 翻译截图（04_translate）");
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const shot = async (name) => {
    await sleep(600);
    ab("screenshot", join(OUT_DIR, name));
    log(`✓ ${name}`);
  };

  // ── 会话重置：关闭残留会话，避免 daemon 白屏/状态异常 ──
  try {
    ab("close", "--all");
  } catch {
    /* 无活跃会话 */
  }
  await sleep(1500);
  ab("open", `${BASE_URL}/login`);
  await sleep(2500);
  ab("set", "viewport", "540", "960");
  await sleep(500);

  // ── 登录：seed token + DeepSeek key，reload 触发 auth 恢复（带重试）──
  const seedJs =
    `(() => { ` +
    `localStorage.setItem('capacitor-storage_refresh_token', ${JSON.stringify(JSON.stringify(REFRESH_TOKEN))}); ` +
    `if (${JSON.stringify(Boolean(DEEPSEEK_API_KEY))}) { localStorage.setItem('capacitor-storage_ds_api_key', ${JSON.stringify(JSON.stringify(DEEPSEEK_API_KEY))}); } ` +
    `return 'seeded'; })()`;

  let loggedIn = false;
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
    log(`登录尝试 ${attempt}/3 ...`);
    const href = evalJs("location.href");
    if (!href || !String(href).includes("localhost")) {
      log("  ⚠ 会话异常，重置并重试");
      try {
        ab("close", "--all");
      } catch {}
      await sleep(1500);
      ab("open", `${BASE_URL}/login`);
      await sleep(2500);
    }
    if (evalJs(seedJs) !== "seeded") {
      log("  ⚠ seed 失败，重试");
      continue;
    }
    ab("reload");
    await sleep(4500);
    await dismissConfirmDialogs();
    await waitForEval(`location.pathname`, "/home", 20_000, "redirect to /home");
    const hasCard = await waitForEval(
      `document.querySelector('.image-card')`,
      "object",
      20_000,
      "feed cards",
    );
    if (hasCard) loggedIn = true;
    else log("  ⚠ feed 未渲染，重试");
  }
  if (!loggedIn) log("⚠ 登录未能就绪，继续（截图可能不完整）");

  // ── 01: 推荐 Feed（等待视口内图片全部加载完成再截图）──
  const feedImagesLoaded = await waitForEval(
    `(() => { const vh=window.innerHeight; const imgs=[...document.querySelectorAll('.image-card img')].filter(i => { const r=i.getBoundingClientRect(); return r.top < vh && r.bottom > 0; }); return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0) ? 'loaded' : 'pending'; })()`,
    "loaded",
    40_000,
    "feed images loaded",
  );
  if (!feedImagesLoaded) log("⚠ feed 图片未全部加载完成，按现状截图");
  await sleep(800);
  await shot("01_feed.png");

  // ── 02: 作品详情（等待详情主图加载）──
  await clickCss(".image-card");
  await sleep(3500);
  await waitForEval(
    `(() => { const imgs=[...document.querySelectorAll('img')].filter(i => { const r=i.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; }); return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0) ? 'loaded' : 'pending'; })()`,
    "loaded",
    30_000,
    "detail images loaded",
  );
  await shot("02_detail.png");

  // ── 03 + 04: 小说阅读器 + AI 翻译 ──
  // 3a. 设置页开启 R18 显示 + R18 翻译开关（推荐小说 feed 全 R18；requireAdult 要求已确认年龄）
  spaNavigate("/settings");
  await sleep(3500);
  for (const label of ["显示 R18 内容", "显示 R-18G 内容", "翻译 R18 内容", "翻译 R18G 内容"]) {
    const clicked = await clickAria(label);
    await sleep(1000);
    await dismissConfirmDialogs();
    const checked = evalJs(
      `(() => { const el=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); return el ? String(el.checked) : 'nf'; })()`,
    );
    log(`开关 ${label}: clicked=${clicked} checked=${checked}`);
  }
  log("R18 / 翻译 R18 开关已开启");

  // 3b. 搜索日文小说（推荐流为中文/全 R18，翻译入口受限）→ 捕获全年龄作品直达
  const pickJs =
    `(() => { window.__pick = null; const of = window.fetch.bind(window); ` +
    `window.fetch = (u, i) => of(u, i).then(async r => { ` +
    `try { const uu = typeof u === 'string' ? u : u.url; if (uu.includes('/search/novel')) { ` +
    `const j = await r.clone().json(); const items = (j && (j.novels || j.body)) || []; ` +
    `const arr = Array.isArray(items) ? items : []; ` +
    `const first = arr.find(n => n && n.x_restrict === 0); ` +
    `if (first && window.__pick === null) window.__pick = first.id; } } catch {} return r; }); return 'ok'; })()`;
  evalJs(pickJs);
  spaNavigate("/search?word=%E3%83%95%E3%82%A1%E3%83%B3%E3%82%BF%E3%82%B8%E3%83%BC&scope=novel");
  await sleep(8000); // 防抖 + 请求 + 捕获
  const picked = evalJs("window.__pick");
  log(`捕获到全年龄小说 id: ${picked}`);
  if (picked) {
    spaNavigate(`/novel/${picked}`);
    await sleep(4000);
  }
  const onNovel = await waitForEval(`location.pathname`, "/novel/", 15_000, "novel page");
  if (!onNovel) {
    // 兜底：点击搜索结果第一个小说卡片
    const cardSel = "div.surface-card";
    await waitForEval(
      `document.querySelectorAll(${JSON.stringify(cardSel)}).length > 0`,
      "true",
      15_000,
      "search result card",
    );
    await clickCss(cardSel);
    await sleep(4000);
  }
  const onNovel2 = await waitForEval(`location.pathname`, "/novel/", 15_000, "novel page 2");
  if (!onNovel2) {
    log("⚠ 未能进入小说页，跳过 03/04");
  } else {
    const hasTranslate = await waitForEval(
      `[...document.querySelectorAll('button,fluent-button')].map(b=>b.textContent).some(t=>t && t.includes('翻译'))`,
      "true",
      8000,
      "translate button",
    );
    if (!hasTranslate) {
      log("⚠ 该小说无可翻译入口，跳过 03/04");
    } else {
      await sleep(1500);
      await shot("03_novel.png");

      // 04: AI 翻译
      if (DEEPSEEK_API_KEY) {
        await clickByText("翻译");
        await sleep(2000);
        const sheet = await waitForEval(
          `document.querySelector('[role="dialog"]')`,
          "object",
          8000,
          "translate sheet",
        );
        if (sheet) {
          await clickByText("开始翻译");
          // R18 风险确认弹窗（S5）与可能出现的年龄弹窗
          await sleep(1500);
          await dismissConfirmDialogs();
          log("翻译进行中，等待完成（最多 2 分钟）...");
          const done = await waitForEval(
            `[...document.querySelectorAll('button')].map(b=>b.textContent).join(' ')`,
            "原文",
            120_000,
            "translation done",
          );
          if (done) {
            await sleep(1500);
            await shot("04_translate.png");
          } else {
            log("⚠ 翻译未在期限内完成，跳过 04_translate");
          }
        } else {
          log("⚠ 翻译面板未打开，跳过 04_translate");
        }
      }
    }
  }

  // ── 05: 引擎切换说明页（SPA 导航）──
  spaNavigate("/client-switch");
  await sleep(2500);
  await shot("05_client_switch.png");

  // ── 06: 设置页（SPA 导航）──
  spaNavigate("/settings");
  await sleep(3000);
  await shot("06_settings.png");

  // ── 07: 登录页（清状态）──
  evalJs(`(() => { localStorage.clear(); sessionStorage.clear(); return 'cleared'; })()`);
  ab("open", `${BASE_URL}/login`);
  await sleep(2500);
  await shot("07_login.png");

  ab("close");
  log("All screenshots captured.");
}

main().catch((error) => {
  console.error("[capture-website] Fatal:", error);
  process.exit(1);
});
