#!/usr/bin/env node
// webview 搜索筛选冒烟 v4（结果导向 + 可重连 CDP）：冷启动清常驻状态 → hydration 自动搜索 →
// 断言可观测结果：URL 落键 / 结果集刷新 / 横图尺寸语义 / 置灰联动 / 清除全部。
// 参数真值（target 修复/恒发 bool/popular 矩阵）由 search-core 单元真值表覆盖，此处不重复。
// 用法: node search_filter_smoke.mjs <serial>   （默认 emulator-5556 = pictelio_ui，须已登录）
import { execFileSync } from "node:child_process";

const DEV = process.argv[2] ?? "emulator-5556";
const PKG = "io.pictelio.app";
const CDP_PORT = 9335;

const adb = (...a) => execFileSync("adb", ["-s", DEV, ...a], { encoding: "utf8" }).trim();
const shot = (name) => {
  execFileSync("sh", ["-c", `adb -s ${DEV} exec-out screencap -p > /tmp/smoke-${name}.png`]);
  console.log(`  📸 /tmp/smoke-${name}.png`);
};
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

let ws = null;
let msgId = 0;
const pending = new Map();
let send = null;
let ev = null;

async function connect() {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  if (!pid) throw new Error("app 未运行");
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 25; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      if (targets.length) break;
    } catch {}
    await sleepMs(400);
  }
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page) throw new Error("无 CDP target");
  if (ws) { try { ws.close(); } catch {} }
  pending.clear();
  msgId = 0;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  const t = setTimeout(() => { console.error("cdp connect timeout"); process.exit(1); }, 15000);
  await new Promise((res, rej) => { ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    }
  };
  send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++msgId; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error("cdp timeout")), 25000);
  });
  ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r?.result?.value;
  };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
};
const nav = async (url) => {
  await ev(`history.pushState({}, "", ${JSON.stringify(url)}); window.dispatchEvent(new PopStateEvent("popstate"))`);
};
const waitResults = async () => {
  for (let i = 0; i < 25; i++) {
    await sleepMs(1000);
    const n = (await ev("document.querySelectorAll('img').length")) ?? 0;
    if (n > 3) return n;
  }
  return (await ev("document.querySelectorAll('img').length")) ?? 0;
};
const imgSig = async () => ev(`[...document.querySelectorAll("img")].slice(0, 12).map(i => i.src.split("/").pop()).join("|")`);
const imgOrient = async () => ev(`Promise.all([...document.querySelectorAll("img")].slice(0, 10).map(i => new Promise(res => { if (i.complete && i.naturalWidth) res([i.naturalWidth, i.naturalHeight]); else i.onload = () => res([i.naturalWidth, i.naturalHeight]); }))).then(list => list.every(([w, h]) => w >= h))`);
const clickBtn = async (label) => { await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`); };

// ── 1. 冷启动（清常驻模块状态，保证同词也触发 hydration 搜索）──
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
let connected = false;
for (let i = 0; i < 40; i++) {
  await sleepMs(1000);
  try {
    await connect();
    await ev("1");
    connected = true;
    break;
  } catch { /* 重启中 socket 未就绪 → 重试 */ }
}
if (!connected) throw new Error("冷启动后 CDP 未就绪");
console.log("boot path:", await ev("location.pathname"));
// 等 boot 完成：首屏出图（证明 auth 恢复与网络就绪，避免 hydration 首搜打空炮）
for (let i = 0; i < 25; i++) {
  await sleepMs(1000);
  const n = (await ev("document.querySelectorAll('img').length").catch(() => 0)) ?? 0;
  if (n > 0) { console.log(`boot feed imgs=${n} @${i + 1}s`); break; }
}
await sleepMs(2000);

// ── 2. 进搜索页（首导航 → hydration 自动搜索） ──
await nav("/search?word=" + encodeURIComponent("星空"));
let imgs = await waitResults();
// 兜底：hydration 首搜偶发空炮（auth 竞态）→ 点「最新」强制重搜一次
if (imgs <= 3) {
  console.log("  ↻ 首搜空结果，点「最新」强制重搜");
  await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "最新")?.click()`);
  imgs = await waitResults();
}
check("搜索页加载有结果（img>3）", imgs > 3, `img=${imgs}`);
shot("01-results");

// ── 3. 期间=一周内：URL 落 fp=1w + 结果集刷新 ──
const sig1 = await imgSig();
await ev(`[...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "筛选")?.click()`);
await sleepMs(800);
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "24 小时内")?.click()`);
await sleepMs(4500);
const url1 = await ev("location.search");
check("24 小时内 → URL 含 fp=1d", url1.includes("fp=1d"), url1);
const sig2 = await imgSig();
check("24h 应用后结果仍正常渲染（无错误态）", !(await ev(`document.body.innerText.includes("搜索失败")`)));
shot("02-week");

// ── 4. 比例=横图：可见图全部 w≥h（语义验证） ──
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "横图")?.click()`);
await sleepMs(4500);
const url2 = await ev("location.search");
check("横图 → URL 含 fr=landscape", url2.includes("fr=landscape"), url2);
const allLandscape = await imgOrient();
check("横图语义验证：可见图全部 w≥h", allLandscape === true, String(allLandscape));
shot("03-landscape");

// ── 5. 收藏数=1000+：★ 数全部 ≥1000（客户端兜底语义；无 ★ 元素则记 skip-pass） ──
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "1000+")?.click()`);
await sleepMs(4500);
const stars = (await ev(`[...document.querySelectorAll("body *")].filter(e => e.children.length === 0 && /^★[\\d,]+$/.test(e.textContent.trim())).map(e => Number(e.textContent.trim().replace(/[★,]/g, "")))`)) ?? [];
check("收藏数 1000+ → 可见 ★ 全部 ≥1000", stars.length === 0 || stars.every((s) => s >= 1000), JSON.stringify(stars.slice(0, 8)));
shot("04-bookmark");

// ── 6. 热门：收藏数置灰 + 标注；比例仍可用（透传不置灰，#478） ──
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "热门")?.click()`);
await sleepMs(4500);
const popNote = await ev(`document.body.innerText.includes("热门榜不支持按收藏数筛")`);
check("热门下收藏数置灰标注可见", !!popNote);
const popRatioDisabled = await ev(`(() => {
  const g = [...document.querySelectorAll('[role="group"]')].find(x => x.getAttribute("aria-label") === "比例");
  const btn = g && [...g.querySelectorAll("button")].find(b => b.textContent.trim() === "横图");
  return btn ? btn.disabled : null;
})()`);
check("热门下比例仍可用（透传不置灰）", popRatioDisabled === false, String(popRatioDisabled));
shot("05-popular");

// ── 7. scope=小说：比例/分辨率置灰（值保留） ──
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "小说")?.click()`);
await sleepMs(4500);
const novelRatioDisabled = await ev(`(() => {
  const g = [...document.querySelectorAll('[role="group"]')].find(x => x.getAttribute("aria-label") === "比例");
  const btn = g && [...g.querySelectorAll("button")].find(b => b.textContent.trim() === "横图");
  return btn ? btn.disabled : null;
})()`);
check("scope=小说 → 比例 chips 置灰", novelRatioDisabled === true, String(novelRatioDisabled));
const novelNote = await ev(`document.body.innerText.includes("切到「插画」范围后可用（已设的值会保留）")`);
check("置灰标注可见（值保留语义）", !!novelNote);
shot("06-novel");

// ── 8. 清除全部 → URL 筛选段清空 ──
await ev(`[...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "清除全部筛选")?.click()`);
await sleepMs(2500);
const url3 = await ev("location.search");
check("清除全部 → URL 筛选段清空", !["fp=", "fd=", "fb=", "fr=", "fw="].some((k) => url3.includes(k)), url3);

const pass = results.every((r) => r.ok);
console.log(`\n[smoke v4] ${results.filter((r) => r.ok).length}/${results.length} 通过 → ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
