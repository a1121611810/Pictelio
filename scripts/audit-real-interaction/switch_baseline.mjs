#!/usr/bin/env node
/**
 * 切换等待剖面基线（地图 #371 / 基线票 #372）。
 *
 * 量化「内容切换即时性」四口径（判定用 DOM 元素存在性，禁灰度 diff 判低对比度动效）：
 *   warm   暖态回访：冷启动等待就绪后切 关注/收藏（持久化恢复后的缓存口径）+ 二次回访（纯 remount 口径）
 *   toggle 插画↔小说 ContentTypeToggle 双向
 *   coldearly 冷启动后立即/延时切 tab（feedQueryPersist 恢复完成前的窗口）
 *   fresh  pm clear 真首访（无持久缓存，网络支配口径；破坏性，最后执行）
 *
 * 用法：node scripts/audit-real-interaction/switch_baseline.mjs [--serial emulator-5554] [--phases warm,toggle,coldearly,fresh]
 * 产出：scripts/audit-real-interaction/regression-out/switch_baseline_<ts>/{<phase>.json, summary.md, raw/}
 *
 * 前提与坑同 README.md：webview flavor（.MainActivityWebview）、登录态（pm clear 后走 adb input text）、
 * 模拟器对 Pixiv 卡死先 adb reboot、DPR 可能非 1（tap 坐标按 innerWidth 比例换算）。
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
function dirname(p) {
  return p.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
}

const SERIAL = argOf("--serial", "emulator-5554");
const OUT_ROOT = resolve(argOf("--out", join(SCRIPT_DIR, "regression-out")));
const PHASES = argOf("--phases", "warm,toggle,coldearly,fresh").split(",").map((s) => s.trim()).filter(Boolean);

const PKG = "io.pictelio.app";
const MAIN_ACTIVITY = ".MainActivityWebview"; // webview flavor launcher；full flavor = .MainActivity（历史误装事故）
const CDP_PORT = 9444;
// 注意：不要硬编码 tab 坐标——2026-09-06 实测本模拟器 DPR=2（视口 360×592），旧 720×1280 口径
// 硬编码坐标全部打偏（tap 落进按钮间隙，切换静默失效）。一律 navCoords() 读 rect×DPR 动态换算。
// 且 WebView 控件在窗口内有状态栏 inset（uiautomator 实测 bounds [0,72][1080,2088]，DPR=3）：
// screen = origin + css×DPR，origin 用 viewportOrigin() 标定，不能假设 (0,0)。

/** WebView 控件在屏幕上的原点（uiautomator 读 bounds；失败则按屏幕高-视口高兜底）。 */
async function viewportOrigin() {
  try {
    const dump = await adbAsync(["exec-out", "uiautomator", "dump", "/dev/tty"], 30000);
    const m = dump.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };
  } catch {
    /* 兜底 */
  }
  const size = adbSync(["shell", "wm", "size"]).match(/(\d+)x(\d+)/);
  const cssH = Number(await (async () => {
    const cdp = await Cdp.connect();
    try {
      return await cdp.eval("window.innerHeight * window.devicePixelRatio");
    } finally {
      cdp.close();
    }
  })());
  const y = Math.max(0, Math.round((Number(size[2]) - cssH) / 2));
  log(`uiautomator 失败，viewport 原点兜底 (0, ${y})`);
  return { x: 0, y };
}
let VIEWPORT = { x: 0, y: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
function argOf(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// ── adb ──────────────────────────────────────────────────────────────────────
function adbSync(args, timeout = 30000) {
  return execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8", timeout });
}
function adbAsync(args, timeout = 30000) {
  return new Promise((res, rej) => {
    execFile("adb", ["-s", SERIAL, ...args], { encoding: "utf8", timeout }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(err, { stderr }));
      else res(stdout);
    });
  });
}
async function tap(xy) {
  await adbAsync(["shell", "input", "tap", ...xy]);
}

// ── CDP（与 run_regression.mjs 同款连接方式）─────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
  }
  static async connect() {
    const pid = adbSync(["shell", "pidof", PKG]).trim().split(/\s+/)[0];
    if (!pid) throw new Error("app 未运行（无 pid）");
    adbSync(["forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
    let targets = [];
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        targets = await res.json();
        if (targets.length) break;
      } catch {
        /* socket 未就绪，重试 */
      }
      await sleep(400);
    }
    const page = targets.find((t) => t.type === "page") ?? targets[0];
    if (!page) throw new Error("无 CDP page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("CDP websocket 连接失败"));
    });
    return new Cdp(ws);
  }
  eval(expression, timeoutMs = 8000) {
    const i = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(i);
        rej(new Error("CDP eval 超时"));
      }, timeoutMs);
      this.pending.set(i, {
        res: (r) => {
          clearTimeout(timer);
          if (r?.exceptionDetails) rej(new Error("evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 300)));
          else res(r?.result?.value);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      this.ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
async function evalSafe(cdpRef, expression) {
  try {
    return await cdpRef.cdp.eval(expression);
  } catch (e) {
    log(`CDP eval 失败（${String(e.message).slice(0, 80)}），重连重试一次`);
    try {
      cdpRef.cdp?.close();
    } catch {
      /* ignore */
    }
    cdpRef.cdp = await Cdp.connect();
    return cdpRef.cdp.eval(expression);
  }
}

// ── DOM 探针（元素存在性口径）────────────────────────────────────────────────
// shellReady = /home 且侧导航就绪（6+ 按钮 = 搜索 + 4 tab + 设置）；cards 区分插画/小说；
// imgLoaded 统计已解码图片数（渐进加载上下文）。
const EXPR_STATE = `(() => {
  const q = (sel) => document.querySelectorAll(sel).length;
  let imgs = 0;
  for (const i of document.querySelectorAll('[data-testid="illust-card"] img, [data-testid="novel-card"] img')) {
    if (i.complete && i.naturalWidth > 0) imgs++;
  }
  const title = document.querySelector("h1");
  return { path: location.pathname,
           shell: q('nav button') >= 6,
           illust: q('[data-testid="illust-card"]'),
           novel: q('[data-testid="novel-card"]'),
           skeletons: q('[data-testid="skeleton-shimmer"]'),
           imgs, title: title ? title.textContent : null };
})()`;
const EXPR_TOGGLE_RECT = (key) => `(() => {
  const b = document.querySelector('[data-testid="content-type-${key}"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;
const EXPR_NAV_RECT = (label) => `(() => {
  const b = [...document.querySelectorAll("nav button")].find((x) => x.getAttribute("aria-label") === "${label}");
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

// ── 测量原语 ─────────────────────────────────────────────────────────────────
/** 轮询 EXPR_STATE 至 settle（签名相对 baseSig 变化 + isSettled + 2s 无变化）或超时。
 *  timeline 条目的 t 相对调用方传入的 t0（默认现在）——调用方若已有 tap 时刻基准必须显式传入。
 *  baseSig = tap 前 UI 签名；不传则首个样本即视为已变化（会误判旧面板为稳定，勿省）。 */
async function pollUntilSettled(cdpRef, timeline, isSettled, timeoutMs, t0 = Date.now(), baseSig = null, tapAction = null) {
  let settledAt = Date.now();
  let lastSig = "";
  let tapRetries = 0;
  for (;;) {
    let s = null;
    try {
      s = await evalSafe(cdpRef, EXPR_STATE);
    } catch {
      /* 重连中 */
    }
    if (s) timeline.push({ t: Date.now() - t0, ...s });
    const cur = timeline.at(-1);
    const sig = cur ? JSON.stringify([cur.illust, cur.novel, cur.skeletons, cur.imgs, cur.path]) : "";
    const changed = baseSig === null || (cur ? JSON.stringify([cur.illust, cur.novel, cur.skeletons, cur.imgs, cur.path]) !== baseSig : false);
    // 吞 tap 兜底（同 measureSwitch；重试前先关更新弹窗）
    if (!changed && tapAction && Date.now() - t0 > 1500 && tapRetries < 2) {
      tapRetries++;
      log(`tap 疑似被吞（1.5s 无签名变化），重试第 ${tapRetries} 次`);
      await dismissUpdateDialog(cdpRef);
      await tapAction();
      continue;
    }
    if (sig !== lastSig) {
      lastSig = sig;
      settledAt = Date.now();
    }
    if ((cur && changed && isSettled(cur) && Date.now() - settledAt > 2000) || Date.now() - t0 > timeoutMs) break;
    await sleep(110);
  }
  return t0;
}

/** 从 timeline 提取一次切换的指标（全部相对 tap 时刻 t0）。
 *  explicitBaseSig：tap 前 UI 签名（coldearly 无 pre-tap 采样，必须显式传；不传取末个负时刻样本）。 */
function extractMetrics(timeline, t0, explicitBaseSig = null) {
  const post = timeline.filter((s) => s.t >= -50).map((s) => ({ ...s, t: s.t }));
  const base = timeline.findLast((s) => s.t < 0) ?? timeline[0];
  const sigOf = (s) => `${s.illust}/${s.novel}/${s.skeletons}/${s.imgs}`;
  const baseSig = explicitBaseSig ?? sigOf(base);
  const cardsOf = (s) => (s?.illust ?? 0) + (s?.novel ?? 0);
  const firstSkeleton = post.find((s) => s.skeletons > 0);
  const firstChange = post.find((s) => sigOf(s) !== baseSig);
  const firstContent = post.find((s) => s.skeletons === 0 && cardsOf(s) > 0 && sigOf(s) !== baseSig);
  // 空白窗：出现过骨架之后，骨架=0 且 cards=0 的最长连续段
  let blankMax = 0;
  let blankStart = null;
  let sawSkeleton = false;
  for (const s of post) {
    if (s.skeletons > 0) {
      sawSkeleton = true;
      blankStart = null;
    } else if (sawSkeleton && cardsOf(s) === 0) {
      if (blankStart === null) blankStart = s.t;
      blankMax = Math.max(blankMax, s.t - blankStart);
    } else if (cardsOf(s) > 0) {
      blankStart = null;
    }
  }
  return {
    response_ms: firstSkeleton ? firstSkeleton.t : firstChange ? firstChange.t : null,
    skeleton_seen: !!firstSkeleton,
    content_ready_ms: firstContent ? firstContent.t : null,
    blank_window_max_ms: blankMax,
    base_cards: cardsOf(base),
    imgs_at_ready: firstContent?.imgs ?? null,
  };
}

async function waitFeedReady(cdpRef, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    let s = null;
    try {
      s = await evalSafe(cdpRef, EXPR_STATE);
    } catch {
      /* 重连中 */
    }
    if (s && s.shell && (s.illust >= 1 || s.novel >= 1) && s.imgs >= 1) return s;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`首页 Feed ${timeoutMs / 1000}s 未就绪（${JSON.stringify(s)}）。模拟器对 Pixiv 卡死可 adb reboot 后重跑`);
    }
    await sleep(400);
  }
}

async function ensureHome(cdpRef) {
  for (let i = 0; i < 5; i++) {
    const s = await evalSafe(cdpRef, "location.pathname");
    if (typeof s === "string" && s === "/home") break;
    await adbAsync(["shell", "input", "keyevent", "4"]);
    await sleep(1200);
  }
  return waitFeedReady(cdpRef, 90000);
}

/** CSS px → 设备 px 比例（模拟器 DPR 可能非 1）。 */
async function cssScale(cdpRef) {
  const dpr = await evalSafe(cdpRef, "window.devicePixelRatio");
  const n = Number(dpr);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 侧导航按钮（aria-label）→ 设备 px 坐标：CDP 读实际矩形中心，screen = viewport 原点 + css×DPR。 */
async function navCoords(cdpRef, label, scale) {
  const rect = await evalSafe(cdpRef, EXPR_NAV_RECT(label));
  if (!rect) throw new Error(`未找到侧导航按钮：${label}`);
  return [String(Math.round(VIEWPORT.x + rect.x * scale)), String(Math.round(VIEWPORT.y + rect.y * scale))];
}

/** 内容类型切换按钮 testid → 设备 px 坐标。 */
async function toggleCoords(cdpRef, key, scale) {
  const rect = await evalSafe(cdpRef, EXPR_TOGGLE_RECT(key));
  if (!rect) throw new Error(`未找到 content-type-${key} 按钮`);
  return [String(Math.round(VIEWPORT.x + rect.x * scale)), String(Math.round(VIEWPORT.y + rect.y * scale))];
}

// 启动更新弹窗（StartupUpdateDialog）会在冷启 ~5s 后弹出（装包版本 < 远端 release 时），
// 模态遮罩吞 tap——coldearly +3s 档三连吞的真凶。测量前必须「稍后再说」关掉。
const EXPR_UPDATE_DISMISS = `(() => {
  const hosts = [...document.querySelectorAll("button, fluent-button, *")].filter(
    (x) => x.children.length === 0 && (x.textContent || "").trim() === "稍后再说",
  );
  if (hosts.length === 0) return null;
  const el = hosts[0];
  const r = (el.getBoundingClientRect ? el : el.parentElement).getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;
async function dismissUpdateDialog(cdpRef) {
  try {
    const rect = await evalSafe(cdpRef, EXPR_UPDATE_DISMISS);
    if (!rect) return false;
    const S = await cssScale(cdpRef);
    log("检测到启动更新弹窗 → 稍后再说关闭");
    await tap([String(Math.round(VIEWPORT.x + rect.x * S)), String(Math.round(VIEWPORT.y + rect.y * S))]);
    await sleep(600);
    return true;
  } catch {
    return false;
  }
}

/** adb input text 真实键入登录（pm clear 后 CDP 设值不触发 Solid 信号，#368 实测）。
 *  坐标不硬编码（720p 时代的 360,960 在 1080p 会打偏）：DOM 矩形定位 textarea 与登录按钮，
 *  键入后校验 value 长度，最多 3 轮。 */
async function loginViaAdbInput(cdpRef) {
  log("登录：adb input text 真实键入 refresh_token…");
  const token = readFileSync(resolve(SCRIPT_DIR, "../../packages/app/.env"), "utf8")
    .match(/^PIXIV_REFRESH_TOKEN=(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error(".env 缺 PIXIV_REFRESH_TOKEN，无法自动重登");
  const S = await cssScale(cdpRef);
  const toDevice = (rect) => [String(Math.round(VIEWPORT.x + rect.x * S)), String(Math.round(VIEWPORT.y + rect.y * S))];
  const EXPR_FIELD = `(() => {
    const t = document.querySelector("fluent-textarea textarea, fluent-textarea, textarea");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`;
  const EXPR_FILLED = `(() => {
    const t = document.querySelector("fluent-textarea textarea, fluent-textarea, textarea");
    return t ? ((t.value || t.textContent || "").length > 30) : false;
  })()`;
  const EXPR_LOGIN_BTN = `(() => {
    // 必须精确匹配「登录」：includes 会命中 DOM 序靠前的「通过 Pixiv 登录」（PKCE 按钮），
    // 把 OAuth 网页拉起来导致登录流程全废（2026-09-06 实测）
    const b = [...document.querySelectorAll("button, fluent-button")].find((x) => (x.textContent || "").trim() === "登录");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`;
  const EXPR_OK_BTN = `(() => {
    const b = [...document.querySelectorAll("button, fluent-button")].find((x) => (x.textContent || "").trim().toUpperCase() === "OK");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // pixiv OAuth 隐私政策确认（若被拉起/残留）：先点 OK 清掉
    const ok = await evalSafe(cdpRef, EXPR_OK_BTN);
    if (ok) {
      await tap(toDevice(ok));
      await sleep(1200);
    }
    const field = await evalSafe(cdpRef, EXPR_FIELD);
    if (!field) throw new Error("登录页未找到 token 输入框");
    await tap(toDevice(field));
    await sleep(800);
    await adbAsync(["shell", "input", "text", token], 60000);
    await sleep(600);
    await adbAsync(["shell", "input", "keyevent", "111"]); // ESC 收起键盘
    await sleep(600);
    const filled = await evalSafe(cdpRef, EXPR_FILLED);
    if (!filled) {
      log(`第 ${attempt} 次键入未落入输入框，重试`);
      continue;
    }
    const btn = await evalSafe(cdpRef, EXPR_LOGIN_BTN);
    if (!btn) throw new Error("登录页未找到登录按钮");
    await tap(toDevice(btn));
    await sleep(5000);
    const path = await evalSafe(cdpRef, "location.pathname");
    if (path !== "/login") return;
    // 可能误入 OAuth 网页流：BACK 退回 app 登录页再重试
    await adbAsync(["shell", "input", "keyevent", "4"]);
    await sleep(1200);
    log(`第 ${attempt} 次登录后仍在 /login（输入框已确认填入；若复现请查 token 是否被轮换失效）`);
  }
}

/** 冷启动 + 登录守卫，返回 {cdpRef, waitMs}（am start → CDP 可用）。 */
async function coldStart() {
  adbSync(["shell", "am", "force-stop", PKG]);
  await sleep(800);
  const t0 = Date.now();
  try {
    adbSync(["shell", "am", "start", "-W", "-n", `${PKG}/${MAIN_ACTIVITY}`], 30000);
  } catch {
    /* -W 超时不影响后续 */
  }
  const cdpRef = { cdp: null };
  for (let i = 0; i < 60; i++) {
    try {
      cdpRef.cdp = await Cdp.connect();
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!cdpRef.cdp) throw new Error("冷启动后 CDP 60×500ms 未就绪");
  // 登录守卫：force-stop 重启可能被 401 重定向到 /login（refresh token 轮换竞态，#368 已知）
  for (let i = 0; i < 10; i++) {
    const path = await evalSafe(cdpRef, "location.pathname");
    if (path !== "/login") break;
    log("检测到 /login → cdp_login.mjs 注入…");
    spawnSync(process.execPath, [join(SCRIPT_DIR, "cdp_login.mjs"), SERIAL], { stdio: "inherit", timeout: 120000 });
    cdpRef.cdp.close();
    cdpRef.cdp = await Cdp.connect();
    if ((await evalSafe(cdpRef, "location.pathname")) === "/login") {
      log("cdp_login 未生效 → adb input text 真实键入重试…");
      await loginViaAdbInput(cdpRef);
    }
  }
  if ((await evalSafe(cdpRef, "location.pathname")) === "/login") throw new Error("登录后仍在 /login，中止");
  return { cdpRef, waitMs: Date.now() - t0 };
}

// ── 阶段实现 ─────────────────────────────────────────────────────────────────
/** 单次切换测量：tap 前先留基线样本，tap 后轮询到 settle。 */
async function measureSwitch(cdpRef, rawDir, name, tapAction, timeoutMs = 30000) {
  const timeline = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      try {
        const s = await evalSafe(cdpRef, EXPR_STATE);
        if (s) timeline.push({ t: Date.now(), ...s });
      } catch {
        /* 重连中 */
      }
      await sleep(110);
    }
  })();
  await sleep(600); // 基线样本
  const timelineAbs = timeline.length;
  const preLast = timeline[timelineAbs - 1];
  const baseSig = preLast ? `${preLast.illust}/${preLast.novel}/${preLast.skeletons}/${preLast.imgs}` : null;
  const t0 = Date.now();
  await tapAction();
  let tapRetries = 0;
  for (;;) {
    const cur = timeline.at(-1);
    const cards = (cur?.illust ?? 0) + (cur?.novel ?? 0);
    const sig = cur ? `${cur.illust}/${cur.novel}/${cur.skeletons}/${cur.imgs}` : "";
    // settle 必须以「签名相对 tap 前发生变化」为前提，否则旧面板会被误判为已稳定（coldearly r2 教训）
    const changed = baseSig === null || (sig !== "" && sig !== baseSig);
    // 吞 tap 兜底：冷启动后首发 input tap 偶发无效（实测非确定），1.5s 无变化自动重试 ≤2 次；
    // 重试前先关掉可能刚弹出的更新弹窗（其模态遮罩正是吞 tap 惯犯）
    if (!changed && Date.now() - t0 > 1500 && tapRetries < 2) {
      tapRetries++;
      log(`tap 疑似被吞（1.5s 无签名变化），重试第 ${tapRetries} 次`);
      await dismissUpdateDialog(cdpRef);
      await tapAction();
      continue;
    }
    const stable = cur && changed && cards > 0 && cur.skeletons === 0 && Date.now() - t0 > 2500;
    // 稳定窗：2s 内签名无变化
    let stableWin = true;
    for (let i = timeline.length - 1; i > 0 && timeline.at(-1).t - timeline[i - 1].t <= 2000; i--) {
      const a = timeline[i];
      const b = timeline[i - 1];
      if (`${a.illust}/${a.novel}/${a.skeletons}/${a.imgs}` !== `${b.illust}/${b.novel}/${b.skeletons}/${b.imgs}`) {
        stableWin = false;
        break;
      }
    }
    if ((stable && stableWin) || Date.now() - t0 > timeoutMs) break;
    await sleep(110);
  }
  polling = false;
  await poller;
  const rel = timeline.map((s, idx) => ({ ...s, t: s.t - t0, _abs: idx >= timelineAbs }));
  const metrics = extractMetrics(rel.filter((s) => s.t >= -600), t0, baseSig);
  if (tapRetries > 0) metrics.tap_retries = tapRetries;
  writeFileSync(join(rawDir, `${name}_timeline.json`), JSON.stringify(rel, null, 1));
  return metrics;
}

async function phaseWarm(ctx, rawDir) {
  log("── warm：冷启动→就绪→回访切换 ──");
  const { cdpRef } = await coldStart();
  const boot = await waitFeedReady(cdpRef, 90000);
  log(`首页就绪（illust=${boot.illust} imgs=${boot.imgs}）；静置 6s 让持久化恢复/后台刷新收敛`);
  await sleep(6000);
  await dismissUpdateDialog(cdpRef);
  const results = [];
  const S = await cssScale(cdpRef);
  // 四段真实切换循环（away-back）：前两段 = 持久化恢复后的首次回访口径，末段 = 会话内二次回访（纯 remount 口径）
  for (const tab of [
    { nav: "关注", label: "推荐→关注", rep: 1 },
    { nav: "收藏", label: "关注→收藏", rep: 1 },
    { nav: "推荐", label: "收藏→推荐", rep: 1 },
    { nav: "关注", label: "推荐→关注", rep: 2 },
  ]) {
    const xy = await navCoords(cdpRef, tab.nav, S);
    const m = await measureSwitch(cdpRef, rawDir, `warm_${tab.nav}_r${tab.rep}`, () => tap(xy));
    const row = { phase: "warm", switch: tab.label, rep: tab.rep, tap_xy: xy, ...m };
    results.push(row);
    log(`warm ${tab.label} r${tab.rep}: response=${m.response_ms}ms skeleton=${m.skeleton_seen} ready=${m.content_ready_ms}ms blank=${m.blank_window_max_ms}ms`);
    await sleep(1200);
  }
  writeFileSync(join(ctx.outDir, "warm.json"), JSON.stringify(results, null, 1));
}

async function phaseToggle(ctx, rawDir) {
  log("── toggle：插画↔小说 ──");
  await ensureHome(ctx.cdpRef);
  const S = await cssScale(ctx.cdpRef);
  const results = [];
  for (const [from, to] of [
    ["illust", "novel"],
    ["novel", "illust"],
  ]) {
    const xy = await toggleCoords(ctx.cdpRef, to, S);
    const m = await measureSwitch(ctx.cdpRef, rawDir, `toggle_${from}_to_${to}`, () => tap(xy));
    const row = { phase: "toggle", switch: `${from}→${to}`, tap_xy: xy, ...m };
    results.push(row);
    log(`toggle ${from}→${to}: response=${m.response_ms}ms skeleton=${m.skeleton_seen} ready=${m.content_ready_ms}ms blank=${m.blank_window_max_ms}ms`);
    await sleep(1200);
  }
  writeFileSync(join(ctx.outDir, "toggle.json"), JSON.stringify(results, null, 1));
}

async function phaseColdEarly(ctx, rawDir) {
  log("── coldearly：冷启动后立即切 tab（持久化恢复窗口）──");
  const results = [];
  for (const [rep, delayAfterShell] of [
    [1, 0],
    [2, 3000],
  ]) {
    adbSync(["shell", "am", "force-stop", PKG]);
    await sleep(800);
    const tBoot = Date.now();
    try {
      adbSync(["shell", "am", "start", "-W", "-n", `${PKG}/${MAIN_ACTIVITY}`], 30000);
    } catch {
      /* ignore */
    }
    const cdpRef = { cdp: null };
    // 从 boot 起高频轮询：先等 CDP，再等 shell 就绪，到点立即 tap
    for (;;) {
      try {
        cdpRef.cdp = await Cdp.connect();
        break;
      } catch {
        if (Date.now() - tBoot > 45000) throw new Error("冷启动 CDP 45s 未就绪");
        await sleep(300);
      }
    }
    let shellAt = null;
    for (;;) {
      let s = null;
      try {
        s = await evalSafe(cdpRef, EXPR_STATE);
      } catch {
        /* 重连 */
      }
      if (s && s.shell && s.path === "/home") {
        shellAt = Date.now();
        break;
      }
      if (Date.now() - tBoot > 60000) throw new Error("冷启动 shell 60s 未就绪");
      await sleep(100);
    }
    const bootToShell = shellAt - tBoot;
    const S = await cssScale(cdpRef);
    const followXy = await navCoords(cdpRef, "关注", S);
    if (delayAfterShell > 0) await sleep(delayAfterShell);
    // 更新弹窗在冷启 ~5s 后出现，恰好卡 +3s 档的 tap——tap 前必须关掉
    await dismissUpdateDialog(cdpRef);
    // tap 前基线签名：settle 判据要求相对它发生变化
    const preState = await evalSafe(cdpRef, EXPR_STATE);
    const baseSig = preState ? `${preState.illust}/${preState.novel}/${preState.skeletons}/${preState.imgs}` : null;
    const t0 = Date.now();
    await tap(followXy);
    const timeline = [];
    // t0 显式传入：pollUntilSettled 内已按 t0 相对化，外部不得再次相减（双重减曾致时间戳全负）
    await pollUntilSettled(
      cdpRef,
      timeline,
      (cur) => cur.illust + cur.novel > 0 && cur.skeletons === 0,
      45000,
      t0,
      baseSig,
      () => tap(followXy),
    );
    const rel = timeline;
    writeFileSync(join(rawDir, `coldearly_r${rep}_timeline.json`), JSON.stringify(rel, null, 1));
    const m = extractMetrics(rel, t0, baseSig);
    const firstSkeleton = rel.find((s) => s.t >= 0 && s.skeletons > 0);
    const firstSample = rel[0];
    const row = {
      phase: "coldearly",
      switch: `shell就绪后+${delayAfterShell}ms 切关注`,
      rep,
      delay_after_shell_ms: delayAfterShell,
      boot_to_shell_ms: bootToShell,
      // 首个采样在 tap 后 ~100ms，可能已是新面板——仅作上下文，不代表 tap 前状态
      first_sample_cards: firstSample ? firstSample.illust + firstSample.novel : null,
      ...m,
      skeleton_first_ms: firstSkeleton ? firstSkeleton.t : null,
    };
    results.push(row);
    log(`coldearly r${rep} (+${delayAfterShell}ms): shell@${bootToShell}ms firstCards=${row.first_sample_cards} skeleton=${m.skeleton_seen} ready=${m.content_ready_ms}ms blank=${m.blank_window_max_ms}ms`);
    // 收尾：等首页推荐也稳定，避免污染下一 rep
    await dismissUpdateDialog(cdpRef);
    await tap(await navCoords(cdpRef, "推荐", S));
    await waitFeedReady(cdpRef, 90000);
    cdpRef.cdp.close();
  }
  writeFileSync(join(ctx.outDir, "coldearly.json"), JSON.stringify(results, null, 1));
}

async function phaseFresh(ctx, rawDir) {
  log("── fresh：pm clear 真首访（破坏性，最后执行）──");
  adbSync(["shell", "pm", "clear", PKG]);
  await sleep(1000);
  const { cdpRef } = await coldStart();
  // pm clear 后必然 /login → coldStart 的登录守卫已处理；此处等首页首载（网络支配，记录耗时）
  const tHome0 = Date.now();
  const boot = await waitFeedReady(cdpRef, 120000);
  const homeReadyMs = Date.now() - tHome0;
  log(`真首访：推荐首载就绪 ${homeReadyMs}ms（网络支配，仅记录）`);
  await sleep(3000);
  // 更新弹窗约在进程启动 5s 后出现——等到窗口过后连关两次，防止后续 tap 撞遮罩或误触「前往下载」
  await sleep(4000);
  await dismissUpdateDialog(cdpRef);
  await dismissUpdateDialog(cdpRef);
  const S = await cssScale(cdpRef);
  const results = [];
  for (const tab of [
    { nav: "关注", label: "推荐→关注(真首访)" },
    { nav: "推荐", label: "关注→推荐(回访)" },
    { nav: "收藏", label: "推荐→收藏(真首访)" },
  ]) {
    const xy = await navCoords(cdpRef, tab.nav, S);
    const m = await measureSwitch(cdpRef, rawDir, `fresh_${tab.nav}`, () => tap(xy), 60000);
    const row = { phase: "fresh", switch: tab.label, tap_xy: xy, ...m };
    results.push(row);
    log(`fresh ${tab.label}: response=${m.response_ms}ms skeleton=${m.skeleton_seen} ready=${m.content_ready_ms}ms blank=${m.blank_window_max_ms}ms`);
    await sleep(1500);
  }
  writeFileSync(join(ctx.outDir, "fresh.json"), JSON.stringify({ home_ready_ms: homeReadyMs, switches: results }, null, 1));
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const env = {
    model: adbSync(["shell", "getprop", "ro.product.model"]).trim(),
    android: adbSync(["shell", "getprop", "ro.build.version.release"]).trim(),
    screen: adbSync(["shell", "wm", "size"]).trim().replace("Physical size: ", ""),
    density: adbSync(["shell", "wm", "density"]).trim().replace("Physical density: ", ""),
    apk_version: adbSync(["shell", "dumpsys", "package", PKG]).match(/versionName=(\S+)/)?.[1] ?? "?",
    webview_version: adbSync(["shell", "dumpsys", "package", "com.google.android.webview"]).match(/versionName=(\S+)/)?.[1] ?? "?",
  };
  const launcher = adbSync(["shell", "cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LAUNCHER", PKG]).trim().split(/\r?\n/).pop();
  if (!launcher?.includes(MAIN_ACTIVITY)) {
    console.error(`flavor 自检失败：launcher=${launcher}，需 ${MAIN_ACTIVITY}（webview flavor）`);
    process.exit(2);
  }
  log(`环境：${env.model} Android ${env.android}，APK ${env.apk_version}，WebView ${env.webview_version}，launcher OK`);

  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const outDir = join(OUT_ROOT, `switch_baseline_${ts}`);
  const rawDir = join(outDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const cdpRef = { cdp: null };
  // 安装/force-stop 后 app 可能未运行：先拉起再连 CDP
  adbSync(["shell", "am", "start", "-n", `${PKG}/${MAIN_ACTIVITY}`]);
  await sleep(2500);
  for (let i = 0; i < 20; i++) {
    try {
      cdpRef.cdp = await Cdp.connect();
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!cdpRef.cdp) throw new Error("CDP 连接失败（app 未启动或非 debug 构建）");
  VIEWPORT = await viewportOrigin();
  log(`viewport 原点 (uiautomator 标定)：(${VIEWPORT.x}, ${VIEWPORT.y})`);
  const ctx = { cdpRef, outDir };

  const runners = { warm: phaseWarm, toggle: phaseToggle, coldearly: phaseColdEarly, fresh: phaseFresh };
  const errors = {};
  for (const phase of PHASES) {
    // 前一阶段可能把 app 挤到后台（如更新弹窗误触「前往下载」拉起浏览器）——每阶段前拉回前台
    try {
      adbSync(["shell", "am", "force-stop", "com.android.chrome"]);
    } catch {
      /* 无 Chrome 时忽略 */
    }
    adbSync(["shell", "am", "start", "-n", `${PKG}/${MAIN_ACTIVITY}`]);
    await sleep(1500);
    try {
      await runners[phase](ctx, rawDir);
      // warm 之后的阶段复用当前进程 CDP；coldearly/fresh 内部自行重启 app，结束后重连
      try {
        cdpRef.cdp.close();
      } catch {
        /* ignore */
      }
      cdpRef.cdp = await Cdp.connect();
    } catch (e) {
      errors[phase] = String(e.message);
      log(`阶段 ${phase} 失败：${e.message}`);
      try {
        cdpRef.cdp.close();
      } catch {
        /* ignore */
      }
      cdpRef.cdp = await Cdp.connect();
    }
  }

  // 汇总 markdown
  const lines = [`# 切换等待剖面基线 · ${ts}`, "", `- 设备：${env.model} Android ${env.android}，APK ${env.apk_version}，WebView ${env.webview_version}`, `- 口径：DOM 元素存在性（illust-card/novel-card/skeleton-shimmer），CDP 轮询 ~110ms`, ""];
  for (const phase of PHASES) {
    const f = join(outDir, `${phase}.json`);
    lines.push(`## ${phase}`, "");
    if (!existsSync(f)) {
      lines.push(errors[phase] ? `- 阶段失败：${errors[phase]}` : "- 无数据", "");
      continue;
    }
    const data = JSON.parse(readFileSync(f, "utf8"));
    const rows = Array.isArray(data) ? data : data.switches ?? [];
    lines.push("| 切换 | rep | 响应ms | 骨架 | 内容就绪ms | 空白窗ms |", "|---|---|---|---|---|---|");
    for (const r of rows) {
      lines.push(`| ${r.switch} | ${r.rep ?? "-"} | ${r.response_ms ?? "?"} | ${r.skeleton_seen ? "有" : "无"} | ${r.content_ready_ms ?? "?"} | ${r.blank_window_max_ms} |`);
    }
    lines.push("");
  }
  writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
  log(`完成 → ${outDir}`);
  cdpRef.cdp?.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(`未预期的失败：${e.stack ?? e.message}`);
  process.exit(2);
});
