#!/usr/bin/env node

/**
 * Pictelio 一键发布脚本
 *
 * 一条命令完成：选择 commits → 生成 changelog → 选版本 → 构建 APK → GitHub Release
 *
 * 用法:
 *   pnpm run release         # 等价于 -i
 *   pnpm run release -i      # 交互模式：选择提交和版本
 *   pnpm run release -c      # 自定义模式：粘贴自己的发布文案
 *
 * 环境变量:
 *   PICTELIO_KEYSTORE_PASSWORD   - keystore 密码（必须）
 *   PICTELIO_KEY_PASSWORD        - key 密码（必须）
 */

import { readFile, writeFile, stat, mkdir, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import process from "node:process";
import { createInterface } from "node:readline";
import ora from "ora";

const rootDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolvePath(rootDir, "../.."); // monorepo 根（git 仓库根）

// #119：三 flavor 变体（full / webview / lynx），默认全量
const DEFAULT_VARIANTS = ["full", "webview", "lynx"];
const APK_DIR = "android/app/build/outputs/apk";

function apkPathsFor(version, variants) {
  return variants.map((flavor) => `${APK_DIR}/${flavor}/release/pictelio-${version}-${flavor}.apk`);
}

// P3/P4：发布流程会修改/新建的文件清单（相对 git 仓库根），
// 供 step 4 定向 add、多余变更拦截和 step 2/3 失败自动回滚复用。
function releaseFilesFor(versionCode) {
  return [
    "packages/app/package.json",
    "packages/app/android/app/build.gradle",
    `packages/app/fastlane/metadata/android/en-US/changelogs/${versionCode}.txt`,
    "packages/website/version.json",
  ];
}

// 解析 --variants / PICTELIO_RELEASE_VARIANTS，默认全量
function resolveVariants() {
  const cliVariantsArg = args.find((a) => a.startsWith("--variants="))?.slice("--variants=".length);
  const hasCliVariants = cliVariantsArg !== undefined;
  const raw = hasCliVariants ? cliVariantsArg : process.env.PICTELIO_RELEASE_VARIANTS || "";
  if (hasCliVariants && cliVariantsArg.trim() === "") {
    throw new Error(`--variants 值无效（空列表）。可选：${DEFAULT_VARIANTS.join(", ")}`);
  }
  if (!raw) return [...DEFAULT_VARIANTS];
  const list = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error(`--variants 值无效（空列表）。可选：${DEFAULT_VARIANTS.join(", ")}`);
  }
  const invalid = list.filter((v) => !DEFAULT_VARIANTS.includes(v));
  if (invalid.length > 0) {
    throw new Error(`未知变体：${invalid.join(", ")}。可选：${DEFAULT_VARIANTS.join(", ")}`);
  }
  return [...new Set(list)];
}

const args = process.argv.slice(2);
const isCustom = args.includes("-c");

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

function readText(path) {
  return readFile(resolvePath(rootDir, path), "utf-8");
}

async function writeText(path, content) {
  await writeFile(resolvePath(rootDir, path), content, "utf-8");
}

async function exists(path) {
  try {
    await stat(resolvePath(rootDir, path));
    return true;
  } catch {
    return false;
  }
}

function run(cmd, argsArr, opts = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const label = `${cmd} ${argsArr.join(" ")}`;
    const child = execFile(cmd, argsArr, { cwd: rootDir, stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        resolve(elapsed);
      } else {
        reject(new Error(`"${label}" 失败 (退出码 ${code}, 耗时 ${elapsed}s)`));
      }
    });
  });
}

function runWithSpinner(label, cmd, argsArr, opts = {}) {
  const spinner = ora({ text: label, color: "cyan" }).start();
  const start = Date.now();
  const timer = setInterval(() => {
    spinner.text = `${label} ⏱ ${((Date.now() - start) / 1000).toFixed(0)}s`;
  }, 1000);

  return new Promise((resolve, reject) => {
    const child = execFile(cmd, argsArr, {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
    let stderrBuf = "";
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => {
      // P5：累积 stderr，失败时附带在错误消息里，便于区分可重试/不可重试错误
      stderrBuf += d.toString();
      spinner.stop();
      process.stderr.write(d);
      spinner.start();
    });
    child.on("error", (e) => {
      clearInterval(timer);
      spinner.stop();
      reject(e);
    });
    child.on("close", (code) => {
      clearInterval(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        spinner.succeed(`${label} (${elapsed}s)`);
        resolve(elapsed);
      } else {
        spinner.fail(`${label} 失败 (退出码 ${code}, ${elapsed}s)`);
        const stderrTail = stderrBuf.trim().slice(-500);
        const err = new Error(
          `"${cmd} ${argsArr.join(" ")}" 失败 (退出码 ${code}, 耗时 ${elapsed}s)` +
            (stderrTail ? `\n${stderrTail}` : ""),
        );
        err.stderr = stderrBuf; // P5：完整 stderr，供调用方判断是否可重试
        reject(err);
      }
    });
  });
}

function runOutput(cmd, argsArr, opts = {}) {
  return execFileSync(cmd, argsArr, {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
    ...opts,
  }).trim();
}

function getRepoSlug() {
  return runOutput("git", ["remote", "get-url", "origin"])
    .replace(/.*github\.com[/u:]/u, "")
    .replace(/\.git$/u, "");
}

// P2：发布必须在 main 分支执行，避免 commit/tag 落在非 main 分支
// 而 push 仍推 main，导致 tag 指向不在远端 main 上的 commit。
function ensureOnMainBranch() {
  const branch = runOutput("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(
      `发布必须在 main 分支执行（当前分支: ${branch || "(detached HEAD)"}）。请先 git checkout main 再重跑`,
    );
  }
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

function classifyCommit(msg) {
  const entry = CATEGORY_ENTRIES.find((e) => e.prefixes.some((p) => msg.startsWith(p)));
  return entry ? entry.category : "🔧 其他";
}

function formatChangelog(messages) {
  const groups = {};
  for (const msg of messages) {
    const category = classifyCommit(msg);
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

function parseVersion(v) {
  const parts = v.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`版本号格式无效: ${v}`);
  }
  // P10：versionCode = major*10000 + minor*100 + patch，minor/patch ≥ 100 会与更高位进位冲突
  if (parts[1] > 99 || parts[2] > 99) {
    throw new Error(
      `版本号 ${v} 超出 versionCode 表示范围（minor 和 patch 均需 < 100，当前 minor=${parts[1]}, patch=${parts[2]}）`,
    );
  }
  return { major: parts[0], minor: parts[1], patch: parts[2], str: v };
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

// P9：数值比较两版本号，candidate >= base 返回 true（3 段，缺省段按 0）
function isVersionAtLeast(candidate, base) {
  const c = parseVersion(candidate);
  const b = parseVersion(base);
  return (
    c.major > b.major ||
    (c.major === b.major && (c.minor > b.minor || (c.minor === b.minor && c.patch >= b.patch)))
  );
}

function askQuestion(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function readCustomChangelog() {
  console.log("\n请粘贴你的自定义发布文案：");
  console.log("输入完成后，在新行输入 EOF 结束\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  for await (const line of rl) {
    if (line.trim() === "EOF") {
      break;
    }
    lines.push(line);
  }
  rl.close();
  const text = lines.join("\n").trim();
  if (!text) {
    console.log("  ⚠ 文案为空，请重新输入");
    return readCustomChangelog();
  }
  return text;
}

async function interactivePickCommits(commits) {
  console.log(`\n自上次发布以来的提交（共 ${commits.length} 个）:`);
  console.log("输入编号选择，支持格式: 1 3 5-8  (空格分隔, -表示范围)");
  console.log("  a = 全选  |  回车 = 空  |  q = 退出\n");

  // Display numbered list
  const items = commits.map((line) => line.replace(/^[0-9a-f]+\s+/u, ""));
  for (let i = 0; i < items.length; i++) {
    const entry = CATEGORY_ENTRIES.find((e) => e.prefixes.some((p) => items[i].startsWith(p)));
    const cat = entry ? entry.emoji : "🔧";
    console.log(`  ${(i + 1).toString().padStart(3)}  ${cat}  ${items[i]}`);
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

async function main() {
  log("Pictelio 一键发布脚本");
  console.log("");

  // P2：发布前强制校验 main 分支
  ensureOnMainBranch();

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

  // ── 发布计划确认 ──
  console.log("─".repeat(40));
  log("即将执行以下发布操作：");
  console.log(`  版本: ${currentVersion} → ${newVersion} (versionCode: ${versionCode})`);
  console.log(`  标签: ${tag}`);
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
      console.error("[release] 环境错误：" + envErrors.join("；"));
      console.error(
        "[release] 请先在 ~/.zshrc 中设置 PICTELIO_KEYSTORE_PASSWORD 和 PICTELIO_KEY_PASSWORD",
      );
      process.exit(1);
    }
  });

  await step(2, "更新版本号", async () => {
    // P4：记录本次会修改/新建的文件，供失败自动回滚
    rollbackFiles = releaseFilesFor(versionCode);
    pkg.version = newVersion;
    await writeText("package.json", JSON.stringify(pkg, null, 2) + "\n");
    await run("node", ["scripts/sync-android-version.mjs"]);
    const changelogPath = `fastlane/metadata/android/en-US/changelogs/${versionCode}.txt`;
    await mkdir(dirname(resolvePath(rootDir, changelogPath)), { recursive: true });
    await writeText(changelogPath, changelog);
    const verJson =
      JSON.stringify(
        {
          version: newVersion,
          // P7：repo 名动态取 git remote，避免硬编码旧 repo 名
          url: `https://github.com/${getRepoSlug()}/releases/tag/${tag}`,
          changelog: changelog.slice(0, 200),
        },
        null,
        2,
      ) + "\n";
    await mkdir(dirname(resolvePath(rootDir, "../../packages/website/version.json")), {
      recursive: true,
    });
    await writeText("../../packages/website/version.json", verJson);
  });

  await step(3, "构建 APK", async () => {
    // #119：按变体解析 assemble/rename task
    const variants = resolveVariants();
    log(`构建变体：${variants.join(", ")}`);
    const gradleTasks = variants.flatMap((flavor) => {
      const cap = flavor.charAt(0).toUpperCase() + flavor.slice(1);
      return [`assemble${cap}Release`, `rename${cap}ReleaseApk`];
    });

    const buildSteps = [
      ["同步 OAuth 配置", "pnpm", ["run", "sync:credentials"]],
      ["构建 Web 产物", "pnpm", ["run", "build"]],
      ["同步 Capacitor 资源", "pnpm", ["run", "cap:sync"]],
      [
        "编译 Release APK",
        "./gradlew",
        gradleTasks,
        {
          cwd: resolvePath(rootDir, "android"),
          env: { ...process.env, GRADLE_USER_HOME: resolvePath(rootDir, "android", ".gradle") },
        },
      ],
    ];
    const total = buildSteps.length;
    for (let i = 0; i < total; i++) {
      const [label, cmd, stepArgs, opts] = buildSteps[i];
      const subLabel = `[${i + 1}/${total}] ${label}`;
      if (cmd === "./gradlew") {
        try {
          await runWithSpinner(subLabel, cmd, stepArgs, opts);
        } catch {
          log("Gradle 构建失败，重试并输出详细堆栈...");
          await runWithSpinner(`${subLabel}（详细堆栈）`, cmd, [...stepArgs, "--stacktrace"], opts);
        }
      } else {
        await runWithSpinner(subLabel, cmd, stepArgs, opts || {});
      }
    }
    const apkPaths = apkPathsFor(newVersion, variants);
    const missing = [];
    for (const p of apkPaths) {
      if (!(await exists(p))) missing.push(p);
    }
    if (missing.length > 0) throw new Error(`APK 未生成: ${missing.join(", ")}`);
    log(`APK 构建完成，产物:`);
    for (const p of apkPaths) log(`  ${resolvePath(rootDir, p)}`);
  });

  await step(4, "Git 提交 + Tag", async () => {
    // P3：只提交发布相关文件，并拦截清单之外的多余变更，
    // 防止无关改动混入发布 commit 或发布产物漏提交。
    const releaseFiles = releaseFilesFor(versionCode);
    const status = runOutput("git", ["status", "--porcelain"], { cwd: repoRoot });
    const extra = status
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3)) // "XY path" 格式，取路径部分
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
          "main",
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
    const apkPaths = apkPathsFor(newVersion, resolveVariants());
    const repo = getRepoSlug();
    let notesFile, tmpDir;
    try {
      tmpDir = await mkdtemp(resolvePath(tmpdir(), "pictelio-release-"));
      notesFile = resolvePath(tmpDir, "release-notes.md");
      await writeFile(notesFile, changelog, "utf-8");

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

      // 第二步：上传 APK（单独步骤，慢但可重试；#119 循环多变体）
      let uploadErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const uploadArgs = [
            "release",
            "upload",
            tag,
            "--repo",
            repo,
            "--clobber",
            ...apkPaths.map((p) => resolvePath(rootDir, p)),
          ];
          await runWithSpinner(`上传 APK (第 ${attempt} 次)`, "gh", uploadArgs);
          uploadErr = null;
          break;
        } catch (e) {
          uploadErr = e;
          if (attempt < 3) {
            const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
            log(`APK 上传失败（第 ${attempt} 次），${delay / 1000}s 后重试...`);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      if (uploadErr) {
        uploadErr.relTag = tag;
        uploadErr.relTitle = title;
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
    if (error.stepN === 2 || error.stepN === 3) {
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
      // P4：commit/tag 已建立但 push 失败——本地已有提交，不能直接重跑
      console.error(`\n   已完成的步骤: 3/6`);
      console.error(`   commit/tag 已存在于本地，尚未推送。如需重新发布当前版本:`);
      console.error(`     git reset --soft HEAD~1`);
      console.error(`     git tag -d ${publishedTag}`);
      console.error(`   然后重跑；或保留本地提交继续发布下一版本`);
    } else if (error.stepN === 5) {
      console.error(`\n   已完成的步骤: 4/6`);
      console.error(`   git push 失败。可能已推送 tag 但未推送 main，或部分成功。检查远端:`);
      console.error(`     git ls-remote origin ${publishedTag}`);
      console.error(`   若 main 已推送而 tag 未推送，可重试: git push origin ${publishedTag}`);
    } else if (error.stepN === 6) {
      const repoKey = getRepoSlug();
      const relTag = error.relTag || "vX.Y.Z";
      const apkRels = apkPathsFor(publishedVersion, resolveVariants())
        .map((p) => `packages/app/${p}`)
        .join(" ");
      // P6：changelog 在 step 2 已写入 fastlane（未提交但文件在），直接指向文件
      const notesFile = `packages/app/fastlane/metadata/android/en-US/changelogs/${publishedVersionCode}.txt`;
      console.error(`\n   已完成的步骤: 5/6`);
      console.error(`   git 已推送但 GitHub Release 创建/上传失败。手动恢复:`);
      console.error(`     1. 创建 Release:`);
      console.error(
        `        gh release create ${relTag} --repo ${repoKey} --title "${error.relTitle || `Pictelio ${relTag}`}" --notes-file ${notesFile}`,
      );
      console.error(`     2. 上传 APK（若 release 已存在可跳过第 1 步）:`);
      console.error(`        gh release upload ${relTag} --repo ${repoKey} --clobber ${apkRels}`);
      console.error(
        `     （若 ${notesFile} 不存在，可改为 --notes "Pictelio ${relTag}" 或手动粘贴 changelog）`,
      );
    }
  } else {
    console.error(`   ${error.message}`);
  }
  process.exit(1);
});
