#!/usr/bin/env node
// ─── 双端滚动跟手性 bench（wayfinder #306 / 地图 #304）───
// T0 层：adb input swipe 手势驱动 + dumpsys gfxinfo framestats 采集解析。
// 方法学依据：docs/research/scroll-responsiveness-bench-methodology.md（research/bench-methodology 分支）。
//
// 用法：
//   node scripts/bench-scroll.mjs probe  --serial emulator-5554
//   node scripts/bench-scroll.mjs run    --serial emulator-5554 --engine webview|lynx --scenario <名> [--groups 3] [--per 10] [--out <dir>]
//   node scripts/bench-scroll.mjs report --out <dir>   # 汇总目录下所有 *.jsonl → summary
//
// 列序（Android 12+ framestats，以 FrameInterval=刷新周期ns 锚定校验，Android 14 实测）：
// 0 Flags 1 VsyncId 2 IntendedVsync 3 Vsync 4 InputEventId 5 HandleInputStart
// 6 AnimationStart 7 PerformTraversalsStart 8 DrawStart 9 FrameDeadline 10 SyncQueued
// 11 FrameInterval(ns) 12 SyncStart 13 IssueDrawCommandsStart 14 SwapBuffers 15 FrameCompleted
// 16 DequeueBufferDuration 17 QueueBufferDuration 18 GpuCompleted 19 SwapBuffersCompleted
// 20 DisplayPresentTime(0=不可得)
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const ACTIVITY = { webview: ".MainActivityWebview", lynx: ".LynxActivity" };
const APK = {
  webview: "android/app/build/outputs/apk/webview/debug/app-webview-debug.apk",
  lynx: "android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk",
};
const CDP_PORT = 9222;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 参数 ───
const args = process.argv.slice(2);
const cmd = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const SERIAL = opt("serial", "emulator-5554");
const ENGINE = opt("engine", "");
const SCENARIO = opt("scenario", "");
const GROUPS = Number(opt("groups", "3"));
const PER = Number(opt("per", "10"));
const OUT = opt("out", resolve(process.cwd(), `bench-results/${new Date().toISOString().replace(/[:.]/g, "-")}`));

function sh(c) { try { return execSync(c, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return ""; } }
const adb = (...a) => sh([ADB, "-s", SERIAL, ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s ${SERIAL} shell ${s}`);

// ─── framestats 解析 ───
// 返回帧对象数组；过滤无效行（FrameInterval 非法/时间戳倒挂）
function parseFramestats(dump) {
  const frames = [];
  for (const line of dump.split("\n")) {
    if (!/^\d+,\d+,/.test(line)) continue;
    const c = line.split(",").map((s) => (s === "" ? NaN : Number(s)));
    if (c.length < 21) continue;
    // 实测列序（Android 14 校验：FrameInterval=16666666 锚定在 index 11）：
    // 9 FrameDeadline 10 SyncQueued 11 FrameInterval 15 FrameCompleted 18 GpuCompleted 20 DisplayPresentTime
    const [flags, vsyncId, intendedVsync, vsync, inputEventId, handleInputStart, , , , frameDeadline, , frameInterval, , , , , frameCompleted, , , gpuCompleted, , displayPresentTime] = c;
    if (!frameInterval || frameInterval < 1e6 || frameInterval > 1e9) continue; // 刷新周期 1ms~1s
    if (!frameCompleted || frameCompleted <= intendedVsync) continue;
    frames.push({
      flags, vsyncId, intendedVsync,
      vsyncMissMs: (vsync - intendedVsync) / 1e6,              // vsync 错过量
      unknownDelayMs: (handleInputStart - intendedVsync) / 1e6, // UNKNOWN_DELAY：输入排队（UI 线程忙）
      totalMs: (frameCompleted - intendedVsync) / 1e6,          // TOTAL_DURATION
      deadlineMs: (frameDeadline - intendedVsync) / 1e6,        // DEADLINE
      jank: frameCompleted - intendedVsync > frameDeadline - intendedVsync,
      presentMs: displayPresentTime > 0 ? (displayPresentTime - gpuCompleted) / 1e6 : null,
    });
  }
  return frames;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}
function summarize(frames) {
  const totals = frames.map((f) => f.totalMs).sort((a, b) => a - b);
  const delays = frames.map((f) => f.unknownDelayMs).sort((a, b) => a - b);
  return {
    frames: frames.length,
    jankRate: frames.length ? +(frames.filter((f) => f.jank).length / frames.length).toFixed(4) : 0,
    totalP50: +percentile(totals, 50).toFixed(2),
    totalP90: +percentile(totals, 90).toFixed(2),
    totalP99: +percentile(totals, 99).toFixed(2),
    unknownDelayP50: +percentile(delays, 50).toFixed(2),
    unknownDelayP90: +percentile(delays, 90).toFixed(2),
    deadlineMs: frames.length ? +frames[0].deadlineMs.toFixed(2) : 0,
  };
}

// ─── 手势 ───
// 屏幕中心 x，y 从 78% → 31% 高（上滑=内容下移阅读方向）；fling 用短时长快甩
async function gesture(kind, w, h) {
  const x = Math.round(w / 2);
  const y1 = Math.round(h * 0.78), y2 = Math.round(h * 0.31);
  if (kind === "drag") adbShell(`input swipe ${x} ${y1} ${x} ${y2} 600`);
  else if (kind === "fling") adbShell(`input swipe ${x} ${y1} ${x} ${Math.round(h * 0.12)} 180`);
  else if (kind === "swipe-left") adbShell(`input swipe ${Math.round(w * 0.83)} ${Math.round(h * 0.5)} ${Math.round(w * 0.17)} ${Math.round(h * 0.5)} 350`);
  else if (kind === "back-top") { // 连续反向快甩回顶（lynx 无 JS 滚动属性，物理回顶，双端语义对齐）
    for (let i = 0; i < 4; i++) { adbShell(`input swipe ${x} ${Math.round(h * 0.25)} ${x} ${Math.round(h * 0.92)} 150`); await SLEEP(350); }
  }
}

function screenSize() {
  const m = /(\d+)x(\d+)/.exec(adb("shell", "wm", "size"));
  return m ? { w: +m[1], h: +m[2] } : { w: 720, h: 1280 };
}

// ─── 采样：一次手势 = reset → 手势 → 稳定 → dump → 解析追加 JSONL ───
async function sampleOnce(outFile, meta) {
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(300);
  const t0 = Date.now();
  await gesture(meta.kind, meta.w, meta.h);
  await SLEEP(1800); // 惯性帧收尾 + ring buffer 窗口内
  const dump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
  const frames = parseFramestats(dump);
  const rec = { ...meta, wallMs: Date.now() - t0, ...summarize(frames), framesDump: frames.length };
  appendFileSync(outFile, JSON.stringify(rec) + "\n");
  return rec;
}

// ─── CDP（webview 侧导航/验证） ───
async function cdpEvaluate(expression) {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  if (!pid) throw new Error("app 未运行");
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); if (targets.length) break; } catch {}
    await SLEEP(400);
  }
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page) throw new Error("无 CDP target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error("cdp timeout")), 15000); });
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r?.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text}`);
  return r?.result?.value;
}

// ─── 场景导航（双端路径等价表见方法学 §5.4） ───
// lynx 坐标：720x1280 模拟器截图实测（FAB 中心 635,1150；插画环项 492,942；小说环项 415,1028），
// 其余屏宽按 720 基准缩放（lynx 布局全 vw 随宽缩放）。
const sx = (v, w) => Math.round((v * w) / 720);
const ANL = "/Users/lilianda/develop/pixivizer/packages/app-lynx/scripts/lynx-screen-analyze.py";
async function shotClassify(tag) {
  const f = `/tmp/bench_${tag}.png`;
  try { execSync(`"${ADB}" -s ${SERIAL} exec-out screencap -p > ${f} 2>/dev/null`); } catch {}
  try {
    const out = execSync(`python3 ${ANL} ${f} classify 2>/dev/null`, { encoding: "utf8" }).trim();
    return JSON.parse(out).page ?? "unknown";
  } catch { return "unknown"; }
}
async function assertPage(tag, allowed, label) {
  // 分类器对白底列表页有误判（实测把完整瀑布流标为 blank），仅记录不中断；
  // 导航正确性由 framesProbe（滚动出帧判定）保证。
  const page = await shotClassify(tag);
  console.log(`  [nav:${label}] page=${page}${allowed.includes(page) ? "" : "（分类器误判可忽略）"}`);
  return page;
}
/** 滚动就绪判定：竖滑 600ms 后能否产出 > 30 帧（轮播纵滑 = 0 帧，列表/详情必出帧） */
async function framesProbe() {
  adbShell(`dumpsys gfxinfo ${PKG} reset`); await SLEEP(250);
  const { w, h } = screenSize();
  await gesture("drag", w, h); await SLEEP(1600);
  const frames = parseFramestats(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
  return frames.length;
}
async function restartApp(activity) {
  adbShell(`am force-stop ${PKG}`); await SLEEP(1200);
  adbShell(`am start -n ${PKG}/${activity}`);
  // 冷启动时长漂移：先等 9s 基线（pictelio 渲染就绪实测 ~10s），再轮询到内容非 blank/login
  await SLEEP(9000);
  for (let i = 0; i < 8; i++) {
    await SLEEP(2500);
    const page = await shotClassify(`ready${i}`);
    if (!["blank", "login", "unknown"].includes(page)) { console.log(`  [nav] 应用就绪（第 ${i + 2} 个 2.5s 轮询, page=${page}）`); return; }
  }
  console.log("  [nav] 就绪轮询超时，继续按固定等待");
  await SLEEP(5000);
}
// 受限卡无交互（点开不了详情），列表首屏可能是 R-18 受限卡 → 滚动后逐点重试
async function tapIntoDetail(w, h, attempts = 5) {
  await gesture("drag", w, h); await SLEEP(1500); // 滚一屏绕过受限卡密集区
  for (let i = 0; i < attempts; i++) {
    const x = Math.round(sx(180, w)), y = Math.round(400 + i * 170);
    adbShell(`input tap ${x} ${y}`); await SLEEP(6500);
    const n = await framesProbe(); // 详情 scroll-view 滚动必出帧
    if (n > 30) { console.log(`  [nav] 第 ${i + 1} 次点击进入可滚动详情（frames=${n}）`); return; }
    console.log(`  [nav] 第 ${i + 1} 次点击 frames=${n}（未进详情），重试`);
  }
  throw new Error("多次点击均未进入详情页（列表可能受限卡密集）");
}
// FAB 菜单展开时序敏感（~3s 动画）+ 冷启动漂移 → 以 framesProbe 判定到达可滚动页，失败重试
async function tapNavWithRetry(ringX, ringY, w, h, label) {
  const tap = (x, y) => adbShell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    tap(sx(635, w), sx(1150, h)); await SLEEP(2800); // FAB → 等菜单动画完成
    await shotClassify(`navmenu${label}${attempt}`); // debug：菜单展开态快照
    tap(sx(ringX, w), sx(ringY, h)); await SLEEP(5000); // 环项 → 目标 tab
    await shotClassify(`navafter${label}${attempt}`); // debug：环项点击后快照
    const n = await framesProbe();
    if (n > 30) { console.log(`  [nav:${label}] 第 ${attempt} 次尝试成功（frames=${n}）`); return; }
    console.log(`  [nav:${label}] 第 ${attempt} 次尝试 frames=${n}（未到达可滚动页），重试`);
  }
  throw new Error(`导航 ${label} 三次尝试后仍未到达可滚动页`);
}
// 外层再兜一层：整段导航（含 FAB→环项）完成后校验，失败整体重试开关
async function navLynx(scenario, w, h) {
  // 导航交给 bash 序列（node 内 input tap 偶发触发轮播换页且冻结，bash 实测稳定，见 lynx-bench-nav.sh）
  const map = {
    "illust-waterfall": "illust",
    "novel-single": "novel",
    "novel-detail": "novel-detail",
    multiimage: "multiimage",
  };
  if (scenario === "carousel") { await assertPage("carousel", ["recommended", "detail"], scenario); return; }
  const nav = resolve(process.cwd(), "scripts/lynx-bench-nav.sh");
  sh(`"${nav}" ${map[scenario] ?? scenario}`);
  const n = await framesProbe();
  if (n < 30) throw new Error(`导航后 framesProbe=${n}，页面不可滚动（网络/受限卡异常）`);
  console.log(`  [nav:${scenario}] 到达可滚动页（framesProbe=${n}）`);
}
async function navWebview(scenario) {
  await restartApp(".MainActivityWebview"); // 登录态由安全存储恢复 → /home 默认推荐面板
  const ev = (e) => cdpEvaluate(e);
  const spa = async (path) => {
    await ev(`(() => { history.pushState(null, "", ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent("popstate")); return location.pathname; })()`);
    await SLEEP(6000);
  };
  const bodyText = async () => ev(`document.body.innerText.slice(0, 400).replace(/\\n/g, " | ")`);
  switch (scenario) {
    case "illust-waterfall": {
      await spa("/home");
      const t = await bodyText();
      const ok = /\u2605|\u2665/.test(t); // 卡片行含 ★/♥ → 已渲染真实插画卡
      console.log(`  [nav:illust-waterfall] ${ok ? "✓" : "✗"} 首页推荐面板: ${t.slice(0, 90)}`);
      if (!ok) throw new Error("webview 首页推荐面板无卡片（网络/登录异常）");
      break;
    }
    case "novel-single": {
      await spa(`/search?word=${encodeURIComponent("少女")}&scope=novel`);
      const t = await bodyText();
      const ok = /[ぁ-んァ-ン一-龠]/.test(t) && !t.includes("暂无内容");
      console.log(`  [nav:novel-single] ${ok ? "✓" : "✗"} 搜索小说列表: ${t.slice(0, 90)}`);
      if (!ok) throw new Error("webview 小说搜索列表无结果");
      break;
    }
    case "novel-detail": {
      await spa(`/search?word=${encodeURIComponent("少女")}&scope=novel`);
      const id = await ev(`(() => {
        const all = [...document.querySelectorAll("*")];
        const cards = all.filter(e => e.childElementCount === 0 && e.textContent.trim().length > 6);
        for (const el of cards) {
          let n = el;
          for (let i = 0; i < 6 && n; i++) {
            n = n.parentElement;
            if (n && n.className && String(n.className).includes("cursor-pointer")) { n.click(); return "clicked"; }
          }
        }
        return "no-card";
      })()`);
      if (id !== "clicked") throw new Error(`webview 搜索页找不到可点小说卡: ${id}`);
      await SLEEP(6000);
      const path = await ev(`location.pathname`);
      const m = /\/novel\/(\d+)/.exec(path);
      if (!m) throw new Error(`点击后未进入 /novel/: ${path}`);
      console.log(`  [nav:novel-detail] 已进入小说详情 novel id=${m[1]}`);
      break;
    }
    default: throw new Error(`webview 场景 ${scenario} 未实现`);
  }
}

// ─── 命令 ───
async function main() {
  if (cmd === "probe") {
    const { w, h } = screenSize();
    adbShell(`dumpsys gfxinfo ${PKG} reset`); await SLEEP(300);
    await gesture("drag", w, h); await SLEEP(1800);
    const frames = parseFramestats(adbShell(`dumpsys gfxinfo ${PKG} framestats`));
    console.log(JSON.stringify({ ok: frames.length > 0, frames: frames.length, ...summarize(frames) }, null, 2));
    return;
  }
  if (cmd === "run") {
    if (!ENGINE || !SCENARIO) throw new Error("run 需要 --engine 与 --scenario");
    mkdirSync(OUT, { recursive: true });
    const { w, h } = screenSize();
    console.log(`[bench] engine=${ENGINE} scenario=${SCENARIO} serial=${SERIAL} screen=${w}x${h} out=${OUT}`);
    // 导航到场景
    if (ENGINE === "webview") await navWebview(SCENARIO); else await navLynx(SCENARIO, w, h);
    // 预热：2 次往返丢弃（轮播为横向滑，无回顶）
    console.log("[bench] 预热…");
    const warmKind = SCENARIO === "carousel" ? "swipe-left" : "drag";
    for (let i = 0; i < 2; i++) {
      await gesture(warmKind, w, h); await SLEEP(900);
      if (SCENARIO !== "carousel") { await gesture("back-top", w, h); await SLEEP(900); }
    }
    const outFile = resolve(OUT, `${ENGINE}_${SCENARIO}.jsonl`);
    writeFileSync(outFile, "");
    for (let g = 0; g < GROUPS; g++) {
      for (let i = 0; i < PER; i++) {
        const kind = SCENARIO === "carousel" ? "swipe-left" : i % 2 === 0 ? "drag" : "fling";
        const rec = await sampleOnce(outFile, { engine: ENGINE, scenario: SCENARIO, group: g, idx: i, kind, w, h });
        process.stdout.write(`  g${g}#${i} ${kind}: frames=${rec.framesDump} jank=${(rec.jankRate * 100).toFixed(0)}% p50=${rec.totalP50}ms\n`);
      }
      if (SCENARIO !== "carousel") { await gesture("back-top", w, h); await SLEEP(1000); }
    }
    console.log(`[bench] 完成 → ${outFile}`);
    return;
  }
  if (cmd === "report") {
    const { readFileSync, readdirSync } = await import("node:fs");
    const rows = [];
    for (const f of readdirSync(OUT)) if (f.endsWith(".jsonl")) for (const l of readFileSync(resolve(OUT, f), "utf8").split("\n")) if (l.trim()) rows.push(JSON.parse(l));
    const byKey = {};
    for (const r of rows) { const k = `${r.engine}/${r.scenario}`; (byKey[k] ??= []).push(r); }
    const out = {};
    for (const [k, rs] of Object.entries(byKey)) {
      const frames = rs.flatMap((r) => ({ jank: r.jankRate, totalMs: r.totalP50 })); // 手势级聚合
      out[k] = {
        gestures: rs.length,
        jankRateMean: +(rs.reduce((s, r) => s + r.jankRate, 0) / rs.length).toFixed(4),
        totalP50ofP50: +percentile(rs.map((r) => r.totalP50).sort((a, b) => a - b), 50).toFixed(2),
        totalP90ofP50: +percentile(rs.map((r) => r.totalP50).sort((a, b) => a - b), 90).toFixed(2),
        unknownDelayP90: +percentile(rs.map((r) => r.unknownDelayP90).sort((a, b) => a - b), 90).toFixed(2),
      };
    }
    console.log(JSON.stringify(out, null, 2));
    writeFileSync(resolve(OUT, "summary.json"), JSON.stringify(out, null, 2));
    return;
  }
  console.error("用法: bench-scroll.mjs probe|run|report …");
  process.exit(1);
}
main().catch((e) => { console.error(`[bench] 失败: ${e.message}`); process.exit(1); });
