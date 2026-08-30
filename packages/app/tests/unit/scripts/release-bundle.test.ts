import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { crc32 } from "node:zlib";
import { join, resolve } from "node:path";
import {
  DOMAIN_PREFIX,
  bundleAssetUrlBase,
  bundleNames,
  bundlePathsFor,
  buildManifest,
  collectDistFiles,
  createZip,
  executeReleaseBundle,
  planReleaseBundle,
  serializeManifest,
  signManifest,
  verifyTrio,
} from "../../../scripts/lib/release-bundle-core.mjs";

// ── oracle 溯源（测试硬约束 6：期望值出处可追溯）──
//
// 1. zip 结构断言：PKWARE APPNOTE.TXT 标准字段（local header 0x04034b50 / central
//    directory 0x02014b50 / EOCD 0x06054b50），测试内自带独立解析器按字段偏移逐字节
//    解析（差分：不依赖被测实现的任何解析代码）；整体完整性另用系统 `unzip` 独立
//    实现 round-trip（-t 校验 + 解压逐字节比对）；java.util.zip.ZipInputStream 兼容性
//    要求（local header 直接写真实 crc/size、无 data descriptor bit）来自 Android 侧
//    OtaPlugin.unpack 源码实读。
// 2. 签名方案 oracle：docs/research/ota-ed25519-android.md §5 ——
//    signature = PureEdDSA_Ed25519(DOMAIN_PREFIX || SHA-256(manifest 字节))；
//    DOMAIN_PREFIX 常量从 Android 侧 OtaSignatureVerifier.java 源码提取比对
//    （backupRulesConsistency 从源码提取常量模式）；round-trip 验签消息由测试内
//    独立构造（node:crypto createHash + concat），不从被测实现导入 signedMessage。
// 3. minApkVersion ≤ version 断言语义：packages/app/scripts/lib/release-utils.mjs 的
//    isVersionAtLeast（独立实现，release-utils.test.ts 已有单测）。
// 4. BASE_PATH 防呆正反例来源：packages/app/vite.config.ts `base: process.env.BASE_PATH || "/"`
//    （GitHub Pages 设 /pixivizer/，release 打包必须 "/"）。
// 5. 密钥：测试内 crypto.generateKeyPairSync("ed25519") 临时生成，禁止使用
//    ~/.pictelio-keys（真实签名材料永不进入测试）。

const REPO_APP_ROOT = resolve(__dirname, "../../..");
const JAVA_VERIFIER_PATH = resolve(
  REPO_APP_ROOT,
  "android/app/src/webview/java/io/pictelio/app/OtaSignatureVerifier.java",
);

// 系统 unzip 可用性（macOS/Linux 自带；不可用时跳过对应 describe）
const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// 测试内临时 ed25519 keypair（每文件一份，禁用真实 ~/.pictelio-keys）
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const tmpRoots: string[] = [];
function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "pictelio-ota-test-"));
  tmpRoots.push(dir);
  return dir;
}

/** 构造一个最小 dist 产物目录，返回绝对路径（index.html 引用以 /assets/ 开头 = 正例形态） */
function makeDist(indexHtml: string, extraFiles: Record<string, string> = {}): string {
  const dir = makeTempRoot();
  writeFileSync(join(dir, "index.html"), indexHtml);
  for (const [name, content] of Object.entries(extraFiles)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

const VALID_INDEX_HTML =
  '<!doctype html><html><head><link rel="icon" href="/favicon.svg">' +
  '<script type="module" src="/assets/index-AB12cd.js"></script></head><body></body></html>';

afterAll(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 测试内独立 zip 解析器（oracle：PKWARE APPNOTE.TXT 字段偏移，不依赖被测实现）──

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

interface ZipEntryView {
  name: string;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function parseEocd(zip: Buffer) {
  const sig = zip.readUInt32LE(zip.length - 22);
  expect(sig).toBe(EOCD_SIG); // 无 comment 时 EOCD 固定在末尾 22 字节
  // EOCD 记录起点 = len-22：+10 总条目数(2B) / +12 CD 大小(4B) / +16 CD 起始偏移(4B)
  return {
    entryCount: zip.readUInt16LE(zip.length - 12),
    cdSize: zip.readUInt32LE(zip.length - 10),
    cdOffset: zip.readUInt32LE(zip.length - 6),
  };
}

function parseCentralDirectory(zip: Buffer, cdOffset: number, entryCount: number): ZipEntryView[] {
  const entries: ZipEntryView[] = [];
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    expect(zip.readUInt32LE(offset)).toBe(CENTRAL_SIG);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    entries.push({
      name: zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf-8"),
      flags: zip.readUInt16LE(offset + 8),
      crc: zip.readUInt32LE(offset + 16),
      compressedSize: zip.readUInt32LE(offset + 20),
      uncompressedSize: zip.readUInt32LE(offset + 24),
      localOffset: zip.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function parseLocalHeader(zip: Buffer, localOffset: number, expectName: string) {
  expect(zip.readUInt32LE(localOffset)).toBe(LOCAL_SIG);
  const nameLen = zip.readUInt16LE(localOffset + 26);
  const extraLen = zip.readUInt16LE(localOffset + 28);
  expect(zip.subarray(localOffset + 30, localOffset + 30 + nameLen).toString("utf-8")).toBe(
    expectName,
  );
  return {
    flags: zip.readUInt16LE(localOffset + 6),
    crc: zip.readUInt32LE(localOffset + 14),
    compressedSize: zip.readUInt32LE(localOffset + 18),
    uncompressedSize: zip.readUInt32LE(localOffset + 22),
    dataStart: localOffset + 30 + nameLen + extraLen,
  };
}

// ── collectDistFiles ──

describe("collectDistFiles", () => {
  it("递归收集并按 name 排序，相对路径用 / 分隔", async () => {
    const dir = makeDist(VALID_INDEX_HTML, {
      "assets/index-AB12cd.js": "console.log(1)",
      "assets/deep/style-XY34.css": "body{}",
      "favicon.svg": "<svg/>",
    });
    const files = await collectDistFiles(dir);
    expect(files.map((f) => f.name)).toEqual([
      "assets/deep/style-XY34.css",
      "assets/index-AB12cd.js",
      "favicon.svg",
      "index.html",
    ]);
    const js = files.find((f) => f.name === "assets/index-AB12cd.js");
    expect(js?.data.toString()).toBe("console.log(1)");
  });

  it("跳过目录符号链接与悬空符号链接（防打包越界），不抛错", async () => {
    const dir = makeDist(VALID_INDEX_HTML, { "assets/app.js": "1" });
    // 目录符号链接指向 dist 之外（模拟越界/成环）
    symlinkSync(tmpdir(), join(dir, "outside"));
    // 悬空符号链接
    symlinkSync(join(dir, "not-exists-target"), join(dir, "dangling"));
    const files = await collectDistFiles(dir);
    expect(files.map((f) => f.name).toSorted()).toEqual(["assets/app.js", "index.html"]);
  });

  it("dist 不存在 → 抛错", async () => {
    await expect(collectDistFiles(join(makeTempRoot(), "nope"))).rejects.toThrow();
  });
});

// ── zip writer 结构 ──

describe("createZip（结构断言，oracle = PKWARE APPNOTE.TXT + 测试内独立解析器）", () => {
  const entries = [
    { name: "index.html", data: Buffer.from("<html>ok</html>") },
    { name: "assets/index-AB12cd.js", data: Buffer.from("console.log('pictelio')") },
  ];

  it("EOCD 签名 0x06054b50、entry 计数与 central directory 偏移正确", () => {
    const zip = createZip(entries);
    const eocd = parseEocd(zip);
    expect(eocd.entryCount).toBe(2);
    // cdOffset = 本地数据总长；cdSize + cdOffset + 22 = 文件总长
    expect(eocd.cdOffset + eocd.cdSize + 22).toBe(zip.length);
    const central = parseCentralDirectory(zip, eocd.cdOffset, eocd.entryCount);
    expect(central.map((e) => e.name)).toEqual(["index.html", "assets/index-AB12cd.js"]);
  });

  it("index.html 在 zip 根（无 dist/ 顶层目录、无 / 前缀）——Java 侧 versions/<id>/ 布局契约", () => {
    const zip = createZip(entries);
    const eocd = parseEocd(zip);
    const central = parseCentralDirectory(zip, eocd.cdOffset, eocd.entryCount);
    expect(central.find((e) => e.name === "index.html")).toBeDefined();
    for (const e of central) {
      expect(e.name.startsWith("/")).toBe(false);
      expect(e.name.includes("..")).toBe(false);
    }
  });

  it("local header 写真实 crc/size（无 bit-3 data descriptor，java.util.zip.ZipInputStream 兼容）", () => {
    const zip = createZip(entries);
    const eocd = parseEocd(zip);
    const central = parseCentralDirectory(zip, eocd.cdOffset, eocd.entryCount);
    for (const ce of central) {
      const local = parseLocalHeader(zip, ce.localOffset, ce.name);
      // oracle：crc32 由 Node 平台原语独立重算
      const raw = entries.find((e) => e.name === ce.name)!.data;
      expect(local.crc).toBe(crc32(raw) >>> 0);
      expect(local.uncompressedSize).toBe(raw.length);
      expect(local.compressedSize).toBe(ce.compressedSize);
      expect(local.compressedSize).toBeGreaterThan(0);
      // data descriptor 标志（bit 3）必须未置位；central 与 local 的 flags 一致
      expect(local.flags & 0x8).toBe(0);
      expect(local.flags).toBe(ce.flags);
    }
  });

  it("同输入重复打包字节一致（固定 DOS 时间戳 + 排序，-o 同内容重传依赖）", () => {
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it("非法条目名（绝对路径 / 上溯段）→ 拒绝", () => {
    expect(() => createZip([{ name: "/etc/passwd", data: Buffer.from("x") }])).toThrow(
      /非法 zip 条目名/,
    );
    expect(() => createZip([{ name: "a/../../b", data: Buffer.from("x") }])).toThrow(
      /非法 zip 条目名/,
    );
  });

  it("空条目列表 → 拒绝", () => {
    expect(() => createZip([])).toThrow(/至少需要一个条目/);
  });
});

// ── 系统 unzip 独立实现 round-trip ──

describe.skipIf(!hasUnzip)("zip 系统 unzip round-trip（独立实现差分 oracle）", () => {
  it("unzip -t 全条目校验通过", () => {
    const zip = createZip([
      { name: "index.html", data: Buffer.from(VALID_INDEX_HTML) },
      { name: "assets/index-AB12cd.js", data: Buffer.from("console.log(1)") },
    ]);
    const dir = makeTempRoot();
    const zipPath = join(dir, "bundle.zip");
    writeFileSync(zipPath, zip);
    const out = execFileSync("unzip", ["-t", zipPath], { encoding: "utf-8" });
    expect(out).toContain("No errors detected");
    expect(out).toContain("testing: index.html");
  });

  it("unzip 解压出的文件与输入逐字节一致（zip 根 = index.html）", () => {
    const fileBodies = [
      { name: "index.html", body: VALID_INDEX_HTML },
      { name: "assets/app.js", body: "console.log('x')".repeat(64) }, // 超过压缩字典块，覆盖分块路径
      { name: "favicon.svg", body: "<svg/>" },
    ];
    const zip = createZip(fileBodies.map((f) => ({ name: f.name, data: Buffer.from(f.body) })));
    const dir = makeTempRoot();
    const zipPath = join(dir, "bundle.zip");
    writeFileSync(zipPath, zip);
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", join(dir, "out")]);
    expect(readdirSync(join(dir, "out")).toSorted()).toEqual([
      "assets",
      "favicon.svg",
      "index.html",
    ]);
    for (const f of fileBodies) {
      expect(readFileSync(join(dir, "out", f.name), "utf-8")).toBe(f.body);
    }
  });
});

// ── manifest ──

describe("buildManifest（两形态 + 兼容下限断言）", () => {
  const zipBuffer = createZip([{ name: "index.html", data: Buffer.from("<html>t</html>") }]);
  // oracle：size/sha256 由测试独立重算（node:crypto / Buffer.length）
  const expectedSha = createHash("sha256").update(zipBuffer).digest("hex");

  it("无 minApkVersion：JSON 不含该 key（缺省 = 不设兼容下限 fail-open）", () => {
    const m = buildManifest({ version: "4.22.0", zipBuffer });
    expect(Object.hasOwn(m, "minApkVersion")).toBe(false);
    expect(m).toEqual({ version: "4.22.0", size: zipBuffer.length, sha256: expectedSha });
  });

  it("提供 minApkVersion：写入且参与字段序（version → minApkVersion → size → sha256）", () => {
    const m = buildManifest({ version: "4.22.0", minApkVersion: "4.21.0", zipBuffer });
    expect(m).toEqual({
      version: "4.22.0",
      minApkVersion: "4.21.0",
      size: zipBuffer.length,
      sha256: expectedSha,
    });
    expect(Object.keys(m)).toEqual(["version", "minApkVersion", "size", "sha256"]);
  });

  it("minApkVersion 为空白字符串 → 视为未提供（不写入）", () => {
    const m = buildManifest({ version: "4.22.0", minApkVersion: "   ", zipBuffer });
    expect(Object.hasOwn(m, "minApkVersion")).toBe(false);
  });

  it("minApkVersion == version（边界）→ 允许", () => {
    const m = buildManifest({ version: "4.22.0", minApkVersion: "4.22.0", zipBuffer });
    expect(m.minApkVersion).toBe("4.22.0");
  });

  it("minApkVersion > version → 断言拒绝（isVersionAtLeast 语义）", () => {
    expect(() => buildManifest({ version: "4.22.0", minApkVersion: "4.23.0", zipBuffer })).toThrow(
      /不能高于本次发布版本/,
    );
  });

  it("version 格式非法 → 拒绝（parseVersion 语义）", () => {
    expect(() => buildManifest({ version: "4.22", zipBuffer })).toThrow(/版本号格式无效/);
  });

  it("serializeManifest 为紧凑 JSON 且与手写字节一致（确定性序列化契约）", () => {
    const m = buildManifest({ version: "4.22.0", minApkVersion: "4.21.0", zipBuffer });
    expect(serializeManifest(m).toString()).toBe(
      `{"version":"4.22.0","minApkVersion":"4.21.0","size":${zipBuffer.length},"sha256":"${expectedSha}"}`,
    );
  });
});

// ── 签名 / 验签 round-trip ──

describe("signManifest / verifyTrio（round-trip + 篡改拒绝）", () => {
  const zipBuffer = createZip([
    { name: "index.html", data: Buffer.from(VALID_INDEX_HTML) },
    { name: "assets/index-AB12cd.js", data: Buffer.from("console.log(1)") },
  ]);
  const manifest = buildManifest({ version: "4.22.0", minApkVersion: "4.21.0", zipBuffer });
  const manifestBytes = serializeManifest(manifest);

  // oracle：签名消息由测试独立构造（research §5 + OtaSignatureVerifier.verifyManifest 口径）
  function independentMessage(bytes: Buffer): Buffer {
    const domain = Buffer.from("Pictelio-OTA-bundle-v1\n", "utf-8");
    const digest = createHash("sha256").update(bytes).digest();
    return Buffer.concat([domain, digest]);
  }

  it("signManifest 输出可被独立构造的验签实现验证（差分：非实现自洽）", () => {
    const sigB64 = signManifest(manifestBytes, PRIVATE_PEM);
    const sig = Buffer.from(sigB64, "base64");
    expect(sig.length).toBe(64); // Ed25519 签名固定 64 字节
    const ok = cryptoVerify(null, independentMessage(manifestBytes), publicKey, sig);
    expect(ok).toBe(true);
  });

  it("verifyTrio round-trip 通过并返回 manifest", () => {
    const sigB64 = signManifest(manifestBytes, PRIVATE_PEM);
    const parsed = verifyTrio({ manifestBytes, sigB64, zipBuffer }, PUBLIC_PEM);
    expect(parsed.version).toBe("4.22.0");
    expect(parsed.sha256).toBe(manifest.sha256);
  });

  it("篡改 manifest 一字节 → 拒绝（验签失败）", () => {
    const sigB64 = signManifest(manifestBytes, PRIVATE_PEM);
    const tampered = Buffer.from(manifestBytes);
    tampered[0] ^= 0x01;
    expect(() => verifyTrio({ manifestBytes: tampered, sigB64, zipBuffer }, PUBLIC_PEM)).toThrow(
      /验签失败/,
    );
  });

  it("篡改 zip 一字节 → 拒绝（sha256 快检不匹配）", () => {
    const sigB64 = signManifest(manifestBytes, PRIVATE_PEM);
    const tampered = Buffer.from(zipBuffer);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    expect(() => verifyTrio({ manifestBytes, sigB64, zipBuffer: tampered }, PUBLIC_PEM)).toThrow(
      /zip 摘要不匹配/,
    );
  });

  it("换一把公钥验签 → 拒绝", () => {
    const sigB64 = signManifest(manifestBytes, PRIVATE_PEM);
    const other = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(() => verifyTrio({ manifestBytes, sigB64, zipBuffer }, other)).toThrow(/验签失败/);
  });

  it("直接构造的错误签名 → 拒绝", () => {
    const wrongSig = cryptoSign(null, Buffer.from("other message"), privateKey).toString("base64");
    expect(() => verifyTrio({ manifestBytes, sigB64: wrongSig, zipBuffer }, PUBLIC_PEM)).toThrow(
      /验签失败/,
    );
  });

  it("DOMAIN_PREFIX 与 Android 侧 OtaSignatureVerifier.java 源码常量逐字一致（跨端契约）", () => {
    const source = readFileSync(JAVA_VERIFIER_PATH, "utf-8");
    const m = source.match(/DOMAIN_PREFIX\s*=\s*"((?:[^"\\]|\\.)*)"/u);
    expect(m).not.toBeNull();
    // Java 源码里 \n 是转义序列，展开后比对
    const javaDomain = m![1].replace(/\\n/gu, "\n").replace(/\\\\/g, "\\");
    expect(DOMAIN_PREFIX).toBe(javaDomain);
    expect(DOMAIN_PREFIX).toBe("Pictelio-OTA-bundle-v1\n");
  });
});

// ── planReleaseBundle ──

describe("planReleaseBundle（防呆 + plan/execute 分离）", () => {
  const REPO = "a1121611810/Pictelio";

  it("正例：plan 产出三件套命名/路径/清单，plan 内完成签名 + round-trip", async () => {
    const dist = makeDist(VALID_INDEX_HTML, {
      "assets/index-AB12cd.js": "console.log(1)",
      "assets/style-XY34.css": "body{}",
    });
    const outRoot = makeTempRoot();
    const plan = await planReleaseBundle({
      distDir: dist,
      version: "4.22.0",
      minApkVersion: "4.21.0",
      outDir: join(outRoot, "ota"), // 尚不存在的目录：plan 阶段不应创建
      repoSlug: REPO,
      privateKeyPem: PRIVATE_PEM,
    });
    // 三件套命名（对齐 pictelio-<version>-<flavor>.apk 惯例）
    expect(plan.names).toEqual({
      zip: "pictelio-4.22.0-web-bundle.zip",
      manifest: "pictelio-4.22.0-manifest.json",
      sig: "pictelio-4.22.0-manifest.json.sig",
    });
    expect(plan.zipPath).toBe(join(outRoot, "ota", "pictelio-4.22.0-web-bundle.zip"));
    expect(plan.manifestPath).toBe(join(outRoot, "ota", "pictelio-4.22.0-manifest.json"));
    expect(plan.sigPath).toBe(join(outRoot, "ota", "pictelio-4.22.0-manifest.json.sig"));
    // 产物清单与 manifest
    expect(plan.entryCount).toBe(3);
    expect(plan.files.map((f) => f.name)).toEqual([
      "assets/index-AB12cd.js",
      "assets/style-XY34.css",
      "index.html",
    ]);
    expect(JSON.parse(plan.manifestBytes.toString())).toEqual({
      version: "4.22.0",
      minApkVersion: "4.21.0",
      size: plan.size,
      sha256: plan.sha256,
    });
    // plan 内签名 + 自验
    expect(plan.sigB64).not.toBeNull();
    expect(plan.verified).toBe(true);
    verifyTrio(
      { manifestBytes: plan.manifestBytes, sigB64: plan.sigB64!, zipBuffer: plan.zipBuffer },
      PUBLIC_PEM,
    );
    // 资产前缀 URL（version.json webBundle.url 契约：无扩展名，App 端拼后缀）
    expect(plan.assetUrlBase).toBe(
      `https://github.com/${REPO}/releases/download/v4.22.0/pictelio-4.22.0`,
    );
    // plan 零落盘（outDir 在 execute 阶段才创建）
    expect(existsSync(join(outRoot, "ota"))).toBe(false);
  });

  it("反例：引用以 ./assets/ 开头（相对路径形态）→ 抛错", async () => {
    const dist = makeDist('<html><script src="./assets/index-AB12cd.js"></script></html>', {
      "assets/index-AB12cd.js": "1",
    });
    await expect(
      planReleaseBundle({
        distDir: dist,
        version: "4.22.0",
        repoSlug: REPO,
        outDir: makeTempRoot(),
      }),
    ).rejects.toThrow(/\/assets\/ 开头/);
  });

  it("反例：BASE_PATH 残留（/pixivizer/assets/…）→ 抛错", async () => {
    const dist = makeDist(
      '<html><script src="/pixivizer/assets/index-AB12cd.js"></script></html>',
      {
        "assets/index-AB12cd.js": "1",
      },
    );
    await expect(
      planReleaseBundle({
        distDir: dist,
        version: "4.22.0",
        repoSlug: REPO,
        outDir: makeTempRoot(),
      }),
    ).rejects.toThrow(/BASE_PATH 残留/);
  });

  it("反例：index.html 缺失 → 抛错", async () => {
    const dist = makeTempRoot();
    writeFileSync(join(dist, "assets.txt"), "x");
    await expect(
      planReleaseBundle({
        distDir: dist,
        version: "4.22.0",
        repoSlug: REPO,
        outDir: makeTempRoot(),
      }),
    ).rejects.toThrow(/缺少 index\.html/);
  });

  it("反例：index.html 无任何 assets 引用 → 视为损坏产物抛错", async () => {
    const dist = makeDist('<html><body><a href="#top">top</a></body></html>');
    await expect(
      planReleaseBundle({
        distDir: dist,
        version: "4.22.0",
        repoSlug: REPO,
        outDir: makeTempRoot(),
      }),
    ).rejects.toThrow(/未发现任何 \/assets\/ 资源引用/);
  });

  it("反例：minApkVersion > version → 抛错", async () => {
    const dist = makeDist(VALID_INDEX_HTML, { "assets/index-AB12cd.js": "1" });
    await expect(
      planReleaseBundle({
        distDir: dist,
        version: "4.22.0",
        minApkVersion: "4.22.1",
        repoSlug: REPO,
        outDir: makeTempRoot(),
        privateKeyPem: PRIVATE_PEM,
      }),
    ).rejects.toThrow(/不能高于本次发布版本/);
  });
});

// ── executeReleaseBundle ──

describe("executeReleaseBundle（落盘三件套）", () => {
  it("plan 已签名（含 privateKeyPem）→ 直接落盘，字节与 plan 一致", async () => {
    const dist = makeDist(VALID_INDEX_HTML, { "assets/index-AB12cd.js": "console.log(1)" });
    const outDir = makeTempRoot();
    const plan = await planReleaseBundle({
      distDir: dist,
      version: "4.23.0",
      outDir,
      repoSlug: "a1121611810/Pictelio",
      privateKeyPem: PRIVATE_PEM,
    });
    const paths = await executeReleaseBundle(plan, "/nonexistent-key.pem"); // 不应被读取
    expect(paths).toHaveLength(3);
    const zipOnDisk = readFileSync(plan.zipPath);
    const manifestOnDisk = readFileSync(plan.manifestPath);
    const sigOnDisk = readFileSync(plan.sigPath, "utf-8");
    expect(zipOnDisk.equals(plan.zipBuffer)).toBe(true);
    expect(manifestOnDisk.equals(plan.manifestBytes)).toBe(true);
    expect(sigOnDisk).toBe(`${plan.sigB64}\n`);
    // 落盘后的三件套仍可通过完整 round-trip
    verifyTrio(
      {
        manifestBytes: readFileSync(plan.manifestPath),
        sigB64: sigOnDisk.trim(),
        zipBuffer: zipOnDisk,
      },
      PUBLIC_PEM,
    );
  });

  it("plan 未签名（无 privateKeyPem）→ execute 读私钥文件签名并自验后落盘", async () => {
    const dist = makeDist(VALID_INDEX_HTML, { "assets/index-AB12cd.js": "console.log(2)" });
    const outDir = makeTempRoot();
    const keyDir = makeTempRoot();
    const keyPath = join(keyDir, "ota-private.pem");
    writeFileSync(keyPath, PRIVATE_PEM);
    const plan = await planReleaseBundle({
      distDir: dist,
      version: "4.24.0",
      outDir,
      repoSlug: "a1121611810/Pictelio",
    });
    expect(plan.sigB64).toBeNull();
    expect(plan.verified).toBe(false);
    const paths = await executeReleaseBundle(plan, keyPath);
    expect(paths).toEqual([plan.zipPath, plan.manifestPath, plan.sigPath]);
    const manifestOnDisk = JSON.parse(readFileSync(plan.manifestPath).toString());
    expect(manifestOnDisk.version).toBe("4.24.0");
    const sigOnDisk = readFileSync(plan.sigPath, "utf-8").trim();
    expect(() =>
      verifyTrio(
        {
          manifestBytes: readFileSync(plan.manifestPath),
          sigB64: sigOnDisk,
          zipBuffer: readFileSync(plan.zipPath),
        },
        PUBLIC_PEM,
      ),
    ).not.toThrow();
  });
});

// ── 路径/URL 纯函数 ──

describe("bundle 命名与 URL 纯函数", () => {
  it("bundlePathsFor 默认落 ota/（相对 packages/app，供 step 6 上传与 catch 指引）", () => {
    const p = bundlePathsFor("4.22.0");
    expect(p).toEqual({
      zip: "ota/pictelio-4.22.0-web-bundle.zip",
      manifest: "ota/pictelio-4.22.0-manifest.json",
      sig: "ota/pictelio-4.22.0-manifest.json.sig",
    });
    expect(bundlePathsFor("4.22.0", "custom-out").zip).toBe(
      "custom-out/pictelio-4.22.0-web-bundle.zip",
    );
  });

  it("bundleAssetUrlBase 为三件套资产前缀（Java 侧拼 -manifest.json / -web-bundle.zip 后缀）", () => {
    expect(bundleAssetUrlBase("4.22.0", "a1121611810/Pictelio")).toBe(
      "https://github.com/a1121611810/Pictelio/releases/download/v4.22.0/pictelio-4.22.0",
    );
  });

  it("bundleNames 与 OtaPlugin 下载后缀契约对齐", () => {
    // oracle：OtaPlugin.java L255-293 —— urlBase + "-manifest.json" / "-manifest.json.sig" / "-web-bundle.zip"
    const names = bundleNames("4.22.0");
    expect(`${names.manifest}`).toMatch(/-manifest\.json$/u);
    expect(`${names.sig}`).toMatch(/-manifest\.json\.sig$/u);
    expect(`${names.zip}`).toMatch(/-web-bundle\.zip$/u);
  });
});
