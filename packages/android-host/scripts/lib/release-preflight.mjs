// release.mjs 确认前分叉预检（ADR-0142 D3 / spec #349 / ticket #353）
// 与 P4 tag 预检同区（确认发布提示之前）：确认分叉 → fail-fast 中止，
// 版本号未 bump、无 commit/tag，零半成品；fetch 失败 → warn + 继续
//（与 P4 ls-remote 失败处理先例一致），由 pre-push 钩子在 push 时兜底。
//
// 分支可覆盖（#816 / 过渡版 6.2.0）：`branch` 由 release.mjs 传入，默认 `main`。
// 原本三个调用点（分支校验 / 分叉预检 / push 目标）各自硬编码 `main`；过渡版发版需要
// 从 `release/transition-6.2.0` 发 tag，若只放开其中一两处会出现「tag 指向不在远端
// 分支上的 commit」——正是 P2 注释要防的故障。故三处**共用同一个 branch 参数**，
// 一次开关整体切换，不留半开状态。
import { fetchRemoteRef, isAncestor, resolveRef } from "./git-refs.mjs";

const MODULE = "[release]";

export async function assertReleaseBranchNotDiverged({
  cwd,
  branch = "main",
  log = console.log,
  warn = console.warn,
} = {}) {
  const fetched = await fetchRemoteRef({ remoteRef: `refs/heads/${branch}`, cwd });
  if (!fetched.ok) {
    warn(
      `${MODULE} ⚠ 无法检查远端分叉（git fetch origin ${branch} 失败: ${fetched.stderr.split("\n")[0] || "未知原因"}）\n` +
        "  将继续发布流程；若远端确有分叉，push 时会由 pre-push 钩子拦截并给出指引",
    );
    return;
  }
  // 比较本地分支引用与 origin/<branch>（与 push 步骤实际推送的引用一致，不比较 HEAD）
  const localRef = await resolveRef(branch, cwd);
  const remoteRef = await resolveRef(`origin/${branch}`, cwd);
  if (localRef === remoteRef || (await isAncestor(remoteRef, localRef, cwd))) {
    log(`${MODULE} 远端分叉预检通过（origin/${branch} 是本地 ${branch} 的祖先）`);
    return;
  }
  throw new Error(
    `远端 ${branch} 包含本地没有的提交（常见于 OpenWiki CI 定时合并 docs 更新）。\n` +
      `  请先执行: git fetch origin && git rebase origin/${branch}\n` +
      "  若存在上次失败残留的本地 tag，rebase 后需删除重打；然后重跑 pnpm release:android-host",
  );
}
