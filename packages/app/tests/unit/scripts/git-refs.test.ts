// git-refs 共享原语测试（ADR-0142 / spec #349 / ticket #351）
// 期望值来源（oracle 溯源）：fixture 用真实 git 双仓库构造已知提交拓扑，
// 断言依据 fixture 中独立可验证的事实（commit sha、推送/未推送状态），
// 禁止 mock git 输出（契约测试硬约束）。
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasCommitObject,
  fetchRemoteRef,
  isAncestor,
  resolveRef,
  trackingRefFor,
} from "../../../scripts/lib/git-refs.mjs";

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args.join(" ")} 失败: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function commitFile(repo, name, content, msg) {
  await writeFile(join(repo, name), content);
  await git(["add", name], repo);
  await git(["commit", "-m", msg], repo);
  return git(["rev-parse", "HEAD"], repo);
}

// 构造 local + 远端 bare 双仓库：local 在 main 上有提交 A 并已推送。
async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "git-refs-test-"));
  tempDirs.push(dir);
  const remote = join(dir, "remote.git");
  const local = join(dir, "local");
  await git(["init", "--bare", "-b", "main", remote], dir);
  await git(["init", "-b", "main", local], dir);
  await git(["config", "user.email", "test@example.com"], local);
  await git(["config", "user.name", "Test"], local);
  const shaA = await commitFile(local, "a.txt", "A", "commit A");
  await git(["remote", "add", "origin", remote], local);
  await git(["push", "-u", "origin", "main"], local);
  return { dir, remote, local, shaA };
}

// 通过第三方克隆推进远端 main（模拟 OpenWiki CI 合并），local 不 fetch。
async function advanceRemote(fixture, name = "b.txt", content = "B") {
  const other = join(fixture.dir, "other");
  await git(["clone", fixture.remote, other], fixture.dir);
  await git(["config", "user.email", "ci@example.com"], other);
  await git(["config", "user.name", "CI"], other);
  const shaB = await commitFile(other, name, content, "remote advance");
  await git(["push", "origin", "main"], other);
  return shaB;
}

describe("hasCommitObject", () => {
  it("本地已有的 commit 返回 true", async () => {
    const f = await makeFixture();
    expect(await hasCommitObject(f.shaA, f.local)).toBe(true);
  });

  it("远端有但本地未 fetch 的 commit 返回 false，fetch 后返回 true", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    expect(await hasCommitObject(shaB, f.local)).toBe(false);
    await fetchRemoteRef({ remoteRef: "refs/heads/main", cwd: f.local });
    expect(await hasCommitObject(shaB, f.local)).toBe(true);
  });
});

describe("fetchRemoteRef", () => {
  it("成功路径：精准 fetch 后 origin/main 更新为远端新提交", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    const before = await resolveRef("origin/main", f.local);
    expect(before).toBe(f.shaA);
    const r = await fetchRemoteRef({ remoteRef: "refs/heads/main", cwd: f.local });
    expect(r.ok).toBe(true);
    expect(await resolveRef("origin/main", f.local)).toBe(shaB);
  });

  it("失败路径：remote 不可达 → ok=false 且 stderr 非空（显式错误返回，不静默）", async () => {
    const f = await makeFixture();
    await git(["remote", "set-url", "origin", join(f.dir, "nonexistent.git")], f.local);
    const r = await fetchRemoteRef({ remoteRef: "refs/heads/main", cwd: f.local });
    expect(r.ok).toBe(false);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it("tag 引用：fetch refs/tags/* 后本地可解析该 tag", async () => {
    const f = await makeFixture();
    const other = join(f.dir, "other");
    await git(["clone", f.remote, other], f.dir);
    await git(["config", "user.email", "ci@example.com"], other);
    await git(["config", "user.name", "CI"], other);
    await git(["tag", "-a", "v9.9.9", "-m", "tag"], other);
    await git(["push", "origin", "refs/tags/v9.9.9"], other);
    const r = await fetchRemoteRef({ remoteRef: "refs/tags/v9.9.9", cwd: f.local });
    expect(r.ok).toBe(true);
    // annotated tag 的 ref 指向 tag 对象，^{commit} 剥离到 commit 再比对
    expect(await resolveRef("refs/tags/v9.9.9^{commit}", f.local)).toBe(f.shaA);
  });
});

describe("isAncestor", () => {
  it("本地领先远端（fast-forward 态）：远端 tip 是本地 HEAD 的祖先 → true", async () => {
    const f = await makeFixture();
    const shaC = await commitFile(f.local, "c.txt", "C", "commit C");
    expect(await isAncestor(f.shaA, shaC, f.local)).toBe(true);
  });

  it("分叉（远端含本地没有的提交）：远端新 tip 不是本地 HEAD 的祖先 → false", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    const shaC = await commitFile(f.local, "c.txt", "C", "commit C");
    await fetchRemoteRef({ remoteRef: "refs/heads/main", cwd: f.local });
    expect(await isAncestor(shaB, shaC, f.local)).toBe(false);
  });

  it("对象缺失时抛出带模块前缀的错误（不静默吞 128）", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    const shaC = await commitFile(f.local, "c.txt", "C", "commit C");
    await expect(isAncestor(shaB, shaC, f.local)).rejects.toThrow("[git-refs]");
  });
});

describe("resolveRef", () => {
  it("成功路径：解析分支到 commit sha", async () => {
    const f = await makeFixture();
    expect(await resolveRef("main", f.local)).toBe(f.shaA);
  });

  it("失败路径：不存在的引用 → throw", async () => {
    const f = await makeFixture();
    await expect(resolveRef("refs/heads/nonexistent", f.local)).rejects.toThrow();
  });
});

describe("trackingRefFor（纯函数映射）", () => {
  it("分支引用映射到 remote-tracking 引用", () => {
    expect(trackingRefFor("refs/heads/main")).toBe("refs/remotes/origin/main");
    expect(trackingRefFor("refs/heads/feat", "upstream")).toBe("refs/remotes/upstream/feat");
  });

  it("非分支引用（tag 等）原样保留", () => {
    expect(trackingRefFor("refs/tags/v1.0.0")).toBe("refs/tags/v1.0.0");
  });
});
