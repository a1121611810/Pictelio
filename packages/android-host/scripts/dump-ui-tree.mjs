#!/usr/bin/env node
/**
 * 运行时 UI 树导出 · 诊断脚本（T0 最小验证）
 * spec: docs/specs/app-lynx-ui-tree-dump-t0.md · issue #1045
 *
 * 用法:
 *   node packages/android-host/scripts/dump-ui-tree.mjs [选项]
 *
 * 选项:
 *   --serial <s>   设备序列号（默认：ANDROID_E2E_SERIAL → 首个在线模拟器）
 *   --wait <ms>    等文件出现的最长时间（默认 20000）
 *   --out <dir>    拉回本地目录（默认 <tmp>/pictelio-ui-tree）
 *   --keep         不清空本地目录里的旧文件
 *
 * 流程: 触发（intent extra）→ 轮询等文件出现 → adb pull → 打印摘要。
 *
 * 摘要里最关键的一项是**节点字段清单**（每个字段在多少个节点上出现过）——
 * 它回答「引擎到底吐什么」，是 T0 的核心产出（反解源码位置不在能力范围内，见 spec）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_PACKAGE = "io.pictelio.app";
/**
 * 组件名必须写成 `pkg/.Class` 形态。
 * 写成 `pkg.Class`（少个斜杠）会被 ActivityManager 判为「Bad component name」——
 * `am start` 直接 exit 255，且**不启动任何东西**（静默失败，最容易误判成「能力没落地」）。
 */
const LYNX_ACTIVITY = `${APP_PACKAGE}/.LynxActivity`;
const EXTRA_TRIGGER = "uiTreeDump";
const REMOTE_DIR = `/sdcard/Android/data/${APP_PACKAGE}/files/ui-tree`;

function parseArgs(argv) {
  const opts = { serial: null, wait: 20_000, out: join(tmpdir(), "pictelio-ui-tree"), keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--serial") opts.serial = argv[++i];
    else if (a === "--wait") opts.wait = Number(argv[++i]);
    else if (a === "--out") opts.out = resolve(argv[++i]);
    else if (a === "--keep") opts.keep = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

/** 定位 adb（与 e2e env.ts 同思路：ANDROID_HOME → ANDROID_SDK_ROOT → macOS 默认路径）。 */
function adbPath() {
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    join(homedir(), "Library/Android/sdk/platform-tools/adb"),
    join(homedir(), "Android/Sdk/platform-tools/adb"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("找不到 adb：请设 ANDROID_HOME 或 ANDROID_SDK_ROOT");
}

const adb = adbPath();

/** 跑一条 adb 命令。返回 {stdout, stderr, status}；失败不抛（调用点自己判 status）。 */
function adbRun(serial, args, opts = {}) {
  try {
    const stdout = execFileSync(adb, ["-s", serial, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      status: typeof e.status === "number" ? e.status : -1,
    };
  }
}

/** 选设备：显式指定 → ANDROID_E2E_SERIAL → 首个在线模拟器。 */
function resolveSerial(explicit) {
  if (explicit) return explicit;
  if (process.env.ANDROID_E2E_SERIAL) return process.env.ANDROID_E2E_SERIAL;
  const out = adbRun("", ["devices"]).stdout;
  const serial = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/u))
    .find((c) => c[0]?.startsWith("emulator-") && c[1] === "device")?.[0];
  if (!serial) {
    throw new Error(
      "找不到在线模拟器。用 --serial <serial> 指定，或设 ANDROID_E2E_SERIAL。\n" +
        `当前 adb devices:\n${out}`,
    );
  }
  return serial;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 列出设备上已有的 dump 文件名（目录不存在 ⇒ 空数组）。 */
function listRemoteFiles(serial) {
  const out = adbRun(serial, ["shell", "ls", "-1", REMOTE_DIR]).stdout;
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".json"));
}

/**
 * 触发抓取：向 LynxActivity 发一个 intent extra（冷启动走 onLoadSuccess，热启动走 onNewIntent）。
 *
 * <p>把 adb 的 stdout/stderr 全部透出：{@code am start} 在「Activity 已在跑」时会打印
 * {@code Activity not started, intent has been delivered to currently running top-most instance}
 * ——这是**成功**（intent 已投递 ⇒ onNewIntent 路径），不是失败。吞掉它会让人误判。
 */
function trigger(serial) {
  const r = adbRun(serial, [
    "shell",
    "am",
    "start",
    "-n",
    LYNX_ACTIVITY,
    "--es",
    EXTRA_TRIGGER,
    "1",
  ]);
  const detail = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0) {
    throw new Error(`触发失败（adb exit ${r.status}）:\n${detail}`);
  }
  console.log(`[ui-tree] am start → ${detail.replace(/\n/g, " | ")}`);
}

/**
 * 统计一棵树。
 *
 * <p>除了基础计数，另给四项「诊断价值最高」的派生量：
 * <ul>
 *   <li><b>class 覆盖率</b>：Tailwind 类名挂在多少节点上（≈「这棵树有多可读」）；</li>
 *   <li><b>语义 id 清单</b>：非空 id 的节点（仓库已在用 {@code id="pictelio-..."} 约定）；</li>
 *   <li><b>a11y 标签清单</b>：{@code accessibility-label}（a11y 树不暴露给 uiautomator，
 *       但它在 UI 树里——这是本通道相对既有手段的增量）；</li>
 *   <li><b>事件名分布</b>：哪些节点可交互、绑的是哪种事件。</li>
 * </ul>
 */
export function summarize(tree) {
  let nodeCount = 0;
  let maxDepth = 0;
  let withClass = 0;
  const tagCounts = new Map();
  const fieldCounts = new Map();
  const topLevel = [];
  const ids = [];
  const a11yLabels = [];
  const eventNames = new Map();

  const walk = (node, depth) => {
    if (!node || typeof node !== "object") return;
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);
    for (const [k, v] of Object.entries(node)) {
      if (k === "children") continue;
      fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
    }
    const tag = typeof node.tag === "string" ? node.tag : "(无 tag)";
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (depth === 0) topLevel.push(tag);

    const attrs = node.attributes ?? {};
    if (Array.isArray(attrs.class) && attrs.class.length > 0) withClass += 1;
    const id = node.id || attrs.id;
    if (id) ids.push(`${tag}#${id}`);
    if (attrs["accessibility-label"]) a11yLabels.push(`${tag}:"${attrs["accessibility-label"]}"`);
    if (Array.isArray(node.events)) {
      for (const ev of node.events) {
        const name = typeof ev === "object" ? ev.eventName : String(ev);
        eventNames.set(name, (eventNames.get(name) ?? 0) + 1);
      }
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c, depth + 1);
  };

  walk(tree, 0);
  return {
    nodeCount,
    maxDepth,
    topLevel,
    withClass,
    ids,
    a11yLabels,
    tagCounts: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]),
    fieldCounts: [...fieldCounts.entries()].sort((a, b) => b[1] - a[1]),
    eventNames: [...eventNames.entries()].sort((a, b) => b[1] - a[1]),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const serial = resolveSerial(opts.serial);
  console.log(`[ui-tree] 设备: ${serial}`);

  const before = new Set(listRemoteFiles(serial));
  console.log(`[ui-tree] 触发抓取（extra ${EXTRA_TRIGGER}=1）…`);
  trigger(serial);

  // 等新文件出现（连拍会在数秒内陆续落盘）
  const deadline = Date.now() + opts.wait;
  let appeared = [];
  while (Date.now() < deadline) {
    appeared = listRemoteFiles(serial).filter((f) => !before.has(f));
    if (appeared.length > 0) break;
    await sleep(300);
  }
  if (appeared.length === 0) {
    console.error(
      `[ui-tree] ${opts.wait}ms 内没有新文件出现。\n` +
        "排查顺序：① App 是否已装（debug 包）② logcat 里是否有「UI 树抓取请求已受理」\n" +
        "③ 是否为 release 包（本能力仅 DEBUG 构建存在）",
    );
    process.exit(1);
  }
  // 等连拍落齐：文件数连续两次轮询不再增长即视为落齐。
  // ⚠️ 不能只等固定时长——连拍间隔是 0/1.5/4s 三档，固定 sleep 会漏掉最后一份。
  let lastCount = -1;
  let stableRounds = 0;
  const settleDeadline = Date.now() + 15_000;
  while (Date.now() < settleDeadline) {
    await sleep(600);
    const current = listRemoteFiles(serial).filter((f) => !before.has(f));
    if (current.length === lastCount) {
      if (++stableRounds >= 2) {
        appeared = current;
        break;
      }
    } else {
      stableRounds = 0;
      lastCount = current.length;
    }
  }
  appeared = listRemoteFiles(serial).filter((f) => !before.has(f));
  console.log(`[ui-tree] 设备上新增 ${appeared.length} 份：${appeared.join(", ")}`);

  if (!opts.keep) rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });

  for (const name of appeared) {
    const local = join(opts.out, name);
    const pulled = adbRun(serial, ["pull", `${REMOTE_DIR}/${name}`, local]);
    if (pulled.status !== 0) {
      console.error(`[ui-tree] 拉回失败: ${name}（adb exit ${pulled.status}）${pulled.stderr}`);
    }
    if (!existsSync(local)) {
      console.error(`[ui-tree] 拉回失败: ${name}`);
      continue;
    }
    const bytes = statSync(local).size;
    let tree;
    try {
      tree = JSON.parse(readFileSync(local, "utf8"));
    } catch (e) {
      console.error(`[ui-tree] ${name} 不是合法 JSON（${e.message}），字节=${bytes}`);
      continue;
    }
    const s = summarize(tree);
    console.log(`\n=== ${name} ===`);
    console.log(`字节=${bytes}  节点数=${s.nodeCount}  最大深度=${s.maxDepth}  带class=${s.withClass}/${s.nodeCount}`);
    console.log(`顶层: ${s.topLevel.join(", ")}`);
    console.log("tag 分布:");
    for (const [tag, n] of s.tagCounts) console.log(`  ${String(n).padStart(6)}  ${tag}`);
    console.log("节点字段清单（出现次数）:");
    for (const [field, n] of s.fieldCounts) console.log(`  ${String(n).padStart(6)}  ${field}`);
    console.log(`事件名分布（${s.eventNames.length} 种）:`);
    for (const [name, n] of s.eventNames) console.log(`  ${String(n).padStart(6)}  ${name}`);
    if (s.ids.length) {
      console.log(`语义 id（${s.ids.length}）:`);
      for (const id of s.ids) console.log(`  ${id}`);
    }
    if (s.a11yLabels.length) {
      console.log(`a11y 标签（${s.a11yLabels.length}）:`);
      for (const label of s.a11yLabels) console.log(`  ${label}`);
    }
  }
  console.log(`\n[ui-tree] 产物已拉回: ${opts.out}`);
}

main().catch((e) => {
  console.error(`[ui-tree] 失败: ${e.message}`);
  process.exit(1);
});
