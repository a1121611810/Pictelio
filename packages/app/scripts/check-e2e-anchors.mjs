#!/usr/bin/env node
/**
 * E2E 静态锚点校验（秒级，不跑浏览器）
 *
 * 背景：agent-browser E2E 套件曾因"改了 UI 但没人跑 E2E"漂移 6 天无人发现。
 * 本脚本扫描 tests/agent-browser/specs/ 中引用的测试锚点，与 src/ 源码静态比对：
 *
 * 硬校验（缺失即失败，exit 1）：
 *   - data-testid 引用（data-testid="xxx" / [data-testid="xxx"] / getByTestId("xxx")）
 *   - aria-label 选择器（[aria-label="xxx"] / [aria-label^="xxx"] / [aria-label*="xxx"]）
 *   - placeholder 选择器（[placeholder="xxx"]）
 *   - 路由路径（navigate / navigateSpa / pathname includes|startsWith 的 "/" 开头字面量）
 *   - 元素标签选择器（fluent-textarea、h1、nav 等，校验 src 中存在对应 JSX 标签）
 *
 * 软校验（仅警告，不阻断）：
 *   - CSS class 选择器（.image-card、.floating-nav 等）—— UnoCSS 动态拼 class，
 *     静态检查可能误报，缺失时标记"已知脆，需人工确认"
 *   - clickReliable / clickButtonByText 的关键文本 —— 文本可能由子组件动态拼接，
 *     缺失时同样仅警告
 *
 * 用法：node packages/app/scripts/check-e2e-anchors.mjs（在仓库任意目录执行均可）
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");
const SPEC_DIR = join(APP_ROOT, "tests", "agent-browser", "specs");
const SRC_DIR = join(APP_ROOT, "src");
const ROUTER_FILE = join(SRC_DIR, "router.tsx");

/**
 * 已知故意依赖 catch-all（router.tsx 的 /*all 兜底渲染首页）的路径白名单。
 * 新增"访问不存在路由"类测试时在此登记，并注明原因。
 */
const KNOWN_CATCH_ALL_PATHS = new Map([
  ["/this-route-does-not-exist", "catch-all 回退测试：故意访问不存在的路由"],
  ["/recommended", "历史遗留路径，依赖 catch-all 渲染首页（router.tsx 无此路由）"],
]);

// ─── 文件收集 ───

/** 递归收集目录下匹配扩展名的文件 */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// ─── 锚点提取 ───

/** 计算字符偏移对应的 1-based 行号 */
function lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content[i] === "\n") line++;
  return line;
}

/**
 * @typedef {{ kind: string, value: string, file: string, line: number, detail?: string }} Anchor
 */

/** 从单个 spec 文件内容中提取全部锚点 */
function extractAnchors(file, content) {
  /** @type {Anchor[]} */
  const anchors = [];
  const rel = relative(REPO_ROOT, file);
  const push = (kind, value, offset, detail) => {
    const v = value.trim();
    if (!v) return;
    anchors.push({ kind, value: v, file: rel, line: lineOf(content, offset), detail });
  };

  const scan = (re, fn) => {
    for (const m of content.matchAll(re)) fn(m);
  };

  // 1. data-testid 引用
  scan(/data-testid\s*=\s*["'`]([^"'`]+)["'`]/g, (m) => push("data-testid", m[1], m.index));
  scan(/getByTestId\(\s*["'`]([^"'`]+)["'`]/g, (m) => push("data-testid", m[1], m.index));

  // 2. aria-label 属性选择器（= 精确、^= 前缀、*= 包含，均按"值需在 src 中出现"校验）
  scan(/\[\s*aria-label\s*[~^$|]?=\s*["'`]([^"'`]+)["'`]\s*\]/g, (m) =>
    push("aria-label", m[1], m.index),
  );

  // 3. placeholder 属性选择器
  scan(/\[\s*placeholder\s*=\s*["'`]([^"'`]+)["'`]\s*\]/g, (m) =>
    push("placeholder", m[1], m.index),
  );

  // 4. 路由路径：navigate / navigateSpa 参数，location.pathname 的 includes/startsWith 判断
  const pushRoute = (raw, offset) => {
    // 去掉模板前缀（${BASE} 等）、协议 host、query/hash，只留 pathname
    let p = raw.replace(/^\$\{[^}]*\}/, "").replace(/^https?:\/\/[^/]+/, "");
    p = p.split(/[?#]/)[0];
    if (!p.startsWith("/")) return;
    push("route", p, offset);
  };
  scan(/\bnavigateSpa\(\s*["'`]([^"'`]+)["'`]/g, (m) => pushRoute(m[1], m.index));
  scan(/\bnavigate\(\s*["'`]([^"'`]+)["'`]/g, (m) => pushRoute(m[1], m.index));
  scan(/\.(?:includes|startsWith)\(\s*["'`](\/[^"'`]*)["'`]\s*\)/g, (m) =>
    pushRoute(m[1], m.index),
  );

  // 5. 选择器字符串（waitForSelector / querySelector(All) / click 的第一个字符串参数）。
  //    注意：getAttribute 的第一个参数是属性名（'style'、'data-fit'），不是选择器，不参与扫描。
  //    从中提取元素标签（硬校验）与 class（软校验）
  scan(/(?:waitForSelector|querySelectorAll|querySelector|click)\(\s*["'`]([^"'`]+)["'`]/g, (m) => {
    const sel = m[1];
    // 元素标签：位于选择器起始或组合器之后的 tag token
    for (const tm of sel.matchAll(/(?:^|[\s>+~,])([a-z][a-z0-9-]*)(?=[\s>+~,.#[\]:]|$)/g)) {
      push("element-tag", tm[1], m.index, sel.slice(0, 60));
    }
    // class token（UnoCSS 动态拼接，仅软校验）
    for (const cm of sel.matchAll(/\.([a-z][a-z0-9_-]*)/g)) {
      push("css-class", cm[1], m.index, sel.slice(0, 60));
    }
  });

  // 6. 关键点击文本（软校验）
  scan(/clickReliable\(\s*["'`]([^"'`]+)["'`]/g, (m) => push("key-text", m[1], m.index));
  scan(/clickButtonByText\([^,]+,\s*["'`]([^"'`]+)["'`]/g, (m) => push("key-text", m[1], m.index));

  return anchors;
}

// ─── src 语料与路由表 ───

const srcFiles = walk(SRC_DIR, [".ts", ".tsx", ".css"]);
const srcCorpus = srcFiles.map((f) => readFileSync(f, "utf-8")).join("\n");
const routerSrc = readFileSync(ROUTER_FILE, "utf-8");

/** 从 router.tsx 解析具体路由（排除 *all catch-all） */
const routePatterns = [...routerSrc.matchAll(/path:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => !p.includes("*"));

/** 段级匹配：":id" 段匹配任意非空段；pathname 允许是 pattern 的前缀（如 includes("/novel/") 探测） */
function routeMatches(pattern, pathname) {
  const pp = pattern.split("/").filter(Boolean);
  const sp = pathname.split("/").filter(Boolean);
  if (pattern === "/" && pathname === "/") return true;
  if (sp.length > pp.length) return false;
  return sp.every((seg, i) => pp[i].startsWith(":") || pp[i] === seg);
}

/** 元素标签存在性：JSX 中 <tag 后跟非标识符字符 */
function tagExists(tag) {
  const re = new RegExp("<" + tag + "(?=[\\s/>])");
  return re.test(srcCorpus);
}

// ─── 校验 ───

const specFiles = walk(SPEC_DIR, [".test.ts", ".spec.ts"]).toSorted();
const allAnchors = specFiles.flatMap((f) => extractAnchors(f, readFileSync(f, "utf-8")));

/** @type {Anchor[]} */
const failures = [];
/** @type {Anchor[]} */
const warnings = [];
/** @type {Anchor[]} */
const catchAllNotes = [];

for (const a of allAnchors) {
  switch (a.kind) {
    case "data-testid":
    case "aria-label":
    case "placeholder":
      // 豁免两类误报：① 含 ${ 的模板占位符（如 navTabActiveJs 的 ${label}，非真实锚点）；
      // ② 动态模板生成的 testid（如 ContentTypeToggle 的 `content-type-${opt.key}` 实际
      // 渲染 content-type-novel/illust，src 中是模板字符串，静态 includes 匹配不到）。
      // 这类锚点由真实浏览器回归（pnpm test:agent-browser）验证，静态校验让位。
      if (a.value.includes("${")) break;
      // 动态 testid：src 中存在 data-testid={`<前缀>-...`} 模板（如 content-type-${opt.key}），
      // spec 引用的 content-type-novel/illust 以该前缀开头视为合法（静态匹配不到模板字符串，
      // 由真实浏览器回归验证）。
      const dynMarker = "data-testid={`";
      let dynIdx = srcCorpus.indexOf(dynMarker);
      let isDynamic = false;
      while (dynIdx !== -1) {
        const after = srcCorpus.slice(dynIdx + dynMarker.length, dynIdx + dynMarker.length + 40);
        const prefix = after.split("$")[0].replace(/[^a-zA-Z0-9_-]/g, "");
        if (prefix && a.value.startsWith(prefix)) {
          isDynamic = true;
          break;
        }
        dynIdx = srcCorpus.indexOf(dynMarker, dynIdx + dynMarker.length);
      }
      if (!isDynamic && !srcCorpus.includes(a.value)) failures.push(a);
      break;
    case "route":
      if (routePatterns.some((p) => routeMatches(p, a.value))) break;
      if (KNOWN_CATCH_ALL_PATHS.has(a.value)) {
        catchAllNotes.push(a);
      } else {
        failures.push(a);
      }
      break;
    case "element-tag":
      if (!tagExists(a.value)) failures.push(a);
      break;
    case "css-class":
    case "key-text":
      if (!srcCorpus.includes(a.value)) warnings.push(a);
      break;
  }
}

// ─── 输出 ───

const counts = {};
for (const a of allAnchors) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
console.log(
  `[check-e2e-anchors] 扫描 ${specFiles.length} 个 spec，提取锚点 ${allAnchors.length} 处（` +
    Object.entries(counts)
      .map(([k, n]) => `${k}: ${n}`)
      .join("、") +
    `），src 文件 ${srcFiles.length} 个，具体路由 ${routePatterns.length} 条`,
);

if (catchAllNotes.length > 0) {
  console.log("\n[提示] 以下路径不在 router.tsx 具体路由中，已在 catch-all 白名单登记：");
  for (const a of catchAllNotes) {
    console.log(`  - ${a.value}（${a.file}:${a.line}）—— ${KNOWN_CATCH_ALL_PATHS.get(a.value)}`);
  }
}

if (warnings.length > 0) {
  console.log("\n[警告] 以下脆锚点在 src/ 中未找到（class 可能由 UnoCSS 动态拼接，需人工确认）：");
  for (const a of warnings) {
    const suffix = a.detail ? `（选择器: ${a.detail}）` : "";
    console.log(`  - [${a.kind}] ${a.value}（${a.file}:${a.line}）${suffix}`);
  }
}

if (failures.length > 0) {
  console.error("\n[失败] 以下锚点在 src/ 中已不存在（UI 改动导致 E2E 锚点失效）：");
  for (const a of failures) {
    console.error(`  - [${a.kind}] ${a.value}（${a.file}:${a.line}）`);
  }
  console.error(
    "\n请同步更新 spec 或 src，或先手动运行 pnpm test:agent-browser 确认后修复。" +
      "确认误报可用 git push --no-verify 绕过。",
  );
  process.exit(1);
}

console.log("\n[check-e2e-anchors] 通过：所有硬锚点在 src/ 中存在。");
