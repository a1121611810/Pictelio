// gv-proto-ext content script（document_start，仅 http://127.0.0.1:18080）
// 职责：
//  1. 页面生命周期打点（navigation timing / DOMContentLoaded / load / SPA 挂载）→ 桥 → logcat
//  2. 桥探针：window.__gv（ping 基准、登录 token 注入、状态上报）
//  3. URL 带 ?__ping=1 时自动跑 300 次 ping RTT 基准并上报 p50/p95
//  4. 登录自动化：/login 页且有注入 token 时自动填充 fluent-textarea 并提交
"use strict";

const T0 = performance.now();
const ms = () => Math.round(performance.now() - T0);

console.log("[gv-ext] content script alive url=" + location.href);

// 无桥探针：title 标记内容脚本存活状态（onTitleChange 委托会打 logcat）
document.title = "CS:injected";

function log(msg) {
  console.log("[gv-ext] send " + msg);
  try {
    browser.runtime.sendNativeMessage("pictelio_proto", { type: "log", msg: `[${ms()}ms] ${msg}` });
    document.title = "CS:msg-ok";
  } catch (e) {
    console.error("[gv-ext] sendNativeMessage failed: " + e);
    document.title = "CS:msg-err:" + (e && e.message ? e.message.slice(0, 60) : e);
  }
}

// ── 1. 生命周期打点 ──
log(`content_script_start url=${location.href} dpr=${window.devicePixelRatio} ua=${navigator.userAgent}`);

document.addEventListener("DOMContentLoaded", () => {
  const nav = performance.getEntriesByType("navigation")[0];
  const t = nav || {};
  log(
    `dom_content_loaded navStart2DCP=${Math.round(t.domContentLoadedEventEnd || -1)} responseEnd=${Math.round(t.responseEnd || -1)} domInteractive=${Math.round(t.domInteractive || -1)}`
  );
});

window.addEventListener("load", () => {
  const imgs = document.images ? document.images.length : -1;
  log(`window_load imgs=${imgs} nodes=${document.getElementsByTagName("*").length}`);
  setTimeout(() => reportState("t+1s"), 1000);
  setTimeout(() => reportState("t+4s"), 4000);
});

// SPA 挂载检测：等 fluent-textarea（登录页）或 feed/nav 特征
function watchSpaMount() {
  const seen = { done: false };
  const obs = new MutationObserver(() => {
    if (seen.done) return;
    const ta = document.querySelector("fluent-textarea");
    const feedish = document.querySelector("[class*=skeleton], [class*=card], [class*=navbar], [class*=nav-], nav");
    if (ta || feedish) {
      seen.done = true;
      obs.disconnect();
      const what = ta ? "login-form" : `element:${feedish.getAttribute("class")?.slice(0, 40)}`;
      log(`spa_mounted via=${what} pathname=${location.pathname}`);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    if (!seen.done) {
      seen.done = true;
      obs.disconnect();
      log(`spa_mount_timeout bodyText=${document.body.innerText.length} nodes=${document.getElementsByTagName("*").length}`);
    }
  }, 15000);
}
watchSpaMount();

function reportState(tag) {
  const imgs = document.images ? document.images.length : -1;
  const loadedImgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0).length;
  const brokenImgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length;
  log(
    `state ${tag} path=${location.pathname} imgs=${imgs} loaded=${loadedImgs} broken=${brokenImgs} bodyText=${document.body.innerText.length}`
  );
}

// ── 2. 桥探针 ──
async function pingBench(n) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const reply = await browser.runtime.sendNativeMessage("pictelio_proto", { type: "ping", t0: Math.round(t) });
    samples.push(performance.now() - t);
    void reply;
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p = (q) => Math.round(samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] * 1000);
  log(`ping_bench n=${n} avg=${avg.toFixed(1)}ms p50=${p(0.5)}us p95=${p(0.95)}us max=${Math.round(samples[samples.length - 1] * 1000)}us`);
}

// 跨源网络探针（background 页宿主权限豁免 CORS；webRequest 注入生效中）
function netProbe(url, method) {
  return browser.runtime
    .sendMessage({ type: "netProbe", url, method })
    .then((reply) => {
      log(`netProbe ${url} → ${JSON.stringify(reply)}`);
      return reply;
    })
    .catch((err) => {
      log(`netProbe ${url} FAILED: ${err}`);
      return { ok: false, error: String(err) };
    });
}

window.__gv = {
  pingBench,
  reportState,
  log,
  netProbe,
  // 登录注入：填 token + 触发 input + 点「登录」
  fillLogin(token) {
    const ta = document.querySelector("fluent-textarea");
    if (!ta) return "no-textarea";
    ta.value = token;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    // 深探针：fluent-textarea 是 FAST 表单关联元素，内层原生 textarea 在 shadow DOM——
    // 兜底同步真实输入事件（若 host 级 input 未驱动 Solid 信号，按钮将保持 disabled）
    const inner = ta.shadowRoot && (ta.shadowRoot.querySelector("textarea") || ta.shadowRoot.querySelector("input"));
    if (inner) {
      inner.value = token;
      inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    setTimeout(() => {
      const buttons = Array.from(document.querySelectorAll("fluent-button"));
      const state = buttons.map((b) => `${(b.textContent || "").trim().slice(0, 12)}:${b.disabled ? "dis" : "en"}`);
      log(`fill_probe values: ta=${ta.value.length}ch inner=${inner ? inner.value.length : "n/a"} buttons=[${state.join(", ")}]`);
      const btn = buttons.find((b) => (b.textContent || "").includes("登录") && !b.disabled);
      if (btn) {
        btn.click();
        log("login_submit clicked");
        return "clicked";
      }
      const anyLogin = buttons.find((b) => (b.textContent || "").includes("登录"));
      if (anyLogin) {
        // 全部 disabled：强发 click（React/Solid disabled 由属性控制，click 事件被吞时兜底）
        anyLogin.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
        log("login_submit force-clicked on disabled button");
        return "force";
      }
      log("login_submit no-button");
      return "no-button";
    }, 300);
    return "filling";
  },
};

// ── 3. 自动探针（URL 参数驱动） ──
const params = new URLSearchParams(location.search);
if (params.has("__probe")) {
  setTimeout(() => netProbe(params.get("__probe")).catch((e) => log("probe_fail " + e)), 5000);
}
if (params.get("__tls") === "1") {
  setTimeout(() => netProbe("https://127.0.0.1:18443/").catch((e) => log("tls_probe_fail " + e)), 5000);
}
if (location.search.includes("__ping=1")) {
  setTimeout(() => pingBench(300).catch((e) => log("ping_bench_fail " + e)), 3000);
}

// ── 5. rAF 帧率基准（跨引擎通用；gfxinfo 看不到 Gecko 自绘合成器的帧） ──
if (location.search.includes("__fps=1")) {
  setTimeout(() => {
    let frames = 0;
    let longFrames = 0;
    let last = performance.now();
    const start = last;
    log("fps_bench_start");
    function tick(t) {
      frames++;
      const dt = t - last;
      if (dt > 32) longFrames++;
      last = t;
      if (t - start < 15000) {
        requestAnimationFrame(tick);
      } else {
        const secs = (t - start) / 1000;
        log(`fps_bench frames=${frames} fps=${(frames / secs).toFixed(1)} long32ms=${longFrames} window=15s`);
      }
    }
    requestAnimationFrame(tick);
  }, 2000);
}

// ── 6. 网关 API RTT 基准（与基线 PixivApi.request 同端点 /v1/novel/follow） ──
if (location.search.includes("__api=1")) {
  setTimeout(async () => {
    const t = [];
    for (let i = 0; i < 10; i++) {
      const s = performance.now();
      const r = await fetch("/pixiv-api/v1/novel/follow", {
        headers: { Authorization: "Bearer " + (window.__gvToken || "") },
      });
      await r.arrayBuffer();
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    log(`api_rtt n=10 p50=${Math.round(t[4])}ms p95=${Math.round(t[8])}ms min=${Math.round(t[0])}ms max=${Math.round(t[9])}ms`);
  }, 8000);
}

// ── 4. 自动登录 ──
async function bridgeCall(payload) {
  // Java 侧回包为 JSON 字符串（JSONObject 直接回包实测回程序列化失败）
  const raw = await browser.runtime.sendNativeMessage("pictelio_proto", payload);
  if (raw == null) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function autoLogin() {
  try {
    const reply = await bridgeCall({ type: "getToken" });
    const token = reply && reply.token;
    if (!token) {
      log("auto_login: no injected token");
      return;
    }
    // 等 SPA 登录页渲染（最多 20s）
    for (let i = 0; i < 100; i++) {
      const ta = document.querySelector("fluent-textarea");
      if (ta && location.pathname === "/login") {
        log(`auto_login filling (attempt ${i})`);
        window.__gv.fillLogin(token);
        return;
      }
      if (location.pathname !== "/login") {
        log(`auto_login skip: already at ${location.pathname}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    log("auto_login timeout: login form never rendered");
  } catch (e) {
    log("auto_login_fail " + e);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(autoLogin, 800));
} else {
  setTimeout(autoLogin, 800);
}
