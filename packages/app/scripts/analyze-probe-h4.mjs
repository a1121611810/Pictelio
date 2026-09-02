#!/usr/bin/env node
// PROBE H4 分析（#318 候选①）：logcat 三轨判据计算 v2
// v2 修正：① 轨 1 图片活动窗口改用原生 img 窗口（logcat wall 同域，比 bind→load 更准）
//         ② 轨 2 速度公式修复（|deltaY|/dt，非 delta-of-delta）
//         ③ 轨 3 补充 fetchMs（网络 vs 解码的区分）+ 脏组均值（frames<=1 剔除）
// 输入：adb logcat -v threadtime 全量（含 [PROBE_H4] JS 流 + PROBE_H4 native 流）
// 输出：/tmp/probe-h4-analysis.json + 控制台摘要
// 用法：node scripts/analyze-probe-h4.mjs <logcat文件> [--bench-dir <dir>]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2] ?? "/tmp/probe-h4-logcat-raw.txt";
const benchDir = process.argv.includes("--bench-dir")
  ? (process.argv[process.argv.indexOf("--bench-dir") + 1] ?? null)
  : null;

const lines = readFileSync(input, "utf8").split("\n");
const T = /^\d{2}-\d{2} (\d{2}:\d{2}:\d{2}\.\d{3})/;
function wallOf(line) {
  const m = T.exec(line);
  if (!m) return null;
  const [hh, mm, ss, ms] = m[1].split(/[:.]/);
  return (+hh) * 3600 * 1000 + (+mm) * 60 * 1000 + (+ss) * 1000 + (+ms);
}

const raf = [], scroll = [], bind = [], load = [], native = [];
for (const line of lines) {
  const wall = wallOf(line);
  if (wall == null) continue;
  let m;
  if ((m = /\[PROBE_H4\]\[(raf|scroll|bind|load)\]/.exec(line))) {
    const kind = m[1];
    const rest = line.slice(m.index + m[0].length);
    const tk = /(\d+(?:\.\d+)?)/.exec(rest);
    const rec = { wall, ts: tk ? +tk[1] : 0 };
    if (kind === "scroll") {
      const dy = /deltaY=(-?\d+)/.exec(rest);
      rec.dy = dy ? +dy[1] : 0;
      scroll.push(rec);
    } else if (kind === "bind" || kind === "load") {
      rec.id = (/\S+$/.exec(rest.trim()) ?? [""])[0].replaceAll('"', "");
      if (kind === "bind") bind.push(rec);
      else load.push(rec);
    } else {
      raf.push(rec);
    }
  } else if ((m = / PROBE_H4: (fetch-start|cache-hit|img) (.+)$/.exec(line))) {
    const kind = m[1];
    const rest = m[2];
    const rec = { wall, kind };
    if (kind === "fetch-start") rec.url = rest.replace(/^\d+ /, "");
    else if (kind === "cache-hit") rec.url = rest;
    else {
      const f = /^(\S+) fetchMs=(\d+) decodeMs=(\d+) inflight=(\d+)$/.exec(rest);
      if (f) { rec.url = f[1]; rec.fetchMs = +f[2]; rec.decodeMs = +f[3]; rec.inflight = +f[4]; }
      else continue;
    }
    native.push(rec);
  }
}

const T0 = Math.min(...raf.map((r) => r.wall), ...scroll.map((r) => r.wall), ...native.map((r) => r.wall));
if (!Number.isFinite(T0)) {
  console.error("无 PROBE_H4 数据，检查 logcat 采集");
  process.exit(1);
}

// ─── 轨 1：rAF 帧间隙 × 原生图片活动窗口（logcat 同域）重叠率 ───
const rafSorted = [...raf].sort((a, b) => a.wall - b.wall);
const gaps = [];
for (let i = 1; i < rafSorted.length; i++) gaps.push({ t: rafSorted[i - 1].wall, gap: rafSorted[i].wall - rafSorted[i - 1].wall });
gaps.sort((a, b) => a.gap - b.gap);
const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)].gap : 0;
const thresh = Math.max(25, medianGap * 1.5);
const janks = gaps.filter((g) => g.gap > thresh);
const jankRate = gaps.length ? janks.length / gaps.length : 0;

// 图片活动窗口（原生）：[img.wall - (fetchMs + decodeMs), img.wall]
const imgRecs = native.filter((n) => n.kind === "img").sort((a, b) => a.wall - b.wall);
const windows = imgRecs.map((n) => ({ bind: n.wall - n.fetchMs - n.decodeMs, load: n.wall, span: n.fetchMs + n.decodeMs }));
function overlap(px) {
  const j = janks.filter((g) => windows.some((w) => g.t >= w.bind - px && g.t <= w.load + px));
  return janks.length ? j.length / janks.length : 0;
}
const overlapStrict = overlap(0);
const overlapPad50 = overlap(50);

// ─── 轨 2：速度段分类 × 图片活动对比（速度 = |deltaY|/dt） ───
const scSorted = [...scroll].sort((a, b) => a.wall - b.wall);
const velos = [];
for (let i = 1; i < scSorted.length; i++) {
  const dt = scSorted[i].wall - scSorted[i - 1].wall;
  if (dt > 0) velos.push({ v: Math.abs(scSorted[i].dy) / dt });
}
velos.sort((a, b) => a.v - b.v);
const vP75 = velos.length ? velos[Math.floor(velos.length * 0.75)].v : 0;
const FAST_V = Math.max(0.8, vP75); // px/ms
function assignNative(n) {
  let best = null, bestV = 0;
  for (let i = 0; i < scSorted.length; i++) {
    const s = scSorted[i];
    const d = Math.abs(s.wall - n.wall);
    if (best == null || d < best.d) { best = { s, d }; }
  }
  if (!best || best.d > 4000) return { seg: "idle", v: 0 };
  const idx = scSorted.findIndex((x) => x.wall >= n.wall);
  const a = idx > 0 ? scSorted[idx - 1] : null;
  const b = idx < scSorted.length ? scSorted[idx] : null;
  let v = 0;
  if (a && b && b.wall > a.wall) v = Math.abs(b.dy) / (b.wall - a.wall);
  return { seg: v >= FAST_V ? "fast" : "idle", v };
}
const mkSeg = () => ({ fetch: 0, img: 0, fetchMs: 0, decodeMs: 0, inflightSum: 0, inflightN: 0, cacheHit: 0 });
const bySeg = { fast: mkSeg(), idle: mkSeg() };
const nativeTagged = [];
for (const n of native) {
  const { seg, v } = assignNative(n);
  nativeTagged.push({ ...n, seg, v });
  if (n.kind === "fetch-start") bySeg[seg].fetch++;
  else if (n.kind === "cache-hit") bySeg[seg].cacheHit++;
  else if (n.kind === "img") { bySeg[seg].img++; bySeg[seg].fetchMs += n.fetchMs; bySeg[seg].decodeMs += n.decodeMs; bySeg[seg].inflightSum += n.inflight; bySeg[seg].inflightN++; }
}

// ─── 轨 3：10s 桶冷热（rAF jank% vs 图片来源命中率） ───
const BUCKET = 10000;
const buckets = new Map();
for (const g of gaps) {
  const b = Math.floor((g.t - T0) / BUCKET);
  const o = buckets.get(b) ?? { jank: 0, total: 0, fetch: 0, hit: 0 };
  o.jank += g.gap > thresh ? 1 : 0; o.total++;
  buckets.set(b, o);
}
for (const n of native) {
  const b = Math.floor((n.wall - T0) / BUCKET);
  const o = buckets.get(b) ?? { jank: 0, total: 0, fetch: 0, hit: 0 };
  if (n.kind === "fetch-start") o.fetch++;
  else if (n.kind === "cache-hit") o.hit++;
  buckets.set(b, o);
}
const hot = [], cold = [];
for (const [b, o] of buckets) {
  if (o.total < 10) continue;
  const hitRate = (o.fetch + o.hit) ? o.hit / (o.fetch + o.hit) : 0;
  const jr = o.total ? o.jank / o.total : 0;
  if (hitRate >= 0.5) hot.push({ b, jankRate: jr, hitRate });
  else if (hitRate <= 0.1) cold.push({ b, jankRate: jr, hitRate });
}
const avg = (xs, f) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);
const hotJr = avg(hot, (x) => x.jankRate), coldJr = avg(cold, (x) => x.jankRate);

// ─── bench JSONL（官方 gfxinfo jank；剔除 frames<=1 脏记录）───
let bench = null;
if (benchDir) {
  try {
    const recs = [];
    for (const f of readdirSync(benchDir).filter((x) => x.endsWith(".jsonl")))
      for (const line of readFileSync(resolve(benchDir, f), "utf8").split("\n")) {
        if (line.trim()) recs.push(JSON.parse(line));
      }
    const byGroup = {};
    for (const r of recs) {
      if (r.framesDump <= 1) continue;
      (byGroup[r.group] ??= []).push(r.jankRate);
    }
    bench = Object.fromEntries(Object.entries(byGroup).map(([g, xs]) => [g, { n: xs.length, jankRateMean: +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(4) }]));
  } catch { bench = null; }
}

const fs = nativeTagged.filter((n) => n.kind === "img");
const out = {
  counts: { raf: raf.length, scroll: scroll.length, bind: bind.length, load: load.length, native: native.length, fetchStart: native.filter((n) => n.kind === "fetch-start").length, cacheHit: native.filter((n) => n.kind === "cache-hit").length, img: fs.length, engineLoadRatio: (native.filter((n) => n.kind === "fetch-start").length / Math.max(1, bind.length)).toFixed(3) },
  raf: { medianGapMs: +medianGap.toFixed(1), threshMs: +thresh.toFixed(1), jankRate: +jankRate.toFixed(4), jankFrames: janks.length },
  imgActivity: { windows: windows.length, avgSpanMs: windows.length ? +(windows.reduce((s, w) => s + w.span, 0) / windows.length).toFixed(0) : 0, avgFetchMs: +(fs.reduce((s, n) => s + n.fetchMs, 0) / Math.max(1, fs.length)).toFixed(0), avgDecodeMs: +(fs.reduce((s, n) => s + n.decodeMs, 0) / Math.max(1, fs.length)).toFixed(1), maxInflight: fs.length ? Math.max(...fs.map((n) => n.inflight)) : 0 },
  overlap: { strict: +overlapStrict.toFixed(3), pad50: +overlapPad50.toFixed(3) },
  speed: { vP75PxMs: +vP75.toFixed(2), fastThresholdPxMs: +FAST_V.toFixed(2), seg: bySeg },
  coldHot: { hotBuckets: hot.length, coldBuckets: cold.length, hotJankRate: +hotJr.toFixed(4), coldJankRate: +coldJr.toFixed(4), diffPp: +((hotJr - coldJr) * 100).toFixed(2), note: "cacheHit=0：64MB LRU 在 77 张解码后已淘汰冷图——轨 3 内存命中口径不成立，冷热信号改用 bench 分组" },
  benchGroups: bench,
};
writeFileSync("/tmp/probe-h4-analysis.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
