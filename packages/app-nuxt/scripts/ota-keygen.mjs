// PROTOTYPE — OTA 签名工具：密钥生成（Ed25519，PKCS8 私钥存仓库外 ~/.pictelio-keys/）
// 用法：node scripts/ota-keygen.mjs
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dir = join(homedir(), ".pictelio-keys");
const privPem = join(dir, "ota_ed25519_private.pem");
const pubB64File = join(dir, "ota_ed25519_public.b64");

if (existsSync(privPem)) {
  console.log(`私钥已存在：${privPem}（不覆盖；如需重置请先手动删除）`);
  console.log(`公钥 b64：${readFileSync(pubB64File, "utf8").trim()}`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(privPem, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
// raw 32 字节公钥 = SPKI DER 的最后 32 字节
const spki = publicKey.export({ type: "spki", format: "der" });
const raw = spki.subarray(spki.length - 32);
const pubB64 = raw.toString("base64");
writeFileSync(pubB64File, pubB64 + "\n");
console.log(`密钥已生成：\n  私钥（勿入库）：${privPem}\n  公钥 b64：${pubB64}`);
