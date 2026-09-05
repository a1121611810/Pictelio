#!/usr/bin/env node
// ─── webview 导航切换 + 图片就绪专项 bench（地图 #355 / #356 T0 扩展 M4+B1）───
// 子命令：
//   switch --groups N : home →/illust/:id（forward）→ history.back()（back），各采一段 framestats；
//                       同时记录 back 后 scrollY（验证 Chromium 恢复/兜底是否打回顶部，A5-b）
//   imgready --groups N : /home 冷启动后清 resource buffer → 3 连 fling → 统计 /pixiv-img/
//                       resource timing（duration 命中分桶 + p50/p90/p99，B1/B5）
//   intercept --groups N : X1 拦截链路探针——每组 logcat -c → 冷启动段 dump → 3 连 fling →
//                       scroll 段 dump，解析 PictelioPerf 日志（hit(mem|disk)/miss/err 分桶）
//   report --out <dir>  : 汇总 *.jsonl → summary.json
// 复用 #306 bench-scroll.mjs 的 framestats 解析与 CDP 通道（自包含拷贝，避免 CLI 副作用）。
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "io.pictelio.app";
const CDP_PORT = 9223;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const cmd = args[0];
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const SERIAL = opt("serial", "emulator-5554");
const GROUPS = Number(opt("groups", "3"));
const OUT = opt("out", resolve(process.cwd(), `bench-results/nav-${Date.now()}`));

function sh(c) {
  try {
    return execSync(c, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}
const adb = (...a) =>
  sh([ADB, "-s", SERIAL, ...a].map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" "));
const adbShell = (s) => sh(`"${ADB}" -s ${SERIAL} shell ${s}`);

// ─── framestats 解析（与 #306 逐字一致，Android 12+ 21 列） ───
function parseSummary(dump) {
  const g = (re) => {
    const m = re.exec(dump);
    return m ? Number(m[1]) : NaN;
  };
  const total = g(/Total frames rendered: (\d+)/);
  const jankPct = g(/Janky frames: \d+ \((\d+(?:\.\d+)?)%\)/);
  const p50 = g(/50th percentile: (\d+)ms/);
  const p90 = g(/90th percentile: (\d+)ms/);
  const p99 = g(/99th percentile: (\d+)ms/);
  if (!total) return null;
  return {
    frames: total,
    jankRate: (jankPct ?? 0) / 100,
    totalP50: p50,
    totalP90: p90,
    totalP99: p99,
  };
}
function parseFramestats(dump) {
  const frames = [];
  for (const line of dump.split("\n")) {
    if (!/^\d+,\d+,/.test(line)) continue;
    const c = line.split(",").map((s) => (s === "" ? NaN : Number(s)));
    if (c.length >= 21) {
      const intendedVsync = c[2],
        handleInputStart = c[5],
        frameDeadline = c[9];
      const frameInterval = c[11],
        frameCompleted = c[15];
      if (!frameInterval || frameInterval < 1e6 || frameInterval > 1e9) continue;
      if (!frameCompleted || frameCompleted <= intendedVsync) continue;
      frames.push({
        intendedVsync,
        unknownDelayMs: (handleInputStart - intendedVsync) / 1e6,
        totalMs: (frameCompleted - intendedVsync) / 1e6,
        deadlineMs: (frameDeadline - intendedVsync) / 1e6,
        jank: frameCompleted - intendedVsync > frameDeadline - intendedVsync,
      });
    }
  }
  return { frames, summary: frames.length > 0 ? null : parseSummary(dump) };
}
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}
function summarize(frames) {
  const totals = frames.map((f) => f.totalMs).toSorted((a, b) => a - b);
  const delays = frames.map((f) => f.unknownDelayMs).toSorted((a, b) => a - b);
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

// ─── CDP（与 #306 一致） ───
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
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => rej(new Error("cdp timeout")), 15000);
    });
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r?.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text}`);
  return r?.result?.value;
}

function screenSize() {
  const m = /(\d+)x(\d+)/.exec(adb("shell", "wm", "size"));
  return m ? { w: +m[1], h: +m[2] } : { w: 720, h: 1280 };
}
async function gesture(kind, w, h) {
  const x = Math.round(w / 2);
  const y1 = Math.round(h * 0.78);
  if (kind === "fling") adbShell(`input swipe ${x} ${y1} ${x} ${Math.round(h * 0.12)} 180`);
}

async function restartApp() {
  adbShell(`am force-stop ${PKG}`);
  await SLEEP(1200);
  adbShell(`am start -n ${PKG}/.MainActivityWebview`);
  await SLEEP(12000);
  // 就绪判定：CDP 可达且 body 有卡片星标（★）或标题
  for (let i = 0; i < 10; i++) {
    try {
      const t = await cdpEvaluate(`document.body.innerText.slice(0, 200).replace(/\\n/g, " ")`);
      if (t && /★|♥|推荐/.test(t)) {
        console.log(`[nav] 应用就绪（${i + 1} 轮）: ${String(t).slice(0, 60)}`);
        return;
      }
    } catch {}
    await SLEEP(2500);
  }
  console.log("[nav] 就绪判定超时，继续");
}

async function sampleFrames(outFile, meta, settleMs = 1800) {
  adbShell(`dumpsys gfxinfo ${PKG} reset`);
  await SLEEP(250);
  const t0 = Date.now();
  await SLEEP(settleMs);
  const dump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
  const { frames, summary } = parseFramestats(dump);
  const base = summary ?? summarize(frames);
  const rec = {
    ...meta,
    wallMs: Date.now() - t0,
    framesDump: summary ? summary.frames : frames.length,
    ...base,
  };
  appendFileSync(outFile, JSON.stringify(rec) + "\n");
  return rec;
}

// ─── switch: home → illust 详情 → back ───
async function switchCmd() {
  mkdirSync(OUT, { recursive: true });
  await restartApp();
  const outFile = resolve(OUT, "webview_switch.jsonl");
  writeFileSync(outFile, "");
  for (let g = 0; g < GROUPS; g++) {
    // home 卡片无 <a>（onClick+useNavigate 跳转）→ 点「含 <img> 的 cursor-pointer 卡」
    const href = await cdpEvaluate(`(() => {
      const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img"));
      return card ? "card" : "none";
    })()`);
    if (href === "none") throw new Error("首页无可点击图片卡（feed 未渲染？）");
    const scrollBefore = await cdpEvaluate(`window.scrollY`);
    adbShell(`dumpsys gfxinfo ${PKG} reset`);
    await SLEEP(250);
    await cdpEvaluate(
      `(() => { const card = [...document.querySelectorAll('[class*="cursor-pointer"]')].find(e => e.querySelector("img")); card.click(); return "clicked"; })()`,
    );
    const fwd = await sampleFrames(
      outFile,
      { scenario: "switch", kind: "forward", group: g, target: href },
      1800,
    );
    // detail → home（back）
    adbShell(`dumpsys gfxinfo ${PKG} reset`);
    await SLEEP(250);
    await cdpEvaluate(`(() => { history.back(); return "back"; })()`);
    await SLEEP(1800);
    const dump = adbShell(`dumpsys gfxinfo ${PKG} framestats`);
    const { frames, summary } = parseFramestats(dump);
    const base = summary ?? summarize(frames);
    const scrollAfter = await cdpEvaluate(`window.scrollY`);
    const pathAfter = await cdpEvaluate(`location.pathname`);
    const recB = {
      scenario: "switch",
      kind: "back",
      group: g,
      framesDump: summary ? summary.frames : frames.length,
      scrollBefore,
      scrollAfter,
      restored: Math.abs(scrollAfter - scrollBefore) < 50,
      ...base,
    };
    appendFileSync(outFile, JSON.stringify(recB) + "\n");
    console.log(
      `  g${g} fwd: jank=${(fwd.jankRate * 100).toFixed(0)}% p99=${fwd.totalP99}ms | back: jank=${(recB.jankRate * 100).toFixed(0)}% p99=${recB.totalP99}ms scroll ${scrollBefore}→${scrollAfter} ${recB.restored ? "✓" : "✗"} path=${pathAfter}`,
    );
    await SLEEP(800);
  }
  console.log(`[switch] 完成 → ${outFile}`);
}

// ─── imgready: /home 冷启动首屏图片统计 → 清 buffer → 3 连 fling → 滚动阶段图片统计 ───
async function imgreadyCmd() {
  mkdirSync(OUT, { recursive: true });
  const { w, h } = screenSize();
  const outFile = resolve(OUT, "webview_imgready.jsonl");
  writeFileSync(outFile, "");
  const snapStats = `(() => {
    const es = performance.getEntriesByType("resource").filter(e => e.name.includes("/pixiv-img/"));
    const durs = es.map(e => Math.round(e.duration)).sort((a,b) => a-b);
    const hit = es.filter(e => e.transferSize === 0 || e.duration < 5).length;
    const p = (q) => durs.length ? durs[Math.min(durs.length-1, Math.ceil(q/100*durs.length)-1)] : 0;
    return { total: es.length, hit, miss: es.length - hit,
      p50: p(50), p90: p(90), p99: p(99), mean: durs.length ? Math.round(durs.reduce((s,d)=>s+d,0)/durs.length) : 0 };
  })()`;
  for (let g = 0; g < GROUPS; g++) {
    await restartApp();
    // 等首屏图片卡真正渲染（防 API 慢时 0 图失真）
    let ready = false;
    for (let i = 0; i < 16; i++) {
      const n = await cdpEvaluate(
        `document.querySelectorAll('img[src*="/pixiv-img/"]').length`,
      ).catch(() => 0);
      if (Number(n) >= 3) {
        ready = true;
        break;
      }
      await SLEEP(1500);
    }
    if (!ready) {
      console.log(`  g${g}: 首屏图片卡未渲染，跳过本组`);
      continue;
    }
    // 阶段 1：冷启动首屏（启动到现在的全部图片请求）
    const cold = await cdpEvaluate(snapStats);
    // 阶段 2：清 buffer → fling → 滚动触发的新图片
    await cdpEvaluate(`performance.clearResourceTimings(); "cleared"`);
    await SLEEP(300);
    for (let i = 0; i < 3; i++) {
      await gesture("fling", w, h);
      await SLEEP(1400);
    }
    await SLEEP(1500);
    const scroll = await cdpEvaluate(snapStats);
    appendFileSync(
      outFile,
      JSON.stringify({ scenario: "imgready", kind: "cold", group: g, ...cold }) + "\n",
    );
    appendFileSync(
      outFile,
      JSON.stringify({ scenario: "imgready", kind: "scroll", group: g, ...scroll }) + "\n",
    );
    console.log(
      `  g${g}: cold imgs=${cold.total} hit=${cold.hit} p50=${cold.p50}ms | scroll imgs=${scroll.total} hit=${scroll.hit} p50=${scroll.p50}ms p90=${scroll.p90}ms`,
    );
  }
  console.log(`[imgready] 完成 → ${outFile}`);
}

// ─── coldstart: am start → 首屏卡片 DOM 就绪毫秒（T4 Query 持久化的主指标） ───
// t0 = 宿主 am start 前时刻；200ms 粒度轮询 CDP（★/♥ 卡片文本 + 图片卡数），
// 就绪后顺带记录当时 /pixiv-img/ 资源数与再等 4s 的晚到图片数。
async function coldstartCmd() {
  mkdirSync(OUT, { recursive: true });
  const outFile = resolve(OUT, "webview_coldstart.jsonl");
  writeFileSync(outFile, "");
  const GROUPS_CS = Number(opt("groups", "3"));
  for (let g = 0; g < GROUPS_CS; g++) {
    adbShell(`am force-stop ${PKG}`);
    await SLEEP(1500);
    const t0 = Date.now();
    adbShell(`am start -n ${PKG}/.MainActivityWebview`);
    let readyMs = null,
      imgsAtReady = 0;
    for (let i = 0; i < 90; i++) {
      await SLEEP(200);
      try {
        const r = await cdpEvaluate(
          `(() => { const t = document.body.innerText; const imgs = document.querySelectorAll('img[src*="/pixiv-img/"]').length; return { ready: /★|♥/.test(t), imgs }; })()`,
        );
        if (r && r.ready) {
          readyMs = Date.now() - t0;
          imgsAtReady = r.imgs;
          break;
        }
      } catch {}
    }
    if (readyMs === null) {
      console.log(`  g${g}: 90s 内未就绪，记失败`);
      appendFileSync(
        outFile,
        JSON.stringify({ scenario: "coldstart", kind: "tocards", group: g, readyMs: null }) + "\n",
      );
      continue;
    }
    await SLEEP(4000);
    const late = await cdpEvaluate(
      `document.querySelectorAll('img[src*="/pixiv-img/"]').length`,
    ).catch(() => 0);
    appendFileSync(
      outFile,
      JSON.stringify({
        scenario: "coldstart",
        kind: "tocards",
        group: g,
        readyMs,
        imgsAtReady,
        imgsLate: Number(late),
      }) + "\n",
    );
    console.log(`  g${g}: 首屏卡片就绪 ${readyMs}ms（当时图片 ${imgsAtReady}，+4s 后 ${late}）`);
  }
  console.log(`[coldstart] 完成 → ${outFile}`);
}

// ─── intercept: X1 拦截链路探针（logcat PictelioPerf）——冷启动段 + 3 连 fling 滚动段 ───
// 每组：logcat -c → 冷启动（am start → 首屏图片卡就绪）→ cold 段 dump → logcat -c →
// 3 连 fling → scroll 段 dump。两段各自清缓冲，保证 cold/scroll 记录互不污染。
// 行格式（PerfLog.java，-v threadtime -s PictelioPerf）：
//   MM-DD HH:MM:SS.mmm PID TID I PictelioPerf: intercept url8=X phase=hit src=mem|disk durationMs=n bytes=n
const INTERCEPT_RE =
  /PictelioPerf: intercept url8=(\S+) phase=(hit|miss|err)(?: src=(\S+))? durationMs=(\d+) bytes=(-?\d+)/;

function parseInterceptDump(dump) {
  const out = [];
  for (const line of dump.split("\n")) {
    const m = INTERCEPT_RE.exec(line);
    if (!m) continue;
    const [, url8, phase, src, durMs, bytes] = m;
    out.push({
      scenario: "intercept",
      url8,
      phase,
      src, // 仅 hit 有值；miss/err 为 undefined → JSON.stringify 自动丢弃
      durationMs: Number(durMs),
      bytes: Number(bytes),
      ts: /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/.exec(line)?.[1],
    });
  }
  return out;
}

async function interceptCmd() {
  mkdirSync(OUT, { recursive: true });
  const { w, h } = screenSize();
  const outFile = resolve(OUT, "webview_intercept.jsonl");
  writeFileSync(outFile, "");
  for (let g = 0; g < GROUPS; g++) {
    adbShell(`logcat -c`);
    adbShell(`am force-stop ${PKG}`);
    await SLEEP(1200);
    adbShell(`am start -n ${PKG}/.MainActivityWebview`);
    // 等首屏图片卡渲染（对齐 imgready 的就绪判定；CDP 未起时 catch 为 0 继续轮询）
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await SLEEP(1500);
      const n = await cdpEvaluate(
        `document.querySelectorAll('img[src*="/pixiv-img/"]').length`,
      ).catch(() => 0);
      if (Number(n) >= 3) {
        ready = true;
        break;
      }
    }
    if (!ready) console.log(`  g${g}: 首屏图片卡未渲染，仍记录本组`);
    // 冷启动段 dump（含启动全程的全部拦截日志）
    let cold = 0;
    for (const r of parseInterceptDump(adbShell(`logcat -d -v threadtime -s PictelioPerf`))) {
      appendFileSync(outFile, JSON.stringify({ ...r, kind: "cold", group: g }) + "\n");
      cold++;
    }
    // 清缓冲 → 3 连 fling → 滚动段 dump
    adbShell(`logcat -c`);
    await SLEEP(300);
    for (let i = 0; i < 3; i++) {
      await gesture("fling", w, h);
      await SLEEP(1400);
    }
    await SLEEP(1500);
    let scroll = 0;
    for (const r of parseInterceptDump(adbShell(`logcat -d -v threadtime -s PictelioPerf`))) {
      appendFileSync(outFile, JSON.stringify({ ...r, kind: "scroll", group: g }) + "\n");
      scroll++;
    }
    console.log(`  g${g}: cold=${cold} scroll=${scroll}${ready ? "" : "（未就绪）"}`);
  }
  console.log(`[intercept] 完成 → ${outFile}`);
}

// ─── report ───
async function reportCmd() {
  const rows = [];
  for (const f of readdirSync(OUT))
    if (f.endsWith(".jsonl"))
      for (const l of readFileSync(resolve(OUT, f), "utf8").split("\n"))
        if (l.trim()) rows.push(JSON.parse(l));
  const byKey = {};
  for (const r of rows) {
    const k = `${r.scenario}/${r.kind}`;
    (byKey[k] ??= []).push(r);
  }
  const out = {};
  for (const [k, rs] of Object.entries(byKey)) {
    if (k.startsWith("imgready/")) {
      const total = rs.reduce((s, r) => s + r.total, 0),
        hit = rs.reduce((s, r) => s + r.hit, 0);
      out[k] = {
        groups: rs.length,
        imgsTotal: total,
        hitRate: total ? +(hit / total).toFixed(3) : 0,
        durP50: +percentile(
          rs.map((r) => r.p50).toSorted((a, b) => a - b),
          50,
        ).toFixed(1),
        durP90: +percentile(
          rs.map((r) => r.p90).toSorted((a, b) => a - b),
          50,
        ).toFixed(1),
        durP99: +percentile(
          rs.map((r) => r.p99).toSorted((a, b) => a - b),
          50,
        ).toFixed(1),
      };
    } else if (k.startsWith("coldstart/")) {
      const valid = rs.filter((r) => r.readyMs !== null && r.readyMs !== undefined);
      out[k] = {
        groups: rs.length,
        readyP50: +percentile(
          valid.map((r) => r.readyMs).toSorted((a, b) => a - b),
          50,
        ).toFixed(0),
        readyP90: +percentile(
          valid.map((r) => r.readyMs).toSorted((a, b) => a - b),
          90,
        ).toFixed(0),
        failures: rs.length - valid.length,
      };
    } else if (k.startsWith("intercept/")) {
      // X1 拦截链路聚合（spec §3.6）：总数/hit 率/按 phase 的 p50/p90/p99/
      // src=mem|disk 计数/miss bytes 均值
      const hit = rs.filter((r) => r.phase === "hit");
      const miss = rs.filter((r) => r.phase === "miss");
      const err = rs.filter((r) => r.phase === "err");
      const hitDurs = hit.map((r) => r.durationMs ?? 0).toSorted((a, b) => a - b);
      const missDurs = miss.map((r) => r.durationMs ?? 0).toSorted((a, b) => a - b);
      out[k] = {
        groups: rs.length,
        total: rs.length,
        hitRate: rs.length ? +(hit.length / rs.length).toFixed(3) : 0,
        byPhase: {
          hit: {
            n: hit.length,
            p50: +percentile(hitDurs, 50).toFixed(1),
            p90: +percentile(hitDurs, 90).toFixed(1),
            p99: +percentile(hitDurs, 99).toFixed(1),
            srcMemN: hit.filter((r) => r.src === "mem").length,
            srcDiskN: hit.filter((r) => r.src === "disk").length,
          },
          miss: {
            n: miss.length,
            p50: +percentile(missDurs, 50).toFixed(1),
            p90: +percentile(missDurs, 90).toFixed(1),
            p99: +percentile(missDurs, 99).toFixed(1),
            bytesMean: miss.length
              ? Math.round(miss.reduce((s, r) => s + (r.bytes ?? 0), 0) / miss.length)
              : 0,
          },
          err: { n: err.length },
        },
      };
    } else if (k.startsWith("switch/") || k.startsWith("nav/")) {
      // 缺字段记录（老格式兜底行）缺省按 0 计
      out[k] = {
        gestures: rs.length,
        jankRateMean: +(rs.reduce((s, r) => s + (r.jankRate ?? 0), 0) / rs.length).toFixed(4),
        totalP50ofP50: +percentile(
          rs.map((r) => r.totalP50 ?? 0).toSorted((a, b) => a - b),
          50,
        ).toFixed(2),
        totalP99ofP50: +percentile(
          rs.map((r) => r.totalP99 ?? 0).toSorted((a, b) => a - b),
          50,
        ).toFixed(2),
        unknownDelayP90: +percentile(
          rs.map((r) => r.unknownDelayP90 ?? 0).toSorted((a, b) => a - b),
          90,
        ).toFixed(2),
        restoredCount: rs.filter((r) => r.restored !== undefined).length
          ? `${rs.filter((r) => r.restored).length}/${rs.length}`
          : undefined,
      };
    }
  }
  console.log(JSON.stringify(out, null, 2));
  writeFileSync(resolve(OUT, "summary.json"), JSON.stringify(out, null, 2));
}

async function main() {
  if (cmd === "switch") {
    await switchCmd();
    return;
  }
  if (cmd === "imgready") {
    await imgreadyCmd();
    return;
  }
  if (cmd === "coldstart") {
    await coldstartCmd();
    return;
  }
  if (cmd === "intercept") {
    await interceptCmd();
    return;
  }
  if (cmd === "report") {
    await reportCmd();
    return;
  }
  console.error(
    "用法: bench-webview-nav.mjs switch|imgready|coldstart|intercept|report --serial <s> --groups <n> --out <dir>",
  );
  process.exit(1);
}
main().catch((e) => {
  console.error(`[nav-bench] 失败: ${e.message}`);
  process.exit(1);
});
