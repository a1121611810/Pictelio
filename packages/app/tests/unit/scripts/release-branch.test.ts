// 发布目标分支开关单测（#816 过渡版 6.2.0）
//
// oracle 溯源：断言全部来自 release.mjs 内联版的原始行为（改动前的硬编码 `main`）与
// ADR/注释里写明的安全约束，不从新实现反推。
//
// 存在理由：release.mjs 的 main() 有 TTY 早退 + 交互提问，脚本路径在 CI 里跑不到；
// 「PICTELIO_RELEASE_BRANCH 是否真的生效」是本轮唯一的安全开关，必须有防线。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELEASE_BRANCH,
  assertOnReleaseBranch,
  releaseBranchWarning,
  resolveReleaseBranch,
} from "../../../scripts/lib/release-branch.mjs";

describe("resolveReleaseBranch（缺省必须恒为 main）", () => {
  it("未设置 → main", () => {
    expect(resolveReleaseBranch({})).toBe("main");
    expect(DEFAULT_RELEASE_BRANCH).toBe("main");
  });

  it("空串 / 纯空白 → main（空值不得意外变成「任意分支」）", () => {
    expect(resolveReleaseBranch({ PICTELIO_RELEASE_BRANCH: "" })).toBe("main");
    expect(resolveReleaseBranch({ PICTELIO_RELEASE_BRANCH: "   \t " })).toBe("main");
  });

  it("显式设置过渡版分支 → 透传（去掉首尾空白）", () => {
    expect(resolveReleaseBranch({ PICTELIO_RELEASE_BRANCH: "  release/transition-6.2.0  " })).toBe(
      "release/transition-6.2.0",
    );
  });

  it("显式设置 main → 仍是 main（开关可幂等表达「按默认发」）", () => {
    expect(resolveReleaseBranch({ PICTELIO_RELEASE_BRANCH: "main" })).toBe("main");
  });
});

describe("assertOnReleaseBranch（覆盖后仍强制人在该分支上）", () => {
  it("人在目标分支 → 放行", () => {
    expect(() =>
      assertOnReleaseBranch({
        current: "release/transition-6.2.0",
        branch: "release/transition-6.2.0",
      }),
    ).not.toThrow();
  });

  it("人在 main、发到 main → 放行", () => {
    expect(() => assertOnReleaseBranch({ current: "main", branch: "main" })).not.toThrow();
  });

  it("人在别的分支 → throw，且文案带 checkout 指引", () => {
    expect(() =>
      assertOnReleaseBranch({ current: "feature/x", branch: "release/transition-6.2.0" }),
    ).toThrow(/git checkout release\/transition-6\.2\.0/);
  });

  it("detached HEAD → throw 且不漏报状态", () => {
    expect(() => assertOnReleaseBranch({ current: "", branch: "main" })).toThrow(
      /\(detached HEAD\)/,
    );
  });

  it("⚠ 半开状态防线：开关设了分支但人还在 main → 必须拒绝", () => {
    // 这是本次改造最危险的组合：push 切到 release 分支、校验却仍认 main 就会错位
    expect(() =>
      assertOnReleaseBranch({ current: "main", branch: "release/transition-6.2.0" }),
    ).toThrow(/当前分支: main/);
  });
});

describe("releaseBranchWarning（覆盖必须醒目）", () => {
  it("main → null（不打告警，避免噪音）", () => {
    expect(releaseBranchWarning("main")).toBeNull();
  });

  it("非 main → 文案含分支名与「非 main 分支发布」", () => {
    const w = releaseBranchWarning("release/transition-6.2.0");
    expect(w).toContain("release/transition-6.2.0");
    expect(w).toContain("非 main 分支发布");
  });
});
