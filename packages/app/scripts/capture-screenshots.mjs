#!/usr/bin/env node
// @ts-check
/**
 * Capture Playwright screenshots for Fastlane Google Play assets.
 *
 * Assumes the Vite dev server is already running at http://localhost:5173.
 * Outputs 1080×1920 logical-pixel PNGs to
 * fastlane/metadata/android/en-US/images/phoneScreenshots/
 * and mirrors them to zh-CN.
 */

import { chromium } from "playwright";
import { join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const OUT_EN = join(
  process.cwd(),
  "fastlane",
  "metadata",
  "android",
  "en-US",
  "images",
  "phoneScreenshots",
);
const OUT_ZH = join(
  process.cwd(),
  "fastlane",
  "metadata",
  "android",
  "zh-CN",
  "images",
  "phoneScreenshots",
);

const VIEWPORT = {
  width: 540,
  height: 960,
};
const DEVICE_SCALE_FACTOR = 2;
const REFRESH_TOKEN = "fake-refresh-token-for-screenshots";

/** @param {string} message */
function warn(message) {
  console.warn(`[capture-screenshots] ${message}`);
}

/** @param {string} message */
function log(message) {
  console.log(`[capture-screenshots] ${message}`);
}

function ensureDirs() {
  for (const dir of [OUT_EN, OUT_ZH]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Save a screenshot to en-US and mirror it to zh-CN.
 * @param {Buffer} buffer
 * @param {string} filename
 */
function saveScreenshot(buffer, filename) {
  const enPath = join(OUT_EN, filename);
  const zhPath = join(OUT_ZH, filename);
  writeFileSync(enPath, buffer);
  copyFileSync(enPath, zhPath);
  log(`Saved ${filename} (${buffer.length} bytes)`);
}

/** @returns {import("../src/api/types").PixivUser} */
function makeMockUser(id) {
  return {
    id,
    name: "Pictelio 画师",
    account: "pictelio_user",
    profile_image_urls: {
      medium: "/pixiv-img/profile.png",
      px_16x16: "/pixiv-img/profile.png",
      px_50x50: "/pixiv-img/profile.png",
      px_170x170: "/pixiv-img/profile.png",
    },
    is_followed: false,
  };
}

/** @returns {import("../src/api/types").PixivIllust} */
function makeMockIllust(id, title, width, height) {
  return {
    id,
    title,
    type: "illust",
    user: makeMockUser(100_000 + id),
    image_urls: {
      square_medium: "/pixiv-img/sample.png",
      medium: "/pixiv-img/sample.png",
      large: "/pixiv-img/sample.png",
    },
    width,
    height,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 128,
    total_comments: 12,
    total_view: 2048,
    illust_ai_type: 0,
    tags: [{ name: "sample" }, { name: "pictelio" }],
    x_restrict: 0,
    create_date: "2026-06-27T00:00:00+09:00",
    caption: "Pictelio 截图示例作品",
    meta_pages: [],
    meta_single_page: { original_image_url: "/pixiv-img/sample.png" },
  };
}

/**
 * Intercept Pixiv API requests and return mock data so the app renders real
 * screens without needing a valid Pixiv token.
 * @param {import("playwright").Page} page
 */
async function interceptApi(page) {
  // OAuth token refresh
  await page.route("**/pixiv-oauth/auth/token", async (route) => {
    log("Intercepted OAuth request; returning mock auth response");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: {
          access_token: "fake-access-token",
          refresh_token: REFRESH_TOKEN,
          user: makeMockUser(123_456),
          expires_in: 3600,
          token_type: "Bearer",
        },
      }),
    });
  });

  // Recommended feed
  await page.route("**/pixiv-api/v1/illust/recommended**", async (route) => {
    log("Intercepted recommended feed; returning mock illusts");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        illusts: [
          makeMockIllust(1001, "晨光中的少女", 800, 1200),
          makeMockIllust(1002, "夏日海边", 1200, 800),
          makeMockIllust(1003, "星空下的城市", 900, 900),
          makeMockIllust(1004, "雨中漫步", 800, 1100),
          makeMockIllust(1005, "午后红茶", 1000, 1000),
          makeMockIllust(1006, "樱花盛开", 800, 1300),
        ],
        next_url: null,
      }),
    });
  });

  // Illustration detail
  await page.route("**/pixiv-api/v1/illust/detail**", async (route) => {
    log("Intercepted illust detail; returning mock detail");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        illust: makeMockIllust(1001, "晨光中的少女", 800, 1200),
      }),
    });
  });

  // Image proxy — return a small colored placeholder PNG so cards render
  await page.route("**/pixiv-img/**", async (route) => {
    const logoPath = join(process.cwd(), "public", "logo-192x192.png");
    if (existsSync(logoPath)) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: readFileSync(logoPath),
      });
    } else {
      await route.abort("failed");
    }
  });
}

/**
 * Seed the secure-storage-backed refresh_token so the app attempts login.
 * @param {import("playwright").Page} page
 */
async function seedFakeToken(page) {
  // @aparajita/capacitor-secure-storage web implementation stores JSON-stringified
  // Values under the "capacitor-storage_" prefix.
  await page.evaluate((token) => {
    localStorage.setItem("capacitor-storage_refresh_token", JSON.stringify(token));
  }, REFRESH_TOKEN);
}

/**
 * Client-side navigate using the app's router. A full page load would cause
 * RootLayout's onMount to redirect to /recommended after auth init, so we
 * trigger navigation from within the already-mounted app.
 * @param {import("playwright").Page} page
 * @param {string} path
 */
async function clientNavigate(page, path) {
  const targetUrl = `${BASE_URL}${path}`;
  log(`Client navigating to ${path}`);
  await page.evaluate((href) => {
    const a = document.createElement("a");
    a.href = href;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, path);
  try {
    await page.waitForURL(targetUrl, { timeout: 5000 });
  } catch {
    // Router may not update the URL exactly; continue with current state.
  }
  log(`Current URL after client navigation: ${page.url()}`);
}

/**
 * Dismiss the age-gate overlay if it is present.
 * @param {import("playwright").Page} page
 */
async function dismissAgeGate(page) {
  try {
    const adultButton = page.getByRole("button", { name: "已满 18 岁" });
    await adultButton.waitFor({ state: "visible", timeout: 3000 });
    await adultButton.click();
    log("Dismissed age gate (已满 18 岁)");
    // Allow the sheet to animate closed.
    await page.waitForTimeout(500);
  } catch {
    // Age gate not present; nothing to do.
  }
}

/**
 * Capture the current viewport, logging any warning but never throwing.
 * @param {import("playwright").Page} page
 * @param {string} filename
 * @param {string} contextLabel
 */
async function safeScreenshot(page, filename, contextLabel) {
  try {
    const url = page.url();
    log(`Capturing ${filename} at ${url}`);
    const buffer = await page.screenshot({ type: "png", fullPage: false });
    saveScreenshot(buffer, filename);
  } catch (error) {
    const err = /** @type {Error} */ (error);
    warn(`Failed to capture ${filename} (${contextLabel}): ${err.message}`);
  }
}

/**
 * Perform a full page navigation. Used for the initial app load and for the
 * login page where a fresh auth state is required.
 * @param {import("playwright").Page} page
 * @param {string} url
 */
async function fullNavigate(page, url) {
  try {
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
    log(`Navigation complete: ${page.url()}`);
  } catch (error) {
    warn(`Navigation to ${url} failed: ${error.message}; retrying with load`);
    try {
      await page.goto(url, { waitUntil: "load", timeout: 10_000 });
      log(`Retry navigation complete: ${page.url()}`);
    } catch (retryError) {
      warn(
        `Retry navigation to ${url} also failed: ${retryError.message}; current url: ${page.url()}`,
      );
    }
  }
}

/**
 * Wait briefly, dismiss age gate, run an optional pre-capture hook, and
 * capture the current viewport. Never throws.
 * @param {import("playwright").Page} page
 * @param {string} filename
 * @param {string} contextLabel
 * @param {(page: import("playwright").Page) => Promise<void>} [beforeCapture]
 */
async function captureCurrent(page, filename, contextLabel, beforeCapture) {
  await dismissAgeGate(page);

  if (beforeCapture) {
    try {
      await beforeCapture(page);
    } catch (error) {
      const err = /** @type {Error} */ (error);
      warn(`Pre-capture step failed for ${filename}: ${err.message}`);
    }
  }

  await safeScreenshot(page, filename, contextLabel);
}

async function main() {
  ensureDirs();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();

  log(`Using base URL: ${BASE_URL}`);

  await interceptApi(page);

  // Seed token and load the app once so RootLayout can complete auth init
  // Before we capture authenticated routes.
  await fullNavigate(page, `${BASE_URL}/login`);
  await seedFakeToken(page);
  // Reload so the app reads the seeded token and completes initializeAuth.
  await page.reload({ waitUntil: "networkidle", timeout: 10_000 });
  log(`App loaded at: ${page.url()}`);

  // If auth redirect didn't fire (Login.tsx onMount ran before auth completed),
  // Navigate to /recommended manually.
  if (page.url().includes("/login")) {
    log("Auth redirect did not fire automatically; navigating to /recommended");
    await page.goto(`${BASE_URL}/recommended`, { waitUntil: "networkidle", timeout: 10_000 });
    log(`After manual navigation: ${page.url()}`);
  }

  // 01 — Feed
  await captureCurrent(page, "01_feed.png", "/recommended", async (p) => {
    // Wait for either skeleton placeholders or actual feed cards to appear.
    const feedLocator = p.locator(
      '[role="feed"], .skeleton-card, .image-card, article, .virtual-feed',
    );
    try {
      await feedLocator.first().waitFor({ state: "visible", timeout: 7000 });
    } catch {
      // Fall back to a short settling delay.
      await p.waitForTimeout(3000);
    }
  });

  // 02 — Detail
  await clientNavigate(page, "/illust/1001");
  await captureCurrent(page, "02_detail.png", "/illust/1001", async (p) => {
    // Detail page is mostly static once its own data resolves.
    await p.waitForTimeout(2500);
  });

  // 03 — Settings sheet
  // Ensure we're on a page with the settings button
  if (!page.url().includes("/recommended") && !page.url().includes("/following")) {
    await page.goto(`${BASE_URL}/recommended`, { waitUntil: "networkidle", timeout: 10_000 });
  }
  await captureCurrent(page, "03_settings.png", "/recommended", async (p) => {
    await dismissAgeGate(p);
    const settingsButton = p.locator('header button[aria-label="设置"]').first();
    await settingsButton.waitFor({ state: "visible", timeout: 5000 });
    await settingsButton.click();
    // Wait for the settings sheet header to render.
    await p.locator("text=设置").first().waitFor({ state: "visible", timeout: 5000 });
    await p.waitForTimeout(500);
    // Scroll to the 账号与数据 section if it exists.
    const accountSection = p.locator("text=账号与数据").first();
    try {
      await accountSection.scrollIntoViewIfNeeded({ timeout: 3000 });
      await p.waitForTimeout(500);
    } catch {
      // Ignore if section not found; capture current view.
    }
  });

  // 04 — Login (capture from a clean, logged-out state)
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await fullNavigate(page, `${BASE_URL}/login`);
  await captureCurrent(page, "04_login.png", "/login", async (p) => {
    // Wait for the login form to render — look for the "Pictelio" heading text
    try {
      await p
        .locator('h1:has-text("Pictelio")')
        .first()
        .waitFor({ state: "visible", timeout: 7000 });
    } catch {
      // Fallback: wait for any form element
      await p
        .locator("form")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => {});
    }
    await p.waitForTimeout(1000);
  });

  await context.close();
  await browser.close();

  log("Screenshot capture complete.");
}

main().catch((error) => {
  console.error("[capture-screenshots] Fatal error:", error);
  process.exit(1);
});
