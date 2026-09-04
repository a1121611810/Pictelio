// check-push-refs 编排器测试（ADR-0142 / spec #349 / ticket #352）
// 期望值来源（oracle 溯源）：真实 git 双仓库 fixture 的已知提交拓扑；
// git 数据零 mock（契约测试硬约束），仅域校验脚本调用（check-e2e-anchors 等）
// 以记录型桩替代——那些脚本有各自的测试，此处只验证编排器的调度与分支语义。
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runPrePushChecks } from "../../../../../scripts/check-push-refs.mjs";

const ZERO = "0000000000000000000000000000000000000000";
const APP_SCRIPT = "packages/app/scripts/check-e2e-anchors.mjs";
const LYNX_SCRIPT = "packages/app-lynx/scripts/check-app-lynx-anchors.mjs";
const AGENTS_SCRIPT = "scripts/verify-agent-skills.mjs";

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

async function commitFiles(repo, files, msg) {
  for (const [p, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo, p)), { recursive: true });
    await writeFile(join(repo, p), content);
    await git(["add", p], repo);
  }
  await git(["commit", "-m", msg], repo);
  return git(["rev-parse", "HEAD"], repo);
}

async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "check-push-refs-test-"));
  tempDirs.push(dir);
  const remote = join(dir, "remote.git");
  const local = join(dir, "local");
  await git(["init", "--bare", "-b", "main", remote], dir);
  await git(["init", "-b", "main", local], dir);
  await git(["config", "user.email", "test@example.com"], local);
  await git(["config", "user.name", "Test"], local);
  const shaA = await commitFiles(local, { "a.txt": "A" }, "commit A");
  await git(["remote", "add", "origin", remote], local);
  await git(["push", "-u", "origin", "main"], local);
  return { dir, remote, local, shaA };
}

// 第三方克隆推进远端 main（模拟 OpenWiki CI 合并），local 不 fetch
async function advanceRemote(f) {
  const other = join(f.dir, "other");
  await git(["clone", f.remote, other], f.dir);
  await git(["config", "user.email", "ci@example.com"], other);
  await git(["config", "user.name", "CI"], other);
  const shaB = await commitFiles(other, { "openwiki/x.md": "wiki" }, "docs: update OpenWiki");
  await git(["push", "origin", "main"], other);
  return shaB;
}

// 运行编排器并捕获输出；runDomainCheck 默认记录调用并返回 0
async function run({ stdinText, gitCwd, checkResults = {} }) {
  const calls = [];
  const logs = [];
  const warns = [];
  const errors = [];
  const code = await runPrePushChecks({
    stdinText,
    gitCwd,
    repoRoot: gitCwd, // 测试中不使用真实域脚本（由桩替代），repoRoot 仅透传
    runDomainCheck: async (script) => {
      calls.push(script);
      return checkResults[script] ?? 0;
    },
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
  });
  return { code, calls, logs, warns, errors };
}

describe("正常路径（remote_sha 存在且为祖先）", () => {
  it("触碰 packages/app/src → 仅调度 E2E 锚点校验，exit 0", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([APP_SCRIPT]);
  });

  it("三域同时触碰 → 按 app → app-lynx → agents 顺序调度", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(
      f.local,
      {
        "packages/app/src/x.ts": "x",
        "packages/app-lynx/src/y.ts": "y",
        ".agents/skills/z/SKILL.md": "z",
      },
      "touch all",
    );
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([APP_SCRIPT, LYNX_SCRIPT, AGENTS_SCRIPT]);
  });

  it("零触碰（仅 docs/adr）→ 零开销放行，不调度任何校验", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "docs/adr/ADR-x.md": "doc" }, "docs only");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("域校验失败 → exit 1 且输出含 --no-verify 绕过指引", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
      checkResults: { [APP_SCRIPT]: 1 },
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("git push --no-verify");
  });
});

describe("remote_sha 本地缺失的三层降级（ADR-0142 D1/D2）", () => {
  it("缺失 → fetch 成功 → 分叉（v4.31.0 事故场景）→ exit 1 + 人话 rebase 指引，不跑域校验", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f); // 远端超前，本地未 fetch
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${shaB}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("git fetch origin && git rebase origin/main");
    expect(r.errors.join("\n")).not.toContain("Invalid revision range");
    expect(r.calls).toEqual([]);
    // fetch 副作用：远端对象已进入本地
    const has = await git(["cat-file", "-e", `${shaB}^{commit}`], f.local).then(
      () => true,
      () => false,
    );
    expect(has).toBe(true);
  });

  it("缺失 → fetch 失败 → warn + fail-open 放行（exit 0），不跑域校验", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    await git(["remote", "set-url", "origin", join(f.dir, "nonexistent.git")], f.local);
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${shaB}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.warns.join("\n")).toContain("fail-open");
    expect(r.calls).toEqual([]);
  });

  it("remote_sha 存在但分叉（已 fetch 仍强推）→ exit 1 + rebase 指引", async () => {
    const f = await makeFixture();
    const shaB = await advanceRemote(f);
    await git(["fetch", "origin"], f.local); // 本地已有 B 对象
    const shaC = await commitFiles(f.local, { "c.txt": "C" }, "diverged commit");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${shaB}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("git fetch origin && git rebase origin/main");
  });
});

describe("协议边界回归（行为不变约束）", () => {
  it("新分支（remote_sha 全零）→ merge-base origin/main 路径", async () => {
    const f = await makeFixture();
    await git(["checkout", "-b", "feat"], f.local);
    const shaD = await commitFiles(f.local, { ".agents/skills/z/SKILL.md": "z" }, "agents");
    const r = await run({
      stdinText: `refs/heads/feat ${shaD} refs/heads/feat ${ZERO}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([AGENTS_SCRIPT]);
  });

  it("删除远端分支（local_sha 全零）→ 跳过", async () => {
    const f = await makeFixture();
    const r = await run({
      stdinText: `refs/heads/main ${ZERO} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("多 ref 逐行处理：main（app 域）+ annotated tag（agents 域）→ 两域调度且去重", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const shaE = await commitFiles(f.local, { ".agents/skills/z/SKILL.md": "z" }, "agents");
    await git(["tag", "-a", "v9.9.9", "-m", "tag"], f.local);
    const tagSha = await git(["rev-parse", "v9.9.9"], f.local);
    const r = await run({
      stdinText:
        `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n` +
        `refs/tags/v9.9.9 ${tagSha} refs/tags/v9.9.9 ${ZERO}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([APP_SCRIPT, AGENTS_SCRIPT]);
    expect(shaE).not.toBe(shaC); // fixture 自检：两提交互异
  });
});
