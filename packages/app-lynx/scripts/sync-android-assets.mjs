#!/usr/bin/env node
// ─── app-lynx 产物 → Android assets 同步（#51） ───
// 用法：node scripts/sync-android-assets.mjs
// 将 packages/app-lynx/dist/main.lynx.bundle 拷贝到
// packages/android-host/android/app/src/main/assets/main.lynx.bundle（含大小校验）。
// ADR-0203 宿主迁移：Gradle 工程随 Android 原生资产迁到宿主包 packages/android-host。
//
// ─── 图标子集字体（ADR-0208 决策 3）───
// @font-face 的 src 指向 ttf。字体**不是** Lynx bundle 的一部分：rspeedy 把它当普通静态资源，
// 落到 dist/static/font/<name>.<hash>.ttf，bundle 内只留 `src: url('webpack:///static/font/…')`。
// 所以宿主 assets 必须镜像 dist/static 的目录结构与**哈希文件名**——名字对不上运行时
// 找不到文件，图标渲染为空白字形（tofu），且不会报错（静默失败）。
// 用 rspeedy 实际产出的清单驱动同步，不猜文件名。
import { copyFileSync, existsSync, statSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const src = join(distDir, "main.lynx.bundle");
const destDir = join(root, "..", "android-host", "android", "app", "src", "main", "assets");
const dest = join(destDir, "main.lynx.bundle");

/** 单文件拷贝 + 大小校验（沿用 #51 原纪律） */
function syncFile(from, to) {
  if (!existsSync(from)) {
    console.error(`[sync:app-lynx] 源产物不存在: ${from}`);
    process.exit(1);
  }
  const size = statSync(from).size;
  if (size === 0) {
    console.error(`[sync:app-lynx] 源产物为空: ${from}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  const copied = statSync(to).size;
  if (copied !== size) {
    console.error(`[sync:app-lynx] 拷贝校验失败: src=${size}B dest=${copied}B`);
    process.exit(1);
  }
  console.log(`[sync:app-lynx] OK: ${from} (${size}B) → ${to}`);
}

/** 递归列出 dir 下的全部文件（相对路径） */
function* listFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* listFiles(p);
    else yield p;
  }
}

syncFile(src, dest);

// ─── 镜像 dist/static → assets/static（字体等静态资源，ADR-0208）───
const staticDir = join(distDir, "static");
if (!existsSync(staticDir)) {
  // 尚无静态资源（图标调用点未接入时 rspeedy 不产 static/）——不是错误，显式说明避免静默
  console.log("[sync:app-lynx] dist/static 不存在（当前构建无静态资源），跳过资源同步");
} else {
  // 先清空宿主侧镜像目录再拷：字体哈希会随内容变，残留旧哈希文件 = 体积泄漏
  const destStatic = join(destDir, "static");
  if (existsSync(destStatic)) rmSync(destStatic, { recursive: true, force: true });
  let n = 0;
  for (const file of listFiles(staticDir)) {
    const rel = relative(staticDir, file);
    syncFile(file, join(destStatic, rel));
    n++;
  }
  console.log(`[sync:app-lynx] 静态资源 ${n} 个已镜像 → ${destStatic}`);
}
