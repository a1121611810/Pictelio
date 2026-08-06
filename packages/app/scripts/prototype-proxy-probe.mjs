#!/usr/bin/env node
// ============================================================================
// PROTOTYPE — 一次性实验脚本（throwaway，验证后删除，勿进入正式发布流程）
// ============================================================================
// 回答的问题（对应 docs/research/github-release-upload-acceleration.md §6）：
//   1. 本项目能否识别「gh release upload 是否走代理」？
//   2. uploads.github.com 直连 vs 代理，哪个更快？
//
// 用法：
//   node packages/app/scripts/prototype-proxy-probe.mjs          # 探测 + 延迟测速（无副作用）
//   node packages/app/scripts/prototype-proxy-probe.mjs --upload-test  # 额外做真实上传吞吐对照
//
// 说明：
//   - 延迟测速：curl 对 uploads.github.com / api.github.com / github.com 分别
//     直连（--noproxy "*"）与走代理（-x 127.0.0.1:10808），输出各阶段耗时与真实远端 IP。
//   - 上传测速（--upload-test）：创建 draft release（不留 tag、测完删除），
//     用真实 gh release upload 传 6MB 测试文件各一次，对比直连/代理吞吐。
//   - 所有状态逐行打印（prototype 约定：surface the state）。
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { writeFile, unlink, stat } from "node:fs/promises";
import process from "node:process";

const execFileP = promisify(execFile);
const PROXY_URL = "http://127.0.0.1:10808";
const REPO = "a1121611810/Pictelio";
const TARGETS = [
  "https://uploads.github.com/",
  "https://api.github.com/",
  "https://github.com/",
];
const CURL_FORMAT = [
  "%{http_code}",
  "%{remote_ip}",
  "%{time_namelookup}",
  "%{time_connect}",
  "%{time_appconnect}",
  "%{time_starttransfer}",
  "%{time_total}",
  "%{size_download}",
].join("|");

// ---------------------------------------------------------------------------
// 1. 代理环境探测（对应「能否识别是否为代理」的静态层）
// ---------------------------------------------------------------------------
function detectProxyEnv() {
  const names = [
    "HTTP_PROXY", "http_proxy",
    "HTTPS_PROXY", "https_proxy",
    "ALL_PROXY", "all_proxy",
    "NO_PROXY", "no_proxy",
  ];
  const env = {};
  for (const n of names) {
    if (process.env[n]) env[n] = process.env[n];
  }
  return env;
}

// 模拟 Go httpproxy 的 NO_PROXY 域名匹配（含子域规则，见文档 §6），
// 静态判断「给定 URL 按当前环境变量是否会走代理」。
function wouldBeProxied(url) {
  const proxyUrl =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ??
    process.env.HTTP_PROXY ?? process.env.http_proxy ?? "";
  if (!proxyUrl) return false;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (noProxy.trim() === "") return true;
  if (noProxy.includes("*")) return false;
  const host = new URL(url).hostname.toLowerCase();
  for (const raw of noProxy.split(",")) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    const entryHost = e.split(":")[0];
    if (!entryHost) continue;
    if (entryHost.startsWith(".")) {
      if (host.endsWith(entryHost)) return false; // .y.com 匹配子域
    } else if (host === entryHost || host.endsWith("." + entryHost)) {
      return false; // y.com 匹配自身 + 所有子域
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. curl 探测（对应「是否真的走了代理」的实测层）
// ---------------------------------------------------------------------------
async function curlProbe(url, mode) {
  const args = [
    "-sS", "-o", "/dev/null",
    "-w", CURL_FORMAT,
    "--max-time", "20",
    "-H", "User-Agent: prototype-proxy-probe",
    "--http1.1", // 统一协议，避免 HTTP/2 干扰对比
  ];
  if (mode === "direct") {
    args.push("--noproxy", "*"); // curl 层面强制直连
  } else {
    args.push("-x", PROXY_URL, "--noproxy", "");
  }
  args.push(url);
  try {
    const { stdout } = await execFileP("curl", args, { env: process.env });
    const [httpCode, remoteIp, namelookup, connect, appconnect, starttransfer, total, size] =
      stdout.trim().split("|");
    return {
      url, mode, httpCode, remoteIp,
      timeNamelookup: Number(namelookup),
      timeConnect: Number(connect),
      timeAppconnect: Number(appconnect),
      timeStarttransfer: Number(starttransfer),
      timeTotal: Number(total),
      sizeDownload: Number(size),
    };
  } catch (error) {
    return { url, mode, error: String(error.stderr || error.message).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// 3. 真实上传测速（--upload-test）
// ---------------------------------------------------------------------------
const UPLOAD_SIZE_MB = 6;

async function ghRun(args, envPatch) {
  const env = { ...process.env, ...envPatch };
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileP("gh", args, { env, timeout: 600_000 });
    return { ok: true, ms: Date.now() - t0, out: (stdout + stderr).slice(-300) };
  } catch (error) {
    return { ok: false, ms: Date.now() - t0, out: String(error.stderr || error.message).slice(-300) };
  }
}

async function uploadSpeedTest() {
  console.log("\n=== 3. 真实上传吞吐对照（--upload-test）===");
  console.log(`仓库：${REPO} ｜ 测试文件：${UPLOAD_SIZE_MB}MB 随机数据 ｜ 模式：draft release（测完即删）`);

  // 3.1 生成测试文件
  const tag = `prototype-proxy-${randomBytes(4).toString("hex")}`;
  const file = `/tmp/pictelio-prototype-probe-${randomBytes(4).toString("hex")}.bin`;
  await writeFile(file, randomBytes(UPLOAD_SIZE_MB * 1024 * 1024));
  console.log(`[状态] 已生成测试文件 ${file}（${UPLOAD_SIZE_MB}MB）`);

  // 3.2 创建 draft release（不推送 tag，测完删除，不留痕）
  const created = await ghRun(
    ["release", "create", tag, "--repo", REPO, "--draft",
     "--title", "PROTOTYPE proxy speed test (auto-deleted)",
     "--notes", "throwaway speed probe — delete me"],
    {},
  );
  if (!created.ok) {
    console.error(`✗ 创建 draft release 失败：${created.out}`);
    console.error("  需要 gh 登录且 token 含 repo scope。跳过上传测速。");
    await unlink(file).catch(() => {});
    return;
  }
  console.log(`[状态] draft release ${tag} 已创建（仅自己可见）`);

  // 3.3 直连 vs 代理 各传一次（同一 asset 名，--clobber 幂等）
  const modes = [
    { label: "直连", env: { HTTPS_PROXY: "", HTTP_PROXY: "", ALL_PROXY: "" } },
    { label: "代理", env: { HTTPS_PROXY: PROXY_URL, HTTP_PROXY: PROXY_URL, ALL_PROXY: PROXY_URL } },
  ];
  const results = [];
  for (const mode of modes) {
    process.stdout.write(`  [${mode.label}] gh release upload ${tag} …`);
    const r = await ghRun(
      ["release", "upload", tag, "--repo", REPO, "--clobber", file],
      mode.env,
    );
    const mbps = r.ok ? (UPLOAD_SIZE_MB / (r.ms / 1000)).toFixed(2) : "-";
    const rate = r.ok ? `${UPLOAD_SIZE_MB}MB / ${(r.ms / 1000).toFixed(1)}s ≈ ${mbps} MB/s` : `失败：${r.out}`;
    console.log(` ${rate}`);
    results.push({ label: mode.label, ok: r.ok, ms: r.ms, mbps });
  }

  // 3.4 清理：删除 draft release + 测试文件
  const del = await ghRun(["release", "delete", tag, "--repo", REPO, "--yes"], {});
  await unlink(file).catch(() => {});
  console.log(`[状态] 已删除 draft release ${tag}（${del.ok ? "成功" : "失败: " + del.out}）与测试文件`);

  // 3.5 结论
  console.log("\n[结论] 真实上传吞吐对照：");
  for (const r of results) {
    console.log(`  ${r.label.padEnd(4)}: ${r.ok ? r.mbps + " MB/s" : "失败"}`);
  }
  if (results.length === 2 && results.every((r) => r.ok)) {
    const [direct, proxy] = results;
    const faster = direct.mbps > proxy.mbps ? "直连" : "代理";
    const ratio = (Math.max(direct.mbps, proxy.mbps) / Math.min(direct.mbps, proxy.mbps)).toFixed(1);
    console.log(`  → ${faster} 更快（约 ${ratio} 倍）`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const uploadTest = process.argv.includes("--upload-test");

  console.log("PROTOTYPE：gh 代理识别 + 直连/代理测速对照");
  console.log("（throwaway 实验脚本，结论请以实测为准）\n");

  // 1. 静态代理识别
  console.log("=== 1. 代理环境识别（静态）===");
  const env = detectProxyEnv();
  if (Object.keys(env).length === 0) {
    console.log("  当前 shell 无任何代理环境变量 → 静态判断：gh 将直连");
  } else {
    for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`);
    for (const t of TARGETS) {
      console.log(`  ${t} → ${wouldBeProxied(t) ? "走代理" : "直连"}（NO_PROXY 规则）`);
    }
  }

  // 2. 实测路径识别 + 延迟测速
  console.log("\n=== 2. 实测：是否真走代理 + 延迟对比 ===");
  console.log("  （直连=curl --noproxy; 代理=-x 127.0.0.1:10808; 统一 HTTP/1.1）");
  const results = [];
  for (const t of TARGETS) {
    for (const mode of ["direct", "proxy"]) {
      results.push(await curlProbe(t, mode));
    }
  }
  console.log("  " + "目标".padEnd(28) + "模式".padEnd(8) + "远端IP".padEnd(17) +
    "TCP".padEnd(8) + "TLS".padEnd(8) + "首字节".padEnd(9) + "HTTP");
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.url.padEnd(28)}${r.mode.padEnd(8)}失败: ${r.error}`);
      continue;
    }
    console.log(
      `  ${r.url.padEnd(28)}${r.mode.padEnd(8)}${r.remoteIp.padEnd(17)}` +
      `${(r.timeConnect * 1000).toFixed(0).padStart(3) + "ms".padEnd(5)}` +
      `${(r.timeAppconnect * 1000).toFixed(0).padStart(3) + "ms".padEnd(5)}` +
      `${(r.timeStarttransfer * 1000).toFixed(0).padStart(4) + "ms".padEnd(5)}` +
      `${r.httpCode}`,
    );
  }
  // 直连/代理判断：remoteIp 若为 127.0.0.1 说明走了代理（CONNECT 隧道），否则为真实远端 IP
  const uploadsDirect = results.find((r) => r.url.includes("uploads") && r.mode === "direct");
  const uploadsProxy = results.find((r) => r.url.includes("uploads") && r.mode === "proxy");
  if (uploadsDirect && uploadsProxy && !uploadsDirect.error && !uploadsProxy.error) {
    const directFaster =
      uploadsDirect.timeStarttransfer < uploadsProxy.timeStarttransfer;
    console.log(`\n  直连远端 IP：${uploadsDirect.remoteIp}（真实 GitHub IP）`);
    console.log(`  代理远端 IP：${uploadsProxy.remoteIp}（127.0.0.1=CONNECT 隧道，即确实走了代理）`);
    console.log(`  首字节延迟：直连 ${(uploadsDirect.timeStarttransfer * 1000).toFixed(0)}ms vs 代理 ${(uploadsProxy.timeStarttransfer * 1000).toFixed(0)}ms` +
      ` → ${directFaster ? "直连更快" : "代理更快"}`);
  }

  // 3. 真实上传测速（可选）
  if (uploadTest) {
    await uploadSpeedTest();
  } else {
    console.log("\n（提示：加 --upload-test 可做真实 gh release upload 吞吐对照，");
    console.log("  会短暂创建并删除一个 draft release。）");
  }

  console.log("\n=== 完成 ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
