#!/usr/bin/env node
// ─── OTA 设备 bench CDP 驱动（#256）───
// 连 WebView CDP（adb forward localabstract），注入 mock fetch（把 raw.githubusercontent
// 的 version.json 请求 mock 成含 webBundle.url=127.0.0.1:8899 的响应）+ 触发
// window.pictelioOtaDev.runOtaCheck() —— 原生 install 链路真实跑（验签/解压/pending）。
// 观察 logcat OtaPlugin 标记判定场景结果。
// 用法：node scripts/bench-cdp.mjs <scenario: 1|2|3|4>
import { execSync } from "node:child_process";

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const SERIAL = "emulator-5556";
const PKG = "io.pictelio.app";
const CDP_PORT = 9222;
const OTA_SERVER = "http://127.0.0.1:8899/pictelio-bench"; // 前缀形态（契约：App 拼 -manifest.json 等后缀）

const scenario = process.argv[2] ?? "1";
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
function adb(...args) {
  return sh(`"${ADB}" -s ${SERIAL} ${args.join(" ")}`);
}

/** 找 WebView CDP ws 地址：forward + /json list */
async function connectCdp() {
  const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
  if (!pid) throw new Error(`app 未运行（pidof 空）`);
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  // 等 devtools 就绪
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = await res.json();
      if (targets.length > 0) break;
    } catch {}
    await SLEEP(500);
  }
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page?.webSocketDebuggerUrl)
    throw new Error(`无 CDP target: ${JSON.stringify(targets).slice(0, 200)}`);
  return page.webSocketDebuggerUrl;
}

let msgId = 0;
const pending = new Map();
function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }
    }, 15000);
  });
}

async function evaluate(ws, expression) {
  const r = await cdpSend(ws, "Runtime.evaluate", { expression, returnByValue: true });
  // r = CDP result：r.result 是 RemoteObject（value 在其中）；异常时取 exceptionDetails
  if (r?.exceptionDetails) {
    throw new Error(`evaluate 异常: ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`);
  }
  return r?.result?.value;
}

/** 注入 mock fetch + 触发 runOtaCheck */
async function injectAndTrigger(ws, minWebVersion) {
  const mock = `(() => {
    const URL_PATTERN = "raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json";
    const BODY = JSON.stringify({
      version: "9.9.9",
      url: "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
      ${minWebVersion ? `minWebVersion: "${minWebVersion}",` : ""}
      webBundle: { version: "9.9.9", url: "${OTA_SERVER}" }
    });
    if (!window.__origFetch) window.__origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.indexOf(URL_PATTERN) !== -1) {
        return Promise.resolve(new Response(BODY, { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return window.__origFetch(input, init);
    };
    return "mocked";
  })()`;
  const m = await evaluate(ws, mock);
  console.log(`  mock: ${m}`);
  const t = await evaluate(
    ws,
    `(() => { const h = window.pictelioOtaDev; if (!h) return "no-hook"; void h.runOtaCheck(); return "triggered"; })()`,
  );
  console.log(`  trigger: ${t}`);
  return t;
}

/** 观察 logcat 中 OtaPlugin 标记，返回匹配行 */
function logcat() {
  return adb("logcat", "-d", "-s", "OtaPlugin", "OtaInstaller", "OtaWorker").split("\n");
}

/** 干净基线：清数据（worker 队列/OTA 状态/缓存）→ 重启 app → 等首屏 */
async function resetApp() {
  adb("shell", "pm", "clear", PKG);
  adb("reverse", "tcp:8899", "tcp:8899"); // reverse 是 adb 主机命令，非 shell 命令
  await SLEEP(1500);
  adb("shell", "am", "start", "-n", `${PKG}/.MainActivityWebview`);
  await SLEEP(8000);
  adb("logcat", "-c");
}

/** 轮询等待 logcat 命中任一关键词（worker 异步执行，调度有延迟） */
async function waitForLog(keywords, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = logcat();
    const hit = logs.filter((l) => keywords.some((k) => l.includes(k)));
    if (hit.length > 0) return hit;
    await SLEEP(2000);
  }
  return [];
}

async function main() {
  console.log(`[bench-cdp] 场景${scenario} 启动（pm clear 干净基线）`);
  await resetApp();
  const wsUrl = await connectCdp();
  console.log(`  CDP: ${wsUrl.slice(0, 60)}…`);
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  adb("logcat", "-c");

  if (scenario === "1") {
    // 好包：注入 → 触发 → 期待 install-ok → pending；重启 → adopt
    await injectAndTrigger(ws, undefined);
    await SLEEP(12000);
    const logs = logcat();
    const installOk = logs
      .filter((l) => l.includes("install-ok") || l.includes("prewarm"))
      .slice(-4);
    console.log(`  install 日志:\n${installOk.join("\n") || "（无）"}`);
    const hasPending = logs.some((l) => l.includes("pending"));
    console.log(`  → ${hasPending ? "✅ 已写 pending" : "❌ 未见 pending"}`);
    if (hasPending) {
      console.log("  重启验证 adopt…");
      adb("shell", "am", "force-stop", PKG);
      await SLEEP(1500);
      adb("logcat", "-c");
      adb("shell", "am", "start", "-n", `${PKG}/.MainActivityWebview`);
      await SLEEP(10000);
      const adopt = logcat()
        .filter((l) => l.includes("adopt-pending") || l.includes("applyPointer"))
        .slice(-4);
      console.log(`  adopt 日志:\n${adopt.join("\n") || "（无）"}`);
      const adopted = adopt.some((l) => l.includes("adopt-pending"));
      console.log(`  → ${adopted ? "✅ 场景1 通过：下次启动生效" : "❌ 场景1 失败：未见 adopt"}`);
    }
  } else if (scenario === "2") {
    // 坏签名：篡改服务器 .sig 后触发 → 期待 install-rejected bad-signature
    await injectAndTrigger(ws, undefined);
    const bad = await waitForLog(["bad-signature", "install-rejected"]);
    console.log(`  ${bad.join("\n") || "（无匹配日志）"}`);
    console.log(
      `  → ${bad.some((l) => l.includes("bad-signature")) ? "✅ 场景2 通过：坏签名拒装" : "❌ 场景2 失败"}`,
    );
  } else if (scenario === "3") {
    // 崩包：服务器换成 broken bundle → 触发 → 期待 install-ok → 重启 → rollback
    await injectAndTrigger(ws, undefined);
    const installLogs = await waitForLog(["install-ok"]);
    console.log(`  安装日志: ${installLogs.slice(-2).join(" | ") || "（无）"}`);
    adb("shell", "am", "force-stop", PKG);
    await SLEEP(1500);
    adb("logcat", "-c");
    adb("shell", "am", "start", "-n", `${PKG}/.MainActivityWebview`);
    await SLEEP(15000); // adopt + notifyReady 超时窗口
    const roll = logcat()
      .filter(
        (l) => l.includes("rollback") || l.includes("notifyReady-ignored") || l.includes("回滚"),
      )
      .slice(-5);
    console.log(`  回滚日志:\n${roll.join("\n") || "（无）"}`);
    console.log(
      `  → ${roll.some((l) => l.includes("rollback")) ? "✅ 场景3 通过：崩包 10s 回滚" : "❌ 场景3 失败"}`,
    );
  } else if (scenario === "4") {
    // 门槛：minWebVersion=99.0.0 → 触发 → 期待 gate 自愈（install 尝试）
    await injectAndTrigger(ws, "99.0.0");
    await SLEEP(12000);
    const logs = logcat();
    const gate = logs
      .filter(
        (l) =>
          l.includes("install-ok") ||
          l.includes("门槛") ||
          l.includes("gate") ||
          l.includes("自愈"),
      )
      .slice(-5);
    console.log(`  门槛日志:\n${gate.join("\n") || "（无）"}`);
    const selfHeal = logs.some((l) => l.includes("install-ok"));
    console.log(`  → ${selfHeal ? "✅ 场景4 通过：门槛命中 → 自愈下载成功" : "❌ 场景4 失败"}`);
  }
  ws.close();
  console.log("[bench-cdp] 完成");
}

main().catch((e) => {
  console.error("[bench-cdp] 失败:", e.message);
  process.exit(1);
});
