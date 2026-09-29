import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
      // S4：不能把「没有 run 子命令」静默跳过——旧步骤 ["pnpm",["cap:sync"]] 那种漏写
      // run 的形态会绕过本断言并让测试转绿。pnpm dlx 之类豁免（需显式声明）。
      expect(args, `[${label}] pnpm 步骤必须含 "run" 子命令`).toContain("run");
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

  it("目录段与文件名段都由 build.gradle 推导（APK_DIR 不自证）", () => {
    // build.gradle:110  def apkDirStr = "${project.layout.buildDirectory.get()}/outputs/apk/${bt}"
    // build.gradle:118  def destApk   = new File("${apkDirStr}/pictelio-${versionName}-${bt}.apk")
    const dirRule = gradleSrc.match(/buildDirectory\.get\(\)\}\/(outputs\/apk\/\$\{bt\})"/u);
    expect(dirRule).not.toBeNull(); // 阳性对照：锚点本身要能命中，否则后面恒真
    const nameRule = gradleSrc.match(/def\s+destApk\s*=\s*new File\("\$\{apkDirStr\}\/([^"]+)"\)/u);
    expect(nameRule).not.toBeNull();
    expect(nameRule![1]).toBe("pictelio-${versionName}-${bt}.apk");

    // 用真实占位符求值，而不是抄一份字面量
    const dirBase = dirRule![1].replace("/${bt}", ""); // outputs/apk
    const renderedDir = dirRule![1].replace("${bt}", "release");
    const renderedName = nameRule![1]
      .replace("${versionName}", "6.3.0")
      .replace("${bt}", "release");

    // ⚠️ 模块名必须**结构推导**且锚定到「真正产出 APK 的那个模块」：
    // android/ 下还有 capacitor-cordova-android-plugins/ 这个 Capacitor 拆除残留模块，
    // 它也有 build.gradle，但不是产包模块。硬编码 "app" 同样是抄字面量。
    // 早先版本写的是 `expect(`${APK_DIR}/release`.endsWith(renderedDir))`，而
    // "android/build/outputs/apk/release" 同样以 "outputs/apk/release" 结尾，
    // APK_DIR 少一层 app/ 时测试照绿（实测反事实 C33 全绿）。
    const gradleRoot = resolve(appDir, "android");
    const apkModules = readdirSync(gradleRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => {
        const f = resolve(gradleRoot, name, "build.gradle");
        return existsSync(f) && /tasks\.register\(renameTaskName\)/u.test(readFileSync(f, "utf-8"));
      });
    expect(apkModules).toContain("app"); // 阳性对照：锚定条件要能命中已知目标

    for (const mod of apkModules) {
      // AGP 约定：模块 buildDir = <gradle 根>/<模块名>/build
      expect(APK_DIR).toBe(`android/${mod}/build/${dirBase}`);
    }

    // APK_DIR 的**完整**形状已由上面的模块枚举锁定为 android/<mod>/build/outputs/apk，
    // 这里只把 gradle 侧解出的 buildType 段与文件名段接上去。
    const actual = apkPathsFor("6.3.0", ["release"])[0];
    expect(actual).toBe(`${APK_DIR}/release/${renderedName}`);
    // 反向：路径末段确实落在 gradle 解出的目录与文件名上（双向对齐，非单边自证）
    expect(actual.endsWith(`/${renderedDir.split("/").pop()}/${renderedName}`)).toBe(true);
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

  // ⚠️ 不再断言「RELEASE_BUILD_TYPES 与 DEFAULT_VARIANTS 相等」——DEFAULT_VARIANTS 现在
  // 从前者派生，那条断言是同义反复。改为校验**默认接线**真的取自该事实源。
  it("resolveVariants() 的默认值即 RELEASE_BUILD_TYPES（唯一事实源的接线）", async () => {
    vi.resetModules();
    const orig = process.argv;
    process.argv = ["node", "release.mjs"];
    try {
      const mod = await import("../../../scripts/lib/release-utils.mjs");
      expect(mod.resolveVariants()).toEqual([...RELEASE_BUILD_TYPES]);
      expect(mod.DEFAULT_VARIANTS).toEqual([...RELEASE_BUILD_TYPES]);
    } finally {
      process.argv = orig;
    }
  });

  // ⚠️ 不得断言 android/app/build/ 下的产物目录是否存在：整棵 build/ 被
  // packages/app/android/.gitignore:24 忽略，CI 的干净检出里根本不存在
  // （git ls-files packages/app/android | grep -c "/build/" = 0），且 CI 的 test job
  // 从不跑 gradle。那样写会本地恒绿、CI 必红。产物是否存在属环境事实，不进单测。
});

describe("resolveVariants：--variants 白名单必须只认单引擎值", () => {
  /** 每次重载模块，使模块顶层的 process.argv.slice(2) 重新求值 */
  async function resolveWith(argv: string[]) {
    vi.resetModules();
    const orig = process.argv;
    process.argv = ["node", "release.mjs", ...argv];
    try {
      return await import("../../../scripts/lib/release-utils.mjs");
    } finally {
      process.argv = orig;
    }
  }

  it("不带参数时返回单引擎默认（可达的生产路径）", async () => {
    const mod = await resolveWith([]);
    expect(mod.resolveVariants()).toEqual(["release"]);
  });

  it("显式 --variants=release 正常通过", async () => {
    const mod = await resolveWith(["--variants=release"]);
    expect(mod.resolveVariants()).toEqual(["release"]);
  });

  it("反事实：#610 下线的 --variants=full 必须被拒（不是静默放行）", async () => {
    const mod = await resolveWith(["--variants=full"]);
    expect(() => mod.resolveVariants()).toThrow(/未知变体/u);
    expect(() => mod.resolveVariants()).toThrow(/full/u);
  });

  it("空值必须报错而不是回落默认值（防手滑静默改变发布形态）", async () => {
    const mod = await resolveWith(["--variants="]);
    expect(() => mod.resolveVariants()).toThrow(/--variants 值无效/u);
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

  // 原有「仓库根 package.json 保留 deploy / 同步脚本」一例已删：它只断言
  // Object.keys(rootScripts).length > 5，与发布链路、与 deploy 都毫无关系，
  // 是恒绿噪音（且把 repoRoot 读进来只为喂它）。
});
