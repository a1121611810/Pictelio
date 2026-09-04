// git 引用原语（ADR-0142 D4）：pre-push 编排器（scripts/check-push-refs.mjs）与
// release.mjs 分叉预检（scripts/lib/release-preflight.mjs）共用。
// 只暴露原语，不含 fail-open/fail-closed 策略（策略在使用方）。
// 所有函数显式接收 cwd，不绑定仓库路径（测试用真实 fixture 仓库驱动）。
import { execFile } from "node:child_process";

const MODULE = "[git-refs]";

// 执行 git 并返回结构化结果：非零退出不 reject（由调用方按语义解释退出码），
// 仅 spawn 级错误（git 不存在等）reject。
function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") {
          reject(new Error(`${MODULE} git ${args[0]} 启动失败: ${err.message}`));
          return;
        }
        resolve({ code: typeof err?.code === "number" ? err.code : 0, stdout, stderr });
      },
    );
  });
}

// 分支引用映射到 remote-tracking 引用；非分支引用（tag 等）原样保留。
export function trackingRefFor(remoteRef, remote = "origin") {
  return remoteRef.startsWith("refs/heads/")
    ? remoteRef.replace("refs/heads/", `refs/remotes/${remote}/`)
    : remoteRef;
}

// 本地是否持有指定 commit 对象（git cat-file -e 边界）。
// 任何非零退出（对象缺失、非仓库目录等）一律返回 false——「无法确认存在」按不存在处理，
// 后续 fetch 失败时由使用方负责 warn（禁静默降级在使用方闭环）。
export async function hasCommitObject(sha, cwd) {
  const r = await runGit(["cat-file", "-e", `${sha}^{commit}`], cwd);
  return r.code === 0;
}

// 精准 fetch 单个远端引用：只取所需 ref，显式 refspec 强制更新 tracking 引用
//（+ 允许远端历史改写后的非 ff 更新）。成功/失败显式区分，stderr 原样带回供调用方打 warn。
export async function fetchRemoteRef({ remoteRef, remote = "origin", cwd }) {
  const refspec = `+${remoteRef}:${trackingRefFor(remoteRef, remote)}`;
  const r = await runGit(["fetch", "--no-tags", remote, refspec], cwd);
  return { ok: r.code === 0, stderr: r.stderr.trim() };
}

// 祖先判定：olderRef 是否是 newerRef 的祖先（0 → true，1 → false）。
// 其他退出码（对象缺失等）throw——调用方必须先确保两端对象存在（hasCommitObject + fetch）。
export async function isAncestor(olderRef, newerRef, cwd) {
  const r = await runGit(["merge-base", "--is-ancestor", olderRef, newerRef], cwd);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new Error(
    `${MODULE} git merge-base --is-ancestor ${olderRef} ${newerRef} 失败（退出码 ${r.code}）: ${r.stderr.trim()}`,
  );
}

// 解析引用到 commit sha；失败 throw（显式错误，不静默降级为空串）。
export async function resolveRef(ref, cwd) {
  const r = await runGit(["rev-parse", "--verify", ref], cwd);
  if (r.code !== 0) {
    throw new Error(`${MODULE} git rev-parse --verify ${ref} 失败: ${r.stderr.trim()}`);
  }
  return r.stdout.trim();
}

// 两点 diff 的文件名列表（from..to）。
export async function diffNames(fromRef, toRef, cwd) {
  const r = await runGit(["diff", "--name-only", `${fromRef}..${toRef}`], cwd);
  if (r.code !== 0) {
    throw new Error(
      `${MODULE} git diff --name-only ${fromRef}..${toRef} 失败: ${r.stderr.trim()}`,
    );
  }
  return r.stdout.split("\n").filter(Boolean);
}

// merge-base；无共同祖先（或引用不可解析）返回 null——调用方退化为 diffTreeNames
//（与原 .husky/pre-push 新分支路径的 `|| true` 退化语义一致）。
export async function mergeBase(a, b, cwd) {
  const r = await runGit(["merge-base", a, b], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

// 单提交的根 diff 文件名列表（新分支且取不到 merge-base 时的退化路径）。
// --root：根提交对空树 diff（原 shell 钩子缺此 flag，orphan 分支根提交会漏检为 0 文件）。
export async function diffTreeNames(sha, cwd) {
  const r = await runGit(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha], cwd);
  if (r.code !== 0) {
    throw new Error(`${MODULE} git diff-tree ${sha} 失败: ${r.stderr.trim()}`);
  }
  return r.stdout.split("\n").filter(Boolean);
}
