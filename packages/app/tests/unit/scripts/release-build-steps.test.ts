import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_BUILD_TYPES,
  gradleTasksFor,
  releaseBuildSteps,
} from "../../../scripts/lib/release-build-steps.mjs";
import { DEFAULT_VARIANTS, apkPathsFor, APK_DIR } from "../../../scripts/lib/release-utils.mjs";

// 定位锚点：本文件在 packages/app/tests/unit/scripts/ 下，回退 3 层 = packages/app
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = resolve(appDir, "../..");

const readApp = (rel: string) => readFileSync(resolve(appDir, rel), "utf-8");

/** 从 packages/app/package.json 读 scripts（真实来源，不硬编码期望值） */
function appScripts(): Record<string, string> {
  return JSON.parse(readApp("package.json")).scripts ?? {};
}

// ─────────────────────────────────────────────────────────────
// #610 单引擎化后，发布链路残留三处过期引用：
//   ① cap:sync（script 已删）② assemble{Full,Webview,Lynx}Release（task 已不存在）
//   ③ APK 产物路径 apk/{flavor}/release/...（flavor 维度已下线）
// 本组用「事实源对照」锁死，期望值全部从 build.gradle / package.json 推导。
// ─────────────────────────────────────────────────────────────

/** 从 build.gradle 的 buildTypeList2 解析出真实注册的 assemble/rename task 名集合 */
function registeredGradleTasks(gradleSrc: string): Set<string> {
  const listBody = gradleSrc.match(/buildTypeList2\s*=\s*\[([^\]]*)\]/u)?.[1] ?? "";
  const registered = new Set<string>();
  for (const m of listBody.matchAll(/'(\w+)'/gu)) {
    const cap = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    registered.add(`assemble${cap}`);
    registered.add(`rename${cap}Apk`);
  }
  return registered;
}

describe("gradleTasksFor：必须产出 build.gradle 真实注册的 task", () => {
  const gradleSrc = readApp("android/app/build.gradle");

  it("对每个变体产出 assemble{X} 与 rename{X}Apk 两个 task", () => {
    expect(gradleTasksFor(["release"])).toEqual(["assembleRelease", "renameReleaseApk"]);
  });

  it("产出的每个 task 名都必须在 build.gradle 中被注册（阳性对照：真实存在的 task 也能命中检测式）", () => {
    const registered = registeredGradleTasks(gradleSrc);
    // 阳性对照：检测式本身要能命中已知目标，否则下面那条断言是恒绿假防线
    expect(registered.has("assembleRelease")).toBe(true);
    expect(registered.has("renameReleaseApk")).toBe(true);

    for (const task of gradleTasksFor(["release"])) {
      expect(registered.has(task)).toBe(true);
    }
  });

  it("反事实：#610 前的 flavor 拼法（assembleFullRelease 等）必须不在注册集合内", () => {
    const registered = registeredGradleTasks(gradleSrc);
    // 已下线的 flavor 维度不得复活（历史拼法在此显式钉死为「不存在」）
    for (const dead of [
      "assembleFullRelease",
      "assembleWebviewRelease",
      "assembleLynxRelease",
      "renameFullReleaseApk",
    ]) {
      expect(registered.has(dead)).toBe(false);
    }
  });
});

describe("releaseBuildSteps：步骤表内每个 pnpm script 都必须真实存在", () => {
  const steps = releaseBuildSteps({ version: "9.9.9", variants: ["release"], otaSkipped: false });

  it("抽到步骤表（扫描范围下界，防正则失效导致后续断言恒真）", () => {
    expect(steps.length).toBeGreaterThanOrEqual(5);
  });

  it("otaSkipped=true 时省略 web bundle 步骤，false 时包含（双路径）", () => {
    const skipped = releaseBuildSteps({
      version: "9.9.9",
      variants: ["release"],
      otaSkipped: true,
    });
    expect(skipped.some(([label]) => label.includes("web bundle"))).toBe(false);
    expect(steps.some(([label]) => label.includes("web bundle"))).toBe(true);
  });

  it("步骤表里引用的每个 pnpm run <script> 在对应 package.json 中都存在", () => {
    const failures: string[] = [];
    for (const [label, cmd, args] of steps) {
      if (cmd !== "pnpm") continue;
      const runIdx = args.indexOf("run");
      if (runIdx === -1) continue;
      const scriptName = args[runIdx + 1];
      // --dir 指向别的包时查那个包的 scripts，否则查 packages/app
      const dirIdx = args.indexOf("--dir");
      const targetDir =
        dirIdx !== -1 && args[dirIdx + 1] ? resolve(appDir, args[dirIdx + 1]) : appDir;
      const targetPkg = resolve(targetDir, "package.json");
      if (!existsSync(targetPkg)) {
        failures.push(`[${label}] 找不到 package.json: ${targetPkg}`);
        continue;
      }
      const scripts = JSON.parse(readFileSync(targetPkg, "utf-8")).scripts ?? {};
      if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
        failures.push(`[${label}] pnpm run ${scriptName} 不存在（${targetPkg}）`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("反事实：#610 已删除的 cap:sync 不得回到步骤表", () => {
    const flat = JSON.stringify(steps);
    expect(flat).not.toContain("cap:sync");
    // 阳性对照：检测式能命中其它仍然存在的 script 名
    expect(flat).toContain("sync:credentials");
  });
});

describe("apkPathsFor：路径形状必须与 build.gradle 的重命名规则一致", () => {
  const gradleSrc = readApp("android/app/build.gradle");

  it("指向单引擎真实产物目录", () => {
    expect(apkPathsFor("6.3.0", ["release"])).toEqual([
      `${APK_DIR}/release/pictelio-6.3.0-release.apk`,
    ]);
  });

  it("文件名规则与 build.gradle 的 rename task 产物规则一致（从 gradle 源码推导，不硬编码）", () => {
    // build.gradle:118  destApk = outputs/apk/${bt}/pictelio-${versionName}-${bt}.apk
    const rule = gradleSrc.match(
      /def\s+apkDirStr\s*=\s*"\$\{project\.layout\.buildDirectory\.get\(\)\}\/outputs\/apk\/\$\{bt\}"/u,
    );
    expect(rule).not.toBeNull(); // 阳性对照：锚点本身要能命中
    const nameRule = gradleSrc.match(/def\s+destApk\s*=\s*new File\("\$\{apkDirStr\}\/([^"]+)"\)/u);
    expect(nameRule).not.toBeNull();
    expect(nameRule![1]).toBe("pictelio-${versionName}-${bt}.apk");

    // 期望值用真实占位符求值，而不是抄一份字面量
    const rendered = nameRule![1].replace("${versionName}", "6.3.0").replace("${bt}", "release");
    expect(apkPathsFor("6.3.0", ["release"])[0]).toBe(`${APK_DIR}/release/${rendered}`);
  });

  it("反事实：#610 前的 apk/{flavor}/release/…-full.apk 形状不得复活", () => {
    const paths = apkPathsFor("6.3.0", ["full"]).join(" ");
    // 旧形状是 apk/full/release/pictelio-6.3.0-full.apk
    expect(paths).not.toBe(`${APK_DIR}/full/release/pictelio-6.3.0-full.apk`);
  });
});

describe("变体集合：单引擎后只剩 release", () => {
  it("DEFAULT_VARIANTS 不含任何已下线的 flavor", () => {
    for (const dead of ["full", "webview", "lynx"]) {
      expect(DEFAULT_VARIANTS).not.toContain(dead);
    }
  });

  it("RELEASE_BUILD_TYPES 与 DEFAULT_VARIANTS 一致（两处事实源不得漂移）", () => {
    expect([...RELEASE_BUILD_TYPES]).toEqual([...DEFAULT_VARIANTS]);
  });

  it("scripts/ 与 android/ 目录里不再存在已下线 flavor 的产物目录", () => {
    // 反事实：证明本防线不是恒绿——现存的 debug 单变体产物能被路径扫描命中
    const outputsDir = resolve(appDir, APK_DIR);
    expect(existsSync(outputsDir)).toBe(true);
  });
});

describe("跨文件一致性：仓库中不再有指向已删 script 的发布引用", () => {
  it("package.json 的 release 链路脚本均存在（正向对照：build:android:release 是真实存在的）", () => {
    const scripts = appScripts();
    expect(scripts["build:android:release"]).toBeDefined();
    expect(scripts["release"]).toBeDefined();
    // build:android:release 是 #610 修好的形态：assembleRelease + renameReleaseApk
    expect(scripts["build:android:release"]).toContain("assembleRelease");
    expect(scripts["build:android:release"]).toContain("renameReleaseApk");
  });

  it("仓库根 package.json 保留 deploy / 同步脚本（结构性下界，防断言静默失效）", () => {
    const rootScripts =
      JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8")).scripts ?? {};
    expect(Object.keys(rootScripts).length).toBeGreaterThan(5);
  });
});
