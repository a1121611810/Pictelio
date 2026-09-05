#!/usr/bin/env node
// E2: 页面内 rAF 计数 + longtask 观测（switch 场景标定）
// 流程复刻 bench switchCmd（点击目标/时序一致），叠加 CDP 注入仪表。
// 输出 /tmp/switch-e2/webview_switch_e2.jsonl
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const CDP_PORT = 9224;
const SERIAL = "emulator-5554";
const OUT = "/tmp/switch-e2";
const GROUPS = Number(process.argv[2] || "4");
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => {
  try { return execSync(c, { encoding: "utf8", maxBuffer: 64e6 }).trim(); } catch { return ""; }
};
const adb = (...a) => sh([ADB, "-s", SERIAL, ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s ${SERIAL} shell ${s}`);

// ── framestats 解析：bench 口径(c[15]=SwapBuffers) + 真实口径(c[16]=FrameCompleted) ──
function parseFrames(dump) {
  const frames = [];
  const m = dump.match(/---PROFILEDATA---\n([\s\S]*?)---PROFILEDATA---/);
  const rows = m ? m[1].trim().split("\n") : [];
  for (const line of rows) {
    if (!/^\d+,\d+,/.test(line)) continue;
    const c = line.split(",");
    if (c.length < 22) continue;
    const n = (i) => (c[i] === "" ? 0 : Number(c[i]));
    const iv = n(2), hs = n(5), dl = n(9), sb = n(15), fc = n(16), gp = n(19);
    if (!sb || sb <= iv) continue;
    frames.push({
      intendedVsync: iv,
      benchTotalMs: +((sb - iv) / 1e6).toFixed(2),   // bench 现状口径
      trueTotalMs: +((fc - iv) / 1e6).toFixed(2),    // AOSP summary 口径
      deadlineMs: +((dl - iv) / 1e6).toFixed(2),
      swapTailMs: +((fc - sb) / 1e6).toFixed(2),
      gpuTailMs: +((gp - sb) / 1e6).toFixed(2),
    });
  }
  const total = Number(/Total frames rendered: (\d+)/.exec(dump)?.[1] ?? NaN);
  return { frames, summaryTotal: total };
}

// ── CDP（bench 同款：每次新建连接） ──
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  if (!pid) throw new Error("app 未运行");
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      if (targets.length) break;
    } catch {}
    await SLEEP(400);
  }
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page) throw new Error("无 CDP target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id; pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => rej(new Error("cdp timeout")), 15000);
    });
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r?.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text}`);
  return r?.result?.value;
}

async function restartApp() {
  adbShell(`am force-stop ${PKG}`);
  await SLEEP(1200);
  adbShell(`am start -n ${PKG}/.MainActivityWebview`);
  await SLEEP(12000);
  for (let i = 0; i < 10; i++) {
    try {
      const t = await cdpEvaluate(`document.body.innerText.slice(0, 200).replace(/\\n/g, " ")`);
      if (t && /★|♥|推荐/.test(t)) { console.log(`[e2] 应用就绪（${i + 1} 轮）`); return; }
    } catch {}
    await SLEEP(2500);
  }
  console.log("[e2] 就绪判定超时，继续");
}

const INSTRUMENT = `(() => {
  if (window.__e2Installed) return "already";
  window.__e2Installed = true;
  window.__rafTs = [];               // rAF 回调时间戳（time origin 起）
  window.__rafMark = 0;              // 上次读回的切片位置
  window.__lt = [];                  // longtask {startTime,duration}
  window.__ltMarkTime = 0;           // 上次读回的时刻
  window.__clickT = null;
  const loop = (ts) => { window.__rafTs.push(ts); window.__rafMark = window.__rafTs.length; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__lt.push({ startTime: +e.startTime.toFixed(1), duration: +e.duration.toFixed(1) });
  }).observe({ entryTypes: ["longtask"] });
  return "instrumented";
})()`;

const MARK = `(() => {
  window.__rafMark = window.__rafTs.length;
  window.__ltMarkTime = performance.now();
  window.__clickT = null;
  return { rafMark: window.__rafMark, ltMark: window.__ltMarkTime };
})()`;

const READBACK = `(() => {
  const rafSlice = window.__rafTs.slice(window.__rafMark);
  const ltSlice = window.__lt.filter((e) => e.startTime >= window.__ltMarkTime);
  window.__rafMark = window.__rafTs.length;
  window.__ltMarkTime = performance.now();
  const deltas = rafSlice.slice(1).map((t, i) => +(t - rafSlice[i]).toFixed(1));
  return {
    rafCount: rafSlice.length,
    rafFirst: rafSlice.length ? +rafSlice[0].toFixed(1) : null,
    rafLast: rafSlice.length ? +rafSlice[rafSlice.length - 1].toFixed(1) : null,
    rafDeltaP50: deltas.length ? deltas.toSorted((a,b)=>a-b)[Math.floor(deltas.length/2)] : null,
    rafDeltaMax: deltas.length ? Math.max(...deltas) : null,
    rafGapOver50: deltas.filter((d) => d > 50).length,
    longtasks: ltSlice,
    path: location.pathname,
  };
})()`;

mkdirSync(OUT, { recursive: true });
const outFile = resolve(OUT, "webview_switch_e2.jsonl");
writeFileSync(outFile, "");

await restartApp();
console.log("[e2] 注入仪表…");
console.log("[e2] instrument:", await cdpEvaluate(INSTRUMENT));

// ── Phase 1: 静态 home 标定（强制 rAF 循环下 gfxinfo 能否看到内容帧） ──
{
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await cdpEvaluate(MARK);
  await SLEEP(2000);
  const dump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
  const { frames, summaryTotal } = parseFrames(dump);
  const raf = await cdpEvaluate(READBACK);
  const rec = { phase: "static-home-2s", summaryTotal, profileRows: frames.length,
    benchFrames: frames.map((f) => f.benchTotalMs), trueFrames: frames.map((f) => f.trueTotalMs), ...raf };
  appendFileSync(outFile, JSON.stringify(rec) + "\n");
  console.log("[e2] static-home:", JSON.stringify(rec));
}

// ── Phase 2: switch 组 ──
for (let g = 0; g < GROUPS; g++) {
  const href = await cdpEvaluate(`(() => {
    const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img"));
    return card ? "card" : "none";
  })()`);
  if (href === "none") throw new Error("首页无可点击图片卡");
  // forward
  await cdpEvaluate(MARK);
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(250);
  await cdpEvaluate(`(() => { const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img")); card.click(); return "clicked"; })()`);
  await SLEEP(1800);
  const fwdDump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
  const fwdGfx = parseFrames(fwdDump);
  const fwdRaf = await cdpEvaluate(READBACK);
  const fwd = { scenario: "switch-e2", kind: "forward", group: g, gfxSummaryTotal: fwdGfx.summaryTotal,
    gfxProfileRows: fwdGfx.frames.length, gfxFrames: fwdGfx.frames, ...fwdRaf };
  appendFileSync(outFile, JSON.stringify(fwd) + "\n");
  console.log(`  g${g} fwd: gfxSummary=${fwdGfx.summaryTotal} rows=${fwdGfx.frames.length} raf=${fwdRaf.rafCount} lt=${JSON.stringify(fwdRaf.longtasks)} trueTotals=${fwdGfx.frames.map((f) => f.trueTotalMs)}`);
  // back
  await cdpEvaluate(MARK);
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(250);
  await cdpEvaluate(`(() => { history.back(); return "back"; })()`);
  await SLEEP(1800);
  const backDump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
  const backGfx = parseFrames(backDump);
  const backRaf = await cdpEvaluate(READBACK);
  const back = { scenario: "switch-e2", kind: "back", group: g, gfxSummaryTotal: backGfx.summaryTotal,
    gfxProfileRows: backGfx.frames.length, gfxFrames: backGfx.frames, ...backRaf };
  appendFileSync(outFile, JSON.stringify(back) + "\n");
  console.log(`  g${g} back: gfxSummary=${backGfx.summaryTotal} rows=${backGfx.frames.length} raf=${backRaf.rafCount} lt=${JSON.stringify(backRaf.longtasks)} trueTotals=${backGfx.frames.map((f) => f.trueTotalMs)}`);
  await SLEEP(800);
}
console.log(`[e2] 完成 → ${outFile}`);
