#!/usr/bin/env node

/**
 * Pictelio 本地预览脚本
 * 将 Astro 构建产物（dist/）复制到 _site/ 目录用于本地预览。
 *
 * GitHub Actions 自动部署到 Pages，此脚本仅用于本地验证。
 *
 * Usage:
 *   node scripts/deploy.mjs
 */

import { cpSync, rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const websiteDist = resolve(rootDir, "packages/website/dist");
const outDir = resolve(rootDir, "_site");

function log(...args) {
  console.log("[preview]", ...args);
}

function main() {
  log("生成本地预览 _site/ ...");

  if (!existsSync(websiteDist)) {
    console.error(
      "❌ packages/website/dist/ 不存在。请先运行: pnpm --filter pictelio-website build"
    );
    process.exit(1);
  }

  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  // 复制 Astro 构建产物（dist/ 下所有内容）
  const entries = readdirSync(websiteDist, { withFileTypes: true });
  for (const entry of entries) {
    const src = resolve(websiteDist, entry.name);
    const dest = resolve(outDir, entry.name);
    if (entry.isDirectory()) {
      cpSync(src, dest, { recursive: true });
    } else {
      cpSync(src, dest);
    }
    log(`✅ ${entry.name}`);
  }

  log("完成！推送 main 后 GitHub Actions 会自动部署。");
}

main();
