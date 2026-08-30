#!/usr/bin/env node

/**
 * OTA web bundle 打包 + 签名 CLI（#250）
 *
 * dist 全量打包 zip（根 = index.html）→ manifest → Ed25519 签名 → round-trip 自验 →
 * 三件套落 packages/app/ota/：
 *   pictelio-<version>-web-bundle.zip / pictelio-<version>-manifest.json /
 *   pictelio-<version>-manifest.json.sig
 *
 * 用法:
 *   node scripts/release-bundle.mjs --version=4.22.0
 *   node scripts/release-bundle.mjs --version=4.22.0 --min-apk=4.22.0 --dist=dist --out=ota
 *
 * 参数:
 *   --version=x.y.z   必填；manifest.version（= package.json version，bundle 自报版本）
 *   --min-apk=x.y.z   可选；该 bundle 要求的最低宿主 APK 版本（新增原生桥方法并升级后设置；
 *                      缺省 = 不设兼容下限，App 端 fail-open）
 *   --dist=<dir>      可选；web 构建产物目录，默认 dist/
 *   --out=<dir>       可选；三件套输出目录，默认 ota/
 *   --key=<path>      可选；Ed25519 私钥（PKCS#8 PEM），默认 ~/.pictelio-keys/ota-ed25519-private.pem
 *
 * 环境变量:
 *   PICTELIO_OTA_MIN_APK  --min-apk 未提供时的回退值（release.mjs 经 env 透传，
 *                         解析顺序对齐 release-utils resolveVariants 的 arg > env 惯例）
 *
 * 独立运行即完成 打包 → 签名 → round-trip 验签 自检闭环，可脱离完整 release 流程使用
 * （发布前自检项见 docs/release-checklist.md「web bundle OTA 产物」）。
 */

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  resolveOtaPrivateKeyPath,
  executeReleaseBundle,
  planReleaseBundle,
} from "./lib/release-bundle-core.mjs";
import { getRepoSlug } from "./lib/release-utils.mjs";

function log(...m) {
  console.log(`[release-bundle]`, ...m);
}

// 解析 --key=value 与 --key value 两种形式（release.mjs buildSteps 以空格分隔传参）
function parseArgs(argv) {
  const map = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      map.set(a.slice(2, eq), a.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      map.set(a.slice(2), argv[++i]);
    }
  }
  return map;
}

const parsedArgs = parseArgs(process.argv.slice(2));
function argValue(name) {
  return parsedArgs.get(name);
}

async function main() {
  const version = argValue("version");
  if (!version) {
    console.error("[release-bundle] ❌ 缺少必填参数 --version=x.y.z");
    process.exit(1);
  }
  const distDir = argValue("dist") || "dist";
  const outDir = argValue("out") || "ota";
  // arg > env（对齐 resolveVariants 的解析顺序）；空串视为未设置
  const minApkVersion =
    argValue("min-apk") ?? ((process.env.PICTELIO_OTA_MIN_APK || "").trim() || null);
  const privateKeyPath = argValue("key") || resolveOtaPrivateKeyPath();

  // 先探测私钥再打包：fail-fast + 明确指引，避免打完包才发现签不了名
  let pem;
  try {
    pem = await readFile(privateKeyPath, "utf-8");
  } catch {
    console.error(
      `[release-bundle] ❌ 找不到 OTA 签名私钥: ${privateKeyPath}\n` +
        `   生成方式见 docs/research/ota-ed25519-android.md §4.2，例如:\n` +
        `   openssl genpkey -algorithm ed25519 -out ~/.pictelio-keys/ota-ed25519-private.pem\n` +
        `   （或设 PICTELIO_RELEASE_SKIP_OTA=1 跳过 web bundle 打包上传）`,
    );
    process.exit(1);
  }

  // repoSlug 仅用于资产 URL 前缀展示；独立运行无 git origin 时不阻断打包
  let repoSlug = null;
  try {
    repoSlug = getRepoSlug();
  } catch (e) {
    console.warn(`[release-bundle] ⚠ 无法解析 git origin（不影响打包）: ${e.message}`);
  }

  const plan = await planReleaseBundle({
    distDir,
    version,
    minApkVersion,
    outDir,
    repoSlug,
    privateKeyPem: pem,
  });

  const paths = await executeReleaseBundle(plan, privateKeyPath);

  log(`web bundle 打包完成（版本 ${plan.version}）:`);
  log(`  条目数   : ${plan.entryCount}`);
  log(`  zip 大小 : ${(plan.size / 1024).toFixed(1)} KB`);
  log(`  zip 摘要 : sha256-${plan.sha256}`);
  log(`  兼容下限 : ${plan.minApkVersion ?? "未设置（不设 minApkVersion，App 端 fail-open）"}`);
  log(`  round-trip 验签: ✅ 通过（plan 阶段完成）`);
  if (plan.assetUrlBase) {
    log(`  资产前缀 : ${plan.assetUrlBase}（version.json webBundle.url）`);
  }
  log("三件套产物:");
  for (const p of paths) log(`  ${p}`);
}

main().catch((error) => {
  console.error(`[release-bundle] ❌ 打包失败: ${error.message}`);
  process.exit(1);
});
