/**
 * Pictelio API 反代（ADR-0146）——用户自建 Cloudflare Worker。
 *
 * 合约（D2）：路径前缀路由，单 Worker 双上游
 *   /api/*   → https://app-api.pixiv.net/*
 *   /oauth/* → https://oauth.secure.pixiv.net/*
 * 请求头/体/查询串透传（Host 由 fetch 按上游 URL 重写；hop-by-hop 头剥离）；
 * 响应原样回传；上游错误带状态码透传（禁吞不降级）。
 *
 * 图片不在本合约内：图片走 App 的图床镜像体系（ADR-0143），与反代正交可叠加。
 */

const UPSTREAM = {
  "/api/": "https://app-api.pixiv.net/",
  "/oauth/": "https://oauth.secure.pixiv.net/",
};

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const prefix = Object.keys(UPSTREAM).find((p) => url.pathname.startsWith(p));
    if (!prefix) {
      return new Response(
        "Pictelio API proxy: unknown path. Expected /api/* or /oauth/* (see worker/README.md).",
        { status: 404 },
      );
    }
    const rest = url.pathname.slice(prefix.length).replace(/^\//, "");
    const upstreamUrl = UPSTREAM[prefix] + rest + url.search;

    const headers = new Headers();
    for (const [k, v] of request.headers) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
    }

    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }

    try {
      const resp = await fetch(upstreamUrl, init);
      const respHeaders = new Headers(resp.headers);
      for (const h of HOP_BY_HOP) respHeaders.delete(h);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    } catch (e) {
      // 上游异常（DNS/TLS/超时）：502 + 原因透传（禁静默降级——App 侧按错误态呈现）
      return new Response("Pictelio API proxy upstream error: " + String(e), { status: 502 });
    }
  },
};
