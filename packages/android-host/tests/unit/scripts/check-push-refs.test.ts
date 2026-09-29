// check-push-refs 编排器测试（ADR-0142 / spec #349 / ticket #352；fmt 门禁 ADR-0195）
// 期望值来源（oracle 溯源）：真实 git 双仓库 fixture 的已知提交拓扑；
// git 数据零 mock（契约测试硬约束），仅域校验脚本调用（check-e2e-anchors 等）
// 以记录型桩替代——那些脚本有各自的测试，此处只验证编排器的调度与分支语义。
// fmt 门禁同法桩化（只验退出码 → 裁决映射），另有「真实调用」用例直接钉住 oxfmt
// 的退出码契约（exit 2 + marker = 无覆盖目标），避免桩与真实行为脱节。
//
// 可达性说明（code-review P2-5b）：spec Testing Decisions 中的「remote_sha 缺失 →
// fetch 成功 → 正常校验」分支在逻辑上不可达——remote_sha 缺失 ⟹ 其不在本地历史中
// ⟹ fetch 后必非 local_sha 祖先 ⟹ 必走分叉报错。现有用例覆盖全部可达分支，
// 请勿为该分支补写不出的用例。
import { describe, it, expect, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runPrePushChecks,
  classifyFmtResult,
  defaultRunFmtCheck,
} from "../../../../../scripts/check-push-refs.mjs";

// 仓库根（仅「真实调用」用例使用）：本文件位于 packages/android-host/tests/unit/scripts/
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../../..");
// oxfmt 对「传入路径全被 ignore 规则排除」的真实文案（stderr），取自实测输出
const FMT_SKIP_STDERR =
  "Expected at least one target file. All matched files may have been excluded by ignore rules.";

// 真实 git 双仓库 fixture（init/clone/push × N 子进程）：默认 5s 预算在全量并发
// 跑下必超时（单跑 ~13s），文件级放宽到 30s——只影响本文件。
vi.setConfig({ testTimeout: 30_000 });

const ZERO = "0000000000000000000000000000000000000000";
// ADR-0203：原 app 域（packages/app/(src|tests/agent-browser) → E2E 锚点静态校验）整体退役。
// 其被调脚本锚定已删的 WebView 源码目录，随整包删除一并消失（决策九「无被测对象资产」）。
// 保留此常量**只用于负向守卫**：证明触碰旧路径不再调度任何脚本，即该域不会复活。
const RETIRED_APP_SCRIPT = "packages/app/scripts/check-e2e-anchors.mjs";
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
  // maxRetries：CI 上 git gc/pack 后台写与 rm 竞态会抛 ENOTEMPTY（2026-09-07 CI 实测），
  // fs/promises rm 对 ENOTEMPTY/EBUSY/EMFILE 原生按 retryDelay 重试后清理
  await Promise.all(
    tempDirs
      .splice(0)
      .map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
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

// 运行编排器并捕获输出；runDomainCheck / runFmtCheck 默认记录调用并返回通过
// （fmt 桩返回真实 oxfmt 的 {code, stdout, stderr} 形状，裁决映射见 classifyFmtResult）
async function run({ stdinText, gitCwd, checkResults = {}, fmt = { code: 0 } }) {
  const calls = [];
  const fmtCalls = [];
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
    runFmtCheck: async (targets, cwd) => {
      fmtCalls.push({ targets, cwd });
      return { code: fmt.code ?? 0, stdout: fmt.stdout ?? "", stderr: fmt.stderr ?? "" };
    },
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
  });
  return { code, calls, fmtCalls, logs, warns, errors };
}

describe("正常路径（remote_sha 存在且为祖先）", () => {
  it("触碰已退役的 packages/app/src → 零域调度（ADR-0203：app 域随 WebView 客户端删除）", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    // 负向守卫：退役域不得复活。若有人把该域加回 DOMAINS，这里会因多出一次调度而红。
    expect(r.calls).not.toContain(RETIRED_APP_SCRIPT);
    expect(r.calls).toEqual([]);
  });

  it("两域同时触碰 → 按 app-lynx → agents 顺序调度", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(
      f.local,
      {
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
    expect(r.calls).toEqual([LYNX_SCRIPT, AGENTS_SCRIPT]);
  });

  it("仅 docs/adr（fmt 忽略面）→ 域校验零调度；fmt 门禁按被推文件跑一次后放行", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "docs/adr/ADR-x.md": "doc" }, "docs only");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
      // 真实 oxfmt 对全忽略面路径的返回（实测）：exit 2 + marker
      fmt: { code: 2, stderr: FMT_SKIP_STDERR },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.fmtCalls).toEqual([{ targets: ["docs/adr/ADR-x.md"], cwd: f.local }]);
    expect(r.logs.join("\n")).toContain("跳过格式校验");
    expect(r.errors).toEqual([]);
  });

  it("域 pattern 第二分支探针：app-lynx/src 与 app-lynx/tests 均命中 app-lynx 域（去重一次）", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(
      f.local,
      {
        "packages/app-lynx/src/x.ts": "x",
        "packages/app-lynx/tests/y.test.ts": "y",
      },
      "touch test dirs",
    );
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LYNX_SCRIPT]);
  });

  it("分叉指引按实际分支名生成（非 main 分支不硬编码 origin/main）", async () => {
    const f = await makeFixture();
    // 远端 feature 分支由第三方推进，本地持有旧 feature
    await git(["checkout", "-b", "feature"], f.local);
    await commitFiles(f.local, { "f.txt": "F" }, "feature commit");
    await git(["push", "-u", "origin", "feature"], f.local);
    const other = join(f.dir, "other");
    await git(["clone", f.remote, other], f.dir);
    await git(["config", "user.email", "ci@example.com"], other);
    await git(["config", "user.name", "CI"], other);
    await git(["checkout", "feature"], other);
    const shaF2 = await commitFiles(other, { "f2.txt": "F2" }, "remote feature advance");
    await git(["push", "origin", "feature"], other);
    // 本地继续提交（不 fetch）→ 分叉
    const shaF3 = await commitFiles(f.local, { "f3.txt": "F3" }, "local feature commit");
    const r = await run({
      stdinText: `refs/heads/feature ${shaF3} refs/heads/feature ${shaF2}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("git rebase origin/feature");
    expect(r.errors.join("\n")).not.toContain("rebase origin/main");
  });

  it("域校验失败 → exit 1 且输出含 --no-verify 绕过指引", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app-lynx/src/x.ts": "x" }, "touch lynx");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
      checkResults: { [LYNX_SCRIPT]: 1 },
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("git push --no-verify");
  });
});

describe("fmt 门禁（ADR-0195）", () => {
  it("被推文件格式漂移 → exit 1 + 修复指引，且短路域校验（不再跑锚点）", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
      fmt: { code: 1, stdout: "Checking formatting...\n\npackages/app/src/x.ts (0ms)\n" },
    });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("packages/app/src/x.ts"); // 失败清单原样透出
    expect(r.errors.join("\n")).toContain("pnpm fmt");
    expect(r.errors.join("\n")).toContain("git push --no-verify");
    expect(r.calls).toEqual([]); // fmt 失败即返回，域校验未跑
  });

  it("exit 2 但无 skip marker（工具链/调用错误）→ 按失败拦截，不静默放行", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
      fmt: { code: 2, stderr: "ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed" },
    });
    expect(r.code).toBe(1);
    expect(r.logs.join("\n")).not.toContain("跳过格式校验");
  });

  it("被推变更只有删除（文件已不在工作区）→ 无 fmt 目标，不调用", async () => {
    const f = await makeFixture();
    await git(["rm", "a.txt"], f.local);
    await git(["commit", "-m", "rm a.txt"], f.local);
    const shaC = await git(["rev-parse", "HEAD"], f.local);
    const r = await run({
      stdinText: `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.fmtCalls).toEqual([]);
  });

  it("多 ref：被推文件跨 ref 取并集去重，fmt 只跑一次", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app/src/x.ts": "x" }, "touch app");
    const shaD = await commitFiles(f.local, { "packages/app/src/y.ts": "y" }, "touch app 2");
    const r = await run({
      stdinText:
        `refs/heads/main ${shaC} refs/heads/main ${f.shaA}\n` +
        `refs/heads/side ${shaD} refs/heads/side ${ZERO}\n`,
      gitCwd: f.local,
    });
    expect(r.code).toBe(0);
    expect(r.fmtCalls).toHaveLength(1);
    expect(r.fmtCalls[0].targets.toSorted()).toEqual([
      "packages/app/src/x.ts",
      "packages/app/src/y.ts",
    ]);
    expect(r.fmtCalls[0].cwd).toBe(f.local); // 路径按被推工作区解析
  });
});

describe("oxfmt 退出码契约（真实调用，oracle = 工具真实输出）", () => {
  it("已格式化文件 → pass；落在 ignore 面的路径 → skip（exit 2 + marker）", async () => {
    // oracle = 工具真实输出。取样路径必须同时满足三条：
    //   ① 删除后仍存在（原取样点 packages/app/src/... 随整包删除消失）
    //   ② 在 oxfmt **覆盖面内**（packages/app-lynx/** 整目录豁免，取它只会得到 skip）
    //   ③ 已被格式化（否则 pass 分支本身就是错的）
    const ok = await defaultRunFmtCheck(["scripts/check-push-refs.mjs"], REPO_ROOT);
    expect(classifyFmtResult(ok.code, ok.stderr)).toBe("pass");

    const ignored = await defaultRunFmtCheck(
      ["docs/adr/0001-proguard-keep-strategy.md"],
      REPO_ROOT,
    );
    expect(classifyFmtResult(ignored.code, ignored.stderr)).toBe("skip");
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
    expect(r.fmtCalls).toEqual([]); // 分叉拦截早于 fmt 门禁（rebase 后下次 push 再校验）
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
    expect(r.fmtCalls).toEqual([]); // 无被推文件 → fmt 门禁零开销
  });

  it("多 ref 逐行处理：main（app-lynx 域）+ annotated tag（agents 域）→ 两域调度且去重", async () => {
    const f = await makeFixture();
    const shaC = await commitFiles(f.local, { "packages/app-lynx/src/x.ts": "x" }, "touch lynx");
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
    expect(r.calls).toEqual([LYNX_SCRIPT, AGENTS_SCRIPT]);
    expect(shaE).not.toBe(shaC); // fixture 自检：两提交互异
  });
});
