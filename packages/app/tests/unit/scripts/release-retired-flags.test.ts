// 已退役 CLI 参数的显式拒绝（ADR-0202：OTA web bundle 发布通道下线）
//
// 为什么必须是子进程测试：release.mjs 是 CLI 编排脚本，顶层即执行参数解析 + TTY 早退
// + main()，import 即产生副作用，无法 import 后直接断言——先例同 release-overwrite.mjs
// 「main() 有 TTY 早退，内联逻辑在 CI 里跑不到，故把可测部分抽进 lib/」。
//
// 本条守卫无法抽进 lib/（它就是入口处的前置门禁），故用子进程跑真实脚本。
// 安全性：退役参数检查排在 TTY 守卫**之前**且在任何副作用之前，命中即 exit 1；
// 负向对照（合法参数）落在 TTY 早退上，同样零副作用。两条路径都不会 commit/tag/push。

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 路径解析用 resolve(dirname(fileURLToPath(import.meta.url)), ...)，不用
// `new URL("../..", import.meta.url)`：后者会被 Vite 的 assetImportMetaUrl 插件
// 当成资源引用重写成非 file scheme URL，fileURLToPath 直接抛
// 「The URL must be of scheme file」。先例：release-build-steps.test.ts:14。
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/release.mjs");

/** 跑一次 release.mjs，返回 {code, stderr}；永不抛（脚本非零退出是预期行为） */
function run(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? "" };
  }
}

describe("release.mjs：已退役参数的显式拒绝（ADR-0202）", () => {
  it("--web-only 被拒并指向 ADR-0202（不是被静默忽略）", () => {
    const { code, stderr } = run(["--web-only"]);
    expect(code).toBe(1);
    expect(stderr).toContain("ADR-0202");
    expect(stderr).toContain("--web-only");
  });

  it("--min-web=x.y.z 的带值形式同样被拒", () => {
    const { code, stderr } = run(["--min-web=4.21.0"]);
    expect(code).toBe(1);
    expect(stderr).toContain("ADR-0202");
  });

  // 反向对照：证明上面的拒绝来自「退役参数检查」而非任何早退都会吐的同一句话。
  // 若这条挂了，说明门禁位置被挪到了 TTY 守卫之后，退役参数检查在 CI/测试里就永远跑不到。
  it("对照：合法参数落到 TTY 守卫，报的是另一条消息（非交互环境零副作用）", () => {
    const { code, stderr } = run(["-o"]);
    expect(code).toBe(1);
    expect(stderr).toContain("需要 TTY");
    expect(stderr).not.toContain("ADR-0202");
  });
});
