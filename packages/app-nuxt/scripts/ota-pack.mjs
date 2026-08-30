// PROTOTYPE — OTA bundle 打包签名：.output/public → bundle.zip + manifest.json + manifest.json.sig
// 用法：node scripts/ota-pack.mjs --version v2 --out /tmp/ota-server [--floor 1.0.0] [--broken]
// 签名语义（对齐 #242）：sig = Ed25519.sign(SHA-256("Pictelio-OTA-bundle-v1\n" + manifest 字节))
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const version = arg("version");
const outDir = resolve(arg("out", "/tmp/ota-server"));
const floor = arg("--floor", "1.0.0");
const broken = args.includes("--broken");
if (!version) {
  console.error("用法：node scripts/ota-pack.mjs --version v2 --out /tmp/ota-server [--floor 1.0.0] [--broken]");
  process.exit(1);
}

const SIGN_PREFIX = "Pictelio-OTA-bundle-v1\n";
const privPemPath = join(homedir(), ".pictelio-keys", "ota_ed25519_private.pem");
if (!existsSync(privPemPath)) {
  console.error(`缺私钥：${privPemPath}（先跑 node scripts/ota-keygen.mjs）`);
  process.exit(1);
}
const privKey = createPrivateKey(readFileSync(privPemPath));

// 1) 组装打包源（broken 场景：index.html 换成立即 throw、无任何应用脚本的占位页）
const src = resolve(".output/public");
if (!existsSync(join(src, "index.html"))) {
  console.error(`缺产物：${src}（先 nuxt generate）`);
  process.exit(1);
}
const stage = resolve(".ota-stage");
rmSync(stage, { recursive: true, force: true });
cpSync(src, stage, { recursive: true });
if (broken) {
  writeFileSync(
    join(stage, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>v${version}-BROKEN</title></head>` +
      `<body><h1>v${version}-BROKEN（启动即失败样本）</h1><script>throw new Error("ota-broken: simulate crash boot");</script></body></html>`
  );
}

// 2) zip（macOS /usr/bin/zip；zip 根 = 产物根）
const zipPath = join(outDir, "bundle.zip");
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execSync(`/usr/bin/zip -qr "${zipPath}" .`, { cwd: stage });
rmSync(stage, { recursive: true, force: true });

// 3) manifest + 域分隔摘要签名
const zipBytes = readFileSync(zipPath);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const manifest = Buffer.from(
  JSON.stringify({ version, sha256, minApkVersion: "0.0.0", builtAt: new Date().toISOString() })
);
const digest = createHash("sha256")
  .update(Buffer.concat([Buffer.from(SIGN_PREFIX, "utf8"), manifest]))
  .digest();
const sig = cryptoSign(null, digest, privKey); // Ed25519 PureEdDSA over digest

writeFileSync(join(outDir, "manifest.json"), manifest);
writeFileSync(join(outDir, "manifest.json.sig"), sig.toString("base64") + "\n");
writeFileSync(join(outDir, "version.json"), JSON.stringify({ minWebVersion: floor }));
console.log(
  `packed ${version}${broken ? " (BROKEN)" : ""} → ${outDir}\n  zip=${zipBytes.length}B sha256=${sha256.slice(0, 12)}… floor=${floor}`
);
