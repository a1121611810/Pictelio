// E4b: trace 修正后的 illust-forward（点真实插画卡）
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
adb("forward", "tcp:9233", `localabstract:webview_devtools_remote_${pid}`);
let targets = [];
for (let i = 0; i < 20; i++) { try { targets = await (await fetch("http://127.0.0.1:9233/json")).json(); if (targets.length) break; } catch {} await SLEEP(400); }
const page = targets.find((t) => t.type === "page") ?? targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const events = []; let complete = false;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === "Tracing.dataCollected") events.push(...(m.params.value || []));
  if (m.method === "Tracing.tracingComplete") complete = true; };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error("cdp timeout: " + method)), 60000); });
const evaluate = (expression) => send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }).then((r) => { if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r?.result?.value; });
// 就位：确保在 home
let p = await evaluate(`location.pathname`);
if (p !== "/home") { await evaluate(`history.back()`); await SLEEP(1500); p = await evaluate(`location.pathname`); }
console.log("[e4b] path:", p);
const CLICK = `(() => { const el = [...document.querySelectorAll('[class*="cursor-pointer"]')].filter((e) => { const i = e.querySelector('img'); return i && /pixiv-img/.test(i.getAttribute("src") || "") && !/user-profile/.test(i.getAttribute("src") || ""); })[0]; el.click(); return "clicked-illust"; })()`;
await send("Tracing.start", { categories: "devtools.timeline,toplevel,v8,blink", transferMode: "ReportEvents" });
await SLEEP(200);
console.log("[e4b] click:", await evaluate(CLICK));
await SLEEP(1500);
await send("Tracing.end");
const t0 = Date.now();
while (!complete && Date.now() - t0 < 30000) await SLEEP(200);
ws.close();
writeFileSync("/tmp/switch-e4/trace-forward-illust.json", JSON.stringify({ count: events.length, events }));
console.log(`[e4b] ${events.length} events saved`);
