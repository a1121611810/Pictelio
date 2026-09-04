// release-preflight 分叉预检测试（ADR-0142 D3 / spec #349 / ticket #353）
// 期望值来源（oracle 溯源）：真实 git 双仓库 fixture 的已知提交拓扑，禁止 mock git 输出。
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMainNotDiverged } from "../../../scripts/lib/release-preflight.mjs";

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

async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "release-preflight-test-"));
  tempDirs.push(dir);
  const remote = join(dir, "remote.git");
  const local = join(dir, "local");
  await git(["init", "--bare", "-b", "main", remote], dir);
  await git(["init", "-b", "main", local], dir);
  await git(["config", "user.email", "test@example.com"], local);
  await git(["config", "user.name", "Test"], local);
  await commitFile(local, "a.txt", "A", "commit A");
  await git(["remote", "add", "origin", remote], local);
  await git(["push", "-u", "origin", "main"], local);
  return { dir, remote, local };
}

async function advanceRemote(f) {
  const other = join(f.dir, "other");
  await git(["clone", f.remote, other], f.dir);
  await git(["config", "user.email", "ci@example.com"], other);
  await git(["config", "user.name", "CI"], other);
  await commitFile(other, "openwiki.md", "wiki", "docs: update OpenWiki");
  await git(["push", "origin", "main"], other);
}

describe("assertMainNotDiverged", () => {
  it("干净（本地领先远端）→ 放行并打通过日志", async () => {
    const f = await makeFixture();
    await commitFile(f.local, "c.txt", "C", "commit C"); // 本地领先 1 个提交
    const logs = [];
    const warns = [];
    await assertMainNotDiverged({
      cwd: f.local,
      log: (m) => logs.push(m),
      warn: (m) => warns.push(m),
    });
    expect(logs.join("\n")).toContain("预检通过");
    expect(warns).toEqual([]);
  });

  it("分叉（远端含本地没有的提交）→ throw 且文案含 rebase 指引与重打 tag 提醒", async () => {
    const f = await makeFixture();
    await advanceRemote(f);
    await commitFile(f.local, "c.txt", "C", "diverged commit");
    await expect(
      assertMainNotDiverged({ cwd: f.local, log: () => {}, warn: () => {} }),
    ).rejects.toThrow(/git fetch origin && git rebase origin\/main/);
    await expect(
      assertMainNotDiverged({ cwd: f.local, log: () => {}, warn: () => {} }),
    ).rejects.toThrow(/重打/);
  });

  it("fetch 失败（remote 不可达）→ warn 不 throw（与 P4 ls-remote 先例一致）", async () => {
    const f = await makeFixture();
    await git(["remote", "set-url", "origin", join(f.dir, "nonexistent.git")], f.local);
    const warns = [];
    await assertMainNotDiverged({ cwd: f.local, log: () => {}, warn: (m) => warns.push(m) });
    expect(warns.join("\n")).toContain("无法检查远端分叉");
    expect(warns.join("\n")).toContain("pre-push");
  });
});
