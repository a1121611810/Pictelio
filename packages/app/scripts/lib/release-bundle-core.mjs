// ReleaseBundleCore —— OTA web bundle 三件套打包/签名深模块（#250）
//
// 职责：dist/ 全量打包 zip（根 = index.html，对齐 OtaPlugin versions/<id>/ 布局）→
// manifest（version / minApkVersion? / size / sha256）→ node:crypto Ed25519 签名 →
// 三件套落 packages/app/ota/。接口面（对齐 release-overwrite.mjs 深模块先例）：
//   planReleaseBundle(...)     纯逻辑（读 dist、打包、签名、round-trip 自验），零落盘
//   executeReleaseBundle(...)  副作用（写三件套文件），签名材料齐备后即可执行
//
// 签名契约（与 android 侧 OtaSignatureVerifier.verifyManifest 逐字对齐，#248 差分锚点）：
//   signature = PureEdDSA_Ed25519(DOMAIN_PREFIX || SHA-256(manifest 字节))
//   DOMAIN_PREFIX = "Pictelio-OTA-bundle-v1\n"（必须与 OtaSignatureVerifier.DOMAIN_PREFIX 一致，
//   单测从 Java 源码提取常量比对防漂移）。被签对象 = manifest 文件字节本身，
//   zip 完整性由 manifest.sha256/size 承载（验签后、解压前快检）。
//
// zip 格式契约（Java 侧 OtaPlugin.unpack 用 java.util.zip.ZipInputStream 解压）：
//   - 仅 deflate 文件条目、相对路径（"/" 分隔）、无目录条目、无 data descriptor
//     （local header 直接写真实 crc/size，ZipInputStream 不读 central directory）
//   - 固定 DOS 时间戳（1980-01-01）+ 条目按名排序 → 同 dist 内容重复打包字节一致
//     （-o 覆盖发布「同内容重传」与发布产物可复现都依赖这一点）

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { isVersionAtLeast, parseVersion } from "./release-utils.mjs";

/** 三件套产物目录（相对 packages/app，对齐 apkPathsFor 的相对路径口径） */
export const OTA_DIR = "ota";

/** OTA 签名私钥默认路径（仓外保管，见 docs/research/ota-ed25519-android.md §4.2） */
export const DEFAULT_OTA_PRIVATE_KEY_PATH = resolvePath(
  homedir(),
  ".pictelio-keys",
  "ota-ed25519-private.pem",
);

/**
 * 域分隔前缀：把签名唯一绑定到本 OTA 体系，防跨协议签名重用。
 * ⚠️ 必须与 android/app/src/webview/java/io/pictelio/app/OtaSignatureVerifier.java
 * 的 DOMAIN_PREFIX 逐字一致（含结尾 \n）；单测从 Java 源码提取常量比对。
 */
export const DOMAIN_PREFIX = "Pictelio-OTA-bundle-v1\n";

/** 三件套文件名（命名对齐 pictelio-<version>-<flavor>.apk 惯例） */
export function bundleNames(version) {
  return {
    zip: `pictelio-${version}-web-bundle.zip`,
    manifest: `pictelio-${version}-manifest.json`,
    sig: `pictelio-${version}-manifest.json.sig`,
  };
}

/** 三件套相对 packages/app 的路径（release.mjs step 6 上传与 catch 恢复指引共用） */
export function bundlePathsFor(version, outDir = OTA_DIR) {
  const names = bundleNames(version);
  const dir = outDir.replace(/\/+$/u, "");
  return {
    zip: `${dir}/${names.zip}`,
    manifest: `${dir}/${names.manifest}`,
    sig: `${dir}/${names.sig}`,
  };
}

/** version.json webBundle.url 的三件套资产前缀 URL（Java 侧自行拼 -manifest.json 等后缀） */
export function bundleAssetUrlBase(version, repoSlug) {
  return `https://github.com/${repoSlug}/releases/download/v${version}/pictelio-${version}`;
}

// ── dist 收集与防呆 ──

/**
 * 递归收集 distDir 下全部文件为 { name, data }（name 为 "/" 分隔的相对路径）。
 * 跳过目录符号链接（防打包越界/成环），文件符号链接按内容读入；
 * 结果按 name 排序，保证 zip 字节确定性。
 */
export async function collectDistFiles(distDir) {
  const root = resolvePath(distDir);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`--dist 不是目录: ${root}`);
  }
  const files = [];
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(dir, entry.name);
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, `${rel}/`);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // 目录/悬空符号链接一律跳过（防打包越界与成环）；文件链接按内容读入
        const target = await stat(child).catch(() => null);
        if (!target?.isFile()) {
          console.warn(`[release-bundle] ⚠ 跳过非文件符号链接: ${rel}（目录或悬空，防打包越界）`);
          continue;
        }
      } else if (!entry.isFile()) {
        console.warn(`[release-bundle] ⚠ 跳过非常规文件: ${rel}`);
        continue;
      }
      files.push({ name: rel, data: await readFile(child) });
    }
  }
  await walk(root, "");
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files;
}

/**
 * BASE_PATH 残留防呆：index.html 必须存在，且其中指向 assets 的资源引用
 * 必须以 "/assets/" 开头（release 打包 base 必须为 "/"，GitHub Pages 专用
 * BASE_PATH 环境变量残留会产出 WebView 加载不到的 bundle）。
 * favicon 等非 assets 引用不在此约束内；一条 assets 引用都没有视为构建产物损坏。
 */
async function assertIndexHtmlBase(distDir) {
  const indexPath = join(distDir, "index.html");
  let html;
  try {
    html = await readFile(indexPath, "utf-8");
  } catch {
    throw new Error(
      `打包产物缺少 index.html: ${indexPath}（dist 目录不是有效的 web 构建产物，或 --dist 指错）`,
    );
  }
  const refs = [];
  const attrRe = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gu;
  for (const m of html.matchAll(attrRe)) {
    const value = m[2];
    // 跳过锚点、内联 data 与外链（带 scheme），只检查本站资源引用
    if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(value)) continue;
    if (value.includes("assets/")) refs.push(value);
  }
  if (refs.length === 0) {
    throw new Error(
      `index.html 未发现任何 /assets/ 资源引用（${indexPath}）。` +
        `不是有效的 Vite SPA 构建产物，拒绝打包`,
    );
  }
  const bad = refs.filter((v) => !v.startsWith("/assets/"));
  if (bad.length > 0) {
    throw new Error(
      `index.html 存在不以 /assets/ 开头的资源引用: ${bad.join(", ")}。` +
        `疑似 BASE_PATH 残留（release 打包 base 必须为 "/"，请勿设置 BASE_PATH 环境变量后重新 pnpm run build）`,
    );
  }
}

// ── 最小 zip writer（零依赖：deflateRaw + crc32 + 手写 zip 三段结构）──

// 固定 DOS 时间戳 1980-01-01 00:00:00（DOS 时间原点）：time=0，
// date = (year-1980)<<9 | month<<5 | day = 0<<9 | 1<<5 | 1 = 0x0021。
// 固定时间戳是 zip 字节确定性的前提（不取文件 mtime）。
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
// version made by: 高字节 3 = UNIX，低字节 30 = 2.0（配合 Unix 权限位 external attrs）
const VERSION_MADE_BY = 0x031e;
const VERSION_NEEDED = 20;
const METHOD_DEFLATE = 8;
// unix 模式：常规文件 rw-r--r--（java.util.zip 不读，供 unix 解包器展示）。
// 用乘法而非 <<：<< 按 int32 语义移位，0o100644 << 16 会溢出为负数导致 writeUInt32LE 越界
const EXTERNAL_ATTRS = 0o100644 * 0x10000;

function zipFlags(name) {
  // EFS（bit 11）：条目名非 ASCII 时显式声明 UTF-8 编码（ZipInputStream 默认即 UTF-8）
  return /^[\x20-\x7e]*$/u.test(name) ? 0 : 0x0800;
}

/**
 * 把 { name, data: Buffer }[] 打包为 zip Buffer（zip 根直接是条目名，无顶层目录）。
 * 条目名要求：相对路径、"/" 分隔、无 ".." 段（防呆；Java 侧另有 canonical-path 防线）。
 */
export function createZip(entries) {
  if (entries.length === 0) {
    throw new Error("zip 至少需要一个条目（dist 为空目录）");
  }
  if (entries.length > 0xffff) {
    throw new Error(`zip 条目数超出上限（${entries.length} > 65535）`);
  }
  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (name.startsWith("/") || name.endsWith("/") || name.includes("\\") || name.includes("..")) {
      throw new Error(`非法 zip 条目名: ${name}`);
    }
    if (seen.has(name)) {
      throw new Error(`zip 条目名重复: ${name}`);
    }
    seen.add(name);
    const nameBytes = Buffer.from(name, "utf-8");
    const flags = zipFlags(name);
    const crc = crc32(data) >>> 0;
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBytes.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(EXTERNAL_ATTRS, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central directory 所在 disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory 起始偏移（= 本地数据总长）
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...locals, centralDir, eocd]);
}

// ── manifest 与签名 ──

/**
 * 组装 manifest 对象：{ version, minApkVersion?, size, sha256(hex) }。
 * minApkVersion 仅在提供且非空时写入（缺省 = 不设兼容下限，App 端 fail-open）；
 * 提供时断言 minApkVersion ≤ version（bundle 与宿主 APK 同仓同 commit 构建，天然满足，
 * 断言防手填错——比较语义复用 release-utils 的 isVersionAtLeast）。
 */
export function buildManifest({ version, minApkVersion, zipBuffer }) {
  parseVersion(version); // 格式校验（x.y.z）
  let minApk = null;
  if (minApkVersion != null && String(minApkVersion).trim() !== "") {
    minApk = String(minApkVersion).trim();
    if (!isVersionAtLeast(version, minApk)) {
      throw new Error(
        `minApkVersion (${minApk}) 不能高于本次发布版本 (${version})：bundle 与宿主 APK 同源构建，` +
          `要求高于自身的兼容下限意味着该 bundle 无人可用`,
      );
    }
  }
  const size = zipBuffer.length;
  const sha256 = sha256Hex(zipBuffer);
  // 键序固定（version → minApkVersion? → size → sha256），配合紧凑 JSON 保证字节确定性
  return minApk ? { version, minApkVersion: minApk, size, sha256 } : { version, size, sha256 };
}

/** manifest 的规范字节（紧凑 JSON、固定键序；签名/落盘/重传都必须用同一份字节） */
export function serializeManifest(manifest) {
  return Buffer.from(JSON.stringify(manifest), "utf-8");
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** 签名消息 = DOMAIN_PREFIX || SHA-256(manifest 字节)（与 OtaSignatureVerifier.verifyManifest 对齐） */
function signedMessage(manifestBytes) {
  const digest = createHash("sha256").update(manifestBytes).digest();
  return Buffer.concat([Buffer.from(DOMAIN_PREFIX, "utf-8"), digest]);
}

/**
 * Ed25519 签名 manifest 字节 → base64（64 字节签名）。
 * privateKeyPem 为 PKCS#8 PEM（~/.pictelio-keys/ota-ed25519-private.pem）。
 */
export function signManifest(manifestBytes, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  return sign(null, signedMessage(manifestBytes), privateKey).toString("base64");
}

/**
 * 三件套 round-trip 验签：Ed25519 验签（域分隔 || manifest 摘要）+ zip sha256/size 比对。
 * 任一失败抛错（错误信息区分验签失败与摘要不符）；通过返回 manifest 解析结果。
 */
export function verifyTrio({ manifestBytes, sigB64, zipBuffer }, publicKeyPem) {
  const signature = Buffer.from(sigB64, "base64");
  const publicKey = createPublicKey(publicKeyPem);
  const sigOk = verify(null, signedMessage(manifestBytes), publicKey, signature);
  if (!sigOk) {
    throw new Error("manifest 验签失败：签名与公钥/manifest 字节不匹配（篡改或密钥不符）");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf-8"));
  } catch (e) {
    throw new Error(`manifest JSON 解析失败（验签已通过却无法解析，属实现缺陷）: ${e.message}`, {
      cause: e,
    });
  }
  const actualSha = sha256Hex(zipBuffer);
  if (actualSha !== manifest.sha256) {
    throw new Error(`zip 摘要不匹配：manifest.sha256=${manifest.sha256}，实际=${actualSha}`);
  }
  if (zipBuffer.length !== manifest.size) {
    throw new Error(`zip 大小不匹配：manifest.size=${manifest.size}，实际=${zipBuffer.length}`);
  }
  return manifest;
}

// ── plan / execute 分离 ──

/**
 * 纯逻辑（除读取 dist 外零副作用）：收集 → 防呆 → 打包 → manifest → 签名（可选）→ round-trip。
 *
 * @param {object} input
 * @param {string} input.distDir          web 构建产物目录（默认 dist/，相对 packages/app 或绝对路径）
 * @param {string} input.version          本次发布版本（= package.json version，manifest 不得说谎）
 * @param {string|null} [input.minApkVersion] 该 bundle 要求的最低宿主 APK 版本（null = 不设下限）
 * @param {string} [input.outDir]         三件套落盘目录（默认 "ota"，相对 packages/app）
 * @param {string} input.repoSlug         GitHub 仓库（如 "a1121611810/Pictelio"，仅用于资产 URL 前缀）
 * @param {string|null} [input.privateKeyPem] 私钥 PEM（提供时 plan 内完成签名 + round-trip 自验；
 *   缺省时由 executeReleaseBundle 读 privateKeyPath 签名）
 * @returns {Promise<ReleaseBundlePlan>} 产物清单 + zipBuffer/manifestBytes/sigB64（供测试与 execute）
 */
export async function planReleaseBundle({
  distDir,
  version,
  minApkVersion = null,
  outDir = OTA_DIR,
  repoSlug,
  privateKeyPem = null,
}) {
  const distAbs = resolvePath(distDir);
  const outAbs = resolvePath(outDir);
  const files = await collectDistFiles(distAbs);
  if (files.length === 0) {
    throw new Error(`dist 目录为空: ${distAbs}（请先 pnpm run build）`);
  }
  await assertIndexHtmlBase(distAbs);

  const zipBuffer = createZip(files);
  const manifest = buildManifest({ version, minApkVersion, zipBuffer });
  const manifestBytes = serializeManifest(manifest);

  const names = bundleNames(version);
  const zipPath = join(outAbs, names.zip);
  const manifestPath = join(outAbs, names.manifest);
  const sigPath = join(outAbs, names.sig);

  let sigB64 = null;
  let verified = false;
  if (privateKeyPem) {
    sigB64 = signManifest(manifestBytes, privateKeyPem);
    // plan 阶段即 round-trip 自验：任何字节级问题在落盘前暴露
    verifyTrio(
      { manifestBytes, sigB64, zipBuffer },
      createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }),
    );
    verified = true;
  }

  return {
    version,
    minApkVersion: manifest.minApkVersion ?? null,
    distDir: distAbs,
    outDir: outAbs,
    repoSlug,
    // repoSlug 缺失（独立运行且无 git origin）时仅影响 URL 前缀展示，不阻断打包
    assetUrlBase: repoSlug ? bundleAssetUrlBase(version, repoSlug) : null,
    names,
    zipPath,
    manifestPath,
    sigPath,
    files: files.map((f) => ({ name: f.name, size: f.data.length })),
    entryCount: files.length,
    zipBuffer,
    manifest,
    manifestBytes,
    sigB64,
    verified,
    size: zipBuffer.length,
    sha256: manifest.sha256,
  };
}

/**
 * 副作用：确保 sig（plan 未签名时读私钥文件签名）→ round-trip 自验 → 落盘三件套。
 *
 * @param {Awaited<ReturnType<typeof planReleaseBundle>>} plan
 * @param {string} [privateKeyPath] 私钥路径（仅 plan.sigB64 为空时读取）
 * @returns {Promise<string[]>} [zipPath, manifestPath, sigPath]
 */
export async function executeReleaseBundle(plan, privateKeyPath = DEFAULT_OTA_PRIVATE_KEY_PATH) {
  let { sigB64, manifestBytes, zipBuffer } = plan;
  if (!sigB64) {
    const pem = await readFile(privateKeyPath, "utf-8");
    sigB64 = signManifest(manifestBytes, pem);
  }
  if (!plan.verified) {
    // execute 阶段补做 round-trip（plan 未注入私钥的路径）；公钥从私钥推导
    const pem = await readFile(privateKeyPath, "utf-8");
    const publicKeyPem = createPublicKey(createPrivateKey(pem)).export({
      type: "spki",
      format: "pem",
    });
    verifyTrio({ manifestBytes, sigB64, zipBuffer }, publicKeyPem);
  }
  await mkdir(plan.outDir, { recursive: true });
  // zip 二进制 / manifest 为被签字节（原样落盘，不加换行）/ sig 为文本（Java 侧读取时 trim）
  await writeFile(plan.zipPath, zipBuffer);
  await writeFile(plan.manifestPath, manifestBytes);
  await writeFile(plan.sigPath, `${sigB64}\n`, "utf-8");
  return [plan.zipPath, plan.manifestPath, plan.sigPath];
}
