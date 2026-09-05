#!/usr/bin/env node
// E5: 修正点击目标后的 switch（点真实插画卡 IllustSingleCard）—— forward 口径重测
// 选择器：cursor-pointer 且含 src 匹配 /pixiv-img/img/ 的 artwork 图（排除 user-profile 头像）
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SERIAL = "emulator-5554";
const GROUPS = Number(process.argv[2] || "4");
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", SERIAL, ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s ${SERIAL} shell ${s}`);
function parseFrames(dump) {
  const frames = [];
  const m = dump.match(/---PROFILEDATA---\n([\s\S]*?)---PROFILEDATA---/);
  for (const line of (m ? m[1].trim().split("\n") : [])) {
    if (!/^\d+,\d+,/.test(line)) continue;
    const c = line.split(",");
    if (c.length < 22) continue;
    const n = (i) => (c[i] === "" ? 0 : Number(c[i]));
    const iv = n(2), sb = n(15), fc = n(16) || n(15), dl = n(9);
    if (!sb || sb <= iv) continue;
    frames.push({ bench: +((sb - iv) / 1e6).toFixed(2), true: +((fc - iv) / 1e6).toFixed(2), deadline: +((dl - iv) / 1e6).toFixed(2) });
  }
  return { frames, summaryTotal: Number(/Total frames rendered: (\d+)/.exec(dump)?.[1] ?? -1) };
}
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", "tcp:9231", `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) { try { targets = await (await fetch("http://127.0.0.1:9231/json")).json(); if (targets.length) break; } catch {} await SLEEP(400); }
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error("cdp timeout")), 15000); });
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r?.result?.value;
}
const FIND_ILLUST = `(() => {
  const el = [...document.querySelectorAll('[class*="cursor-pointer"]')].filter((e) => {
    const i = e.querySelector('img');
    return i && /pixiv-img/.test(i.getAttribute("src") || "") && !/user-profile/.test(i.getAttribute("src") || "");
  })[0];
  if (!el) return null;
  return { tag: el.tagName, w: Math.round(el.getBoundingClientRect().width), top: Math.round(el.getBoundingClientRect().top) };
})()`;
const CLICK_ILLUST = `(() => {
  const el = [...document.querySelectorAll('[class*="cursor-pointer"]')].filter((e) => {
    const i = e.querySelector('img');
    return i && /pixiv-img/.test(i.getAttribute("src") || "") && !/user-profile/.test(i.getAttribute("src") || "");
  })[0];
  el.click(); return "clicked-illust";
})()`;

await restart();
function readbackExpr() {
  return `(() => {
    const lt = (window.__lt || []).filter((e) => e.startTime >= (window.__ltMark || 0));
    window.__ltMark = performance.now();
    return { longtasks: lt, path: location.pathname };
  })()`;
}
async function restart() {
  adbShell(`am force-stop ${PKG}`); await SLEEP(1200);
  adbShell(`am start -n ${PKG}/.MainActivityWebview`); await SLEEP(12000);
  for (let i = 0; i < 10; i++) {
    try { const t = await cdpEvaluate(`document.body.innerText.slice(0,100)`); if (/★|推荐/.test(t)) { console.log("[e5] ready"); return; } } catch {}
    await SLEEP(2500);
  }
}
await cdpEvaluate(`(() => {
  if (window.__lt) return "already";
  window.__lt = []; window.__ltMark = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ startTime: +e.startTime.toFixed(1), duration: +e.duration.toFixed(1) }); }).observe({ entryTypes: ["longtask"] });
  return "instrumented";
})()`);

mkdirSync("/tmp/switch-e5", { recursive: true });
const outFile = resolve("/tmp/switch-e5/webview_switch_illust.jsonl");
writeFileSync(outFile, "");
const log = (o) => { appendFileSync(outFile, JSON.stringify(o) + "\n"); console.log(JSON.stringify(o)); };

for (let g = 0; g < GROUPS; g++) {
  const tgt = await cdpEvaluate(FIND_ILLUST);
  if (!tgt) throw new Error("找不到插画卡");
  // forward（修正目标）
  await cdpEvaluate(`window.__ltMark = performance.now()`);
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(250);
  await cdpEvaluate(CLICK_ILLUST);
  await SLEEP(1800);
  const fwd = parseFrames(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
  const fwdRead = await cdpEvaluate(readbackExpr());
  log({ scenario: "switch-illust", kind: "forward", group: g, target: tgt, pathAfter: fwdRead.path,
    gfxSummaryTotal: fwd.summaryTotal, frames: fwd.frames, longtasks: fwdRead.longtasks });
  // back
  await cdpEvaluate(`window.__ltMark = performance.now()`);
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(250);
  await cdpEvaluate(`(() => { history.back(); return "back"; })()`);
  await SLEEP(1800);
  const back = parseFrames(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
  const backRead = await cdpEvaluate(readbackExpr());
  log({ scenario: "switch-illust", kind: "back", group: g, pathAfter: backRead.path,
    gfxSummaryTotal: back.summaryTotal, frames: back.frames, longtasks: backRead.longtasks });
  await SLEEP(800);
}
console.log("[e5] done");
