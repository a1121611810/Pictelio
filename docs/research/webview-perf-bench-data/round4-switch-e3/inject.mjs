// E3 注入器：tier a|b|c → 注入对应 CSS（幂等，按 id 替换），注入后校验
import { execSync } from "node:child_process";
const TIER = process.argv[2];
const CSS = {
  a: "*{animation:none!important;transition:none!important}",
  b: 'div[style*="fluent-shimmer"]{animation:none!important}',
  c: "img{display:none!important}",
}[TIER];
if (!CSS) { console.error("tier 必须是 a|b|c"); process.exit(1); }
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", `tcp:9227`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 10; i++) { try { targets = await (await fetch(`http://127.0.0.1:9227/json`)).json(); if (targets.length) break; } catch {} await SLEEP(300); }
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
const expr = `(() => {
  let s = document.getElementById("e3-tier");
  if (!s) { s = document.createElement("style"); s.id = "e3-tier"; document.head.appendChild(s); }
  s.textContent = ${JSON.stringify(CSS)};
  return { injected: true, sheets: document.styleSheets.length, imgCount: document.querySelectorAll("img").length };
})()`;
for (let i = 0; i < 12; i++) {
  try {
    const r = await cdpEvaluate(expr);
    console.log(`[e3-${TIER}] injected:`, JSON.stringify(r));
    process.exit(0);
  } catch (e) { await SLEEP(400); }
}
console.error(`[e3-${TIER}] 注入失败`); process.exit(1);
