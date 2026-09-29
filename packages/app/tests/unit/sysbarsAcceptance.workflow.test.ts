// sysbars 验收工作流契约测试（#829 第 1 项）
//
// 为什么要它：这个 workflow 是 **workflow_dispatch 手动触发**、不在 ci.yml 门禁里，
// 所以它会在两次手动触发之间静默腐化。单引擎化（#610）后它已断四处，而没有任何
// 机器防线会报出来——直到发版前有人手动跑，且失败表现（系统栏未隐藏）极易被
// 误读为产品回归，而不是验收脚本过期。
//
// 期望值来源（oracle 溯源，非反推实现）：
// - 变体已下线、variant 退化为纯 buildType：packages/app/android/app/build.gradle
//   注释「沙盒 #610：flavor 维度下线，variant 名退化为纯 buildType（debug / release）」
//   + buildTypeList2 = ['debug','release'] + renameTaskName = pictelio-{versionName}-{buildType}.apk
// - LAUNCHER 由占位符注入：build.gradle 的 manifestPlaceholders launcherActivity: ".LynxActivity"
// - MainActivity 类已删：git ls-files packages/app/android/app/src/ | grep -i MainActivity → 0
//
// 断言方式：源级守卫（读文件、剥注释、对代码本文匹配）。不启动模拟器——本仓已有的
// 源级守卫范式，见 packages/app-lynx/CONTEXT.md「源级守卫」词条。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found (AGENTS.md + pnpm-workspace.yaml)");
    dir = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());
const raw = readFileSync(join(repoRoot, ".github/workflows/sysbars-acceptance.yml"), "utf8");
// 剥注释行：注释里允许保留历史词（记录「这里曾是 full flavor」），断言只针对会被执行的代码
const body = raw
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

describe("sysbars 验收工作流契约（#610 单引擎化后防腐）", () => {
  // 防「文档被清空 / 文件被掏空」导致下面所有负面断言空转通过
  it("工作流仍有实质内容（负面断言不得靠文件被清空而空转）", () => {
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("acceptance.log");
  });

  it("已下线的 flavor 维度清零（buildType 已退化为 debug / release）", () => {
    expect(body).not.toContain("assembleFullDebug");
    expect(body).not.toContain("apk/full");
    expect(body).not.toContain("app-full-debug.apk");
    // 正面：确实在跑单引擎的 debug 任务
    expect(body).toContain("assembleDebug");
    expect(body).toContain("outputs/apk/debug");
  });

  it("已删除的宿主 Activity 类名清零（LAUNCHER 现由占位符注入为 .LynxActivity）", () => {
    expect(body).not.toContain(".MainActivity");
  });

  it("启动目标改为运行时解析 LAUNCHER（类名再变也不会腐）", () => {
    expect(body).toContain("resolve-activity");
    // 启动时用解析结果，而非硬编码类名
    expect(body).toMatch(/am start[^\n]*\$LAUNCHER/);
  });

  it("启动前置校验存在且把「脚本过期」与「产品回归」区分开（反事实防线）", () => {
    // 没有这条，解析失败会退化成 A1「LynxView != 全屏」——看起来像产品 bug
    expect(body).toContain("PREFLIGHT FAIL");
    expect(body).toMatch(/脚本|过期|stale/i);
  });
});
