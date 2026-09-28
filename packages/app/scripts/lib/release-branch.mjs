// 发布目标分支的解析与校验（#816 过渡版 6.2.0）。
//
// 拆出来是为了可单测：`release.mjs` 的 `main()` 里有 TTY 早退 + 交互提问，
// 开关是否真的生效无法在 CI 里跑到（先例：`release-preflight.mjs` 同样只放纯逻辑）。
//
// 安全约束（与 release.mjs 内联版一致，此处为唯一实现）：
//   ① 只有显式设置 PICTELIO_RELEASE_BRANCH 才覆盖，缺省恒为 main；
//   ② 覆盖后**仍强制**人必须处在该分支上——不会出现「人在 A 分支、发到 B 分支」；
//   ③ 非 main 时必须打醒目告警（tag 将指向非主干分支的 commit）。
export const DEFAULT_RELEASE_BRANCH = "main";

/** 解析发布目标分支：空串/未设置/纯空白 → 回落到 main。 */
export function resolveReleaseBranch(env = process.env) {
  const raw = env.PICTELIO_RELEASE_BRANCH;
  return raw?.trim() || DEFAULT_RELEASE_BRANCH;
}

/**
 * 校验当前所处分支就是发布目标分支，否则抛错并给出可执行的指引。
 * @param {{ current: string; branch: string }} params
 */
export function assertOnReleaseBranch({ current, branch }) {
  if (current === branch) return;
  const where = current || "(detached HEAD)";
  const hint =
    branch === DEFAULT_RELEASE_BRANCH
      ? "请先 git checkout main 再重跑"
      : `当前 PICTELIO_RELEASE_BRANCH=${branch}，请先 git checkout ${branch} 再重跑`;
  throw new Error(`发布必须在 ${branch} 分支执行（当前分支: ${where}）。${hint}`);
}

/** 非 main 时的告警文案；main 返回 null（不打）。 */
export function releaseBranchWarning(branch) {
  if (branch === DEFAULT_RELEASE_BRANCH) return null;
  return (
    `发布目标分支已覆盖为 ${branch}（PICTELIO_RELEASE_BRANCH）——非 main 分支发布，` +
    "tag 将指向该分支的 commit，确认这是有意为之"
  );
}
