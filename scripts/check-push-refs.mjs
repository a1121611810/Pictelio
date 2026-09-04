#!/usr/bin/env node
// check-push-refs：pre-push 静态校验编排器（ADR-0142 / spec #349 / ticket #352）
// 接管 stdin pre-push 协议（逐行 <local ref> <local sha> <remote ref> <remote sha>）：
//   1) remote_sha 本地缺失 → 精准 fetch 重试；fetch 失败 → warn + fail-open 放行
//      （push 本身必联网，fetch 失败时 push 也必失败，fail-open 不会放行坏代码）
//   2) 真分叉（remote_sha 非 local_sha 祖先）→ fail-closed 人话报错（exit 1）
//   3) 三域触碰校验：packages/app/(src|tests/agent-browser) → E2E 锚点静态校验；
//      packages/app-lynx/(src|tests) → app-lynx 单测；.agents/ → 仓库级 skill 校验
// .husky/pre-push 为透传 stdin 的薄壳；本脚本承载全部逻辑以便单测（真实 git fixture）。
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasCommitObject,
  fetchRemoteRef,
  isAncestor,
  diffNames,
  mergeBase,
  diffTreeNames,
} from "../packages/app/scripts/lib/git-refs.mjs";

const MODULE = "[check-push-refs]";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = "0000000000000000000000000000000000000000";

// 三域配置：文案与原 .husky/pre-push 逐字一致（行为不变约束）
const DOMAINS = [
  {
    key: "app",
    pattern: /^packages\/app\/(src\/|tests\/agent-browser\/)/u,
    script: "packages/app/scripts/check-e2e-anchors.mjs",
    banner: "pre-push: 检测到 packages/app/src 或 tests/agent-browser 改动，运行 E2E 锚点静态校验…",
    failGuidance:
      "❌ E2E 锚点静态校验失败\n" +
      "  - 修复失效锚点（同步 spec 或 src）后重试\n" +
      "  - 确认为误报时可用 git push --no-verify 绕过",
  },
  {
    key: "app-lynx",
    pattern: /^packages\/app-lynx\/(src\/|tests\/)/u,
    script: "packages/app-lynx/scripts/check-app-lynx-anchors.mjs",
    banner: "pre-push: 检测到 packages/app-lynx 改动，跑 app-lynx 单测…",
    failGuidance:
      "❌ app-lynx 单测失败\n" +
      "  - 修复失败的单测后重试\n" +
      "  - 确认为误报时可用 git push --no-verify 绕过",
  },
  {
    key: "agents",
    pattern: /^\.agents\//u,
    script: "scripts/verify-agent-skills.mjs",
    banner: "pre-push: 检测到 .agents/ 改动，运行仓库级 skill 校验…",
    failGuidance:
      "❌ 仓库级 skill 校验失败\n" +
      "  - 修复 .agents/skills/ 下 SKILL.md（frontmatter / name 一致性）后重试\n" +
      "  - 确认为误报时可用 git push --no-verify 绕过",
  },
];

function defaultRunDomainCheck(script, cwd) {
  return new Promise((resolvePromise) => {
    execFile("node", [script], { cwd, stdio: "inherit" }, (err) => {
      resolvePromise(err ? (typeof err.code === "number" ? err.code : 1) : 0);
    });
  });
}

// 返回进程退出码（0 放行 / 1 拦截）；不直接 process.exit，便于测试。
export async function runPrePushChecks({
  stdinText,
  // git 操作默认作用于「钩子被调用时的工作区」（git 以保证 cwd=工作树根部调用钩子），
  // 与脚本位置解耦，便于 fixture/E2E 驱动；域校验脚本始终从脚本所在仓库根解析。
  gitCwd = process.cwd(),
  repoRoot = REPO_ROOT,
  runDomainCheck = defaultRunDomainCheck,
  log = console.log,
  warn = console.warn,
  error = console.error,
} = {}) {
  const touched = new Set();
  let diverged = false;

  for (const line of stdinText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [, localSha, remoteRef, remoteSha] = trimmed.split(/\s+/u);

    // 删除远端分支：无新代码，无需校验
    if (localSha === ZERO) continue;

    let files;
    if (remoteSha === ZERO) {
      // 新分支：与 origin/main 的 merge-base 比较；取不到时退化为仅看顶端提交
      const base = await mergeBase(localSha, "origin/main", gitCwd);
      files = base ? await diffNames(base, localSha, gitCwd) : await diffTreeNames(localSha, gitCwd);
    } else {
      // 已存在分支：remote_sha 本地缺失 → 精准 fetch 重试（ADR-0142 D1）
      if (!(await hasCommitObject(remoteSha, gitCwd))) {
        const fetched = await fetchRemoteRef({ remoteRef, cwd: gitCwd });
        if (!fetched.ok || !(await hasCommitObject(remoteSha, gitCwd))) {
          warn(
            `${MODULE} ⚠ 远端引用 ${remoteRef}（${remoteSha.slice(0, 8)}）本地不存在且 fetch 失败` +
              (fetched.stderr ? `: ${fetched.stderr.split("\n")[0]}` : "") +
              "\n  跳过该引用的静态校验并放行（fail-open：push 本身必联网，网络异常时 push 会自行失败）",
          );
          continue;
        }
      }
      // 真分叉 / 远端历史改写 → 人话报错（ADR-0142 D2）
      if (!(await isAncestor(remoteSha, localSha, gitCwd))) {
        error(
          `❌ pre-push: 远端 ${remoteRef} 包含本地没有的提交（常见于 OpenWiki CI 定时合并 docs 更新）\n` +
            "  - 请先执行: git fetch origin && git rebase origin/main\n" +
            "  - 完成后重试 push；确认为误报时可用 git push --no-verify 绕过",
        );
        diverged = true;
        continue;
      }
      files = await diffNames(remoteSha, localSha, gitCwd);
    }

    for (const d of DOMAINS) {
      if (files.some((f) => d.pattern.test(f))) touched.add(d.key);
    }
  }

  // 分叉/历史改写：拦截，且不跑域校验（rebase 后下一次 push 再校验）
  if (diverged) return 1;

  // 未触碰任何相关目录：零开销放行
  if (touched.size === 0) return 0;

  for (const d of DOMAINS) {
    if (!touched.has(d.key)) continue;
    log(d.banner);
    const code = await runDomainCheck(d.script, repoRoot);
    if (code !== 0) {
      error(d.failGuidance);
      return 1;
    }
  }
  return 0;
}

// CLI 入口（薄壳 .husky/pre-push 透传 stdin）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let stdinText = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) stdinText += chunk;
  try {
    process.exit(await runPrePushChecks({ stdinText }));
  } catch (e) {
    console.error(`${MODULE} 未预期错误: ${e.message}`);
    process.exit(1);
  }
}
