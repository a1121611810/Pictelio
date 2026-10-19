#!/usr/bin/env node
/**
 * 运行时 UI 树导出 · 诊断脚本（T0 最小验证）
 * spec: docs/specs/app-lynx-ui-tree-dump-t0.md · issue #1045 · ADR-0223
 *
 * 用法:
 *   node packages/android-host/scripts/dump-ui-tree.mjs [选项]
 *
 * 选项:
 *   --serial <s>   设备序列号（默认：ANDROID_E2E_SERIAL → 首个在线模拟器）
 *   --wait <ms>    等新文件出现的最长时间（默认 20000）
 *   --out <dir>    拉回本地目录（默认 <tmp>/pictelio-ui-tree）
 *   --keep         不清空本地目录里的旧文件
 *
 * 流程: 触发（intent extra）→ 轮询等文件出现 → adb pull → 打印摘要。
 *
 * 摘要里最关键的一项是**节点字段清单**（每个字段在多少个节点上出现过）——
 * 它回答「引擎到底吐什么」，是 T0 的核心产出（反解源码位置不在能力范围内，见 spec）。
 *
 * 本文件只做**编排**（调 adb / 轮询 / 打印）；可测的纯逻辑都在 ./lib/ui-tree-dump-core.mjs，
 * 那里有对应的单测（tests/unit/scripts/ui-tree-dump-core.test.ts）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  EXTRA_TRIGGER,
  FILE_SUFFIX,
  LYNX_ACTIVITY,
  REMOTE_DIR,
  SAMPLE_DELAYS_CSV,
  SAMPLE_DELAYS_MS,
  parseArtifactName,
  planWait,
  summarize,
} from "./lib/ui-tree-dump-core.mjs";

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
function adbRun(serial, args) {
  try {
    const stdout = execFileSync(adb, ["-s", serial, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
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
    .filter((l) => l.endsWith(FILE_SUFFIX));
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
 * 等新文件落齐。
 *
 * <p>判据（见 lib/ui-tree-dump-core.mjs 的 planWait）：
 * **按已知采样档位等齐**——宿主侧每轮连拍 3 份（0 / 1.5 / 4s，档位见 spec），
 * 落齐 = 出现的采样点里至少有一轮三档齐；再等一段静默期兜住「另一轮迟到的文件」。
 *
 * <p>⚠️ 旧实现用「连续两次轮询计数不变」判落齐（窗口约 1.2s），而第 2→3 份间隔 2.5s
 * ⇒ 必然在空档里 break，**丢掉的正是 4s 那份（唯一完整树）**且 exit 0 静默。
 */
async function waitForNewFiles(serial, before, waitMs) {
  const deadline = Date.now() + waitMs;
  let appeared = [];
  while (Date.now() < deadline) {
    appeared = listRemoteFiles(serial).filter((f) => !before.has(f));
    const plan = planWait(appeared, SAMPLE_DELAYS_MS);
    if (plan.settled) return { files: appeared, plan };
    await sleep(300);
  }
  return { files: appeared, plan: planWait(appeared, SAMPLE_DELAYS_MS), timedOut: true };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const serial = resolveSerial(opts.serial);
  console.log(`[ui-tree] 设备: ${serial}`);

  const before = new Set(listRemoteFiles(serial));
  console.log(`[ui-tree] 设备: ${serial}  远端落盘目录: ${REMOTE_DIR}`);
  console.log(`[ui-tree] 触发抓取（extra ${EXTRA_TRIGGER}=1）…`);
  trigger(serial);

  const { files: appeared, plan, timedOut } = await waitForNewFiles(serial, before, opts.wait);
  if (appeared.length === 0) {
    console.error(
      `[ui-tree] ${opts.wait}ms 内没有新文件出现。\n` +
        "排查顺序：① App 是否已装（debug 包）② logcat 里是否有「UI 树抓取请求已受理」\n" +
        "③ 是否为 release 包（本能力仅 DEBUG 构建存在）",
    );
    process.exit(1);
  }
  if (!plan.settled) {
    // 收不齐必须显式告警：不能静默丢档位（实测丢的正是 4s 那份完整树）。
    console.error(
      `[ui-tree] ⚠️ 采样未落齐：${opts.wait}ms 内只等到 ${appeared.length} 份。\n` +
        `预期每轮 ${SAMPLE_DELAYS_CSV} ms 三档齐备；实际到档 ${plan.seenDelays.join(",") || "(无)"}。\n` +
        "缺档位意味着「最完整的那一份」可能没到——请看 logcat 里 UiTreeDump 的告警。",
    );
  }
  console.log(`[ui-tree] 设备上新增 ${appeared.length} 份：${appeared.join(", ")}`);
  for (const group of plan.groups) {
    console.log(`[ui-tree]   采样点 ${group.point}：到档 ${group.delays.join(",")} ms`);
  }

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
    const parsed = parseArtifactName(name);
    console.log(`\n=== ${name} ===`);
    console.log(
      `字节=${bytes}  节点数=${s.nodeCount}  最大深度=${s.maxDepth}  带class=${s.withClass}/${s.nodeCount}`,
    );
    console.log(`采样点=${parsed?.point ?? "?"}  采样延迟=${parsed?.delayMs ?? "?"}ms`);
    console.log(`顶层: ${s.topLevel.join(", ")}`);
    console.log("tag 分布:");
    for (const [tag, n] of s.tagCounts) console.log(`  ${String(n).padStart(6)}  ${tag}`);
    console.log("节点字段清单（出现次数）:");
    for (const [field, n] of s.fieldCounts) console.log(`  ${String(n).padStart(6)}  ${field}`);
    console.log(`事件名分布（${s.eventNames.length} 种）:`);
    for (const [evName, n] of s.eventNames) console.log(`  ${String(n).padStart(6)}  ${evName}`);
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
  if (timedOut) {
    console.error("[ui-tree] ⚠️ 等待超时（采样未确认落齐），请核对上面的档位清单。");
  }
}

/** 解析命令行参数（缺值/未知参数 ⇒ exit 2，不静默忽略）。 */
function parseArgs(argv) {
  const opts = {
    serial: null,
    wait: 20_000,
    out: join(tmpdir(), "pictelio-ui-tree"),
    keep: false,
  };
  const needValue = (flag, value) => {
    if (value === undefined || value.startsWith("--")) {
      console.error(`参数 ${flag} 缺少取值`);
      process.exit(2);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--serial") opts.serial = needValue(a, argv[++i]);
    else if (a === "--wait") {
      const raw = needValue(a, argv[++i]);
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`参数 --wait 需为正整数毫秒，收到: ${raw}`);
        process.exit(2);
      }
      opts.wait = n;
    } else if (a === "--out") opts.out = resolve(needValue(a, argv[++i]));
    else if (a === "--keep") opts.keep = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

main().catch((e) => {
  console.error(`[ui-tree] 失败: ${e.message}`);
  process.exit(1);
});
