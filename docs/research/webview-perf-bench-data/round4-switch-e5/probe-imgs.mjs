import { execSync } from "node:child_process";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", "tcp:9232", `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) { try { targets = await (await fetch("http://127.0.0.1:9232/json")).json(); if (targets.length) break; } catch {} await SLEEP(400); }
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
const r = await cdpEvaluate(`(() => {
  const imgs = [...document.querySelectorAll('img')];
  const srcs = imgs.map(i => (i.getAttribute('src')||'').slice(0,60));
  const cp = [...document.querySelectorAll('[class*="cursor-pointer"]')].filter(e => e.querySelector('img')).length;
  return { total: imgs.length, sample: srcs.slice(0, 12), cpWithImg: cp,
    illustLike: imgs.filter(i => /pixiv-img/.test(i.getAttribute('src')||'') && !/user-profile/.test(i.getAttribute('src')||'')).length };
})()`);
console.log(JSON.stringify(r, null, 1));
