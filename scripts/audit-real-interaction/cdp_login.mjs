#!/usr/bin/env node
// 经 CDP 在登录页注入 refresh_token 并点击登录（#362 体检重登用）
// 用法: node cdp_login.mjs <serial>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEV = process.argv[2] ?? "emulator-5554";
const PKG = "io.pictelio.app";
const CDP_PORT = 9333;

const adb = (...a) => execFileSync("adb", ["-s", DEV, ...a], { encoding: "utf8" }).trim();
const envFile = readFileSync(resolve(import.meta.dirname, "../../packages/app/.env"), "utf8");
const token = envFile.match(/^PIXIV_REFRESH_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error(".env 缺 PIXIV_REFRESH_TOKEN");

const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
if (!pid) throw new Error("app 未运行");
adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);

let targets = [];
for (let i = 0; i < 25; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    if (targets.length) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
}
const page = targets.find((t) => t.type === "page") ?? targets[0];
if (!page) throw new Error("无 CDP target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => rej(new Error("cdp timeout")), 20000);
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r?.result?.value;
};

console.log("path:", await ev("location.pathname"));
const injected = await ev(`(() => {
  const find = (root) => {
    const ta = root.querySelector("textarea");
    if (ta) return ta;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) { const hit = find(el.shadowRoot); if (hit) return hit; }
    }
    return null;
  };
  const ta = find(document);
  if (!ta) return "no-textarea";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, ${JSON.stringify(token)});
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.dispatchEvent(new Event("change", { bubbles: true }));
  return "injected";
})()`);
console.log("inject:", injected);
await new Promise((r) => setTimeout(r, 500));
const clicked = await ev(`(() => {
  const btns = [...document.querySelectorAll("button, fluent-button, [role=button]")];
  const b = btns.find((x) => x.textContent?.includes("登录") && !x.textContent?.includes("通过"));
  if (!b) return "no-button:" + btns.map((x) => x.textContent?.trim().slice(0,12)).join("|");
  b.click();
  return "clicked";
})()`);
console.log("click:", clicked);
await new Promise((r) => setTimeout(r, 12000));
console.log("after path:", await ev("location.pathname"));
console.log("body:", (await ev("document.body.innerText.slice(0,120).replace(/\\n/g,' ')")) ?? "");
ws.close();
