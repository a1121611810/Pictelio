// gv-proto-ext background script
// 职责：
//  1. webRequest 注入 PoC：对 *.pximg.net / *.pixiv.net 请求注入 Referer + User-Agent，
//     并统计注入次数（ProtoServer.INJ_STATS 经桥同步，或经内容脚本查询）
//  2. 引擎直连网络实验（跨源 fetch，宿主权限豁免 CORS）：
//     netProbe → 任意 URL，返回 status/字节长度/耗时/失败类型
//  3. TLS 校验实验：自签名端点 fetch 必须失败（webRequest.onErrorOccurred 捕获错误码）
"use strict";

let injectedCount = 0;

// ── 1. webRequest 头注入（PoC 核心：无此则 i.pximg.net 一律 403） ──
browser.webRequest.onBeforeSendHeaders.addListener(
  (info) => {
    try {
      const headers = info.requestHeaders || [];
      const idxReferer = headers.findIndex((h) => h.name.toLowerCase() === "referer");
      const idxUa = headers.findIndex((h) => h.name.toLowerCase() === "user-agent");
      if (idxReferer >= 0) headers[idxReferer].value = "https://app-api.pixiv.net/";
      else headers.push({ name: "Referer", value: "https://app-api.pixiv.net/" });
      if (idxUa >= 0) headers[idxUa].value = "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)";
      else headers.push({ name: "User-Agent", value: "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)" });
      injectedCount++;
      return { requestHeaders: headers };
    } catch (e) {
      return {};
    }
  },
  { urls: ["*://*.pximg.net/*", "*://*.pixiv.net/*"] },
  ["blocking", "requestHeaders"]
);

// ── 2/3. 网络探针 ──
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "netProbe") return undefined;
  const t0 = performance.now();
  fetch(msg.url, {
    method: msg.method || "GET",
    cache: "no-store",
    redirect: "follow",
  })
    .then(async (resp) => {
      let len = -1;
      try {
        const buf = await resp.arrayBuffer();
        len = buf.byteLength;
      } catch (e) {
        /* body 读取失败不影响状态判定 */
      }
      sendResponse({
        ok: true,
        status: resp.status,
        bytes: len,
        ms: Math.round(performance.now() - t0),
        finalUrl: resp.url,
        injectedBefore: injectedCount,
      });
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: String(err && err.message ? err.message : err),
        ms: Math.round(performance.now() - t0),
      });
    });
  return true; // 异步 sendResponse
});

// 网络错误归因（TLS 失败等在此暴露引擎侧错误名）
browser.webRequest.onErrorOccurred.addListener(
  (info) => {
    console.log(`[gv-ext] onErrorOccurred url=${info.url} error=${info.error}`);
  },
  { urls: ["<all_urls>"] }
);

console.log("[gv-ext] background started");
