// E2b: 干净标定 —— (A) 强制 rAF 循环 2s vs gfxinfo；(B) background-position paint 动画 2s vs gfxinfo
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
  adb("forward", `tcp:9226`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) { try { targets = await (await fetch(`http://127.0.0.1:9226/json`)).json(); if (targets.length) break; } catch {} await SLEEP(400); }
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
const gfxTotal = () => Number(/Total frames rendered: (\d+)/.exec(adbShell(`dumpsys gfxinfo ${PKG} framestats`))?.[1] ?? -1);

mkdirSync("/tmp/switch-e2", { recursive: true });
const out = "/tmp/switch-e2/e2b-calibration.jsonl";
writeFileSync(out, "");
const log = (o) => { appendFileSync(out, JSON.stringify(o) + "\n"); console.log(JSON.stringify(o)); };

// 冷启动，确保无旧仪表
adbShell(`am force-stop ${PKG}`); await SLEEP(1200);
adbShell(`am start -n ${PKG}/.MainActivityWebview`); await SLEEP(12000);
for (let i = 0; i < 10; i++) { try { const t = await cdpEvaluate(`document.body.innerText.slice(0,100)`); if (/★|推荐/.test(t)) break; } catch {} await SLEEP(2500); }

// Phase A: 强制 rAF 循环（无任何样式/绘制变更）
await cdpEvaluate(`(() => { if (!window.__rafTs) { window.__rafTs = []; const loop = (ts) => { window.__rafTs.push(ts); requestAnimationFrame(loop); }; requestAnimationFrame(loop); } return "ok"; })()`);
adbShell(`dumpsys gfxinfo ${PKG} reset`);
const a0 = await cdpEvaluate(`window.__rafTs.length`);
await SLEEP(2000);
const a1 = await cdpEvaluate(`window.__rafTs.length`);
const aGfx = gfxTotal();
log({ phase: "A-raf-loop-2s", rafFired: a1 - a0, gfxinfoFrames: aGfx });

// Phase B: shimmer 同款 background-position paint 动画（关键帧复刻 base.css fluent-shimmer 200%→-200%）
await cdpEvaluate(`(() => {
  const s = document.createElement("style");
  s.id = "e2b-shimmer";
  s.textContent = "@keyframes e2shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}";
  document.head.appendChild(s);
  const d = document.createElement("div");
  d.id = "e2b-shimmer-div";
  d.style.cssText = "position:fixed;top:0;left:0;width:300px;height:120px;background:linear-gradient(90deg,#eee 25%,#fff 50%,#eee 75%);background-size:200% 100%;animation:e2shimmer 500ms linear infinite";
  document.body.appendChild(d);
  return "injected";
})()`);
adbShell(`dumpsys gfxinfo ${PKG} reset`);
const b0 = await cdpEvaluate(`window.__rafTs.length`);
await SLEEP(2000);
const b1 = await cdpEvaluate(`window.__rafTs.length`);
const bGfx = gfxTotal();
log({ phase: "B-bgpos-anim-2s", rafFired: b1 - b0, gfxinfoFrames: bGfx });

// Phase C: 对照——移除动画后静止 2s
await cdpEvaluate(`(() => { document.getElementById("e2b-shimmer-div")?.remove(); document.getElementById("e2b-shimmer")?.remove(); return "removed"; })()`);
adbShell(`dumpsys gfxinfo ${PKG} reset`);
const c0 = await cdpEvaluate(`window.__rafTs.length`);
await SLEEP(2000);
const c1 = await cdpEvaluate(`window.__rafTs.length`);
const cGfx = gfxTotal();
log({ phase: "C-static-2s", rafFired: c1 - c0, gfxinfoFrames: cGfx });
console.log("done");
