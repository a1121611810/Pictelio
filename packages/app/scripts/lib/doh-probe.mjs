// DoH 端点可达性 + 污染检测探针（research: docs/research/doh-resolver-feasibility-2026-09.md）
//
// 在 GFW 时代验证 DoH 端点是否可用 + 解析结果是否被污染，作为 PixivDns 默认端点
// 选型的依据。用户明示：Quad9 (9.9.9.9) + Cloudflare 1.0.0.1 两个端点都要纳入，
// Cloudflare 1.1.1.1 已知被污染（GFW 时代）做对照，Google 8.8.8.8 做参考。
//
// 测试矩阵：
//   端点 × 域名（app-api.pixiv.net / i.pximg.net / oauth.secure.pixiv.net）
//   每组做 3 项测试：
//     1. HTTPS 连通性（200 / 解析超时）
//     2. JSON 响应 + 含 A 记录
//     3. 解析结果 IP 是否在仓库内置静态表（DirectIpTableDefaults）范围内
//
// 通过标准（来自 docs/research/pixiv-gfw-blocking-and-bypass.md 探针）：
//   - 可达 = HTTPS 200 + JSON 合法 + IP 与内置表匹配（Akamai/Cloudflare 段）
//   - 降级 = HTTPS 200 但 IP 不匹配（可能是更新后的真实 IP，需人工 review）
//   - 不可用 = 连接超时 / TLS 失败 / 响应非 JSON / 解析为 0.0.0.0 等明显污染 IP
//
// 输出：JSON 报告 + 控制台表格 + 探针报告 docs/research/doh-resolver-feasibility-2026-09.md

import { request as undiciRequest } from "node:https";
import { performance } from "node:perf_hooks";

const ENDPOINTS = [
  { name: "Quad9", url: "https://9.9.9.9/dns-query", note: "Quad9 无日志/无 ECS（用户首选）" },
  {
    name: "Cloudflare-1.0.0.1",
    url: "https://1.0.0.1/dns-query",
    note: "Cloudflare 备用（1.1.1.1 被污染，对照）",
  },
  { name: "Cloudflare-1.1.1.1", url: "https://1.1.1.1/dns-query", note: "对照（已知 GFW 污染）" },
  { name: "Google-8.8.8.8", url: "https://8.8.8.8/dns-query", note: "参考" },
];

const TEST_HOSTS = [
  {
    host: "app-api.pixiv.net",
    expectIps: ["210.140.139.155", "210.140.139.154", "210.140.139.156", "210.140.139.157"],
  },
  {
    host: "oauth.secure.pixiv.net",
    expectIps: ["210.140.139.155", "210.140.139.154", "210.140.139.156", "210.140.139.157"],
  },
  {
    host: "i.pximg.net",
    expectIps: ["210.140.139.131", "210.140.139.133", "210.140.139.134", "210.140.139.137"],
  },
  {
    host: "s.pximg.net",
    expectIps: ["210.140.139.133", "210.140.139.134", "210.140.139.135", "210.140.139.137"],
  },
];

const PROBE_TIMEOUT_MS = 8000;

/**
 * 构造 DoH 查询的 URL（GET 形式，RFC 8484 wire format base64url）。
 * 这里用 JSON API 形式（application/dns-json）—— 兼容性更广，不依赖 wireformat。
 */
function buildDohUrl(endpoint, hostname, type = "A") {
  const u = new URL(endpoint);
  u.searchParams.set("name", hostname);
  u.searchParams.set("type", type);
  return u;
}

/**
 * 单次 DoH 查询（GET application/dns-json），返回结构化结果。
 * 走 Node 内置 https.request，避免引入新依赖；HTTP_PROXY 环境变量交给 undici 默认行为。
 */
function probeOnce(endpointUrl, hostname) {
  return new Promise((resolve) => {
    const url = buildDohUrl(endpointUrl, hostname);
    const start = performance.now();

    const req = undiciRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Accept: "application/dns-json",
          "User-Agent": "pictelio-doh-probe/1.0",
        },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const elapsedMs = Math.round(performance.now() - start);
          if (res.statusCode !== 200) {
            return resolve({
              ok: false,
              reason: `HTTP ${res.statusCode}`,
              elapsedMs,
            });
          }
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            return resolve({
              ok: false,
              reason: `响应非 JSON（${body.slice(0, 80)}）`,
              elapsedMs,
            });
          }
          const answers = Array.isArray(json.Answer) ? json.Answer : [];
          const ips = answers
            .filter((a) => a.type === 1 && typeof a.data === "string")
            .map((a) => a.data);
          resolve({ ok: true, ips, elapsedMs, status: json.Status });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      const elapsedMs = Math.round(performance.now() - start);
      resolve({
        ok: false,
        reason: `${err.code || err.name || "Error"}: ${err.message}`,
        elapsedMs,
      });
    });
    req.end();
  });
}

/**
 * 判断解析结果是否"被污染"——典型污染特征：
 *   - 解析为 0.0.0.0 / 127.0.0.1 / RFC1918 内网 IP
 *   - 完全无 Answer
 *   - 解析为明显不属于 Akamai/Cloudflare 段的 IP（需对照 expectIps）
 */
function classifyResult(ips, expectIps) {
  if (ips.length === 0) {
    return { status: "empty", matchedExpect: false };
  }
  const polluted = ips.filter(
    (ip) =>
      ip === "0.0.0.0" || ip === "127.0.0.1" || ip.startsWith("10.") || ip.startsWith("192.168."),
  );
  if (polluted.length > 0) {
    return { status: "polluted", pollutedIps: polluted, matchedExpect: false };
  }
  const matched = ips.some((ip) => expectIps.includes(ip));
  return {
    status: matched ? "ok" : "novel",
    matchedExpect: matched,
    novelIps: matched ? [] : ips,
  };
}

/**
 * 跑完整探针矩阵。
 * @returns {Promise<Array<{endpoint, host, result, classification}>>}
 */
export async function runDohProbe() {
  const rows = [];
  for (const ep of ENDPOINTS) {
    for (const { host, expectIps } of TEST_HOSTS) {
      const result = await probeOnce(ep.url, host);
      const classification = result.ok
        ? classifyResult(result.ips, expectIps)
        : { status: "unreachable", matchedExpect: false };
      rows.push({
        endpoint: ep.name,
        endpointUrl: ep.url,
        endpointNote: ep.note,
        host,
        result,
        classification,
      });
    }
  }
  return rows;
}

/**
 * 汇总哪些端点"主候选可用"——必须满足：
 *   - 至少 1 个测试 host 解析成功且 IP 匹配 expectIps
 *   - 至少 2 个 host 解析成功（避免单点侥幸）
 */
export function summarizeProbe(rows) {
  const byEndpoint = new Map();
  for (const r of rows) {
    if (!byEndpoint.has(r.endpoint)) {
      byEndpoint.set(r.endpoint, {
        name: r.endpoint,
        url: r.endpointUrl,
        note: r.endpointNote,
        okCount: 0,
        novelCount: 0,
        pollutedCount: 0,
        unreachableCount: 0,
        emptyCount: 0,
        totalElapsedMs: 0,
        matchedHosts: [],
        novelHosts: [],
      });
    }
    const agg = byEndpoint.get(r.endpoint);
    agg.totalElapsedMs += r.result.elapsedMs ?? 0;
    switch (r.classification.status) {
      case "ok":
        agg.okCount++;
        agg.matchedHosts.push(r.host);
        break;
      case "novel":
        agg.novelCount++;
        agg.novelHosts.push({ host: r.host, ips: r.result.ips });
        break;
      case "polluted":
        agg.pollutedCount++;
        break;
      case "empty":
        agg.emptyCount++;
        break;
      case "unreachable":
        agg.unreachableCount++;
        break;
    }
  }
  const summary = [...byEndpoint.values()].map((e) => {
    const cloned = Object.assign({}, e);
    cloned.avgElapsedMs = Math.round(cloned.totalElapsedMs / TEST_HOSTS.length);
    cloned.verdict =
      cloned.okCount >= 2 ? "推荐" : cloned.okCount >= 1 ? "降级（部分可用）" : "不可用";
    return cloned;
  });
  return summary;
}

/**
 * 渲染人类可读表格（CLI 输出）。
 */
export function renderProbeTable(rows) {
  const lines = [];
  lines.push("# DoH 端点可达性探针");
  lines.push("");
  lines.push("| 端点 | 测试域名 | 结果 | IP | 分类 | 耗时(ms) |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    const ipStr = r.result.ok ? r.result.ips.join(", ") : "-";
    const statusIcon = {
      ok: "✅",
      novel: "⚠️ novel",
      polluted: "❌ polluted",
      empty: "❌ empty",
      unreachable: "❌ unreachable",
    }[r.classification.status];
    const reason = !r.result.ok ? `（${r.result.reason}）` : "";
    lines.push(
      `| ${r.endpoint} | ${r.host} | ${statusIcon}${reason} | ${ipStr} | ${r.classification.status} | ${r.result.elapsedMs ?? "-"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * CLI 入口：跑探针 + 输出 + 写报告
 */
async function main() {
  const rows = await runDohProbe();
  const summary = summarizeProbe(rows);
  const table = renderProbeTable(rows);

  console.log(table);
  console.log("\n## 汇总\n");
  console.log("| 端点 | ok | novel | polluted | unreachable | empty | 平均耗时 | 判定 |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const s of summary) {
    console.log(
      `| ${s.name} | ${s.okCount} | ${s.novelCount} | ${s.pollutedCount} | ${s.unreachableCount} | ${s.emptyCount} | ${s.avgElapsedMs} | ${s.verdict} |`,
    );
  }
  console.log("\n## 推荐选型\n");
  const recommended = summary.filter((s) => s.verdict === "推荐");
  if (recommended.length === 0) {
    console.log("❌ 无推荐端点——所有 DoH 端点都不可用，必须回退内置 IP 表 + 系统 DNS");
  } else {
    console.log(`✅ 推荐主端点：${recommended[0].name}（${recommended[0].url}）`);
    if (recommended.length >= 2) {
      console.log(`✅ 备用端点：${recommended[1].name}（${recommended[1].url}）`);
    }
  }

  // 写 JSON 报告（机器可读）
  const jsonReport = {
    timestamp: new Date().toISOString(),
    rows,
    summary,
    recommendation: recommended.map((r) => ({ name: r.name, url: r.url })),
  };
  console.log("\n## JSON 报告\n");
  console.log(JSON.stringify(jsonReport, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("探针执行失败：", err);
    process.exit(1);
  });
}
