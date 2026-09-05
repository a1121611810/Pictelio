#!/usr/bin/env node
// FT-5 交互回归脚本（#368 / 地图 #361）：真实交互体检六场景一键复跑。
//
// 场景协议与判定线出处（不得改判定线凑绿）：
//   1 coldstart 冷启动   —— docs/research/ri-365-coldstart-report.md（FT-2）：录屏最长完全静止段 <1s；
//                          WaitTime 仅记录（网络/缓存波动，不设回归线）。
//   2 detail   点进详情  —— docs/research/real-interaction-audit.md 场景 2：骨架帧 ≤1.1s；可交互帧 ≤2s。
//   3 back     系统返回  —— 体检报告场景 3 + FT-1A：响应 ≤400ms ×3 rep、过渡帧数 ≥1（有过渡动画为正常；
//                          VFR 快动画可被压缩成单帧切换，故以「3 rep 中出现过渡帧」判定动画存在，
//                          3 rep 全 0 才判 fail）、3 rep 方差（max-min）<100ms。
//   4 tabs     tab 切换  —— 体检报告场景 4 + ri-366-shimmer-report.md（FT-3）：骨架响应 ≤1.1s；
//                          空白窗判定 = 骨架出现过之后「骨架=0 且卡片=0」连续段 >500ms 即 fail
//                          （元素存在性口径：CDP DOM 探测；低对比度动效灰度 diff 判冻结不可靠，见 ri-366）。
//   5 scroll   滚动      —— 体检报告场景 5：滚动窗内 VFR delta p90 ≤34ms；无 >200ms 停滞段。
//   6 viewer   查看器    —— 体检报告场景 6 + ri-367-viewer-report.md（FT-4）：开启占位 ≤200ms；
//                          翻页释放→新页首帧 ≤500ms 且释放后无 >500ms 静默段。
//
// 用法: node run_regression.mjs [--serial emulator-5554] [--out <dir>] [--compare <baseline summary.json>]
//               [--scenes coldstart,detail,back,tabs,scroll,viewer] [--keyframes]
// 退出码: 全部场景 pass=0（记录型指标不设线不判 pass），任一 FAIL=1，环境自检失败=2。
//
// 依赖: adb、python3（imageio_ffmpeg/numpy/PIL，analyze_rec.py 同款）、Node ≥22（全局 WebSocket）。
// 无新 npm 依赖；录制/停录复用 start_rec.sh / stop_rec.sh 同款 screenrecord + pkill -2 流程，
// mp4 分析复用 analyze_rec.py；登录复用 cdp_login.mjs。

import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const hasFlag = (f) => argv.includes(f);

const SERIAL = argOf("--serial", "emulator-5554");
const OUT_ROOT = resolve(argOf("--out", join(SCRIPT_DIR, "regression-out")));
const COMPARE = argOf("--compare", null);
const ALL_SCENES = ["coldstart", "detail", "back", "tabs", "scroll", "viewer"];
const SCENES = argOf("--scenes", ALL_SCENES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const KEYFRAMES = hasFlag("--keyframes");

// ── 常量（720×1280 口径，与体检报告固定测法一致）────────────────────────────
const PKG = "io.pictelio.app";
const MAIN_ACTIVITY = ".MainActivityWebview"; // webview flavor launcher；full flavor = .MainActivity（历史误装事故）
const CDP_PORT = 9444;
const XY_FIRST_CARD = ["360", "600"]; // 首卡（体检场景 2/3 协议）
const XY_VIEWER_OPEN = ["360", "550"]; // 查看器开启（体检场景 6 协议）
const NAV = { home: ["52", "227"], follow: ["52", "310"], bookmark: ["52", "419"] }; // 侧导航（体检场景 4 协议）
const SWIPE_SLOW = ["360", "1100", "360", "400", "500"]; // 慢拖 500ms
const SWIPE_FLING = ["360", "1200", "360", "200", "150"]; // 快甩 150ms
const SWIPE_FLIP = ["600", "640", "120", "640", "200"]; // 查看器翻页（体检场景 6 协议）
const INPUT_ANCHOR_MS = 1000; // 录屏起点 → sleep 1s → 注入输入（体检口径；读数含 adb 注入延迟 ~100-300ms）
const ANCHOR_SLACK = 250; // screenrecord 编码器启动延迟会使视频时基比名义锚点早 ~0-250ms（实测 smoke 928ms 处即出现 tap 响应帧），
// 首变/停滞检索统一从 anchor−ANCHOR_SLACK 起查，读数负值按 0 处理（编码器延迟 > 注入延迟时输入帧早于名义锚点）。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
};

// ── adb ──────────────────────────────────────────────────────────────────────
function adbSync(args, timeout = 30000) {
  return execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8", timeout });
}
function adbAsync(args, timeout = 30000) {
  return new Promise((res, rej) => {
    execFile("adb", ["-s", SERIAL, ...args], { encoding: "utf8", timeout }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(err, { stderr }));
      else res(stdout);
    });
  });
}
function adbBuffer(args, timeout = 30000) {
  return new Promise((res, rej) => {
    execFile("adb", ["-s", SERIAL, ...args], { encoding: "buffer", timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) rej(err);
      else res(stdout);
    });
  });
}

// ── CDP（复用 cdp_login.mjs 的连接方式）──────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
  }

  static async connect() {
    const pid = adbSync(["shell", "pidof", PKG]).trim().split(/\s+/)[0];
    if (!pid) throw new Error("app 未运行（无 pid）");
    adbSync(["forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
    let targets = [];
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        targets = await res.json();
        if (targets.length) break;
      } catch {
        /* socket 未就绪，重试 */
      }
      await sleep(400);
    }
    const page = targets.find((t) => t.type === "page") ?? targets[0];
    if (!page) throw new Error("无 CDP page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("CDP websocket 连接失败"));
    });
    return new Cdp(ws);
  }

  eval(expression, timeoutMs = 8000) {
    const i = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(i);
        rej(new Error("CDP eval 超时"));
      }, timeoutMs);
      this.pending.set(i, {
        res: (r) => {
          clearTimeout(timer);
          if (r?.exceptionDetails) rej(new Error("evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 300)));
          else res(r?.result?.value);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      this.ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** 带「断线重连一次」的 eval。cdpRef = { cdp: Cdp|null }（可变引用，重连后原地更新）。 */
async function evalSafe(cdpRef, expression) {
  try {
    return await cdpRef.cdp.eval(expression);
  } catch (e) {
    log(`CDP eval 失败（${String(e.message).slice(0, 80)}），重连重试一次`);
    try {
      cdpRef.cdp?.close();
    } catch {
      /* ignore */
    }
    cdpRef.cdp = await Cdp.connect();
    return cdpRef.cdp.eval(expression);
  }
}

// ── DOM 探测表达式（元素存在性口径，ri-366 报告建议）─────────────────────────
const EXPR_FEED_STATE = `(() => {
  const cards = document.querySelectorAll('[data-testid="illust-card"]');
  let imgs = 0;
  for (const i of document.querySelectorAll('[data-testid="illust-card"] img')) {
    if (i.complete && i.naturalWidth > 0) imgs++;
  }
  return { path: location.pathname, cards: cards.length, imgs,
           skeletons: document.querySelectorAll('[data-testid="skeleton-shimmer"]').length };
})()`;

const EXPR_DETAIL_STATE = `(() => {
  const pageImgs = [...document.querySelectorAll('[data-page-index] img')];
  const anyBig = [...document.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth >= 300);
  return { path: location.pathname,
           pages: document.querySelectorAll('[data-page-index]').length,
           imgOk: pageImgs.some((i) => i.complete && i.naturalWidth > 0) || anyBig };
})()`;

// ── 判定线出处（summary 逐指标引用，禁止无出处判定线）────────────────────────
const SRC = {
  stall: "docs/research/ri-365-coldstart-report.md（FT-2 验收线：最长完全静止段 <1s）",
  waittime: "docs/research/ri-365-coldstart-report.md（暖基线 1782ms；网络/缓存波动，仅记录不设回归线）",
  detailSkeleton: "docs/research/real-interaction-audit.md 场景 2（骨架帧 ≤1.1s）",
  detailInteractive: "docs/research/real-interaction-audit.md 场景 2（可交互帧 ≤2s）",
  backResponse: "docs/research/real-interaction-audit.md 场景 3（响应 ≤400ms 且 3 rep 方差 <100ms）",
  backTransition: "docs/research/real-interaction-audit.md 场景 3 + FT-1A（过渡动画存在 ⇒ 过渡帧数 ≥1；VFR 快动画可被压缩为单帧切换）",
  tabResponse: "docs/research/real-interaction-audit.md 场景 4（响应 ≤1.1s）",
  tabBlank: "docs/research/ri-366-shimmer-report.md（FT-3 验收线：空白窗=0；>500ms 无卡片段即 fail）",
  scrollP90: "docs/research/real-interaction-audit.md 场景 5（VFR delta p90 ≤34ms）",
  scrollStall: "docs/research/real-interaction-audit.md 场景 5（滚动窗内无 >200ms 停滞）",
  viewerOpen: "docs/research/real-interaction-audit.md 场景 6（开启占位 ≤200ms）",
  viewerFlip: "docs/research/ri-367-viewer-report.md（FT-4 验收线：翻页释放→新页首帧 ≤500ms）",
};

// ── 录制：screenrecord（主）+ screencap 轮询（空文件降级）────────────────────
class ScreenRecorder {
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.remote = `/sdcard/pictelio_reg_${name}.mp4`;
    this.local = join(dir, `${name}.mp4`);
    this.child = null;
  }

  start(maxSecs) {
    try {
      adbSync(["shell", "rm", "-f", this.remote]);
    } catch {
      /* ignore */
    }
    // 与 start_rec.sh 同款：VFR、4M 码率；--time-limit 兜底
    this.child = spawn("adb", ["-s", SERIAL, "shell", "screenrecord", "--time-limit", String(maxSecs), "--bit-rate", "4M", this.remote], { stdio: "ignore" });
  }

  /** SIGINT finalize（与 stop_rec.sh 同款 pkill -2），等待编码器收尾后拉回。 */
  async stopAndPull() {
    if (this.child) {
      try {
        adbSync(["shell", "pkill", "-2", "screenrecord"]);
      } catch {
        /* 无进程时 pkill 非零，忽略 */
      }
      await Promise.race([new Promise((res) => this.child.once("exit", res)), sleep(6000)]);
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      this.child = null;
      await sleep(500);
    }
    try {
      adbSync(["pull", this.remote, this.local], 30000);
      const size = existsSync(this.local) ? statSync(this.local).size : 0;
      // 已知坑：模拟器编码器静默失效产出 3232 字节空文件（ri-366 报告）
      return { ok: size > 4000, size };
    } catch (e) {
      return { ok: false, size: 0, error: String(e.message) };
    }
  }
}

/** screencap 轮询采样（exec-out 直传 host，文件名含相对 ms 时间戳）。 */
class ScreencapSampler {
  constructor(dir) {
    this.dir = join(dir, "screencap");
    mkdirSync(this.dir, { recursive: true });
    this.seq = 0;
    this.t0 = 0;
  }

  async run(durationMs, intervalMs = 250) {
    this.t0 = Date.now();
    for (;;) {
      if (Date.now() - this.t0 > durationMs) break;
      try {
        const buf = await adbBuffer(["exec-out", "screencap", "-p"], 20000);
        if (buf?.length > 100) {
          const rel = Date.now() - this.t0;
          const name = `${String(++this.seq).padStart(4, "0")}_${String(rel).padStart(6, "0")}.png`;
          writeFileSync(join(this.dir, name), buf);
        }
      } catch {
        /* 单帧失败跳过 */
      }
      const next = this.t0 + this.seq * intervalMs;
      await sleep(Math.max(30, next - Date.now()));
    }
  }
}

// ── 帧分析：mp4 走 analyze_rec.py；screencap 走同口径内联 python ─────────────
const PY_SCREENCAP = `
import os, sys, json
import numpy as np
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
names = sorted(f for f in os.listdir(d) if f.endswith(".png"))
frames = []; prev = None
for n in names:
    t = int(n.split("_")[1].split(".")[0])
    a = np.asarray(Image.open(os.path.join(d, n)).convert("L").resize((90, 160)), dtype=np.float32)
    diff = 0.0 if prev is None else float(np.abs(a - prev).mean())
    prev = a
    frames.append({"pts_ms": t, "delta_ms": t - frames[-1]["pts_ms"] if frames else 0, "diff": round(diff, 3)})
stalls = []; st = None
for i in range(1, len(frames)):
    if frames[i]["diff"] <= 2.0:
        if st is None: st = frames[i - 1]["pts_ms"]
    else:
        if st is not None and frames[i]["pts_ms"] - st > 200:
            stalls.append({"from_ms": st, "to_ms": frames[i]["pts_ms"], "duration_ms": frames[i]["pts_ms"] - st})
        st = None
json.dump({"mode": "screencap", "frames": frames, "stalls_over_200ms": stalls,
           "frame_count": len(frames), "duration_ms": frames[-1]["pts_ms"] if frames else 0},
          open(out, "w"), ensure_ascii=False)
print("OK", len(frames), "frames ->", out)
`;

function analyzeMp4(mp4, outJson, keyframesPrefix = null) {
  const args = ["analyze_rec.py", mp4, "--out", outJson];
  if (keyframesPrefix) args.push("--keyframes-prefix", keyframesPrefix);
  execFileSync("python3", args, { cwd: SCRIPT_DIR, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(readFileSync(outJson, "utf8"));
}

function analyzeScreencaps(dir, outJson) {
  execFileSync("python3", ["-c", PY_SCREENCAP, join(dir, "screencap"), outJson], {
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(readFileSync(outJson, "utf8"));
}

/**
 * 统一录制窗口：t=0 启动录制 → t≈1000ms 执行 act() → t=holdMs 结束。
 * screenrecord 产出空文件（≤4000B）时返回 failed=true，由调用方以 screencap 模式重跑整个场景。
 */
async function captureInteraction({ name, dir, mode, maxSecs, holdMs, act, keyframes = false }) {
  const analysisPath = join(dir, `${name}.frames.json`);
  if (mode === "screenrecord") {
    const rec = new ScreenRecorder(dir, name);
    rec.start(maxSecs);
    const t0 = Date.now();
    await sleep(Math.max(0, INPUT_ANCHOR_MS - (Date.now() - t0)));
    const actResult = await act();
    await sleep(Math.max(0, holdMs - (Date.now() - t0)));
    const pull = await rec.stopAndPull();
    if (!pull.ok) {
      return { mode, failed: true, reason: `screenrecord 产出过小（${pull.size}B，编码器静默失效）` };
    }
    let analysis;
    try {
      analysis = analyzeMp4(rec.local, analysisPath, keyframes ? join(dir, `${name}_kf`) : null);
    } catch (e) {
      // 偶发：stop 竞态产出可下载但 ffmpeg 不可解的损坏 mp4（#368 首轮 coldstart 实录）
      // → 与空文件同路降级 screencap 整场景重跑
      return { mode, failed: true, reason: `mp4 解析失败（${String(e).slice(0, 120)}）→ 降级 screencap` };
    }
    return { mode, failed: false, analysis, actResult, mp4: rec.local };
  }
  // screencap 降级模式（采样粒度 ~250-400ms：静止段/首变时刻读数相应变粗，README 已记）
  const sampler = new ScreencapSampler(dir);
  const runP = sampler.run(holdMs);
  await sleep(INPUT_ANCHOR_MS);
  const actResult = await act();
  await runP;
  const analysis = analyzeScreencaps(dir, analysisPath);
  return { mode, failed: false, analysis, actResult };
}

// ── 帧指标提取 ────────────────────────────────────────────────────────────────
function firstChangeMs(frames, anchorMs, thr = 2.0) {
  const from = Math.max(0, anchorMs - ANCHOR_SLACK);
  const f = frames.find((x) => x.pts_ms >= from && x.diff > thr);
  return f ? Math.max(0, f.pts_ms - anchorMs) : null;
}
function lastChangeMs(frames, thr = 2.0) {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].diff > thr) return frames[i].pts_ms;
  }
  return null;
}
/** 停滞段（按段起点 ∈ [fromMs, toMs] 过滤——桌面/加载前的段起点 0 不计入交互窗）。 */
function maxStallIn(stalls, fromMs, toMs = Infinity) {
  let max = null;
  for (const s of stalls) {
    if (s.from_ms >= fromMs && s.from_ms <= toMs) {
      if (max === null || s.duration_ms > max) max = s.duration_ms;
    }
  }
  return max;
}
function stallsIn(stalls, fromMs, toMs = Infinity) {
  return stalls.filter((s) => s.from_ms >= fromMs && s.from_ms <= toMs);
}
/** 显著帧（diff>thr）间最大静默间隔——「翻页释放→新页帧 ≤500ms 或期间有可见反馈」的操作化口径：
 *  拖拽跟手帧=可见反馈；预取未命中的黑屏冻结会表现为显著帧间 ~2s 间隔。 */
function maxSignificantGap(frames, fromMs, thr = 2.0) {
  const pts = frames.filter((f) => f.pts_ms >= fromMs && f.diff > thr).map((f) => f.pts_ms);
  let max = null;
  for (let i = 1; i < pts.length; i++) {
    const g = pts[i] - pts[i - 1];
    if (max === null || g > max) max = g;
  }
  return max;
}
function deltaP90(frames, fromMs, toMs) {
  const ds = frames.filter((f) => f.pts_ms >= fromMs && f.pts_ms <= toMs && f.delta_ms > 0).map((f) => f.delta_ms);
  if (!ds.length) return null;
  ds.sort((a, b) => a - b);
  return ds[Math.min(ds.length - 1, Math.ceil(0.9 * ds.length) - 1)];
}

// summary 指标构造：{值, 判定线, pass, 出处[, note]}；pass 三态：true/false/null（null=仅记录或无法测定）
const met = (value, line, pass, source, note) => (note ? { value, line, pass, source, note } : { value, line, pass, source });
/** 无法测定（value=null）时 pass 记 null，不判 false。 */
const judge = (value, ok) => (value === null || value === undefined ? null : ok);

// ── 环境自检与导航辅助 ────────────────────────────────────────────────────────
async function envCheck() {
  const devs = execFileSync("adb", ["devices"], { encoding: "utf8", timeout: 15000 });
  if (!new RegExp(`^${SERIAL}\\s+device$`, "m").test(devs)) {
    console.error(`环境自检失败：设备 ${SERIAL} 未连接（adb devices）`);
    process.exit(2);
  }
  try {
    adbSync(["shell", "pm", "path", PKG]);
  } catch {
    console.error(`环境自检失败：未安装 ${PKG}`);
    process.exit(2);
  }
  // flavor 核对：launcher activity 必须是 webview flavor（历史事故：full flavor 覆盖安装）
  const launcherRaw = adbSync(["shell", "cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LAUNCHER", PKG]);
  const launcher = launcherRaw.trim().split("\n").filter(Boolean).pop().trim();
  if (!launcher.endsWith(MAIN_ACTIVITY)) {
    console.error(
      `环境自检失败：launcher=${launcher}，期望 ${PKG}/${MAIN_ACTIVITY}（webview flavor）。\n` +
        `full flavor（.MainActivity，双引擎）曾误装覆盖 webview flavor，须重装 apk/webview/debug/ 产物后重跑。`,
    );
    process.exit(2);
  }
  const size = adbSync(["shell", "wm", "size"]).match(/(\d+x\d+)/)?.[1];
  if (size !== "720x1280") {
    log(`警告：屏幕 ${size} ≠ 720x1280，固定坐标（首卡/侧导航/查看器）可能失准`);
  }
  // app 前台
  const focus = adbSync(["shell", "dumpsys", "activity", "activities"]);
  if (!/ResumedActivity[=:].*io\.pictelio\.app/.test(focus)) {
    log("app 不在前台，启动中…");
    await adbAsync(["shell", "am", "start", "-W", "-n", `${PKG}/${MAIN_ACTIVITY}`], 60000);
    await sleep(1500);
  }
  return {
    serial: SERIAL,
    launcher,
    screen: size,
    android: adbSync(["shell", "getprop", "ro.build.version.release"]).trim(),
    model: adbSync(["shell", "getprop", "ro.product.model"]).trim(),
    apk_version: adbSync(["shell", "dumpsys", "package", PKG]).match(/versionName=(\S+)/)?.[1] ?? "?",
    webview_version: adbSync(["shell", "dumpsys", "package", "com.google.android.webview"]).match(/versionName=(\S+)/)?.[1] ?? "?",
  };
}

async function waitFeedReady(cdpRef, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    let s = null;
    try {
      s = await evalSafe(cdpRef, EXPR_FEED_STATE);
    } catch {
      /* 重连中，继续等 */
    }
    if (s && s.cards >= 1 && s.imgs >= 1) return s;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        `首页 Feed ${timeoutMs / 1000}s 未就绪（${JSON.stringify(s)}）。` +
          `疑似模拟器访问 Pixiv 卡死：可 adb -s ${SERIAL} reboot 后重跑（重启后需重新核对登录态与 flavor）`,
      );
    }
    await sleep(400);
  }
}

async function ensureHome(cdpRef) {
  // 逐层退出非 home 路由（查看器/评论浮层/详情页可能叠加多层，需多次 BACK）
  for (let i = 0; i < 5; i++) {
    const s = await evalSafe(cdpRef, "location.pathname");
    if (typeof s === "string" && s === "/home") break;
    await adbAsync(["shell", "input", "keyevent", "4"]);
    await sleep(1200);
  }
  return waitFeedReady(cdpRef, 90000);
}

async function waitDetailReady(cdpRef, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    let s = null;
    try {
      s = await evalSafe(cdpRef, EXPR_DETAIL_STATE);
    } catch {
      /* ignore */
    }
    if (s && s.path?.startsWith("/illust") && s.imgOk) return s;
    if (Date.now() - t0 > timeoutMs) return s; // 超时返回当前状态，由调用方决定
    await sleep(300);
  }
}

async function screenshot(dir, name) {
  try {
    const buf = await adbBuffer(["exec-out", "screencap", "-p"], 20000);
    writeFileSync(join(dir, `${name}.png`), buf);
  } catch (e) {
    log(`截图失败 ${name}: ${e.message}`);
  }
}

// ── 场景 1：冷启动 ────────────────────────────────────────────────────────────
/** CDP 轮询 chrome/首图（仅记录口径）：与录制并发跑，不干预交互。 */
async function pollColdstartCdp(cdpRef, maxMs) {
  const t0 = Date.now();
  let chromeMs = null;
  let firstImgMs = null;
  for (;;) {
    if (chromeMs !== null && firstImgMs !== null) break;
    if (Date.now() - t0 > maxMs) break;
    try {
      if (!cdpRef.cdp) cdpRef.cdp = await Cdp.connect();
      const s = await cdpRef.cdp.eval(EXPR_FEED_STATE);
      if (s) {
        if (chromeMs === null && s.path === "/home") chromeMs = Date.now() - t0;
        if (firstImgMs === null && s.imgs >= 1) firstImgMs = Date.now() - t0;
      }
    } catch {
      try {
        cdpRef.cdp?.close();
      } catch {
        /* ignore */
      }
      cdpRef.cdp = null;
    }
    await sleep(250);
  }
  return { chromeMs, firstImgMs };
}

async function sceneColdstart(ctx) {
  const dir = ctx.dir("coldstart");
  const notes = [];
  const attempt = async (mode) => {
    adbSync(["shell", "am", "force-stop", PKG]);
    await adbAsync(["shell", "input", "keyevent", "3"]); // HOME 回桌面
    await sleep(1500);
    ctx.cdp.cdp = null; // force-stop 后旧连接失效
    const obsP = pollColdstartCdp(ctx.cdp, 25000);
    const r = await captureInteraction({
      name: "coldstart",
      dir,
      mode,
      maxSecs: 15,
      holdMs: 13000,
      act: async () => {
        const amOut = await adbAsync(["shell", "am", "start", "-W", "-n", `${PKG}/${MAIN_ACTIVITY}`], 60000);
        writeFileSync(join(dir, "amstart.txt"), amOut);
        return amOut;
      },
    });
    const obs = await obsP;
    return { r, obs };
  };

  let { r, obs } = await attempt("screenrecord");
  if (r.failed) {
    notes.push(`${r.reason} → 降级 screencap 轮询整场景重跑`);
    log("coldstart: " + notes.at(-1));
    ({ r, obs } = await attempt("screencap"));
    if (r.failed) throw new Error("coldstart 双模式录制均失败");
  }

  const frames = r.analysis.frames;
  const stalls = r.analysis.stalls_over_200ms;
  const splashFirst = firstChangeMs(frames, INPUT_ANCHOR_MS);
  const maxStall = maxStallIn(stalls, Math.max(0, INPUT_ANCHOR_MS - ANCHOR_SLACK)); // 桌面静止段（am start 前）不计入
  const amOut = typeof r.actResult === "string" ? r.actResult : "";
  const waitTime = Number(amOut.match(/WaitTime:\s*(\d+)/)?.[1] ?? NaN);
  const totalTime = Number(amOut.match(/TotalTime:\s*(\d+)/)?.[1] ?? NaN);
  await screenshot(dir, "after_12s");
  writeFileSync(
    join(dir, "coldstart.json"),
    JSON.stringify(
      {
        metrics: {
          splash_first_ms: met(splashFirst, null, null, "体检报告场景 1（splash 首帧=首个显著变化帧）", "含 adb 注入延迟，仅记录"),
          max_stall_ms: met(maxStall, "<1000", judge(maxStall, maxStall < 1000), SRC.stall, r.mode === "screencap" ? "screencap 降级模式，分辨率 ~±350ms" : "录屏 VFR 停滞段（≥200ms 段取最大）"),
          waittime_ms: met(waitTime, null, null, SRC.waittime, "仅记录（网络/缓存波动）"),
          totaltime_ms: met(totalTime, null, null, SRC.waittime, "仅记录"),
          chrome_cdp_ms: met(obs.chromeMs, null, null, "体检报告场景 1 首屏帧口径的 DOM 代理（/home 路由首现）", "CDP 口径，仅记录"),
          first_image_cdp_ms: met(obs.firstImgMs, null, null, "体检报告场景 1 首图帧口径的 DOM 代理（首卡 img complete）", "CDP 口径，仅记录"),
        },
        mode: r.mode,
        notes,
      },
      null,
      1,
    ),
  );
  log(`coldstart: max_stall=${maxStall}ms (line <1000), WaitTime=${waitTime}ms`);
}

// ── 场景 2：点进详情 ──────────────────────────────────────────────────────────
async function sceneDetail(ctx) {
  const dir = ctx.dir("detail");
  const notes = [];
  const attempt = async (mode) => {
    await ensureHome(ctx.cdp);
    return captureInteraction({
      name: "detail",
      dir,
      mode,
      maxSecs: 10,
      holdMs: 9000,
      act: async () => adbAsync(["shell", "input", "tap", ...XY_FIRST_CARD]),
      keyframes: KEYFRAMES,
    });
  };
  let r = await attempt("screenrecord");
  if (r.failed) {
    notes.push(`${r.reason} → 降级 screencap 轮询重跑`);
    log("detail: " + notes.at(-1));
    r = await attempt("screencap");
    if (r.failed) throw new Error("detail 双模式录制均失败");
  }
  const frames = r.analysis.frames;
  const skeletonMs = firstChangeMs(frames, INPUT_ANCHOR_MS);
  const lastChange = lastChangeMs(frames);
  const interactiveMs = lastChange !== null ? lastChange - INPUT_ANCHOR_MS : null;
  await screenshot(dir, "settled");
  writeFileSync(
    join(dir, "detail.json"),
    JSON.stringify(
      {
        metrics: {
          skeleton_ms: met(skeletonMs, "≤1100", judge(skeletonMs, skeletonMs <= 1100), SRC.detailSkeleton, "含 input 注入延迟与触摸指示帧（体检同口径）"),
          interactive_ms: met(interactiveMs, "≤2000", judge(interactiveMs, interactiveMs <= 2000), SRC.detailInteractive, "近似口径：末次显著变化帧（首卡大图 Feed 缓存口径，体检场景 2 同）"),
        },
        mode: r.mode,
        notes,
      },
      null,
      1,
    ),
  );
  log(`detail: skeleton=${skeletonMs}ms (≤1100), interactive=${interactiveMs}ms (≤2000)`);
}

// ── 场景 3：系统返回 ×3 rep ───────────────────────────────────────────────────
async function sceneBack(ctx) {
  const dir = ctx.dir("back");
  const notes = [];
  const reps = [];
  for (let rep = 1; rep <= 3; rep++) {
    const attempt = async (mode) => {
      // rep1 沿用场景 2 所在详情页；rep2/3 回 home 后重进（同首卡，缓存口径）
      const before = await evalSafe(ctx.cdp, "location.pathname");
      if (!(typeof before === "string" && before.startsWith("/illust"))) {
        await waitFeedReady(ctx.cdp, 90000);
        await adbAsync(["shell", "input", "tap", ...XY_FIRST_CARD]);
      }
      const ready = await waitDetailReady(ctx.cdp, 30000);
      if (!ready?.imgOk) notes.push(`rep${rep}: 详情图 30s 未就绪（网络支配），按当前状态录制`);
      await sleep(1500); // 落定
      return captureInteraction({
        name: `back_rep${rep}`,
        dir,
        mode,
        maxSecs: 6,
        holdMs: 4500,
        act: async () => adbAsync(["shell", "input", "keyevent", "4"]),
        keyframes: KEYFRAMES && rep === 1,
      });
    };
    let r = await attempt("screenrecord");
    if (r.failed) {
      notes.push(`rep${rep}: ${r.reason} → 降级 screencap 重跑`);
      log(`back rep${rep}: ` + notes.at(-1));
      r = await attempt("screencap");
      if (r.failed) throw new Error(`back rep${rep} 双模式录制均失败`);
    }
    const frames = r.analysis.frames;
    const response = firstChangeMs(frames, INPUT_ANCHOR_MS);
    const settle = lastChangeMs(frames) ?? frames.at(-1)?.pts_ms ?? INPUT_ANCHOR_MS;
    // 过渡帧：响应帧之后到落定帧之间的显著变化帧数（FT-1A 过渡动画；单帧切换=0）
    const transition = frames.filter((f) => f.pts_ms > INPUT_ANCHOR_MS + (response ?? 0) && f.pts_ms <= settle && f.diff > 2).length;
    reps.push({ rep, response_ms: response, settle_ms: settle - INPUT_ANCHOR_MS, transition_frames: transition, mode: r.mode });
    log(`back rep${rep}: response=${response}ms, transition=${transition}f, settle=${settle - INPUT_ANCHOR_MS}ms`);
    await sleep(800);
  }
  const responses = reps.map((x) => x.response_ms).filter((v) => v !== null);
  const transitions = reps.map((x) => x.transition_frames);
  const variance = responses.length === 3 ? Math.max(...responses) - Math.min(...responses) : null;
  await screenshot(dir, "home_after_rep3");
  writeFileSync(
    join(dir, "back.json"),
    JSON.stringify(
      {
        metrics: {
          response_ms_max: met(responses.length ? Math.max(...responses) : null, "≤400", responses.length === 3 ? judge(Math.max(...responses), Math.max(...responses) <= 400) : null, SRC.backResponse, `3 rep = [${responses.join(", ")}]ms（含注入延迟，体检同口径）`),
          transition_frames_max: met(transitions.length ? Math.max(...transitions) : null, "≥1", transitions.length === 3 ? judge(Math.max(...transitions), Math.max(...transitions) >= 1) : null, SRC.backTransition, `3 rep = [${transitions.join(", ")}]；VFR 快动画可被压缩为单帧切换，任一 rep 出现过渡帧即证明动画存在，3 rep 全 0 才判 fail`),
          variance_ms: met(variance, "<100", judge(variance, variance < 100), SRC.backResponse, "3 rep response max-min"),
        },
        reps,
        notes,
      },
      null,
      1,
    ),
  );
  log(`back: response_max=${Math.max(...responses)}ms (≤400), transition=${transitions.join("/")} (≥1), variance=${variance}ms (<100)`);
}

// ── 场景 4：tab 切换（DOM 元素存在性口径，FT-3）──────────────────────────────
function blankWindowMaxMs(timeline) {
  // 状态机：骨架出现过之后，「骨架=0 且卡片=0」连续段的最大时长（骨架卸载→内容出现前的空白窗）
  let sawSkeleton = false;
  let blankStart = null;
  let maxBlank = 0;
  for (const s of timeline) {
    if (s.skeletons > 0) {
      sawSkeleton = true;
      if (blankStart !== null) {
        maxBlank = Math.max(maxBlank, s.t - blankStart);
        blankStart = null;
      }
    } else if (sawSkeleton && s.cards === 0) {
      if (blankStart === null) blankStart = s.t;
      maxBlank = Math.max(maxBlank, s.t - blankStart);
    } else if (s.cards > 0) {
      blankStart = null;
    }
  }
  return maxBlank;
}

async function sceneTabs(ctx) {
  const dir = ctx.dir("tabs");
  const notes = [];
  const switches = [];
  await ensureHome(ctx.cdp);
  await adbAsync(["shell", "input", "tap", ...NAV.home]);
  await sleep(600);
  await waitFeedReady(ctx.cdp, 90000);

  for (const tab of [
    { key: "follow", xy: NAV.follow, label: "推荐→关注" },
    { key: "bookmark", xy: NAV.bookmark, label: "关注→收藏" },
  ]) {
    const timeline = [];
    let polling = true;
    const poller = (async () => {
      while (polling) {
        try {
          const s = await evalSafe(ctx.cdp, EXPR_FEED_STATE);
          if (s) timeline.push({ t: Date.now(), path: s.path, skeletons: s.skeletons, cards: s.cards, imgs: s.imgs });
        } catch {
          ctx.cdp.cdp = null;
        }
        await sleep(120);
      }
    })();
    await sleep(500); // 保证有 tap 前基线样本
    const base = timeline.at(-1);
    const baseSig = base ? `${base.skeletons}/${base.cards}/${base.imgs}` : null;
    const t0 = Date.now();
    await adbAsync(["shell", "input", "tap", ...tab.xy]);
    // 等切换落定：卡片出现且骨架卸载，且 2s 状态无变化；或超时
    let settledAt = Date.now();
    let lastSig = "";
    for (;;) {
      const cur = timeline.at(-1);
      const sig = cur ? `${cur.skeletons === 0}/${cur.cards > 0}` : "";
      if (sig !== lastSig) {
        lastSig = sig;
        settledAt = Date.now();
      }
      const stable = cur && cur.cards > 0 && cur.skeletons === 0 && Date.now() - settledAt > 2000 && Date.now() - t0 > 2500;
      if (stable || Date.now() - t0 > 25000) break;
      await sleep(150);
    }
    polling = false;
    await poller;
    const rel = timeline.map((s) => ({ ...s, t: s.t - t0 }));
    writeFileSync(join(dir, `${tab.key}_timeline.json`), JSON.stringify(rel, null, 1));
    const post = rel.filter((s) => s.t >= 0);
    const firstSkeleton = post.find((s) => s.skeletons > 0);
    const firstSigChange = post.find((s) => `${s.skeletons}/${s.cards}/${s.imgs}` !== baseSig);
    const firstContent = post.find((s) => s.skeletons === 0 && s.cards > 0 && `${s.skeletons}/${s.cards}/${s.imgs}` !== baseSig);
    const blank = blankWindowMaxMs(post);
    const response = firstSkeleton ? firstSkeleton.t : firstSigChange ? firstSigChange.t : null;
    const cached = !firstSkeleton && !!firstContent;
    await screenshot(dir, `${tab.key}_after`);
    switches.push({
      tab: tab.key,
      label: tab.label,
      response_ms: response,
      cached_no_skeleton: cached,
      content_ready_ms: firstContent ? firstContent.t : null,
      blank_window_max_ms: blank,
    });
    log(`tabs ${tab.label}: response=${response}ms${cached ? " (缓存直现无骨架)" : ""}, blank_max=${blank}ms (line 无>500ms), ready=${firstContent?.t ?? "?"}ms`);
    await sleep(1000);
  }
  // 切回推荐，恢复现场
  await adbAsync(["shell", "input", "tap", ...NAV.home]);
  await waitFeedReady(ctx.cdp, 90000);

  const metrics = {};
  for (const sw of switches) {
    metrics[`${sw.tab}_response_ms`] = met(sw.response_ms, "≤1100", judge(sw.response_ms, sw.response_ms <= 1100), SRC.tabResponse, sw.cached_no_skeleton ? "缓存直现无骨架（本会话已访问过），以首个状态变化计" : "骨架首现口径（DOM 元素存在性）");
    metrics[`${sw.tab}_blank_window_max_ms`] = met(sw.blank_window_max_ms, "≤500（空白窗=0）", sw.blank_window_max_ms <= 500, SRC.tabBlank, "骨架出现过之后骨架=0 且卡片=0 的最长连续段（DOM 元素存在性口径）");
    metrics[`${sw.tab}_content_ready_ms`] = met(sw.content_ready_ms, null, null, "体检报告场景 4 内容就绪（网络支配，仅记录）");
  }
  writeFileSync(join(dir, "tabs.json"), JSON.stringify({ metrics, switches, notes }, null, 1));
}

// ── 场景 5：滚动（慢拖/快甩）─────────────────────────────────────────────────
async function sceneScroll(ctx) {
  const dir = ctx.dir("scroll");
  const notes = [];
  const metrics = {};
  const gestures = [
    { key: "slow", args: SWIPE_SLOW },
    { key: "fling", args: SWIPE_FLING },
  ];
  for (const g of gestures) {
    const attempt = async (mode) => {
      await ensureHome(ctx.cdp);
      return captureInteraction({
        name: `scroll_${g.key}`,
        dir,
        mode,
        maxSecs: 6,
        holdMs: 4500,
        act: async () => adbAsync(["shell", "input", "swipe", ...g.args]),
      });
    };
    let r = await attempt("screenrecord");
    if (r.failed) {
      notes.push(`${g.key}: ${r.reason} → 降级 screencap 重跑`);
      log(`scroll ${g.key}: ` + notes.at(-1));
      r = await attempt("screencap");
      if (r.failed) throw new Error(`scroll ${g.key} 双模式录制均失败`);
    }
    const WINDOW = [800, 3400]; // 手势 ~1000ms 起（锚点容差 −250）+ 惯性/渐进窗；停滞段按起点∈窗过滤，手势前静止段起点 0 不计入
    const frames = r.analysis.frames;
    const stalls = stallsIn(r.analysis.stalls_over_200ms, WINDOW[0], WINDOW[1]);
    const p90 = r.mode === "screenrecord" ? deltaP90(frames, WINDOW[0], WINDOW[1]) : null;
    metrics[`scroll_${g.key}_delta_p90_ms`] = met(
      p90,
      "≤34",
      judge(p90, p90 <= 34),
      SRC.scrollP90,
      r.mode === "screenrecord" ? `滚动窗 ${WINDOW[0]}-${WINDOW[1]}ms 内帧间隔 p90` : "screencap 降级模式无法测 VFR 帧间隔，pass 无法判定（仅记录）",
    );
    metrics[`scroll_${g.key}_stalls_over_200ms`] = met(
      stalls.length,
      "=0",
      stalls.length === 0,
      SRC.scrollStall,
      stalls.length ? JSON.stringify(stalls) : `滚动窗 ${WINDOW[0]}-${WINDOW[1]}ms 内无 >200ms 无变化段`,
    );
    log(`scroll ${g.key}: p90=${p90}ms (≤34), stalls>200ms=${stalls.length} (=0)`);
    await sleep(800);
  }
  writeFileSync(join(dir, "scroll.json"), JSON.stringify({ metrics, notes }, null, 1));
}

// ── 场景 6：查看器（开 + 翻页，多图作品）─────────────────────────────────────
/** 确保「多图作品详情页、查看器关闭、首图就绪」。 */
async function ensureMultipageDetail(ctx, dir, notes) {
  let s = await evalSafe(ctx.cdp, EXPR_DETAIL_STATE);
  if (s?.path?.startsWith("/illust") && s.pages >= 2 && s.imgOk) return true;
  for (let attempt = 0; attempt < 10; attempt++) {
    const cards = await evalSafe(ctx.cdp, `(() => {
      const out = [];
      for (const b of document.querySelectorAll('[data-testid="illust-type-badges"] span[aria-label^="共"]')) {
        const card = b.closest('[data-testid="illust-card"]');
        if (!card) continue;
        const r = card.getBoundingClientRect();
        out.push({ top: r.top, height: r.height, label: b.getAttribute("aria-label") });
      }
      return out;
    })()`);
    const visible = (cards ?? []).find((c) => c.top > 130 && c.top + Math.min(c.height, 560) < 1280);
    if (visible) {
      const y = Math.round(Math.min(Math.max(visible.top + visible.height / 2, 200), 1150));
      log(`viewer: 多图卡 ${visible.label} @ y=${y}（第 ${attempt + 1} 次尝试）`);
      await adbAsync(["shell", "input", "tap", "360", String(y)]);
      const ready = await waitDetailReady(ctx.cdp, 30000);
      if (ready?.path?.startsWith("/illust") && ready.pages >= 2) {
        await screenshot(dir, "detail_multipage");
        return true;
      }
      notes.push(`进入的详情非多图（${JSON.stringify(ready)}），返回重找`);
      await adbAsync(["shell", "input", "keyevent", "4"]);
      await sleep(1200);
    }
    await adbAsync(["shell", "input", "swipe", "360", "1000", "360", "350", "400"]);
    await sleep(1500);
  }
  return false;
}

async function sceneViewer(ctx) {
  const dir = ctx.dir("viewer");
  const notes = [];
  await ensureHome(ctx.cdp);
  if (!(await ensureMultipageDetail(ctx, dir, notes))) {
    throw new Error("首页 10 屏内未找到多图作品（角标「共 N 图」），查看器场景无法执行翻页判定");
  }
  await sleep(2000); // 首页落定 + FT-4 邻页预取窗口

  const runOpen = (mode) =>
    captureInteraction({
      name: "viewer_open",
      dir,
      mode,
      maxSecs: 6,
      holdMs: 5000,
      act: async () => adbAsync(["shell", "input", "tap", ...XY_VIEWER_OPEN]),
      keyframes: KEYFRAMES,
    });
  let rOpen = await runOpen("screenrecord");
  if (rOpen.failed) {
    // 恢复到「多图详情、查看器关闭」再降级重跑（失败尝试可能已把查看器点开）
    const p = await evalSafe(ctx.cdp, "location.pathname");
    if (typeof p === "string" && p.startsWith("/illust")) {
      await adbAsync(["shell", "input", "keyevent", "4"]);
      await sleep(1000);
    }
    notes.push(`viewer_open: ${rOpen.reason} → 降级 screencap 重跑`);
    if (!(await ensureMultipageDetail(ctx, dir, notes))) throw new Error("降级重跑前未能恢复多图详情");
    await sleep(1500);
    rOpen = await runOpen("screencap");
    if (rOpen.failed) throw new Error("viewer_open 双模式录制均失败");
  }
  const openMs = firstChangeMs(rOpen.analysis.frames, INPUT_ANCHOR_MS);
  log(`viewer open=${openMs}ms (≤200)`);

  const runFlip = (mode) =>
    captureInteraction({
      name: "viewer_flip",
      dir,
      mode,
      maxSecs: 7,
      holdMs: 5500,
      act: async () => adbAsync(["shell", "input", "swipe", ...SWIPE_FLIP]),
      keyframes: KEYFRAMES,
    });
  let rFlip = await runFlip("screenrecord");
  if (rFlip.failed) {
    notes.push(`viewer_flip: ${rFlip.reason} → 降级 screencap 重跑（先滑回第 1 页）`);
    // 失败尝试可能已翻到第 2 页：先滑回，保证重跑仍从第 1 页翻起
    await adbAsync(["shell", "input", "swipe", SWIPE_FLIP[2], SWIPE_FLIP[3], SWIPE_FLIP[0], SWIPE_FLIP[1], "300"]);
    await sleep(1200);
    rFlip = await runFlip("screencap");
    if (rFlip.failed) throw new Error("viewer_flip 双模式录制均失败");
  }
  const RELEASE = INPUT_ANCHOR_MS + 200; // swipe 200ms 后释放（锚点估计，含注入延迟）
  const flipGap = maxSignificantGap(rFlip.analysis.frames, Math.max(0, RELEASE - 450 - ANCHOR_SLACK));
  // 清理：关查看器 → 回首页
  await adbAsync(["shell", "input", "keyevent", "4"]);
  await sleep(800);
  await adbAsync(["shell", "input", "keyevent", "4"]);
  await sleep(600);
  await screenshot(dir, "home_after");
  writeFileSync(
    join(dir, "viewer.json"),
    JSON.stringify(
      {
        metrics: {
          open_ms: met(openMs, "≤200", judge(openMs, openMs <= 200), SRC.viewerOpen, "tap→首个显著变化帧（含注入延迟与锚点容差）"),
          flip_max_gap_ms: met(flipGap, "≤500", judge(flipGap, flipGap <= 500), SRC.viewerFlip, `翻页全程（拖拽起 ~${RELEASE - 450 - ANCHOR_SLACK}ms 起）显著帧间最长静默；拖拽跟手帧与预取命中即视为有反馈，黑屏冻结表现为长间隔`),
        },
        mode_open: rOpen.mode,
        mode_flip: rFlip.mode,
        notes,
      },
      null,
      1,
    ),
  );
  log(`viewer: open=${openMs}ms (≤200), flip_max_gap=${flipGap}ms (≤500)`);
}

// ── 汇总与对比 ────────────────────────────────────────────────────────────────
function collectResults(runDir) {
  const scenarios = {};
  for (const scene of SCENES) {
    const p = join(runDir, scene, `${scene}.json`);
    if (existsSync(p)) scenarios[scene] = JSON.parse(readFileSync(p, "utf8"));
  }
  return scenarios;
}

function fmtVal(v) {
  if (v === null || v === undefined) return "—";
  return typeof v === "number" ? `${Math.round(v * 100) / 100}` : String(v);
}

function markdownTable(scenarios) {
  const rows = ["| 场景 | 指标 | 值 | 判定线 | pass | 判定线出处 |", "|---|---|---|---|---|---|"];
  const mark = (p) => (p === true ? "PASS" : p === false ? "**FAIL**" : "记录");
  for (const [scene, data] of Object.entries(scenarios)) {
    for (const [k, m] of Object.entries(data.metrics ?? {})) {
      rows.push(`| ${scene} | ${k} | ${fmtVal(m.value)} | ${m.line ?? "—"} | ${mark(m.pass)} | ${m.source ?? "—"} |`);
    }
    for (const n of data.notes ?? []) rows.push(`| ${scene} | note | ${n} | | | |`);
    if (data.error) rows.push(`| ${scene} | error | ${data.error} | | **FAIL** | |`);
  }
  return rows.join("\n");
}

function compareMarkdown(base, cur) {
  const rows = ["| 场景 | 指标 | 基线值 | 本轮值 | 判定线 | 基线 pass | 本轮 pass |", "|---|---|---|---|---|---|---|"];
  const mark = (p) => (p === true ? "PASS" : p === false ? "**FAIL**" : "记录");
  for (const scene of new Set([...Object.keys(base.scenarios ?? {}), ...Object.keys(cur.scenarios ?? {})])) {
    const bm = base.scenarios?.[scene]?.metrics ?? {};
    const cm = cur.scenarios?.[scene]?.metrics ?? {};
    for (const k of new Set([...Object.keys(bm), ...Object.keys(cm)])) {
      rows.push(`| ${scene} | ${k} | ${fmtVal(bm[k]?.value)} | ${fmtVal(cm[k]?.value)} | ${cm[k]?.line ?? bm[k]?.line ?? "—"} | ${mark(bm[k]?.pass)} | ${mark(cm[k]?.pass)} |`);
    }
  }
  return rows.join("\n");
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  const meta = await envCheck();
  log(`环境自检通过：${meta.model} Android ${meta.android}，APK ${meta.apk_version}，WebView ${meta.webview_version}，launcher=${meta.launcher}`);

  // 登录态检查（未登录尝试 cdp_login.mjs）
  const cdpRef = { cdp: null };
  try {
    cdpRef.cdp = await Cdp.connect();
  } catch (e) {
    console.error(`环境自检失败：CDP 连接失败（${e.message}）。需 debug 构建且 app 在前台。`);
    process.exit(2);
  }
  let path = await cdpRef.cdp.eval("location.pathname");
  if (path === "/age-confirmation") {
    console.error("环境自检失败：app 停在年龄确认页，请先手动完成年龄确认后重跑。");
    process.exit(2);
  }
  if (path === "/login") {
    log("未登录 → 运行 cdp_login.mjs 注入 refresh_token…");
    const r = spawnSync(process.execPath, [join(SCRIPT_DIR, "cdp_login.mjs"), SERIAL], { stdio: "inherit", timeout: 120000 });
    if (r.status !== 0) {
      console.error("cdp_login.mjs 登录失败（pm clear 后 CDP 设值不触发 Solid 信号时，见 README 已知坑：adb input text 方案）");
      process.exit(2);
    }
    cdpRef.cdp.close();
    cdpRef.cdp = await Cdp.connect();
    path = await cdpRef.cdp.eval("location.pathname");
    if (path === "/login") {
      console.error("登录后仍在 /login，中止。");
      process.exit(2);
    }
  }
  log(`登录态 OK（path=${path}）`);

  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const runDir = join(OUT_ROOT, ts);
  for (const scene of SCENES) mkdirSync(join(runDir, scene), { recursive: true });
  const ctx = { cdp: cdpRef, dir: (scene) => join(runDir, scene) };

  const runners = { coldstart: sceneColdstart, detail: sceneDetail, back: sceneBack, tabs: sceneTabs, scroll: sceneScroll, viewer: sceneViewer };
  for (const scene of SCENES) {
    log(`── 场景 ${scene} ──`);
    try {
      await runners[scene](ctx);
    } catch (e) {
      log(`场景 ${scene} 失败：${e.message}`);
      writeFileSync(join(runDir, scene, `${scene}.json`), JSON.stringify({ metrics: {}, error: e.message, notes: [] }, null, 1));
    }
  }

  // 汇总
  const scenarios = collectResults(runDir);
  let overall = true;
  for (const [scene, data] of Object.entries(scenarios)) {
    if (data.error) {
      data.pass = false;
      overall = false;
      continue;
    }
    data.pass = Object.values(data.metrics ?? {}).every((m) => m.pass !== false);
    if (!data.pass) overall = false;
  }
  const summary = { meta: { ...meta, timestamp: new Date().toISOString(), scenes: SCENES }, overall_pass: overall, scenarios };
  const summaryPath = join(runDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 1));
  const table = markdownTable(scenarios);
  writeFileSync(join(runDir, "summary.md"), `# FT-5 交互回归 · ${ts}\n\n${table}\n\noverall_pass: ${overall}\n`);
  console.log(`\n${table}\n`);
  log(`summary → ${summaryPath}（overall_pass=${overall}）`);

  if (COMPARE) {
    const base = JSON.parse(readFileSync(COMPARE, "utf8"));
    const md = compareMarkdown(base, summary);
    writeFileSync(join(runDir, "compare.md"), `# 前后对比（基线 ${COMPARE}）\n\n${md}\n`);
    console.log(`\n${md}\n`);
    log(`compare → ${join(runDir, "compare.md")}`);
  }

  cdpRef.cdp?.close();
  process.exitCode = overall ? 0 : 1;
}

main().catch((e) => {
  console.error(`未预期的失败：${e.stack ?? e.message}`);
  process.exit(2);
});
