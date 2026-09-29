// 代理路径探测模块（研究：docs/research/github-release-upload-acceleration.md 附录 A）
//
// 按 Go 标准库 httpproxy（golang.org/x/net/http/httpproxy）语义判断某个目标 host
// 走直连还是经代理，供发布脚本在上传前打印「本次将走直连/代理」提示。
//
// 关键语义（与 gh CLI 一致，gh 的 http.DefaultTransport → ProxyFromEnvironment）：
//   - 读 HTTP_PROXY/http_proxy、HTTPS_PROXY/https_proxy、NO_PROXY/no_proxy（大小写皆可）。
//   - NO_PROXY 逗号分隔；条目可为 `*`、IPv4、CIDR、IPv6、域名。
//   - 域名匹配「该域名 + 所有子域」；带前导点 `.y.com` 只匹配子域（不匹配 y.com 自身）。
//   - 推论：NO_PROXY 里写 `github.com` 会把 `uploads.github.com` 一并排除代理（子域匹配）。

// 判断 host 是否为 IPv4 字面量
function isIPv4(s) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(s);
}

// IPv4 → 32 位整数
function ipv4ToInt(ip) {
  const [a, b, c, d] = ip.split(".").map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// IPv4 CIDR 前缀匹配（host 必须为 IPv4）
function cidrMatch(host, cidr) {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!isIPv4(base) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const hostInt = ipv4ToInt(host);
  const baseInt = ipv4ToInt(base);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (hostInt & mask) === (baseInt & mask);
}

/**
 * NO_PROXY 单条目是否命中目标 host（httpproxy 语义）。
 * @param {string} host 目标主机名（无端口）
 * @param {string} entry NO_PROXY 条目（已 trim）
 * @returns {boolean}
 */
export function noProxyMatch(host, entry) {
  if (entry === "*") return true;

  // CIDR（仅 IPv4 支持）
  if (entry.includes("/")) {
    return isIPv4(host) && cidrMatch(host, entry);
  }

  // IPv4 精确
  if (isIPv4(entry)) return host === entry;

  // IPv6（剥 []，仅精确字符串匹配；带端口的 IPv6 目标同样按无端口 host 处理）
  if (entry.includes("[") || entry.split(":").length > 2) {
    return host === entry.replace(/^\[|\]$/gu, "");
  }

  // `host:port` 形式：目标 host 无端口（默认 443），带端口条目不匹配
  if (entry.includes(":")) return false;

  // 域名：前导点只匹配子域；无前导点匹配「自身 + 子域」
  const subOnly = entry.startsWith(".");
  const domain = subOnly ? entry.slice(1) : entry;
  if (host === domain) return !subOnly;
  return host.endsWith(`.${domain}`);
}

function parseNoProxy(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 探测目标 host 在给定环境下走直连还是代理。
 *
 * @param {string} host 目标主机名（如 "uploads.github.com"）
 * @param {NodeJS.ProcessEnv} [env] 环境变量（默认 process.env）
 * @returns {{ mode: "direct" | "proxy", proxyUrl?: string, reason: string, noProxyMatch?: string }}
 */
export function probeProxyRouting(host, env = process.env) {
  const entries = parseNoProxy(env.NO_PROXY || env.no_proxy);
  const hit = entries.find((e) => noProxyMatch(host, e));
  if (hit) {
    return {
      mode: "direct",
      reason: `NO_PROXY 命中（NO_PROXY 含 "${hit}"，含子域匹配）`,
      noProxyMatch: hit,
    };
  }

  const httpsProxy = env.HTTPS_PROXY || env.https_proxy;
  // Go httpproxy 语义：https 目标优先 HTTPS_PROXY，未设置时 fallback 到 ALL_PROXY；
  // HTTP_PROXY 只用于 http 目标，不参与 https 判定。
  const allProxy = env.ALL_PROXY || env.all_proxy;
  const proxyUrl = httpsProxy || allProxy;
  if (proxyUrl) {
    return {
      mode: "proxy",
      proxyUrl,
      reason: `检测到 ${httpsProxy ? "HTTPS_PROXY" : "ALL_PROXY"} = ${proxyUrl}`,
    };
  }

  return { mode: "direct", reason: "未配置代理环境变量" };
}

/**
 * 单行人类可读描述（上传前打印用）。
 * @param {string} [host]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function describeUploadRouting(host = "uploads.github.com", env = process.env) {
  const r = probeProxyRouting(host, env);
  return r.mode === "direct" ? `直连（${r.reason}）` : `经代理 ${r.proxyUrl}（${r.reason}）`;
}
