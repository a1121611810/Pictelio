// Sync-android-version.mjs
// 从 package.json 读取 version，同步到 android/app/build.gradle 的 versionName 和 versionCode。
// VersionCode 生成规则：major×10000 + minor×100 + patch
//
// ADR-0203 决策 3「事实源迁移」：版本号事实源已迁到唯一客户端包 pictelio-app-lynx，
// 本脚本改为消费 ../app-lynx/package.json（不再读本包内已迁走的副本）。
// 写出的 build.gradle 仍在本包 android/ 下——那是宿主迁移（另一票）的范围。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lynxPackageDir = resolve(rootDir, "..", "app-lynx");

const pkg = JSON.parse(readFileSync(resolve(lynxPackageDir, "package.json"), "utf-8"));
const { version } = pkg;
if (!version) {
  console.error("[sync-android-version] package.json 中未找到 version 字段");
  process.exit(1);
}

const parts = version.split(".").map(Number);
if (parts.length !== 3 || parts.some(isNaN)) {
  console.error(`[sync-android-version] 无法解析版本号 "${version}"，期望格式: x.y.z`);
  process.exit(1);
}

const [major, minor, patch] = parts;
const versionCode = major * 10_000 + minor * 100 + patch;

const gradlePath = resolve(rootDir, "android", "app", "build.gradle");
let gradle = readFileSync(gradlePath, "utf-8");

const versionCodeBefore = gradle.match(/versionCode\s+(\d+)/u)?.[1] ?? "?";
const versionNameBefore = gradle.match(/versionName\s+"([^"]+)"/u)?.[1] ?? "?";

gradle = gradle.replace(/versionCode\s+\d+/u, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/u, `versionName "${version}"`);

writeFileSync(gradlePath, gradle, "utf-8");

console.log(
  `[sync-android-version] app-lynx/package.json:${version} → build.gradle: versionCode ${versionCodeBefore}→${versionCode}, versionName "${versionNameBefore}"→"${version}"`,
);
