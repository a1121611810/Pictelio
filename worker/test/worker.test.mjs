// Worker 合约测试（ADR-0146 D2）——node:test 内置运行：node --test worker/test/
//
// oracle 溯源：
// - 前缀路由映射（/api/* → app-api.pixiv.net、/oauth/* → oauth.secure.pixiv.net）
//   = ADR-0146 D2 合约表（App 侧 ApiEndpoints 拼接 <base>/api、<base>/oauth 的对偶）；
// - 头透传（Authorization/X-Client-Time 原样上行）+ hop-by-hop 剥离 = HTTP 代理标准；
// - 上游错误 502 透传 = 禁静默降级（ADR-0146「错误带状态码透传」）。
//
// 手段：stub globalThis.fetch 捕获上游调用（URL/method/headers/body），
// 不发真实网络；认证头使用假值（合约断言不需要真实凭据）。
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const WORKER_BASE = "https://pictelio-api-proxy.test";

/** 上游调用捕获器：替换 globalThis.fetch，记录每次上游请求 */
function stubUpstream(responder) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = {};
    if (init?.headers) {
      for (const [k, v] of new Headers(init.headers)) headers[k.toLowerCase()] = v;
    }
    let body;
    if (init?.body && typeof init.body !== "string") {
      body = await new Response(init.body).text();
    } else {
      body = init?.body ?? null;
    }
    calls.push({ url, method, headers, body });
    return responder(calls.length, calls[calls.length - 1]);
  };
  return calls;
}

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("合约：/api/* 映射到 app-api.pixiv.net，查询串与 Authorization 透传", async () => {
  const calls = stubUpstream(() => new Response(JSON.stringify({ ok: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

  const req = new Request(`${WORKER_BASE}/api/v1/illust/follow?limit=30&x=1`, {
    headers: { authorization: "Bearer abc123", "app-os": "ios" },
  });
  const resp = await worker.fetch(req);

  assert.equal(resp.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app-api.pixiv.net/v1/illust/follow?limit=30&x=1");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.authorization, "Bearer abc123");
  assert.equal(calls[0].headers["app-os"], "ios");
  // hop-by-hop 头剥离（host 由 fetch 按上游 URL 重写，不得透传伪造值）
  assert.equal(calls[0].headers.host, undefined);
});

test("合约：/oauth/* 映射到 oauth.secure.pixiv.net，POST 体透传", async () => {
  let captured;
  stubUpstream(() => new Response(JSON.stringify({
    access_token: "at", refresh_token: "rt",
  }), { status: 200 }));

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    // handler 透传 request.body（ReadableStream）：读出流内容再断言
    const bodyStream = init?.body;
    captured = {
      url,
      method: init?.method,
      body: typeof bodyStream === "string" ? bodyStream
        : bodyStream ? await new Response(bodyStream).text() : null,
    };
    return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), {
      status: 200,
    });
  };

  const resp = await worker.fetch(new Request(`${WORKER_BASE}/oauth/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=tok",
  }));

  assert.equal(resp.status, 200);
  assert.equal(captured.url, "https://oauth.secure.pixiv.net/auth/token");
  assert.equal(captured.method, "POST");
  assert.equal(captured.body, "grant_type=refresh_token&refresh_token=tok");
});

test("合约：未知路径 404（不转发任何上游）", async () => {
  const calls = stubUpstream(() => new Response("x", { status: 200 }));
  const resp = await worker.fetch(new Request(`${WORKER_BASE}/other/path`));
  assert.equal(resp.status, 404);
  assert.equal(calls.length, 0);
});

test("合约：上游 4xx 状态码与体原样透传（禁吞不降级）", async () => {
  stubUpstream(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  const resp = await worker.fetch(new Request(`${WORKER_BASE}/oauth/auth/token`, {
    method: "POST",
    body: "grant_type=refresh_token&refresh_token=bad",
  }));
  assert.equal(resp.status, 400);
  assert.match(JSON.stringify(await resp.json()), /invalid_grant/);
});

test("合约：上游异常 → 502 + 原因透传", async () => {
  stubUpstream(() => {
    throw new Error("connect timeout");
  });
  const resp = await worker.fetch(new Request(`${WORKER_BASE}/api/v1/illust/1`));
  assert.equal(resp.status, 502);
  assert.match(await resp.text(), /connect timeout/);
});
