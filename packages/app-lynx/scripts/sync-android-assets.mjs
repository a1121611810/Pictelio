#!/usr/bin/env node
// ─── app-lynx bundle → Android assets 同步（#51） ───
// 用法：node scripts/sync-android-assets.mjs
// 将 packages/app-lynx/dist/main.lynx.bundle 拷贝到
// packages/app/android/app/src/main/assets/main.lynx.bundle（含大小校验）。
import { copyFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "dist", "main.lynx.bundle");
const destDir = join(root, "..", "app", "android", "app", "src", "main", "assets");
const dest = join(destDir, "main.lynx.bundle");

if (!existsSync(src)) {
  console.error(`[sync:lynx-bundle] 源产物不存在: ${src}（先执行 pnpm --dir packages/app-lynx build）`);
  process.exit(1);
}
const size = statSync(src).size;
if (size === 0) {
  console.error(`[sync:lynx-bundle] 源产物为空: ${src}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
const copied = statSync(dest).size;
if (copied !== size) {
  console.error(`[sync:lynx-bundle] 拷贝校验失败: src=${size}B dest=${copied}B`);
  process.exit(1);
}
console.log(`[sync:lynx-bundle] OK: ${src} (${size}B) → ${dest}`);
