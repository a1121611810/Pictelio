#!/usr/bin/env node

/**
 * Pictelio 一键发布脚本
 *
 * 一条命令完成：选择 commits → 生成 changelog →（可选）模型总结 → 选版本 → 构建 APK → GitHub Release
 *
 * 用法:
 *   pnpm run release         # 等价于 -i
 *   pnpm run release -i      # 交互模式：选择提交和版本
 *   pnpm run release -c      # 自定义模式：粘贴自己的发布文案
 *   pnpm run release -o      # 覆盖发布模式：对已发布版本更新文案/资产，不 bump 版本号
 *                             # （目标 Release 必须已存在且非 draft；不移动 tag/不建 commit）
 *   pnpm run release -o --dry-run   # 覆盖模式 dry-run：打印将执行的 gh 命令，不实际调用
 *
 * 环境变量:
 *   PICTELIO_KEYSTORE_PASSWORD   - keystore 密码
 *   PICTELIO_KEY_PASSWORD        - key 密码
 *   PICTELIO_RELEASE_BRANCH      - 发布目标分支（缺省 main；设了则分支校验/分叉预检/push 目标
 *                                   三处一并切到该分支。过渡版发版用：
 *                                   PICTELIO_RELEASE_BRANCH=release/transition-6.2.0 pnpm release）
 *
 * 发布文案「模型总结」的可选配置（-i 与 -c 共用；值填在 packages/app/.env，该文件不进 git，
 * 四个键缺任一 = 未配置 → 跳过该步骤并打 warn）:
 *   PICTELIO_AI_BASE_URL         - OpenAI 兼容服务的 base URL（脚本追加 /chat/completions 或 /responses）
 *   PICTELIO_AI_API_KEY          - 服务方 API key
 *   PICTELIO_AI_MODEL            - 模型名（带思考的推理模型单次可能数分钟，建议先用快档）
 *   PICTELIO_AI_PROTOCOL         - 协议形态：chat（chat/completions）或 responses（responses）
 */

import { writeFile, mkdir, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import process from "node:process";
import {
  readText,
  writeText,
  exists,
  run,
  runWithSpinner,
  runOutput,
  getRepoSlug,
  parseVersion,
  isVersionAtLeast,
  askQuestion,
  readCustomChangelog,
  addCommitLinks,
  resolveVariants,
  apkPathsFor,
  withSpinner,
} from "./lib/release-utils.mjs";
import { truncateChangelog } from "./lib/changelog.mjs";
import { releaseBuildSteps } from "./lib/release-build-steps.mjs";
import { buildVersionJson } from "./lib/release-version-json.mjs";
import { assertReleaseBranchNotDiverged } from "./lib/release-preflight.mjs";
import {
  assertOnReleaseBranch,
  releaseBranchWarning,
  resolveReleaseBranch,
} from "./lib/release-branch.mjs";
import { planOverwrite, executeOverwrite, probeRemote } from "./release-overwrite.mjs";
import { uploadReleaseAssets, resolveUploader } from "./lib/release-uploader.mjs";
import { probeProxyRouting } from "./lib/proxy-probe.mjs";
import { createUploadPanel } from "./lib/release-panel.mjs";
import { loadAiConfig, runSummaryStep, summarizeReleaseNotes } from "./lib/release-notes-ai.mjs";

const rootDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolvePath(rootDir, "../.."); // monorepo 根（git 仓库根）

// P3：发布流程会提交到 git 的文件清单（相对 git 仓库根），
// 供 step 4 定向 add 与多余变更拦截复用。
// ⚠️ 注意：fastlane/ 整体被 .gitignore 忽略（自动生成），changelog 文件不进 git，
// 不能出现在此清单中（git add 会失败）。
function releaseFilesFor() {
  return [
    "packages/app/package.json",
    "packages/app/android/app/build.gradle",
    "packages/website/version.json",
  ];
}

// P3-fix：step 2 实际会写入/新建的全部文件（含被 ignore 的 changelog），
// 供失败回滚清理使用——changelog 未跟踪且被 ignore，需单独 unlink。
function step2FilesFor(versionCode) {
  return [
    ...releaseFilesFor(),
    `packages/app/fastlane/metadata/android/en-US/changelogs/${versionCode}.txt`,
  ];
}

// ADR-0202：OTA web bundle 发布通道已下线，--web-only / --min-web 已移除。
// 显式拒绝而非静默吞掉——若不拦截，`pnpm release --web-only` 会无声走一次**完整的正常发布**
// （bump 版本 + 构建 APK + commit/tag/push + 创建真实 GitHub Release），
// 后果与发布前想做的事完全相反。禁静默降级：退役参数必须响亮地失败。
const RETIRED_FLAGS = ["--web-only", "--min-web"];
for (const a of process.argv.slice(2)) {
  if (RETIRED_FLAGS.some((f) => a === f || a.startsWith(`${f}=`))) {
    console.error(
      `[release] ❌ ${a} 已随 OTA web bundle 发布通道下线移除（见 ADR-0202）。` +
        "当前只有正常发布与覆盖发布（-o）两种模式。",
    );
    process.exit(1);
  }
}

const args = new Set(process.argv.slice(2));
const isCustom = args.has("-c");
// -o / --overwrite：覆盖发布模式（对已存在且已发布的 Release 更新文案/资产，不 bump 版本号）
const isOverwrite = args.has("-o") || args.has("--overwrite");
// --dry-run：打印将执行的 gh 命令，不实际调用（覆盖模式专用）
const dryRun = args.has("--dry-run");

// #119：模块级记录当前发布版本，供 catch 恢复指引使用（main() 作用域外访问）
let publishedVersion = null;
// P4：记录本次发布的 tag 与 step 2 会修改的文件，供 catch 失败回滚使用
let publishedTag = null;
let rollbackFiles = [];
// P6：记录 versionCode，供 catch 恢复指引定位 changelog 文件
let publishedVersionCode = null;

if (!process.stdin.isTTY) {
  console.error("[release] ❌ 发布脚本需要 TTY 终端中运行");
  process.exit(1);
}

// ── 工具函数 ──

function log(...m) {
  console.log(`[release]`, ...m);
}
function ok(...m) {
  console.log(`[release] ✅`, ...m);
}

// P2：发布必须在「发布目标分支」执行，避免 commit/tag 落在非目标分支
// 而 push 仍推目标分支，导致 tag 指向不在远端分支上的 commit。
// 目标分支默认 main；PICTELIO_RELEASE_BRANCH 可显式覆盖（解析/校验/告警在
// lib/release-branch.mjs，可单测——main() 有 TTY 早退，内联逻辑在 CI 里跑不到）。
// 三处（分支校验 / 分叉预检 / push 目标）共用同一个值，避免「只放开一两处」的半开状态。
function ensureOnReleaseBranch(branch) {
  assertOnReleaseBranch({ current: runOutput("git", ["branch", "--show-current"]), branch });
  const warning = releaseBranchWarning(branch);
  if (warning) log(`⚠ ${warning}`);
}

// ── 核心流程 ──

function getLastTag() {
  try {
    return runOutput("git", ["describe", "--tags", "--abbrev=0"]);
  } catch {
    return null;
  }
}

function getGitLogSince(tag) {
  if (!tag) {
    return [];
  }
  const raw = runOutput("git", ["log", `${tag}..HEAD`, "--oneline", "--no-decorate"]);
  return raw.split("\n").filter(Boolean);
}

const CATEGORY_ENTRIES = [
  { prefixes: ["feat(", "feat:"], emoji: "✨", category: "✨ 新功能" },
  { prefixes: ["fix(", "fix:"], emoji: "🐛", category: "🐛 修复" },
  { prefixes: ["perf(", "perf:"], emoji: "⚡", category: "⚡ 性能" },
  { prefixes: ["docs(", "docs:", "📝"], emoji: "📝", category: "📝 文档" },
  { prefixes: ["chore(", "chore:", "🔧"], emoji: "🧹", category: "🧹 杂项" },
  { prefixes: ["refactor(", "refactor:"], emoji: "♻️", category: "♻️ 重构" },
  { prefixes: ["style(", "style:"], emoji: "💄", category: "💄 样式" },
  { prefixes: ["test(", "test:"], emoji: "🧪", category: "🧪 测试" },
];

// P15：去掉行首 commit hash（"f13e155c feat(settings): ..." → "feat(settings): ..."）
function stripHash(line) {
  return line.replace(/^[0-9a-f]+\s+/u, "");
}

function classifyCommit(msg) {
  const entry = CATEGORY_ENTRIES.find((e) => e.prefixes.some((p) => msg.startsWith(p)));
  return entry ? entry.category : "🔧 其他";
}

function formatChangelog(messages) {
  const groups = {};
  for (const msg of messages) {
    // P15：分类基于去掉 hash 的消息；分组内保留完整行（含 hash，供 P16 生成链接）
    const category = classifyCommit(stripHash(msg));
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(msg);
  }
  const lines = [];
  for (const [cat, items] of Object.entries(groups)) {
    lines.push(`${cat}`);
    for (const item of items) {
      lines.push(`  ${item}`);
    }
  }
  return lines.join("\n") || "小修复与改进";
}

function generateChangelogPreview(selected) {
  return formatChangelog(selected);
}

function bump(v, part) {
  const p = parseVersion(v);
  switch (part) {
    case "major":
      return `${p.major + 1}.0.0`;
    case "minor":
      return `${p.major}.${p.minor + 1}.0`;
    default:
      return `${p.major}.${p.minor}.${p.patch + 1}`;
  }
}

async function interactivePickCommits(commits) {
  console.log(`\n自上次发布以来的提交（共 ${commits.length} 个）:`);
  console.log("输入编号选择，支持格式: 1 3 5-8  (空格分隔, -表示范围)");
  console.log("  a = 全选  |  回车 = 空  |  q = 退出\n");

  // Display numbered list — P15：items 保留原始 "hash message" 行（供 changelog 溯源），
  // 仅显示与分类时剥掉 hash
  const items = commits;
  for (let i = 0; i < items.length; i++) {
    const shown = stripHash(items[i]);
    const entry = CATEGORY_ENTRIES.find((e) => e.prefixes.some((p) => shown.startsWith(p)));
    const cat = entry ? entry.emoji : "🔧";
    console.log(`  ${(i + 1).toString().padStart(3)}  ${cat}  ${shown}`);
  }

  // Loop until valid selection or exit
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await askQuestion("\n输入编号: ");

    if (answer === "q") {
      console.log("[release] 已退出");
      process.exit(0);
    }

    let indices;
    if (answer === "a") {
      indices = items.map((_, i) => i);
    } else if (answer === "") {
      indices = [];
    } else {
      indices = [];
      const parts = answer.split(/\s+/u).filter(Boolean);
      let valid = true;
      for (const part of parts) {
        if (/^\d+$/u.test(part)) {
          const idx = parseInt(part, 10) - 1;
          if (idx >= 0 && idx < items.length) {
            indices.push(idx);
          }
        } else if (/^(\d+)-(\d+)$/u.test(part)) {
          const [, s, e] = part.match(/^(\d+)-(\d+)$/u);
          const start = parseInt(s, 10) - 1;
          const end = parseInt(e, 10) - 1;
          if (start >= 0 && end < items.length && start <= end) {
            for (let j = start; j <= end; j++) {
              indices.push(j);
            }
          } else {
            valid = false;
          }
        } else {
          valid = false;
        }
      }
      if (!valid || (indices.length === 0 && parts.some((p) => p !== ""))) {
        console.log("  ⚠ 格式错误，请重新输入");
        continue;
      }
    }

    // Deduplicate and sort
    indices = [...new Set(indices)].toSorted((a, b) => a - b);
    const selected = indices.map((i) => items[i]);

    // Show preview grouped by category
    console.log(`\n已选 ${selected.length} 个提交，生成的 changelog：\n`);
    const preview = generateChangelogPreview(selected);
    console.log(preview);

    // eslint-disable-next-line no-await-in-loop
    const confirm = await askQuestion("\n确认使用? (Y/n/e=重新编辑): ");
    if (confirm.toLowerCase() === "n") {
      console.log("[release] 已取消");
      process.exit(0);
    } else if (confirm.toLowerCase() === "e") {
      continue;
    } else {
      return selected;
    }
  }
}

async function interactivePickVersion(currentVersion) {
  console.log(`\n当前版本: ${currentVersion}\n`);
  console.log("版本递增方式:");
  console.log(`  1) patch  (${currentVersion} → ${bump(currentVersion, "patch")}) — 小修复`);
  console.log(`  2) minor  (${currentVersion} → ${bump(currentVersion, "minor")}) — 新功能`);
  console.log(`  3) major  (${currentVersion} → ${bump(currentVersion, "major")}) — 大改版`);
  console.log("  4) 自定义版本号\n");

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await askQuestion("选择 (1-4): ");
    switch (answer) {
      case "1":
        return { type: "patch", version: bump(currentVersion, "patch") };
      case "2":
        return { type: "minor", version: bump(currentVersion, "minor") };
      case "3":
        return { type: "major", version: bump(currentVersion, "major") };
      case "4": {
        // eslint-disable-next-line no-await-in-loop
        const custom = await askQuestion("输入版本号 (格式 x.y.z): ");
        if (/^\d+\.\d+\.\d+$/u.test(custom)) {
          // P9：禁止低于当前版本，避免 versionCode 倒退导致 Android 拒绝安装
          if (!isVersionAtLeast(custom, currentVersion)) {
            console.log(`  ⚠ 版本不能低于当前版本 ${currentVersion}，请重新输入`);
            break;
          }
          return { type: "custom", version: custom };
        }
        console.log("  ⚠ 格式错误，请输入 x.y.z 格式（如 2.0.0）");
        break;
      }
      default:
        console.log("  ⚠ 请输入 1-4");
    }
  }
}

// ── 模型总结（可选步骤：-i 与 -c 两种模式共用）──
// 配置读 packages/app/.env（该文件不进 git，四个键的值由使用者自填）；缺任一键 = 未配置 →
// 打 warn 跳过本步骤（不去问一个做不到的问题）。读取与交互闭环都在 lib/release-notes-ai.mjs
// （端口注入、有单测），这里只负责端口接线与日志口吻。
const aiWarn = (message) => console.warn(`[release] ⚠ ${message}`);

async function maybeSummarizeChangelog(changelog) {
  const config = await loadAiConfig({ readText, env: process.env, warn: aiWarn });
  if (!config.configured) {
    aiWarn(
      `未配置发布文案模型（缺或为空：${config.missing.join("、")}；填在 packages/app/.env 后可用），` +
        `跳过「模型总结」，使用原始文案`,
    );
    return changelog;
  }

  const { notes, cancelled } = await runSummaryStep({
    rawNotes: changelog,
    config,
    ask: askQuestion,
    summarize: (params) =>
      withSpinner(`模型总结中（${config.model}）...`, () => summarizeReleaseNotes(params)),
    warn: aiWarn,
  });
  if (cancelled) {
    console.log("[release] 已取消");
    process.exit(0);
  }
  return notes;
}

// ── 覆盖发布模式（-o / --overwrite）──
// 对已存在且已发布的 GitHub Release 覆盖更新文案/资产，不 bump 版本号。
// 流程编排：远端探测（先行、带动画）→ 本地探测 → 交互①范围 → 交互②复用/重建
//           →（可选重建，重建前预校验远端）→ 准备文案 → planOverwrite（校验+计划）
//           → 展示+二次确认 → executeOverwrite。
// 说明：远端网络探测必须先行完成（异步 + spinner 动画，启动即有反馈）——若与交互
//       并行，spinner 的 \r 单行刷新会覆盖用户输入行；检查完成 spinner 停止后再进入
//       交互流程。重建前先校验远端，避免对未发布/草稿版本白跑完整构建。
async function runOverwriteFlow() {
  const pkg = JSON.parse(await readText("package.json"));
  const version = pkg.version;
  const repo = getRepoSlug();
  const variants = resolveVariants();
  const tag = `v${version}`;
  const apkPaths = apkPathsFor(version, variants);

  try {
    // ── 远端状态探测：先行完成（异步 + spinner 动画，启动即有反馈），
    // 再进入交互流程——spinner 的 \r 刷新若与输入并行会覆盖输入行。
    const remote = await withSpinner("检查远端 Release 状态...", () => probeRemote({ tag, repo }));

    // ── 本地 APK 探测（纯本地 stat，快）──
    const localApks = [];
    for (let i = 0; i < variants.length; i++) {
      localApks.push({
        buildType: variants[i],
        path: (await exists(apkPaths[i])) ? resolvePath(rootDir, apkPaths[i]) : null,
      });
    }

    // ── 交互①：覆盖范围 ──
    console.log(`\n覆盖发布目标：版本 ${version}（tag ${tag}）· 变体 ${variants.join(", ")}`);
    console.log("要覆盖哪些内容？");
    console.log("  1) 仅文案（title / notes）");
    console.log("  2) 仅资产（APK）");
    console.log("  3) 全部（默认）");
    const scope = ((await askQuestion("选择 (1-3) [3]: ")) || "3").trim() || "3";
    const updateMeta = scope === "1" || scope === "3";
    const includeAssets = scope === "2" || scope === "3";

    // ── 交互②：复用本地 APK 还是重新构建 ──
    let rebuild = false;
    if (includeAssets) {
      const missing = localApks.filter((x) => !x.path);
      if (missing.length === 0) {
        console.log("\n本地已存在全部变体 APK：");
        for (const x of localApks) console.log(`  ${x.buildType}: ${x.path}`);
        const ans = ((await askQuestion("\n复用本地 APK (r) 还是重新构建 (b)？ [r]: ")) || "r")
          .trim()
          .toLowerCase();
        rebuild = ans === "b";
      } else {
        console.log(
          `\n本地缺少变体 APK：${missing.map((x) => x.buildType).join(", ")}，将重新构建`,
        );
        rebuild = true;
      }
    }

    // ── 重新构建（可选；dry-run 跳过实际构建，仅预览计划）──
    if (rebuild) {
      // 重建前预校验：tag 必须存在且 Release 已发布，否则中止——
      // 避免对未发布/草稿版本白跑数分钟完整构建。
      planOverwrite({
        version,
        variants,
        repo,
        localApks,
        remote,
        notes: null,
        includeAssets: false,
      });
      if (dryRun) {
        log("[dry-run] 将重新构建（已跳过实际构建，计划按当前本地产物预览）");
      } else {
        log(`重新构建变体：${variants.join(", ")}（约数分钟）...`);
        await buildReleaseApks(version, variants);
      }
      for (let i = 0; i < variants.length; i++) {
        localApks[i] = {
          buildType: variants[i],
          path: (await exists(apkPaths[i])) ? resolvePath(rootDir, apkPaths[i]) : null,
        };
      }
    }

    // ── 文案准备 ──
    let notes = null;
    if (updateMeta) {
      const parsed = parseVersion(version);
      const versionCode = parsed.major * 10_000 + parsed.minor * 100 + parsed.patch;
      const changelogPath = `fastlane/metadata/android/en-US/changelogs/${versionCode}.txt`;
      if (await exists(changelogPath)) {
        notes = addCommitLinks(await readText(changelogPath), repo);
        console.log(`\n使用 fastlane changelog（${changelogPath}），更新后文案预览：`);
      } else {
        console.log(`\n未找到 ${changelogPath}，请粘贴新文案：`);
        notes = await readCustomChangelog();
      }
      console.log("─".repeat(40));
      console.log(notes);
      console.log("─".repeat(40));
      const noteChoice = ((await askQuestion("确认使用该文案? (Y/n/e=重新输入): ")) || "y")
        .trim()
        .toLowerCase();
      if (noteChoice === "n") {
        console.log("[release] 已取消");
        process.exit(0);
      } else if (noteChoice === "e") {
        notes = addCommitLinks(await readCustomChangelog(), repo);
      }
    }

    // ── 计划 + 展示 + 二次确认 ──
    const plan = planOverwrite({
      version,
      variants,
      repo,
      localApks,
      remote,
      notes,
      includeAssets,
    });
    console.log("─".repeat(40));
    log("覆盖发布计划：");
    console.log(`  Release : ${plan.title} (${plan.tag})`);
    console.log(`  更新文案: ${plan.notes !== null ? "是" : "否"}`);
    if (plan.assetsToUpload.length > 0) {
      console.log(
        `  上传资产: ${plan.assetsToUpload.map((p) => p.split(/[\\/]/u).pop()).join(", ")}`,
      );
    }
    if (plan.assetsToReplace.length > 0) {
      console.log(`  覆盖资产: ${plan.assetsToReplace.join(", ")}`);
    }
    if (plan.assetsMissing.length > 0) {
      console.log(`  新增资产: ${plan.assetsMissing.join(", ")}`);
    }
    if (plan.buildRequired.length > 0) {
      console.log(`  ⚠ 不包含变体: ${plan.buildRequired.join(", ")}`);
    }
    for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
    console.log("─".repeat(40));
    // 第一道确认：y 或直接回车 = 确认（用户要求两者等价）；n 或其它 = 取消。
    // 第二道 tag 确认：直接回车默认接受当前 tag。
    const confirm = (await askQuestion("\n确认覆盖发布?（y 或回车 = 确认，n 或其它 = 取消）: "))
      .trim()
      .toLowerCase();
    if (confirm !== "" && confirm !== "y") {
      console.log("[release] 已取消");
      process.exit(0);
    }
    const tagConfirm = await askQuestion(`请输入 tag 名确认（直接回车 = 默认 ${plan.tag}）: `);
    // 直接回车默认接受当前 tag；输入其他值（与 plan.tag 不符）则取消，双重防误覆盖
    if (tagConfirm.trim() !== "" && tagConfirm.trim() !== plan.tag) {
      console.log("[release] tag 确认不匹配，已取消（未执行任何操作）");
      process.exit(0);
    }

    // ── 执行 ──
    const runGh = async (ghArgs) => {
      await runWithSpinner(`gh ${ghArgs[0]} ${ghArgs[1]} ${plan.tag}`, "gh", ghArgs);
    };
    const result = await executeOverwrite(plan, { runGh, dryRun });

    // 执行成功后同步 website version.json 的 changelog 字段（dry-run 不产生任何写入）。
    // 本地文件同步失败仅告警：Release 已更新成功，不应因本地文件问题误报发布失败（幂等，重跑无害）。
    if (!result.dryRun && plan.notes !== null) {
      const verJsonPath = "../../packages/website/version.json";
      try {
        if (await exists(verJsonPath)) {
          const verJson = JSON.parse(await readText(verJsonPath));
          verJson.changelog = truncateChangelog(plan.notes);
          await writeText(verJsonPath, JSON.stringify(verJson, null, 2) + "\n");
          log(`已同步 ${verJsonPath} 的 changelog 字段`);
        }
      } catch (e) {
        console.warn(`[release] ⚠ 同步 ${verJsonPath} 失败（不影响已完成的发布）: ${e.message}`);
      }
    }

    console.log("");
    console.log("=".repeat(50));
    if (result.dryRun) {
      console.log("🔎 覆盖发布 dry-run 完成（未执行任何操作）");
    } else {
      console.log("🎉 覆盖发布完成！");
      if (result.edited) console.log(`   文案已更新`);
      if (result.uploaded.length > 0) console.log(`   已上传资产: ${result.uploaded.join(", ")}`);
      if (result.restored.length > 0) {
        console.log(`   ⚠ 已从备份恢复被覆盖资产: ${result.restored.join(", ")}`);
      }
    }
    console.log(`   版本: ${version} · tag: ${tag}`);
    console.log(`   地址: https://github.com/${repo}/releases/tag/${tag}`);
    console.log("=".repeat(50));
  } catch (e) {
    e.isOverwrite = true;
    e.overwriteTag = tag;
    throw e;
  }
}

// 顺序执行构建步骤（gradlew 带 P13 可重试性区分：编译/R8 missing class 等代码问题直接
// 失败，避免白跑一轮几分钟的 --stacktrace 重构建；缓存/依赖瞬时问题带 --stacktrace
// 重试一次；其余命令失败即抛）。正常发布（buildReleaseApks）与覆盖发布重建共用。
async function runBuildSteps(buildSteps) {
  const total = buildSteps.length;
  for (let i = 0; i < total; i++) {
    const [label, cmd, stepArgs, opts] = buildSteps[i];
    const subLabel = `[${i + 1}/${total}] ${label}`;
    if (cmd === "./gradlew") {
      try {
        await runWithSpinner(subLabel, cmd, stepArgs, opts);
      } catch (e) {
        const stderr = e.stderr || "";
        // P13：不可重试错误（编译/R8 missing class 等代码问题，memory 坑 2）
        // 直接失败，避免白跑一轮几分钟的 --stacktrace 重构建。
        if (/Missing classes|Missing class|error: |FAILURE: Build failed/i.test(stderr)) {
          throw e;
        }
        // 可重试错误（缓存 not-found / 依赖解析瞬时失败，memory 坑 1）
        log("Gradle 构建失败（疑似缓存/依赖问题），重试并输出详细堆栈...");
        await runWithSpinner(`${subLabel}（详细堆栈）`, cmd, [...stepArgs, "--stacktrace"], opts);
      }
    } else {
      await runWithSpinner(subLabel, cmd, stepArgs, opts || {});
    }
  }
}

// 构建 Release APK（正常发布 step 3 与覆盖发布重建共用）
// 步骤表在 lib/release-build-steps.mjs（纯函数，可单测）；#610 单引擎化后
// 「变体」= buildType，唯一值 release，见该文件的 RELEASE_BUILD_TYPES 注释。
async function buildReleaseApks(version, variants) {
  const buildSteps = releaseBuildSteps({ variants });
  await runBuildSteps(buildSteps);
  const apkPaths = apkPathsFor(version, variants);
  const missing = [];
  for (const p of apkPaths) {
    if (!(await exists(p))) missing.push(p);
  }
  if (missing.length > 0) throw new Error(`APK 未生成: ${missing.join(", ")}`);
  log(`APK 构建完成，产物:`);
  for (const p of apkPaths) log(`  ${resolvePath(rootDir, p)}`);
}

async function main() {
  log("Pictelio 一键发布脚本");
  console.log("");

  // P2：发布前强制校验「发布目标分支」（默认 main，可由 PICTELIO_RELEASE_BRANCH 覆盖）
  // 三处（分支校验 / 分叉预检 / push 目标）共用这一个值，避免半开状态
  const releaseBranch = resolveReleaseBranch(process.env);
  ensureOnReleaseBranch(releaseBranch);

  // 覆盖发布模式：对已发布版本更新文案/资产，不 bump 版本号
  if (isOverwrite) {
    await runOverwriteFlow();
    return;
  }

  const pkg = JSON.parse(await readText("package.json"));
  const currentVersion = pkg.version;
  let newVersion;
  let versionCode;
  let tag;
  let title;
  let changelog;

  if (isCustom) {
    // ── Custom mode: user pastes their own changelog ──
    log("自定义发布模式");
    changelog = await readCustomChangelog();

    console.log("\n你的发布文案：");
    console.log("─".repeat(40));
    console.log(changelog);
    console.log("─".repeat(40));

    const answer = await askQuestion("\n确认使用? (Y/n): ");
    if (answer.toLowerCase() === "n") {
      console.log("[release] 已取消");
      process.exit(0);
    }

    changelog = await maybeSummarizeChangelog(changelog);

    const versionPick = await interactivePickVersion(currentVersion);
    newVersion = versionPick.version;
    publishedVersion = newVersion;

    log(`目标版本: ${newVersion}`);
    console.log("");
  } else {
    // ── Interactive mode: user picks commits and version ──
    const lastTag = await getLastTag();
    const commits = lastTag ? await getGitLogSince(lastTag) : [];
    log(`自 ${lastTag || "初始提交"} 以来共 ${commits.length} 个提交`);

    const selectedCommits = await interactivePickCommits(commits);
    changelog = generateChangelogPreview(selectedCommits) || "小修复与改进";

    changelog = await maybeSummarizeChangelog(changelog);

    const versionPick = await interactivePickVersion(currentVersion);
    newVersion = versionPick.version;
    publishedVersion = newVersion;

    log(`目标版本: ${newVersion}`);
    console.log("");
    log("最终 changelog：");
    console.log(changelog);
    console.log("");
  }

  const { major: mi, minor: mn, patch: pt } = parseVersion(newVersion);
  versionCode = mi * 10_000 + mn * 100 + pt;
  tag = `v${newVersion}`;
  title = `Pictelio v${newVersion}`;
  publishedTag = tag;
  publishedVersionCode = versionCode;

  // P4：tag 预检——本地或远端已存在同名 tag 则拒绝发布，
  // 防止重复发布或上次失败残留的 tag 被覆盖。
  const localTagExists = runOutput("git", ["tag", "-l", tag]) !== "";
  let remoteTagExists = false;
  try {
    remoteTagExists = runOutput("git", ["ls-remote", "--tags", "origin", tag]) !== "";
  } catch {
    log("⚠ 无法检查远端 tag（网络异常），仅校验本地");
  }
  if (localTagExists || remoteTagExists) {
    throw new Error(
      `tag ${tag} 已存在（本地: ${localTagExists}, 远端: ${remoteTagExists}）。请删除冲突 tag 或更换版本号`,
    );
  }

  // ADR-0142 D3 / ticket #353：远端分叉预检——确认前 fail-fast，零半成品
  // （分叉时中止：版本号未 bump、无 commit/tag；fetch 失败仅 warn，由 pre-push 钩子兜底）
  await assertReleaseBranchNotDiverged({ cwd: repoRoot, branch: releaseBranch });

  // ── 发布计划确认 ──
  console.log("─".repeat(40));
  log("即将执行以下发布操作：");
  console.log(`  版本: ${currentVersion} → ${newVersion} (versionCode: ${versionCode})`);
  console.log(`  标签: ${tag}`);
  console.log(
    `  目标分支: ${releaseBranch}${releaseBranch === "main" ? "" : "  ⚠ 非 main（PICTELIO_RELEASE_BRANCH 覆盖）"}`,
  );
  console.log(`  步骤: 更新版本 → 构建 APK → git commit/tag → git push → GitHub Release`);
  console.log("─".repeat(40));
  const confirmRelease = await askQuestion("\n确认发布? (Y/n): ");
  if (confirmRelease.toLowerCase() === "n") {
    console.log("[release] 已取消");
    process.exit(0);
  }
  console.log("");

  let completedSteps = [];
  const step = (n, name, fn) => {
    log(`▶ [${n}/6] ${name}...`);
    return fn().then(
      (r) => {
        completedSteps.push(n);
        ok(`[${n}/6] ${name} 完成`);
        return r;
      },
      (e) => {
        throw Object.assign(e, { stepN: n, stepName: name });
      },
    );
  };

  await step(1, "检查签名环境", async () => {
    const keystorePassword = process.env.PICTELIO_KEYSTORE_PASSWORD;
    const keyPassword = process.env.PICTELIO_KEY_PASSWORD;
    const keystoreExists = await exists("android/app/pictelio-release.keystore");
    const envErrors = [];
    if (!keystorePassword) envErrors.push("缺少 PICTELIO_KEYSTORE_PASSWORD");
    if (!keyPassword) envErrors.push("缺少 PICTELIO_KEY_PASSWORD");
    if (!keystoreExists) envErrors.push("找不到 android/app/pictelio-release.keystore");
    if (envErrors.length > 0) {
      // P14：用 throw 走统一 catch（输出失败步骤 + 恢复指引），而非直接 process.exit
      throw new Error(
        "环境错误：" +
          envErrors.join("；") +
          "（请先设置签名环境变量并放置 keystore，见 docs/release-signing.md）",
      );
    }
  });

  await step(2, "更新版本号", async () => {
    // P4：记录本次会修改/新建的文件（含被 ignore 的 changelog），供失败自动回滚
    rollbackFiles = step2FilesFor(versionCode);
    pkg.version = newVersion;
    await writeText("package.json", JSON.stringify(pkg, null, 2) + "\n");
    await run("node", ["scripts/sync-android-version.mjs"]);
    const changelogPath = `fastlane/metadata/android/en-US/changelogs/${versionCode}.txt`;
    await mkdir(dirname(resolvePath(rootDir, changelogPath)), { recursive: true });
    await writeText(changelogPath, changelog);
    const repo = getRepoSlug();
    const verJson = buildVersionJson({
      version: newVersion,
      repo,
      tag,
      changelog: truncateChangelog(changelog),
    });
    await mkdir(dirname(resolvePath(rootDir, "../../packages/website/version.json")), {
      recursive: true,
    });
    await writeText("../../packages/website/version.json", verJson);
  });

  await step(3, "构建 APK", async () => {
    // #119：按变体解析 assemble/rename task
    const variants = resolveVariants();
    log(`构建变体：${variants.join(", ")}`);
    await buildReleaseApks(newVersion, variants);
  });

  await step(4, "Git 提交 + Tag", async () => {
    // P3：只提交发布相关文件，并拦截清单之外的多余变更，
    // 防止无关改动混入发布 commit 或发布产物漏提交。
    const releaseFiles = releaseFilesFor();
    // P3-fix：必须 trim:false——git status --porcelain 首行以 " M "（前导空格）开头，
    // trim 会吃掉该空格导致路径解析错位。
    const status = runOutput("git", ["status", "--porcelain"], { cwd: repoRoot, trim: false });
    const extra = status
      .split("\n")
      .filter(Boolean)
      .map((line) => line.match(/^.. (.*)$/u)?.[1] ?? "") // "XY path" 格式，取路径
      .filter((p) => !releaseFiles.includes(p));
    if (extra.length > 0) {
      throw new Error(
        `工作区存在发布无关的变更: ${extra.join(", ")}。请先处理或 git stash 后再发布`,
      );
    }
    await run("git", ["add", ...releaseFiles], { cwd: repoRoot });
    await run("git", ["commit", "-m", `chore: bump version to ${newVersion}`, "-m", changelog], {
      cwd: repoRoot,
    });
    await run("git", ["tag", "-a", tag, "-m", title], { cwd: repoRoot });
  });

  await step(5, "推送到 GitHub", async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await runWithSpinner(`git push (第 ${attempt} 次)`, "git", [
          "push",
          "origin",
          releaseBranch,
          "--tags",
        ]);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  });

  await step(6, "创建 GitHub Release", async () => {
    const uploadPaths = apkPathsFor(newVersion, resolveVariants()).map((p) =>
      resolvePath(rootDir, p),
    );
    const repo = getRepoSlug();
    let notesFile, tmpDir;
    try {
      tmpDir = await mkdtemp(resolvePath(tmpdir(), "pictelio-release-"));
      notesFile = resolvePath(tmpDir, "release-notes.md");
      // P16：Release notes 使用带 commit 链接的版本；fastlane/commit message 保持纯文本
      await writeFile(notesFile, addCommitLinks(changelog, repo), "utf-8");

      // 预检：release 是否已存在
      let releaseExists = false;
      try {
        runOutput("gh", ["release", "view", tag, "--repo", repo]);
        releaseExists = true;
      } catch {}

      // 第一步：创建 Release（不传 APK，只需 API 调用，~1s）
      if (!releaseExists) {
        // P5：不可重试错误模式（4xx / 认证 / tag 冲突等），命中则放弃重试
        const NON_RETRYABLE =
          /HTTP 4\d\d|already exists|not found|unauthorized|forbidden|bad credential/i;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await runWithSpinner(`gh release create (第 ${attempt} 次)`, "gh", [
              "release",
              "create",
              tag,
              "--repo",
              repo,
              "--title",
              title,
              "--notes-file",
              notesFile,
            ]);
            break;
          } catch (e) {
            e.relTag = tag;
            e.relTitle = title;
            if (NON_RETRYABLE.test(e.stderr || "")) {
              throw e; // 不可重试：直接失败，不白等重试
            }
            if (attempt >= 3) {
              throw e;
            }
            const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
            log(`gh release create 失败（${delay / 1000}s 后重试）...`);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      // 第二步：逐包上传资产（ADR-0065 编排 + Node 原生上传器；单包最多 3 次重试由深模块内部处理）
      // 研究结论：uploads.github.com 慢的根因是国际链路；先探测直连/代理并提示，
      // Node 上传器默认直连（实测更快且无 api.github.com 403 风险）。
      const routing = probeProxyRouting("uploads.github.com");
      log(
        `GitHub 上传路径: ${routing.mode === "direct" ? `直连（${routing.reason}）` : `经代理 ${routing.proxyUrl}（${routing.reason}）`}`,
      );
      const { kind: uploaderKind, fn: uploaderFn } = resolveUploader();
      if (routing.mode === "proxy") {
        if (uploaderKind === "node") {
          log(
            `Node 原生上传器将绕过代理直连（实测直连更快且无 403 风险）；如需强制走代理请设 PICTELIO_UPLOADER=gh`,
          );
        } else {
          log(
            `gh 将经代理上传；若过慢建议固化 NO_PROXY=api.github.com,uploads.github.com 强制直连`,
          );
        }
      }
      const panel = createUploadPanel();
      const report = await uploadReleaseAssets({
        tag,
        repo,
        paths: uploadPaths,
        gh: uploaderFn,
        render: (e) => panel.onEvent(e),
      });
      panel.finish();
      if (report.failed.length > 0) {
        const uploadErr = new Error(
          `资产上传失败（${report.failed.length}/${uploadPaths.length} 个资产）:\n` +
            report.failed
              .map((f) => `  - ${f.name}: 尝试 ${f.attempts} 次，${f.stderrTail}`)
              .join("\n"),
        );
        uploadErr.relTag = tag;
        uploadErr.relTitle = title;
        uploadErr.failedAssets = report.failed.map((f) => f.name);
        throw uploadErr;
      }
    } finally {
      await unlink(notesFile).catch(() => {});
      await rmdir(tmpDir).catch(() => {});
    }
  });

  console.log("");
  console.log("=".repeat(50));
  console.log(`🎉 发布流程完成！`);
  console.log(`   版本: ${newVersion}`);
  console.log(`   标签: ${tag}`);
  console.log(`   APK（${resolveVariants().join(", ")}）:`);
  for (const p of apkPathsFor(newVersion, resolveVariants())) {
    console.log(`     ${resolvePath(rootDir, p)}`);
  }
  console.log(`   地址: https://github.com/${getRepoSlug()}/releases/tag/${tag}`);
  console.log("=".repeat(50));
}

main().catch(async (error) => {
  console.error(`\n[release] ❌ 发布流程失败`);
  if (error.stepName) {
    console.error(`   失败步骤: [${error.stepN}/6] ${error.stepName}`);
    console.error(`   错误: ${error.message}`);
    if (error.stepN === 1) {
      // P14：环境检查失败，无文件被修改，无需回滚
      console.error(`\n   已完成的步骤: 0/6`);
      console.error(`   签名环境未就绪，未发生任何写入，直接修复环境后重跑即可`);
    } else if (error.stepN === 2 || error.stepN === 3) {
      // P4：版本号已写入但尚未 commit，自动回滚文件，避免重跑跳过该版本
      console.error(`\n   已完成的步骤: ${error.stepN - 1}/6`);
      console.error(`   正在自动回滚版本文件...`);
      try {
        // changelog 是新建文件（未跟踪），git checkout 无法恢复，需单独删除
        const tracked = rollbackFiles.filter((f) => !f.endsWith(".txt"));
        if (tracked.length > 0) {
          await run("git", ["checkout", "--", ...tracked], { cwd: repoRoot });
        }
        const changelog = rollbackFiles.find((f) => f.endsWith(".txt"));
        if (changelog) await unlink(resolvePath(repoRoot, changelog)).catch(() => {});
        console.error(
          `   ✅ 已回滚 package.json / build.gradle / changelog / version.json，工作区干净`,
        );
        console.error(`   可直接重跑发布`);
      } catch (rollbackErr) {
        console.error(`   ⚠ 自动回滚失败: ${rollbackErr.message}`);
        console.error(
          `   请手动执行: git checkout -- ${rollbackFiles.filter((f) => !f.endsWith(".txt")).join(" ")}`,
        );
        const changelog = rollbackFiles.find((f) => f.endsWith(".txt"));
        if (changelog) console.error(`   并删除: ${changelog}`);
      }
    } else if (error.stepN === 4) {
      // P4：step 4 失败点可能在校验/ add 之前（无 commit）或在 commit/tag 之后。
      // 先检查本地是否真的创建了 commit 与 tag，再给对应指引。
      console.error(`\n   已完成的步骤: 3/6`);
      const headMsg = runOutput("git", ["log", "-1", "--oneline"], { cwd: repoRoot });
      const tagExists = (() => {
        try {
          return runOutput("git", ["tag", "-l", publishedTag], { cwd: repoRoot }) !== "";
        } catch {
          return false;
        }
      })();
      if (headMsg.includes(`bump version to ${publishedVersion}`) || tagExists) {
        console.error(`   已创建本地 commit/tag（${publishedTag}）。如需重新发布当前版本:`);
        console.error(`     git reset --soft HEAD~1`);
        console.error(`     git tag -d ${publishedTag}`);
        console.error(`   然后重跑；或保留本地提交继续发布下一版本`);
      } else {
        console.error(`   尚未创建 commit/tag（失败在校验或 add 阶段），工作区残留版本文件:`);
        console.error(`     git checkout -- ${releaseFilesFor().join(" ")}`);
        console.error(
          `     rm -f packages/app/fastlane/metadata/android/en-US/changelogs/${publishedVersionCode}.txt`,
        );
        console.error(`   清理后可直接重跑`);
      }
    } else if (error.stepN === 5) {
      console.error(`\n   已完成的步骤: 4/6`);
      console.error(`   git push 失败。可能已推送 tag 但未推送 main，或部分成功。检查远端:`);
      console.error(`     git ls-remote origin ${publishedTag}`);
      console.error(`   若 main 已推送而 tag 未推送，可重试: git push origin ${publishedTag}`);
    } else if (error.stepN === 6) {
      const repoKey = getRepoSlug();
      const relTag = error.relTag || "vX.Y.Z";
      // 恢复指引覆盖全部资产（APK）
      const assetRels = apkPathsFor(publishedVersion, resolveVariants()).map(
        (p) => `packages/app/${p}`,
      );
      const failedAssets = error.failedAssets || [];
      const targets =
        failedAssets.length > 0
          ? assetRels.filter((p) => failedAssets.includes(p.split("/").pop()))
          : assetRels;
      const uploadTargets = targets.length > 0 ? targets : assetRels;
      // P6：changelog 在 step 2 已写入 fastlane（未提交但文件在），直接指向文件
      const notesFile = `packages/app/fastlane/metadata/android/en-US/changelogs/${publishedVersionCode}.txt`;
      console.error(`\n   已完成的步骤: 5/6`);
      console.error(`   git 已推送但 GitHub Release 创建/上传失败。手动恢复:`);
      console.error(`     1. 创建 Release:`);
      console.error(
        `        gh release create ${relTag} --repo ${repoKey} --title "${error.relTitle || `Pictelio ${relTag}`}" --notes-file ${notesFile}`,
      );
      console.error(`     2. 上传资产（APK；若 release 已存在可跳过第 1 步；仅列未成功包）:`);
      for (const rel of uploadTargets) {
        console.error(`        gh release upload ${relTag} --repo ${repoKey} --clobber ${rel}`);
      }
      console.error(
        `     （若 ${notesFile} 不存在，可改为 --notes "Pictelio ${relTag}" 或手动粘贴 changelog）`,
      );
    }
  } else if (error.isOverwrite) {
    console.error(`\n[release] ❌ 覆盖发布失败`);
    console.error(`   ${error.message}`);
    console.error(`   覆盖范围仅限 GitHub Release 页面，tag/commit 未被改动。`);
    console.error(`   若资产在上传中丢失，脚本已尝试从备份恢复；可重跑 pnpm run release -o 重试。`);
    console.error(
      `   检查远端: https://github.com/${getRepoSlug()}/releases/tag/${error.overwriteTag || "vX.Y.Z"}`,
    );
  } else {
    console.error(`   ${error.message}`);
  }
  process.exit(1);
});
