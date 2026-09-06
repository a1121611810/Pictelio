#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PROTOTYPE（一次性探针，非生产代码）— 验证 Pictelio 免梯直连 Pixiv 的可行性
//
// 问题：无 VPN 情况下，图片 / API / 登录 三层哪条绕过通路在本网络真实可行？
// 通路来自 2026-09-06 调研（Pixez compat 模式 = 静态 IP + 无 SNI TLS；
// Shaft = QUIC；s.pximg.net 未被封锁；社区镜像 i.pixiv.re）。
//
// 运行：node scripts/prototype-pixiv-bypass.mjs
// 依赖：无（Node 内置模块）。所有探测均为直连（Node 网络层不走系统代理）。
// 唯一例外：I0 基线对照经本机代理，用于内容一致性比对，失败不阻塞结论。
// 结论只反映探测时刻的网络封锁状态（GFW 策略会变化）。
// ═══════════════════════════════════════════════════════════════════════════

import tls from "node:tls";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// ── 常量（与仓库 OAuthConfig.java 同源）─────────────────────────────────
const APP_UA = "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)"; // OAuthConfig.USER_AGENT
const REFERER = "https://app-api.pixiv.net/"; // OAuthConfig.REFERER
const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SECRET = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";
// 真实在线样本图（2026-09-06 当日 ranking.php 榜单提取，经代理确认 200）
const SAMPLE_IMG =
  "/c/480x960/img-master/img/2026/09/04/20/30/05/149268713_p0_master1200.jpg";
// Pixez host.json 内置的 app-api/oauth 自建边缘 IP + 本机实测 s.pximg 边缘
const PIXIV_EDGE_CANDIDATES = ["210.140.139.155", "210.140.139.131", "210.140.139.134"];
const CLOUDFLARE_APPAPI_IP = "104.18.42.239"; // 境外 DoH 解析 app-api.pixiv.net 所得
const PXIMG_EDGE = "210.140.139.131";
const POLLUTED_APPAPI_IP = "74.86.118.24"; // 2026-09-06 国内 DoH 返回的假 IP（基线用）
const PROXY = "http://127.0.0.1:10808"; // 仅 I0 基线对照用

const results = [];
function record(id, desc, verdict, detail) {
  results.push({ id, desc, verdict, detail });
  const mark = verdict === "PASS" ? "✅" : verdict === "FAIL" ? "❌" : "⚠️ ";
  console.log(`${mark} ${id.padEnd(4)} ${desc}`);
  for (const line of String(detail).split("\n")) console.log(`       ${line}`);
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

// ── TLS + 裸 HTTP/1.1 直连探测（ip 钉死，servername 控制是否发 SNI）────────
function httpsProbe({ ip, host, servername, method = "GET", path = "/", headers = {}, body = null, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { try { socket.destroy(); } catch { /* ignore */ } resolve({ error: "timeout" }); }, timeoutMs);
    const chunks = [];
    let stage = "tcp";
    let socket;
    const done = (r) => { clearTimeout(timer); try { socket.destroy(); } catch { /* ignore */ } resolve(r); };
    try {
      socket = tls.connect({ host: ip, port: 443, servername, rejectUnauthorized: false });
    } catch (e) {
      return done({ error: `tls-init: ${e.message}` });
    }
    socket.on("secureConnect", () => {
      stage = "http";
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
      const req =
        `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${APP_UA}\r\n` +
        `Accept: */*\r\nConnection: close\r\n${extra ? extra + "\r\n" : ""}`;
      socket.write(body ? `${req}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}` : `${req}\r\n`);
    });
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      const idx = buf.indexOf("\r\n\r\n");
      const head = idx < 0 ? buf.toString("latin1") : buf.slice(0, idx).toString("latin1");
      const bodyBuf = idx < 0 ? Buffer.alloc(0) : buf.slice(idx + 4);
      const m = head.match(/^HTTP\/[\d.]+ (\d{3})/);
      done(m
        ? { status: +m[1], bodyBytes: bodyBuf.length, sha: sha256(bodyBuf), snippet: bodyBuf.subarray(0, 160).toString("utf8").replace(/\s+/g, " ") }
        : { error: `bad-response: ${head.slice(0, 80)}` });
    });
    socket.on("timeout", () => done({ error: `timeout@${stage}` }));
    socket.on("error", (e) => {
      const code = e.code || e.message || "unknown";
      done({ error: code === "ECONNRESET" && stage === "tcp" ? "RST@TLS握手（疑似GFW按SNI重置）" : code === "ECONNRESET" || code === "EPIPE" ? `RST@${stage}` : code });
    });
  });
}

// ── 明文 HTTP/80 直连探测（无 TLS → 无 SNI 可拦）────────────────────────
function httpProbe({ ip, host, path = "/", timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(() => { socket.destroy(); resolve({ error: "timeout" }); }, timeoutMs);
    let socket;
    const done = (r) => { clearTimeout(timer); try { socket.destroy(); } catch { /* ignore */ } resolve(r); };
    socket = net.connect({ host: ip, port: 80 });
    socket.on("connect", () =>
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${APP_UA}\r\nReferer: ${REFERER}\r\nAccept: */*\r\nConnection: close\r\n\r\n`));
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      const m = buf.toString("latin1").match(/^HTTP\/[\d.]+ (\d{3})/);
      done(m ? { status: +m[1], bodyBytes: Math.max(0, buf.length - buf.indexOf("\r\n\r\n") - 4), sha: sha256(buf.slice(buf.indexOf("\r\n\r\n") + 4)) } : { error: "bad-response" });
    });
    socket.on("error", (e) => done({ error: e.code || e.message }));
  });
}

// 经代理基线（唯一走梯的探测项）
function viaProxy(url) {
  try {
    const out = execFileSync("curl", ["-x", PROXY, "-s", "--max-time", "20", url, "-H", `Referer: ${REFERER}`, "-H", `User-Agent: ${APP_UA}`], { maxBuffer: 20 * 1024 * 1024 });
    return { status: 200, bodyBytes: out.length, sha: sha256(out) };
  } catch (e) {
    return { error: `curl-exit-${e.status ?? "?"}（代理未开？）` };
  }
}

// QUIC 版本协商探测：发伪造 Initial（version=0x0a0a0a0a 强制触发 VN），收到任何 UDP 响应即通路开放
function quicVnProbe(ip, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const dcid = crypto.randomBytes(8);
    const scid = crypto.randomBytes(8);
    const pkt = Buffer.concat([
      Buffer.from([0xc0]),
      Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]),
      Buffer.from([dcid.length]), dcid,
      Buffer.from([scid.length]), scid,
    ]);
    const timer = setTimeout(() => { try { sock.close(); } catch { /* ignore */ } resolve({ error: "no-response（UDP 被丢弃或无 QUIC 服务）" }); }, timeoutMs);
    sock.on("message", (msg) => {
      clearTimeout(timer);
      const isVn = msg.length > 5 && (msg[0] & 0x80) !== 0 && msg[1] === 0 && msg[2] === 0 && msg[3] === 0 && msg[4] === 0;
      try { sock.close(); } catch { /* ignore */ }
      resolve({ response: `${msg.length}B ${isVn ? "（Version Negotiation）" : "（未知包型）"}` });
    });
    sock.send(pkt, 443, ip, (e) => { if (e) { clearTimeout(timer); try { sock.close(); } catch { /* ignore */ } resolve({ error: e.message }); } });
  });
}

// ── 边缘探测辅助：候选 IP 逐个试，421/403 = vhost 不在此边缘（跳过），瞬时抖动重试一轮
async function probeEdge(candidates, buildProbe) {
  for (let pass = 0; pass < 2; pass++) {
    const wrongEdge = [];
    for (const ip of candidates) {
      const r = await buildProbe(ip);
      if (r.status && ![421, 403].includes(r.status)) return { ip, ...r };
      if (r.status) wrongEdge.push(`${ip}→${r.status}`);
    }
    if (pass === 0 && wrongEdge.length) console.log(`       [pass0 边缘探测未命中: ${wrongEdge.join(", ")}，重试一轮]`);
  }
  return null;
}

const lookupIp = (host) => new Promise((r) => dns.lookup(host, (e, a) => r(e ? null : a)));
const resolve4All = (host) => new Promise((r) => dns.resolve4(host, (e, a) => r(e ? [e.code] : a)));

// ════════════════════════════ 测试矩阵 ════════════════════════════
console.log("── DNS 层 ───────────────────────────────────────────────");
const dnsSpximg = await resolve4All("s.pximg.net");
record("D1", "系统 DNS 解析 s.pximg.net", dnsSpximg.join(",").includes("210.140.139") ? "PASS" : "FAIL",
  `未被污染，真实 IP: ${dnsSpximg.slice(0, 4).join(", ")}${dnsSpximg.length > 4 ? " …" : ""}`);
const dnsAppapi = await resolve4All("app-api.pixiv.net");
record("D2", "系统 DNS 解析 app-api.pixiv.net", dnsAppapi.join(",").match(/210\.140\.139|^104\./) ? "WARN" : "PASS",
  `污染确认（假 IP，非 Pixiv 段）: ${dnsAppapi.slice(0, 3).join(", ")}`);

console.log("\n── 图片层（真实样本图 + Referer）────────────────────────");
const base = viaProxy(`https://i.pximg.net${SAMPLE_IMG}`);
record("I0", "基线：经代理拉 i.pximg.net（唯一走梯项）", base.status === 200 ? "PASS" : "WARN",
  base.status ? `200, ${base.bodyBytes}B, sha=${base.sha}` : base.error);

const i1ip = await lookupIp("s.pximg.net");
const i1 = i1ip ? await httpsProbe({ ip: i1ip, host: "s.pximg.net", path: SAMPLE_IMG, headers: { Referer: REFERER } }) : { error: "dns-lookup-failed" };
record("I1", "直连 HTTPS s.pximg.net（系统 DNS，换 host）", i1.status === 200 ? "PASS" : "FAIL",
  i1.status ? `200, ${i1.bodyBytes}B, sha=${i1.sha}${i1.sha === base.sha ? " =与基线一致" : " ⚠️ 与基线不同"}` : i1.error);

const i3 = await httpProbe({ ip: PXIMG_EDGE, host: "i.pximg.net", path: SAMPLE_IMG });
record("I3", "直连明文 HTTP i.pximg.net（80 端口）", i3.status === 200 ? "PASS" : "FAIL",
  i3.status ? `200, ${i3.bodyBytes}B, sha=${i3.sha}${i3.sha === base.sha ? " =与基线一致" : ""}` : i3.error);

const i4 = await httpsProbe({ ip: PXIMG_EDGE, host: "i.pximg.net", servername: undefined, path: SAMPLE_IMG, headers: { Referer: REFERER } });
record("I4", "直连 HTTPS i.pximg.net 无 SNI（Pixez compat 路线）", i4.status === 200 ? "PASS" : "FAIL",
  i4.status ? `200, ${i4.bodyBytes}B, sha=${i4.sha}${i4.sha === base.sha ? " =与基线一致" : ""}` : i4.error);

const i5 = await new Promise((resolve) => {
  const buf = [];
  const timer = setTimeout(() => resolve({ error: "timeout" }), 8000);
  const s = tls.connect({ host: "i.pixiv.re", port: 443, servername: "i.pixiv.re", rejectUnauthorized: false }, () => {
    s.write(`GET ${SAMPLE_IMG} HTTP/1.1\r\nHost: i.pixiv.re\r\nUser-Agent: ${APP_UA}\r\nReferer: ${REFERER}\r\nConnection: close\r\n\r\n`);
  });
  s.on("data", (d) => buf.push(d));
  s.on("end", () => {
    clearTimeout(timer);
    const m = Buffer.concat(buf).toString("latin1").match(/^HTTP\/[\d.]+ (\d{3})/);
    resolve(m ? { status: +m[1] } : { error: "bad-response" });
  });
  s.on("error", (e) => { clearTimeout(timer); resolve({ error: e.code || e.message }); });
});
record("I5", "社区镜像 i.pixiv.re 直连（用户现成通路）", i5.status === 200 ? "PASS" : "FAIL",
  i5.status ? `200（样本路径可取）` : JSON.stringify(i5.error ?? i5));

console.log("\n── API 层（app-api.pixiv.net，GET /v1/illust/detail 无鉴权）");
const a1 = await httpsProbe({ ip: POLLUTED_APPAPI_IP, host: "app-api.pixiv.net", servername: "app-api.pixiv.net", path: "/v1/illust/detail?illust_id=1" });
record("A1", "API 基线：假 IP + 正常 SNI（复现封锁）", a1.status ? "WARN(意外)" : "PASS",
  a1.status ? `意外拿到 HTTP ${a1.status}` : a1.error);

let a2 = await probeEdge(PIXIV_EDGE_CANDIDATES, (ip) =>
  httpsProbe({ ip, host: "app-api.pixiv.net", servername: undefined, path: "/v1/illust/detail?illust_id=1", headers: { Referer: REFERER } }));
record("A2", "API 免梯：无 SNI + 静态 IP（Pixez compat）", a2 ? "PASS" : "FAIL",
  a2 ? `边缘 ${a2.ip} → HTTP ${a2.status}, ${a2.bodyBytes}B | ${a2.snippet.slice(0, 90)}` : "候选 IP 全部无 HTTP 响应");

const a3 = await httpsProbe({ ip: PIXIV_EDGE_CANDIDATES[0], host: "app-api.pixiv.net", servername: "app-api.pixiv.net", path: "/" });
record("A3", "API 对照：同 IP 带 pixiv SNI（证明 SNI 是封锁点）", a3.status ? "WARN(居然通了)" : "PASS",
  a3.status ? `HTTP ${a3.status}` : a3.error);

const a4 = await httpsProbe({ ip: CLOUDFLARE_APPAPI_IP, host: "app-api.pixiv.net", servername: undefined, path: "/v1/illust/detail?illust_id=1" });
record("A4", "API 免梯备选：Cloudflare IP + 无 SNI", a4.status ? "PASS" : "FAIL",
  a4.status ? `HTTP ${a4.status}（CF 无 SNI 路由结果）, ${a4.bodyBytes}B` : a4.error);

console.log("\n── 登录层（oauth.secure.pixiv.net，假凭证探活）──────────");
const clientTime = `${new Date().toISOString().replace("Z", "+00:00")}`;
const clientHash = crypto.createHash("md5").update(clientTime + HASH_SECRET).digest("hex");
const authBody = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "password", username: "probe-fake@example.com", password: "fake-password-probe", get_secure_url: "1" }).toString();
let h1 = await probeEdge(PIXIV_EDGE_CANDIDATES, (ip) =>
  httpsProbe({
    ip, host: "oauth.secure.pixiv.net", servername: undefined, method: "POST", path: "/auth/token",
    headers: { "X-Client-Time": clientTime, "X-Client-Hash": clientHash, "App-OS": "ios", "App-OS-Version": "18.5", "Content-Type": "application/x-www-form-urlencoded" },
    body: authBody,
  }));
record("H1", "登录免梯：无 SNI 直连 OAuth /auth/token（password grant）", h1 && [400, 401, 403, 404].includes(h1.status) ? "PASS" : "FAIL",
  h1 ? `边缘 ${h1.ip} → HTTP ${h1.status}（端点已处理请求并拒绝假凭证 = 免梯可达）| ${h1.snippet.slice(0, 80)}` : h1 ? `边缘 ${h1.ip} → HTTP ${h1.status}（非预期）` : "候选 IP 全部无 HTTP 响应");

// H2：refresh_token grant —— Pictelio 401 静默刷新的免梯通路（假 token，预期 invalid_grant）
// ⚠️ 实测发现：/auth/token 连发会触发短窗口限频（H1 后立即发 H2 必超时/被拒，单发正常），
// 因此 H1 与 H2 之间必须留冷却窗口
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log("       [冷却 30s：规避 OAuth 端点短窗口限频]");
await sleep(30000);
const authBodyRt = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: "fake-refresh-token-probe", get_secure_url: "1" }).toString();
let h2 = await probeEdge(PIXIV_EDGE_CANDIDATES, (ip) =>
  httpsProbe({
    ip, host: "oauth.secure.pixiv.net", servername: undefined, method: "POST", path: "/auth/token",
    headers: { "X-Client-Time": clientTime, "X-Client-Hash": clientHash, "App-OS": "ios", "App-OS-Version": "18.5", "Content-Type": "application/x-www-form-urlencoded" },
    body: authBodyRt,
  }));
record("H2", "登录免梯：refresh_token 刷新直连（Pictelio 401 契约）", h2 && h2.status === 400 && h2.snippet.includes("invalid_grant") ? "PASS" : "FAIL",
  h2 ? `边缘 ${h2.ip} → HTTP ${h2.status} | ${h2.snippet.slice(0, 80)}` : "候选 IP 全部无 HTTP 响应");

console.log("\n── QUIC / UDP 通路（Shaft 路线前提）────────────────────");
const q1 = await quicVnProbe(CLOUDFLARE_APPAPI_IP);
record("Q1", "UDP 443 → Cloudflare（app-api 现托管地）", q1.response ? "PASS" : "FAIL", q1.response ?? q1.error);
const q2 = await quicVnProbe(PXIMG_EDGE);
record("Q2", "UDP 443 → Pixiv 自建边缘", q2.response ? "PASS" : "FAIL", q2.response ?? q2.error);

console.log("\n════════════════════════ 汇总 ════════════════════════");
const pass = results.filter((r) => r.verdict === "PASS").length;
console.log(`PASS ${pass} / ${results.length}`);
for (const r of results) console.log(`  ${r.verdict.padEnd(4)} ${r.id}  ${r.desc}`);
