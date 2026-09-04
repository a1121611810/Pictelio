// release.mjs 确认前分叉预检（ADR-0142 D3 / spec #349 / ticket #353）
// 与 P4 tag 预检同区（确认发布提示之前）：确认分叉 → fail-fast 中止，
// 版本号未 bump、无 commit/tag，零半成品；fetch 失败 → warn + 继续
//（与 P4 ls-remote 失败处理先例一致），由 pre-push 钩子在 push 时兜底。
import { fetchRemoteRef, isAncestor, resolveRef } from "./git-refs.mjs";

const MODULE = "[release]";

export async function assertMainNotDiverged({ cwd, log = console.log, warn = console.warn } = {}) {
  const fetched = await fetchRemoteRef({ remoteRef: "refs/heads/main", cwd });
  if (!fetched.ok) {
    warn(
      `${MODULE} ⚠ 无法检查远端分叉（git fetch origin main 失败: ${fetched.stderr.split("\n")[0] || "未知原因"}）\n` +
        "  将继续发布流程；若远端确有分叉，push 时会由 pre-push 钩子拦截并给出指引",
    );
    return;
  }
  // 比较本地 main 引用与 origin/main（与 push 步骤实际推送的引用一致，不比较 HEAD）
  const localMain = await resolveRef("main", cwd);
  const remoteMain = await resolveRef("origin/main", cwd);
  if (localMain === remoteMain || (await isAncestor(remoteMain, localMain, cwd))) {
    log(`${MODULE} 远端分叉预检通过（origin/main 是本地 main 的祖先）`);
    return;
  }
  throw new Error(
    "远端 main 包含本地没有的提交（常见于 OpenWiki CI 定时合并 docs 更新）。\n" +
      "  请先执行: git fetch origin && git rebase origin/main\n" +
      "  若存在上次失败残留的本地 tag，rebase 后需删除重打；然后重跑 pnpm release",
  );
}
