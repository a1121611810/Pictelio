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
    // CLI 对表达式结果做 JSON.stringify；尝试解析
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

  // ── 启动会话 + 手机视口 ──
  ab("open", `${BASE_URL}/login`);
  await sleep(2000);
  ab("set", "viewport", "540", "960");
  await sleep(500);

  // ── seed token + DeepSeek key，reload 触发 auth 自动恢复 ──
  const seedJs =
    `(() => { ` +
    `localStorage.setItem('capacitor-storage_refresh_token', ${JSON.stringify(JSON.stringify(REFRESH_TOKEN))}); ` +
    `if (${JSON.stringify(Boolean(DEEPSEEK_API_KEY))}) { localStorage.setItem('capacitor-storage_ds_api_key', ${JSON.stringify(DEEPSEEK_API_KEY)}); } ` +
    `return 'seeded'; })()`;
  evalJs(seedJs);
  log("Token seeded; reloading ...");
  ab("reload");
  await sleep(3000);

  // 等待主界面（/home 或已登录特征）
  const onHome = await waitForEval(
    `location.pathname`,
    "/home",
    25_000,
    "redirect to /home",
  );
  if (!onHome) {
    const path = evalJs("location.pathname");
    log(`当前路径: ${path}，尝试直接导航 /home`);
    ab("open", `${BASE_URL}/home`);
    await sleep(3000);
  }
  // 年龄确认（若出现）
  const ageGate = await waitForEval(
    `document.body.innerText`,
    "已满 18 岁",
    4000,
    "age gate",
  );
  if (ageGate) {
    await clickByText("已满 18 岁");
    await sleep(1500);
  }

  // ── 01: 推荐 Feed ──
  if (!(await waitForEval(`document.querySelector('.image-card')`, "object", 25_000, "feed cards"))) {
    log("⚠ feed 卡片未出现");
  }
  await sleep(2500); // 图片加载
  await shot("01_feed.png");

  // ── 02: 作品详情 ──
  await clickCss(".image-card");
  await sleep(3500);
  await shot("02_detail.png");

  // ── 03: 小说阅读器 ──
  ab("open", `${BASE_URL}/home`);
  await sleep(2500);
  await clickByText("小说");
  await sleep(3000);
  const novelCardSel = 'div[class*="cursor-pointer"][class*="rounded-[var(--borderRadiusLarge)]"]';
  if (!(await waitForEval(`document.querySelector(${JSON.stringify(novelCardSel)})`, "object", 20_000, "novel card"))) {
    log("⚠ 小说卡片未出现");
  } else {
    await sleep(1200);
    await clickCss(novelCardSel);
    await sleep(4000);
    await shot("03_novel.png");

    // ── 04: AI 翻译对照 ──
    if (DEEPSEEK_API_KEY) {
      await clickByText("翻译");
      await sleep(2000);
      const sheet = await waitForEval(`document.querySelector('[role="dialog"]')`, "object", 8000, "translate sheet");
      if (sheet) {
        await clickByText("开始翻译");
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

  // ── 05: 引擎切换说明页 ──
  ab("open", `${BASE_URL}/client-switch`);
  await sleep(2500);
  await shot("05_client_switch.png");

  // ── 06: 设置页 ──
  ab("open", `${BASE_URL}/settings`);
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
