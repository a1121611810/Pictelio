// 探针：visibilityState + 一次性 rAF 是否触发 + CSS 动画是否产生帧
import { execSync } from "node:child_process";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", `tcp:9225`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:9225/json`)).json(); if (targets.length) break; } catch {}
    await SLEEP(400);
  }
  console.log("targets:", targets.map((t) => `${t.type}:${t.title?.slice(0,30)}:${t.url?.slice(0,50)}`));
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error("cdp timeout")), 20000); });
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r?.result?.value;
}
const probe = await cdpEvaluate(`(async () => {
  const vis = document.visibilityState;
  const hasRafTs = Array.isArray(window.__rafTs);
  const rafLen = hasRafTs ? window.__rafTs.length : -1;
  const one = await Promise.race([
    new Promise((res) => requestAnimationFrame(() => res("raf-fired"))),
    new Promise((res) => setTimeout(() => res("raf-timeout-1s"), 1000)),
  ]);
  // CSS 动画驱动帧测试：注入一个 500ms transform 动画并观察 rAF 是否恢复
  const s = document.createElement("style");
  s.textContent = "@keyframes e2probe{from{transform:translateX(0)}to{transform:translateX(10px)}}";
  document.head.appendChild(s);
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;width:10px;height:10px;animation:e2probe 200ms linear 3 infinite";
  document.body.appendChild(d);
  const before = window.__rafTs ? window.__rafTs.length : -1;
  await new Promise((r) => setTimeout(r, 800));
  const after = window.__rafTs ? window.__rafTs.length : -1;
  const anims = document.getAnimations ? document.getAnimations().length : -1;
  d.remove(); s.remove();
  return { vis, hasRafTs, rafLen, oneShot: one, rafDuringCssAnim: after - before, anims };
})()`);
console.log("probe:", JSON.stringify(probe));
