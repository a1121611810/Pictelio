// 发布 APK 构建步骤表（纯函数）
//
// 抽出自 release.mjs 的 buildReleaseApks：原本是内联数组字面量，而 release.mjs 是
// 顶层即执行的脚本（无 export，无法被单测 import），导致 #610 单引擎化后残留的
// 过期引用无人发现——`pnpm release` 在 step 3 的第 6 个子步骤以
// `[ERR_PNPM_NO_SCRIPT] Missing script: cap:sync` 硬失败。
//
// 抽成纯模块后，「步骤表里引用的 pnpm script 是否存在」「gradle task 是否真实注册」
// 「APK 产物路径是否与 build.gradle 的 rename 规则一致」三项都能被单测直接断言，
// 见 tests/unit/scripts/release-build-steps.test.ts。

import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// 与 release-utils.mjs 同口径：lib/ 的上级上级 = packages/app
const rootDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * #610 单引擎化后唯一可发布的构建变体。
 *
 * 原 DEFAULT_VARIANTS 是 `["full", "webview", "lynx"]`（gradle flavor）。#610 删除了
 * `flavorDimensions` 与全部 `productFlavors`，gradle variant 名退化为**纯 buildType**，
 * 于是：
 *   - assemble${Flavor}Release  →  assemble${BuildType}     （assembleRelease）
 *   - rename${Flavor}ReleaseApk →  rename${BuildType}Apk    （renameReleaseApk）
 *   - apk/${flavor}/release/…   →  apk/${buildType}/…        （apk/release/…）
 *
 * 命名与 android/app/build.gradle 的 buildTypeList2 = ['debug', 'release'] 对齐；
 * 发布只取 release（debug 包不签名、不进 Release 资产）。
 */
export const RELEASE_BUILD_TYPES = ["release"];

/** buildType 段首字母大写（assembleRelease / renameReleaseApk） */
function capSegment(bt) {
  return bt.charAt(0).toUpperCase() + bt.slice(1);
}

/**
 * 解析发布 APK 需要执行的 gradle task。
 *
 * #610 前按 flavor 拼 `assemble${Cap}Release` + `rename${Cap}ReleaseApk`，单引擎后
 * 这六个 task 全部不存在（gradle 会直接报 "Task not found"）。
 */
export function gradleTasksFor(variants) {
  return variants.flatMap((bt) => [`assemble${capSegment(bt)}`, `rename${capSegment(bt)}Apk`]);
}

/**
 * 正常发布（buildReleaseApks）的完整步骤表。
 *
 * 顺序有依赖，不可随意调换：
 *   1) sync:credentials 先把 OAuth 配置写进 Java 源码
 *   2) 构建 Web 产物 —— OTA web bundle 三件套紧随其后打包，因为此后无步骤再触碰 dist/
 *   3) 构建 Lynx bundle（NODE_ENV=production 硬兜底，防 dev 凭证内联进生产包）
 *      再同步进 android/app/src/main/assets/main.lynx.bundle，否则 APK 无 bundle → 白屏
 *   4) 最后 gradle assemble + rename
 *
 * @param {object} input
 * @param {string} input.version 目标版本（写入 web bundle 三件套文件名）
 * @param {string[]} input.variants 构建变体（= buildType），来自 resolveVariants()
 * @param {boolean} input.otaSkipped PICTELIO_RELEASE_SKIP_OTA=1 时省略 web bundle 步骤
 * @returns {Array<[string, string, string[], object?]>} [label, cmd, args, opts]
 */
export function releaseBuildSteps({ version, variants, otaSkipped }) {
  const androidDir = resolvePath(rootDir, "android");
  return [
    ["同步 OAuth 配置", "pnpm", ["run", "sync:credentials"]],
    ["构建 Web 产物", "pnpm", ["run", "build"]],
    // #250：OTA web bundle 三件套（打包 + 签名 + round-trip 自验，独立脚本 release-bundle.mjs）。
    // 位置紧随「构建 Web 产物」：此后无任何步骤再触碰 dist/。
    // 正常发布与 -o 重建两条路径共用本函数，本步自动生效；失败落在 step 3 的自动回滚窗口内。
    // minApkVersion 由脚本内读 PICTELIO_OTA_MIN_APK 决定（新增桥方法需提升时设置）。
    ...(otaSkipped
      ? []
      : [["打包并签名 web bundle", "node", ["scripts/release-bundle.mjs", "--version", version]]]),
    // #51 修复：Lynx bundle 必须先构建并同步进 android assets（src/main/assets/main.lynx.bundle），
    // 否则 APK 无 main.lynx.bundle，LynxActivity 加载失败 → 白屏。
    // NODE_ENV=production 硬兜底：防止发布环境残留 PICTELIO_LYNX_DEV=1 时把真实 OAuth
    // 凭证内联进生产 bundle（lynx.config.ts 的 __CREDENTIALS__ 仅在 dev 下注入真值）。
    [
      "构建 Lynx bundle",
      "pnpm",
      ["--dir", "../app-lynx", "run", "build"],
      { env: { ...process.env, NODE_ENV: "production" } },
    ],
    ["同步 Lynx bundle 到 Android assets", "node", ["../app-lynx/scripts/sync-android-assets.mjs"]],
    [
      "编译 Release APK",
      "./gradlew",
      gradleTasksFor(variants),
      {
        cwd: androidDir,
        env: { ...process.env, GRADLE_USER_HOME: resolvePath(androidDir, ".gradle") },
      },
    ],
  ];
}
