#!/usr/bin/env node
// ============================================================================
// PROTOTYPE — 一次性实验脚本（throwaway，验证后删除，勿进入正式发布流程）
// ============================================================================
// 回答的问题：用 Node.js / Bun 原生实现 GitHub release asset 上传（不经 gh CLI）
//   1. 是否可行？  2. 速度 vs gh CLI（已测：直连 1.48 MB/s / 代理 1.22 MB/s）？
//
// 用法（4 个模式各跑一次，环境变量控制代理）：
//   node  scripts/prototype-node-upload.mjs --node-https --direct   # Node 原生 https，直连
//   node  scripts/prototype-node-upload.mjs --node-https --proxy    # Node 原生 https，CONNECT 隧道
//   bun   scripts/prototype-node-upload.mjs --bun-fetch  --direct   # Bun fetch(HTTP/2)，直连
//   HTTPS_PROXY=http://127.0.0.1:10808 \
//   HTTP_PROXY=http://127.0.0.1:10808  \
//   bun   scripts/prototype-node-upload.mjs --bun-fetch  --proxy    # Bun fetch，走代理
//
// 流程：生成 6MB 随机文件 → gh 创建 draft release → 按实现上传 → 删除 release+文件（零残留）。
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { writeFile, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import process from "node:process";

const execFileP = promisify(execFile);
const REPO = "a1121611810/Pictelio";
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 10808;
const SIZE_MB = 6;
const PROXY = `http://${PROXY_HOST}:${PROXY_PORT}`;

// ---------------------------------------------------------------------------
// 工具：gh 子进程
// ---------------------------------------------------------------------------
async function gh(args) {
  const { stdout, stderr } = await execFileP("gh", args, { timeout: 120_000 });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Node 原生 https：CONNECT 隧道代理 Agent
// ---------------------------------------------------------------------------
class TunnelAgent extends https.Agent {
  constructor() {
    super({ keepAlive: false });
  }
  createConnection(options, callback) {
    const proxySock = net.connect(PROXY_PORT, PROXY_HOST);
    proxySock.once("error", callback);
    proxySock.once("connect", () => {
      proxySock.write(
        `CONNECT ${options.host}:${options.port} HTTP/1.1\r\n` +
        `Host: ${options.host}:${options.port}\r\n\r\n`,
      );
      let buf = "";
      const onData = (chunk) => {
        buf += chunk;
        if (!buf.includes("\r\n\r\n")) return;
        proxySock.off("data", onData);
        if (!buf.startsWith("HTTP/1.1 200")) {
          proxySock.destroy();
          callback(new Error(`CONNECT 失败: ${buf.slice(0, 80)}`));
          return;
        }
        const tlsSock = tls.connect({ socket: proxySock, servername: options.host });
        tlsSock.once("secureConnect", () => callback(null, tlsSock));
        tlsSock.once("error", callback);
      };
      proxySock.on("data", onData);
    });
  }
}

// ---------------------------------------------------------------------------
// 上传实现 1：Node 原生 https（直连 / CONNECT 隧道）
// ---------------------------------------------------------------------------
function uploadNodeHttps(uploadUrl, filePath, token, useProxy) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const agent = useProxy ? new TunnelAgent() : undefined;
    const req = https.request({
      host: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "POST",
      agent,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/octet-stream",
        "Content-Length": SIZE_MB * 1024 * 1024,
        "User-Agent": "prototype-node-upload",
      },
    });
    const t0 = performance.now();
    req.on("response", (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        resolve({ status: res.statusCode, ms: performance.now() - t0, body: body.slice(0, 200) });
      });
    });
    req.on("error", reject);
    createReadStream(filePath).pipe(req);
  });
}

// ---------------------------------------------------------------------------
// 上传实现 2：Bun fetch（HTTP/2 默认；代理由环境变量 HTTPS_PROXY 控制）
// ---------------------------------------------------------------------------
async function uploadBunFetch(uploadUrl, filePath, token) {
  const u = new URL(uploadUrl);
  const t0 = performance.now();
  const res = await fetch(u, {
    method: "POST",
    body: Bun.file(filePath),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/octet-stream",
      "User-Agent": "prototype-node-upload",
    },
  });
  const body = await res.text();
  return { status: res.status, ms: performance.now() - t0, body: body.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 上传实现 3：gh CLI（对照组，同流程同文件直接对比）
// ---------------------------------------------------------------------------
async function uploadGhCli(tag, filePath) {
  const t0 = performance.now();
  const { stderr } = await execFileP(
    "gh", ["release", "upload", tag, "--repo", REPO, "--clobber", filePath],
    { timeout: 600_000 },
  );
  return { status: 201, ms: performance.now() - t0, body: stderr.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const impl = process.argv.includes("--node-https") ? "node-https"
    : process.argv.includes("--gh-cli") ? "gh-cli" : "bun-fetch";
  const useProxy = process.argv.includes("--proxy");
  const viaEnvProxy = !!process.env.HTTPS_PROXY && !process.argv.includes("--direct");
  const proxyLabel = useProxy || viaEnvProxy ? "代理" : "直连";
  const runtime = impl === "node-https" ? "node" : impl === "gh-cli" ? "gh" : "bun";

  console.log(`PROTOTYPE：${runtime} ${impl} ｜ ${proxyLabel} ｜ 文件 ${SIZE_MB}MB`);
  console.log(`代理判定：useProxy=${useProxy} viaEnv=${viaEnvProxy}`);

  // 1. 生成测试文件 + 建 draft release
  const tag = `prototype-node-${randomBytes(4).toString("hex")}`;
  const file = `/tmp/pictelio-node-probe-${randomBytes(4).toString("hex")}.bin`;
  await writeFile(file, randomBytes(SIZE_MB * 1024 * 1024));
  const token = await gh(["auth", "token"]);
  // 用 gh api POST 创建 draft release 并一步拿 upload_url（GET /releases 列表端点不含 draft）
  const uploadUrl = (await gh([
    "api", `repos/${REPO}/releases`,
    "-X", "POST",
    "-f", `tag_name=${tag}`,
    "-F", "draft=true",
    "-f", "name=PROTOTYPE node/bun upload test (auto-deleted)",
    "-f", "body=throwaway — delete me",
    "--jq", ".upload_url",
  ])).replace(
    "{?name,label}",
    `?name=${encodeURIComponent(`probe-${tag}.bin`)}`,
  );
  console.log(`[状态] draft release ${tag} 已创建`);
  console.log(`[状态] upload_url: ${uploadUrl.replace(/\/repos.*/, "/repos/…")}`);

  try {
    // 3. 上传（按实现）
    let result;
    if (impl === "node-https") {
      result = await uploadNodeHttps(uploadUrl, file, token, useProxy);
    } else if (impl === "gh-cli") {
      result = await uploadGhCli(tag, file);
    } else {
      result = await uploadBunFetch(uploadUrl, file, token);
    }
    const mbps = result.status === 201 ? (SIZE_MB / (result.ms / 1000)).toFixed(2) : null;
    console.log(
      `  HTTP ${result.status} ｜ ${(result.ms / 1000).toFixed(1)}s ｜ ` +
      (mbps ? `${mbps} MB/s` : `失败: ${result.body}`),
    );
    if (result.status === 201) {
      console.log(`[结论] ${runtime}/${impl}/${proxyLabel}: ${SIZE_MB}MB / ${(result.ms / 1000).toFixed(1)}s ≈ ${mbps} MB/s`);
    } else {
      console.log(`[结论] ${runtime}/${impl}/${proxyLabel}: 失败（HTTP ${result.status} ${result.body}）`);
    }
  } finally {
    // 4. 清理：删 release + 文件（零残留）
    await gh(["release", "delete", tag, "--repo", REPO, "--yes"]).catch(() => {});
    await unlink(file).catch(() => {});
    console.log(`[状态] 已清理 draft release ${tag} 与测试文件`);
  }
}

main().catch((error) => {
  console.error("错误:", error.message);
  process.exit(1);
});
