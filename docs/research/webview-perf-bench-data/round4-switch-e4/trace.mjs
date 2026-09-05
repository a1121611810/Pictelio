#!/usr/bin/env node
// E4: CDP Tracing —— Tracing.start → click/back → 1.5s → Tracing.end → 收集事件存 JSON
// 用法: node trace.mjs forward|back
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s emulator-5554 shell ${s}`);

const MODE = process.argv[2] || "forward";
mkdirSync("/tmp/switch-e4", { recursive: true });

const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
adb("forward", "tcp:9229", `localabstract:webview_devtools_remote_${pid}`);
let targets = [];
for (let i = 0; i < 20; i++) {
  try { targets = await (await fetch("http://127.0.0.1:9229/json")).json(); if (targets.length) break; } catch {}
  await SLEEP(400);
}
const page = targets.find((t) => t.type === "page") ?? targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const events = [];
let complete = false;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    return;
  }
  if (m.method === "Tracing.dataCollected") events.push(...(m.params.value || []));
  if (m.method === "Tracing.tracingComplete") complete = true;
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error("cdp timeout: " + method)), 60000);
  });
const evaluate = (expression) =>
  send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }).then((r) => {
    if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r?.result?.value;
  });

// 就绪：确认在 home 且有卡
const state0 = await evaluate(`(() => ({ path: location.pathname, cards: document.querySelectorAll('[class*="cursor-pointer"]').length }))()`);
console.log("[e4] state:", JSON.stringify(state0));
if (state0.path !== "/home") { await evaluate(`history.back()`); await SLEEP(1500); }

// 预热连接完成，开始 trace
await send("Tracing.start", { categories: "devtools.timeline,toplevel,v8,blink", transferMode: "ReportEvents", traceConfig: JSON.stringify({ excluded_categories: ["devtools.timeline.frame"] }) }).catch(async () => {
  // 某些版本不接受 traceConfig，退回简单参数
  return send("Tracing.start", { categories: "devtools.timeline,toplevel,v8,blink", transferMode: "ReportEvents" });
});
await SLEEP(200); // 让 trace 稳定
const tClickWall = Date.now();
if (MODE === "forward") {
  console.log("[e4] click:", await evaluate(`(() => { const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img")); card.click(); return "clicked"; })()`));
} else {
  // 先确保在 detail 页
  const st = await evaluate(`location.pathname`);
  if (st === "/home") {
    await evaluate(`(() => { const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img")); card.click(); return "to-detail"; })()`);
    await SLEEP(2500);
    // trace 重新开始（第一段只是进详情用）
    events.length = 0;
    await send("Tracing.end");
    const t0 = Date.now();
    while (!complete && Date.now() - t0 < 30000) await SLEEP(200);
    complete = false;
    console.log("[e4] 已在 detail，重新开 trace");
    await send("Tracing.start", { categories: "devtools.timeline,toplevel,v8,blink", transferMode: "ReportEvents" });
    await SLEEP(200);
  }
  console.log("[e4] back:", await evaluate(`(() => { history.back(); return "back"; })()`));
}
await SLEEP(1500);
await send("Tracing.end");
const t0 = Date.now();
while (!complete && Date.now() - t0 < 30000) await SLEEP(200);
ws.close();

const outFile = `/tmp/switch-e4/trace-${MODE}.json`;
writeFileSync(outFile, JSON.stringify({ mode: MODE, wallClick: tClickWall, count: events.length, events }, null, 0));
console.log(`[e4] ${MODE}: ${events.length} events → ${outFile}`);
