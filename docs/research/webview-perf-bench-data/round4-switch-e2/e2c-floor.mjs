// E2c: 对比「连续动画帧」与「空闲后首帧」的 trueTotal 分布（验证 17-18ms 是否为空闲唤醒地板）
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; } };
const adb = (...a) => sh([ADB, "-s", "emulator-5554", ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s emulator-5554 shell ${s}`);
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  adb("forward", `tcp:9228`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 10; i++) { try { targets = await (await fetch(`http://127.0.0.1:9228/json`)).json(); if (targets.length) break; } catch {} await SLEEP(300); }
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
function parseFrames(dump) {
  const frames = [];
  const m = dump.match(/---PROFILEDATA---\n([\s\S]*?)---PROFILEDATA---/);
  for (const line of (m ? m[1].trim().split("\n") : [])) {
    if (!/^\d+,\d+,/.test(line)) continue;
    const c = line.split(",");
    if (c.length < 22) continue;
    const n = (i) => (c[i] === "" ? 0 : Number(c[i]));
    const iv = n(2), sb = n(15), fc = n(16), dl = n(9);
    if (!sb || sb <= iv) continue;
    frames.push({ bench: +((sb - iv) / 1e6).toFixed(2), true: +((fc - iv) / 1e6).toFixed(2), deadline: +((dl - iv) / 1e6).toFixed(2) });
  }
  return frames;
}
mkdirSync("/tmp/switch-e2", { recursive: true });
const out = "/tmp/switch-e2/e2c-floor.jsonl";
writeFileSync(out, "");
const log = (o) => { appendFileSync(out, JSON.stringify(o) + "\n"); console.log(JSON.stringify(o)); };

// Phase B': 连续 shimmer 动画 1.5s → 逐帧 trueTotal
await cdpEvaluate(`(() => {
  const s = document.createElement("style"); s.id = "e2c-kf";
  s.textContent = "@keyframes e2ckf{0%{background-position:200% 0}100%{background-position:-200% 0}}";
  document.head.appendChild(s);
  const d = document.createElement("div"); d.id = "e2c-d";
  d.style.cssText = "position:fixed;top:0;left:0;width:300px;height:120px;background:linear-gradient(90deg,#eee 25%,#fff 50%,#eee 75%);background-size:200% 100%;animation:e2ckf 500ms linear infinite";
  document.body.appendChild(d); return "on";
})()`);
adbShell(`dumpsys gfxinfo ${PKG} reset`);
await SLEEP(1500);
const animFrames = parseFrames(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
log({ phase: "continuous-anim-1.5s", n: animFrames.length, frames: animFrames });

// 停动画 → 空闲 3s → 单次微小失效（触发一帧）→ 该帧 trueTotal
await cdpEvaluate(`(() => { document.getElementById("e2c-d")?.remove(); document.getElementById("e2c-kf")?.remove(); return "off"; })()`);
await SLEEP(3000);
adbShell(`dumpsys gfxinfo ${PKG} reset`);
await SLEEP(300);
await cdpEvaluate(`(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;width:2px;height:2px;background:#123"; document.body.appendChild(d); setTimeout(() => d.remove(), 100); return "tickle"; })()`);
await SLEEP(1500);
const idleFrame = parseFrames(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
log({ phase: "idle-then-single-frame", n: idleFrame.length, frames: idleFrame });
console.log("done");
