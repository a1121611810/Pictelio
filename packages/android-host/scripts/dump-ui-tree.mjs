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
 *   --out <dir>    拉回本地目录（默认 <tmp>/pictelio-ui-tree）。**只清本通道的旧产物**
 *                  （`ui-tree-*.json`），目录里的其它文件一律不动；拒绝指向当前工作
 *                  目录或它的祖先。
 *   --keep         不清空本地目录里的旧文件
 *
 * 流程: 触发（intent extra）→ 轮询等文件出现 → adb pull → 打印摘要。
 *
 * 摘要里最关键的一项是**节点字段清单**（每个字段在多少个节点上出现过）——
 * 它回答「引擎到底吐什么」，是 T0 的核心产出（反解源码位置不在能力范围内，见 spec）。
 *
 * 本文件只做**编排**（调 adb / 轮询 / 打印）；可测的纯逻辑都在 ./lib/ui-tree-dump-core.mjs，
 * 那里有对应的单测（tests/unit/scripts/ui-tree-dump-core.test.ts）。
 *
 * <p><b>已知失效面（显式登记，不是缺陷，是本层的边界）</b>：
 * <ul>
 *   <li><b>编排层本身没有单测</b>：真正跑 adb 的部分需要真设备，无法在 CI 里单测。
 *       可测的判据（落齐判据、退出码、产物名解析、摘要统计）**全部下沉到
 *       {@code lib/ui-tree-dump-core.mjs} 并在那里单测</b>——这是本层唯一有机器防线的部分。</li>
 *   <li><b>「拉回来的是不是本次触发产生的」靠文件名时间戳 + 目录清空近似</b>：
 *       脚本用「触发前的文件集合」做差集来认新文件；若设备上另一个进程并发抓树，
 *       差集里会混入别人的产物（认不出 ⇒ 摘要会多列几棵树，但不会静默丢）。</li>
 *   <li><b>不做「哪一份才是完整树」的自动判定</b>：判据是「三档齐」，
 *       「哪一份最完整」由人看体积/节点数决定（2026-10-20 实测 4s 那份最完整，但那是当次页面的事实，
 *       不是通用规律）。</li>
 *   <li><b>清理只删本通道产物</b>：输出目录里只删 `ui-tree-*.json`，<b>不删目录、不删其它
 *       文件</b>。旧实现是整目录递归删除（`--out ""` 会把当前工作目录删掉，第 4 轮 review
 *       实测复现过）⇒ 现已收紧，且 `--out` 拒绝空值 / 当前工作目录 / 其祖先。
 *       ⚠️ <b>本层的参数解析本身没有机器防线</b>（要真跑 adb 才能进到这里，无法在 CI 里
 *       单测）⇒ 第 4 轮那个阻塞缺陷就是从这里漏出去的。<b>目录安全校验已下沉到 lib 层</b>
 *       （{@code assertSafeOutDir}）并有门禁；<b>取值与校验的单一出口也在 lib 层</b>
 *       （{@code resolveOutDir}）⇒ 默认输出目录与显式 {@code --out} 走同一条防线，
 *       不会分叉；但「参数解析」那一层仍只有人工复验兜着
 *       （见 ADR-0223 §3.3「尚未覆盖」）。</li>
 *   <li><b>远端目录路径是按平台约定拼的</b>（{@code /sdcard/Android/data/<pkg>/files/<dir>}），
 *       而宿主侧用 {@code getExternalFilesDir(null)} 动态取——两者靠约定相等，不靠字面量相等
 *       （宿主侧与脚本侧的<b>目录名</b>由跨端协议门禁逐字比对，见 ADR-0223 §3.4）。</li>
 * </ul>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXTRA_TRIGGER,
  FILE_SUFFIX,
  LYNX_ACTIVITY,
  REMOTE_DIR,
  SAMPLE_DELAYS_CSV,
  SAMPLE_DELAYS_MS,
  artifactsToRemove,
  exitCodeFor,
  parseArtifactName,
  planWait,
  resolveOutDir,
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

/**
 * adb 路径（惰性解析）。
 *
 * <p>为什么惰性：原先在模块顶层 `const adb = adbPath()`，**import 即产生副作用**——
 * 没有 adb 的环境（CI、别的机器）只要 import 本文件就会抛错。惰性化后模块可被安全 import，
 * 也让「本文件被引用」不再等于「本机必须装了 adb」。
 */
let adbCache = null;
function adb() {
  if (!adbCache) adbCache = adbPath();
  return adbCache;
}

/** 跑一条 adb 命令。返回 {stdout, stderr, status}；失败不抛（调用点自己判 status）。 */
function adbRun(serial, args) {
  try {
    const stdout = execFileSync(adb(), ["-s", serial, ...args], {
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
 * 落齐 = 出现的采样点里至少有一轮三档齐；落齐后再等一段**静默期**，
 * 把「另一轮迟到」的文件也一并捞回来。
 *
 * <p>⚠️ 旧实现用「连续两次轮询计数不变」判落齐（窗口约 1.2s），而第 2→3 份间隔 2.5s
 * ⇒ 必然在空档里 break，**丢掉的正是 4s 那份（唯一完整树）**且 exit 0 静默。
 *
 * <p>为什么需要静默期：命中两个采样点时（进程死、任务记录还在 ⇒ cold + hot 两轮，各 3 份），
 * 两轮的 4s 档几乎同时落盘但可能差几百毫秒——「一轮齐」时另一轮可能还差最后一档。
 * 静默期只多花 ≤2.5s，却能把那几份捞回来。
 */
async function waitForNewFiles(serial, before, waitMs) {
  const deadline = Date.now() + waitMs;
  let appeared = [];
  while (Date.now() < deadline) {
    appeared = listRemoteFiles(serial).filter((f) => !before.has(f));
    const plan = planWait(appeared, SAMPLE_DELAYS_MS);
    if (plan.settled) {
      return await collectQuietPeriod(serial, before, appeared, deadline);
    }
    await sleep(300);
  }
  return { files: appeared, plan: planWait(appeared, SAMPLE_DELAYS_MS), timedOut: true };
}

/** 落齐后的静默期：连续若干次轮询没有新增文件即认为静默，提前收工。 */
const QUIET_PERIOD_MS = 2500;
const QUIET_STREAK_POLLS = 3;

async function collectQuietPeriod(serial, before, appeared, deadline) {
  const quietDeadline = Math.min(Date.now() + QUIET_PERIOD_MS, deadline);
  const known = new Set(appeared);
  let quietStreak = 0;
  let files = appeared;
  while (Date.now() < quietDeadline) {
    await sleep(300);
    const all = listRemoteFiles(serial).filter((f) => !before.has(f));
    const fresh = all.filter((f) => !known.has(f));
    if (fresh.length > 0) {
      for (const f of fresh) known.add(f);
      files = all;
      quietStreak = 0;
    } else {
      quietStreak += 1;
      if (quietStreak >= QUIET_STREAK_POLLS) break;
    }
  }
  return { files, plan: planWait(files, SAMPLE_DELAYS_MS) };
}

/**
 * 清理输出目录里的**旧产物**——只删本通道产物名的**普通文件**，**不删目录、不删其它文件**。
 *
 * <p>⚠️ 旧实现是整目录递归删除：{@code --out ""}（{@code path.resolve("")} = 当前工作目录）
 * 会把用户的整个目录删掉，{@code --out <任意已有目录>} 会把该目录里用户的其它文件一并清空。
 * 第 4 轮 review 实测复现过（整个 CWD 消失）。⇒ 清理范围收紧到「只删本通道产物」。
 *
 * <p>⚠️ 只删**普通文件**：输出目录里若存在**名叫 `ui-tree-*.json` 的目录**，按名字删会
 * 抛 EISDIR 让整跑批中止（第 5 轮 Standards 轴实测）⇒ 目录一律跳过。
 */
function cleanStaleArtifacts(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true }).map((d) => ({
    name: d.name,
    isDir: d.isDirectory(),
  }));
  for (const name of artifactsToRemove(entries)) {
    rmSync(join(dir, name), { force: true });
  }
}

/**
 * `--out` 的安全校验（判据在 lib 层，有机器防线）。
 *
 * <p>为什么必须挡：输出目录若就是当前工作目录（或它的祖先），清理动作会落在用户的
 * 工作目录上 ⇒ 目录直接消失。旧实现是整目录递归删除 ⇒ 第 4 轮 review 实测复现过
 * （整个 CWD 消失）。现在清理范围已收紧到「只删本通道产物」，本校验是**第二道**防线。
 *
 * <p>⚠️ 判据本体（含符号链接解析）在 {@code lib/ui-tree-dump-core.mjs} 的
 * {@code assertSafeOutDir} 里，配套单测在
 * {@code tests/unit/scripts/ui-tree-dump-outdir.test.ts}；<b>取值 + 校验的单一出口</b>
 * 是同模块的 {@code resolveOutDir}（默认路径与显式 {@code --out} 都走它 ⇒ 不分叉）。
 */
function checkOutDir(cwd, requested, tmpRoot) {
  try {
    // 取值 + 校验都在 lib 层的单一出口（resolveOutDir）：显式 `--out` 与**默认值**
    // 走同一条防线 ⇒ 两条路径不可能分叉（第 6 轮 Standards 轴实测抓到：此前默认值
    // 完全绕过校验，工作目录恰是默认输出目录时 CWD 里的通道产物会被删）。
    return resolveOutDir(cwd, requested, tmpRoot);
  } catch (e) {
    console.error(`[ui-tree] ${e.message}`);
    process.exit(2);
  }
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
    process.exit(exitCodeFor({ settled: plan.settled, timedOut }));
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

  if (!opts.keep) cleanStaleArtifacts(opts.out);
  mkdirSync(opts.out, { recursive: true });

  let pullFailures = 0;
  let invalidJson = 0;
  /** 本次最完整的一份（节点数多者胜，同数比字节）。收工时点名，避免读者被字典序里最空的那份误导。 */
  let best = null;
  for (const name of appeared) {
    const local = join(opts.out, name);
    const pulled = adbRun(serial, ["pull", `${REMOTE_DIR}/${name}`, local]);
    if (pulled.status !== 0) {
      // ⚠️ adb 报错 ⇒ 本地文件**不可信**（可能是上一轮的残留、也可能是半截）。
      //   必须计入失败**并且不拿它的内容当本次产物打印**——否则「拉回失败」只停在
      //   一行告警上，退出码仍是 0（这正是第 1 轮 review 要堵的洞）。
      console.error(`[ui-tree] 拉回失败: ${name}（adb exit ${pulled.status}）${pulled.stderr}`);
      pullFailures += 1;
      continue;
    }
    if (!existsSync(local)) {
      console.error(`[ui-tree] 拉回失败: ${name}`);
      pullFailures += 1;
      continue;
    }
    const bytes = statSync(local).size;
    let tree;
    try {
      tree = JSON.parse(readFileSync(local, "utf8"));
    } catch (e) {
      console.error(`[ui-tree] ${name} 不是合法 JSON（${e.message}），字节=${bytes}`);
      invalidJson += 1;
      continue;
    }
    const s = summarize(tree);
    const parsed = parseArtifactName(name);
    if (!best || s.nodeCount > best.nodes || (s.nodeCount === best.nodes && bytes > best.bytes)) {
      best = { name, nodes: s.nodeCount, bytes };
    }
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
  if (best) {
    // ⚠️ 产物按文件名字典序打印 ⇒ **最空的那份排在最前**（0ms 档常只有几十个节点）。
    //   读者若只看第一段字段清单，会把「半棵树」当成结论——故收工时点名最完整的那一份。
    console.log(
      `[ui-tree] 最完整的一份：${best.name}（节点数=${best.nodes} 字节=${best.bytes}）` +
        "——「三档落齐」只说明产物齐，不说明每份都完整，以这一份为准。",
    );
  }
  if (timedOut) {
    console.error("[ui-tree] ⚠️ 等待超时（采样未确认落齐），请核对上面的档位清单。");
  }
  // 退出码 = 唯一能被机器读到的那一半失败信号（判据纯函数在 core 层，有单测）。
  process.exit(exitCodeFor({ settled: plan.settled, timedOut, pullFailures, invalidJson }));
}

/** 解析命令行参数（缺值/未知参数 ⇒ exit 2，不静默忽略）。 */
function parseArgs(argv) {
  const opts = {
    serial: null,
    wait: 20_000,
    out: null, // 最终生效的输出目录在参数解析**末尾**统一解析并校验（含默认值）
    keep: false,
  };
  const needValue = (flag, value) => {
    // 空串也必须拒：--out "" ⇒ path.resolve("") = 当前工作目录 ⇒ 旧实现会把用户的
    // 整个目录删掉（第 4 轮 review 实测复现过）。空值在任何参数上都没有意义。
    if (value === undefined || value.startsWith("--") || value.trim() === "") {
      console.error(`[ui-tree] 参数 ${flag} 缺少有效取值`);
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
      // ⚠️ 判据必须是**整数**：文案承诺「正整数毫秒」，而 `Number.isFinite` 会放行
      //   `1.5` 这类小数（第 7 轮 Standards 轴抓到文案与实现不一致）⇒ 这里用
      //   `Number.isInteger`（它同时排除 NaN / Infinity）。
      if (!Number.isInteger(n) || n <= 0) {
        console.error(`[ui-tree] 参数 --wait 需为正整数毫秒，收到: ${raw}`);
        process.exit(2);
      }
      opts.wait = n;
    } else if (a === "--out") {
      // 这里只**取值**；校验统一放在末尾（相对路径按 CWD 解析，判据在 lib 层：
      // assertSafeOutDir 的 target 基准 = cwd）
      opts.out = needValue(a, argv[++i]);
    } else if (a === "--keep") opts.keep = true;
    else {
      console.error(`[ui-tree] 未知参数: ${a}`);
      process.exit(2);
    }
  }
  // 单一出口：显式 `--out` 与默认值都过同一条目录安全防线。
  opts.out = checkOutDir(process.cwd(), opts.out, tmpdir());
  return opts;
}

main().catch((e) => {
  console.error(`[ui-tree] 失败: ${e.message}`);
  process.exit(1);
});
