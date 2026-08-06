// Pictelio 发布流程共享工具（release.mjs 与 release-overwrite.mjs 共用）
//
// 纯搬移自 scripts/release.mjs（不变量为重构）：常量、APK 路径、进程调用、
// 交互输入、版本解析、repo 解析等工具集中于此，避免两处重复实现。
// 本文件不包含任何发布流程编排逻辑。

import { readFile, writeFile, stat } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import process from "node:process";
import ora from "ora";

// lib/ 的上级上级 = packages/app（与 release.mjs 的 rootDir 语义一致）
const rootDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);

// #119：三 flavor 变体（full / webview / lynx），默认全量
export const DEFAULT_VARIANTS = ["full", "webview", "lynx"];
export const APK_DIR = "android/app/build/outputs/apk";

export function apkPathsFor(version, variants) {
  return variants.map((flavor) => `${APK_DIR}/${flavor}/release/pictelio-${version}-${flavor}.apk`);
}

// 解析 --variants / PICTELIO_RELEASE_VARIANTS，默认全量
export function resolveVariants() {
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

export function readText(path) {
  return readFile(resolvePath(rootDir, path), "utf-8");
}

export async function writeText(path, content) {
  await writeFile(resolvePath(rootDir, path), content, "utf-8");
}

export async function exists(path) {
  try {
    await stat(resolvePath(rootDir, path));
    return true;
  } catch {
    return false;
  }
}

export function run(cmd, argsArr, opts = {}) {
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

export function runWithSpinner(label, cmd, argsArr, opts = {}) {
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

export function runOutput(cmd, argsArr, opts = {}) {
  const { trim = true, ...execOpts } = opts;
  const out = execFileSync(cmd, argsArr, {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
    ...execOpts,
  });
  // P3-fix：trim 会吃掉多行输出的首行前导空格（git status 首行以 " M " 开头），
  // 需要解析行格式时传 { trim: false }
  return trim ? out.trim() : out;
}

// P12：结构化解析 origin URL（支持 https/git@/ssh:// 三种形态），
// 避免旧正则靠贪婪匹配猜前缀导致的解析错误。
export function getRepoSlug() {
  const url = runOutput("git", ["remote", "get-url", "origin"]);
  // https://github.com/owner/repo.git | git@github.com:owner/repo.git | ssh://git@github.com/owner/repo.git
  const m = url.match(/(?:github\.com[:/])([^/]+)\/([^/\s]+?)(?:\.git)?$/iu);
  if (!m) {
    throw new Error(`无法从 origin 解析 GitHub 仓库: ${url}`);
  }
  return `${m[1]}/${m[2]}`;
}

export function parseVersion(v) {
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

// P9：数值比较两版本号，candidate >= base 返回 true（3 段，缺省段按 0）
export function isVersionAtLeast(candidate, base) {
  const c = parseVersion(candidate);
  const b = parseVersion(base);
  return (
    c.major > b.major ||
    (c.major === b.major && (c.minor > b.minor || (c.minor === b.minor && c.patch >= b.patch)))
  );
}

export function askQuestion(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function readCustomChangelog() {
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

// P16：把 changelog 里 "hash message" 行转成 GitHub commit 链接（仅用于 Release notes）。
// fastlane 文件 / git commit message 保持纯文本，不经过此函数。
export function addCommitLinks(changelog, repo) {
  return changelog
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)([0-9a-f]{7,40})\s+(.*)$/u);
      return m ? `${m[1]}[${m[3]}](https://github.com/${repo}/commit/${m[2]})` : line;
    })
    .join("\n");
}
