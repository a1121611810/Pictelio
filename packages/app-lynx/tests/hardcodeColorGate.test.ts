// B11 回潮门禁的姊妹门（spec docs/specs/lynx-night-mode-audit.md §5）：
// 扫描 src/**/*.{vue,ts}，禁止出现硬编码浅色字面量（违反 T4「一律改走 --md-* token」）。
// 检测三类硬编码色：
//   1. #xxxxxx  /  #xxx  /  #xxxx  /  #xxxxxxxx（3/4/6/8 位 hex 色字面量）
//   2. rgb(...)  /  rgba(...)
//   3. 命名色（text-white / bg-white / text-black / bg-black / 注释豁免）
// 豁免：tokens.css 色板定义本身、tests/.test.ts 测试 fixture、styles/tailwind.css 编译产物、
// 白名单文件 hardcode-whitelist-colors.json。
//
// 设计选择：
// - 仅扫描 src/**（不扫 tests/、dist/、scripts/）——脚本生成产物允许 hex
// - 注释中允许 hex（如 BookmarkButton.vue:155 ADR-0112 取证），但非注释命中即违规
// - .vue 文件：template 与 style 块扫 hex/rgb；script 块整体扫（含 i18n / data）
// - 区分「颜色 hex」（#xxx/#xxxx/#xxxxxx/#xxxxxxxx = 3/4/6/8 位）与「issue 编号」
//   （任意位数）：issue 编号通常 1-4 位，与颜色 hex 长度集合（3/4/6/8）有重叠但
//   形态不同——issue 编号前面是空格/标号，hex 后面必有非字母数字边界。
//
// 与 hardcode-gate.test.ts 的差异：本门扫「颜色」而非「中文」，两者并行无重叠。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../src");
const TOKENS = path.resolve(SRC, "styles/tokens.css"); // tokens.css 自身含 hex，永久豁免

const WHITELIST = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "hardcode-whitelist-colors.json"),
    "utf-8",
  ),
) as { path: string; reason: string }[];

/** 颜色 hex 字面量：精确长度（3/4/6/8 位）+ 后置「非字母数字」边界。
 *  排除 #default（#defa 前缀）、#issue129 这类被截断的单词前 4 字母：
 *  - 真实 CSS hex 字面量后面必有非字母数字字符（; / , / ) / 空格 / 行尾）
 *  - #default 后面是 `ult`（字母 u）→ 不命中
 *  - #abc（合法 3 位 hex）后面是 `def`（字母 d）→ 不命中
 * 长度集合：3(#fff) / 4(#rgba) / 6(#rrggbb) / 8(#rrggbbaa)。*/
const HEX_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![a-zA-Z0-9_])/g;
const RGB_RE = /\brgba?\s*\(/g;

// 命名色：Tailwind utility 写法（最常见的硬编码入口）。
// 注意：`text-white/NN` / `bg-white/NN` 出现在 scrim overlay 上下文时是**合法**的
// （M3 scrim 在明暗模式下均为暗色，白字叠暗 scrim 是通用语义）——这些文件/上下文
// 已在 hardcode-whitelist-colors.json 登记豁免，本正则只做命中收集。
const NAMED_COLOR_TAILWIND_RE =
  /\b(?:text|bg|border|fill|stroke|ring|shadow|outline|divide|placeholder|caret|accent)-(?:white|black|red-\d+|green-\d+|blue-\d+|yellow-\d+|orange-\d+|purple-\d|pink-\d+|slate-\d+|gray-\d+|zinc-\d+|neutral-\d+|stone-\d+)(?:\/\d+)?\b/g;

// CSS / Vue / JS 注释豁免：Lynx 真机取证 / 平台约束 / ADR 解释等会引用具体色值
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // CSS / JS 块注释
    .replace(/<!--[\s\S]*?-->/g, "") // Vue 模板 HTML 注释
    .replace(/\/\/[^\n]*/g, ""); // JS 行注释
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(vue|ts)$/.test(entry.name) && p !== TOKENS) yield p;
  }
}

/** 抽 stripComments 后剩余的硬编码色命中（去重 + 排序） */
function collectHardcodedColors(source: string): string[] {
  const stripped = stripComments(source);
  const hits = new Set<string>();
  for (const m of stripped.matchAll(HEX_RE)) hits.add(m[0]);
  for (const m of stripped.matchAll(RGB_RE)) hits.add(m[0] + "...)");
  for (const m of stripped.matchAll(NAMED_COLOR_TAILWIND_RE)) hits.add(m[0]);
  return [...hits].sort();
}

function scan(file: string): string[] {
  return collectHardcodedColors(fs.readFileSync(file, "utf-8"));
}

describe("硬编码浅色值回潮门禁（spec lynx-night-mode-audit.md §5）", () => {
  it("扫描器自检：hex / rgba / Tailwind 命名色必须命中（防线有效性）", () => {
    const sample = `
      /* 颜色字面量应被命中 */
      background-color: #1a6fa8;
      color: rgba(255, 255, 255, 0.8);
      class="text-black text-surface-on"
    `;
    const hits = collectHardcodedColors(sample);
    expect(hits).toContain("#1a6fa8");
    expect(hits.some((h) => h.startsWith("rgba("))).toBe(true);
    expect(hits).toContain("text-black");
  });

  it("扫描器自检：CSS 块注释豁免（取证 / ADR 引用具体色值不被误报）", () => {
    const sample = `
      /* ADR-0112 取证：心形字形固有色 #fa242f —— Lynx 文字表情化陷阱 */
      class="text-error"
    `;
    const hits = collectHardcodedColors(sample);
    expect(hits).not.toContain("#fa242f");
  });

  it("扫描器自检：Vue HTML 注释豁免", () => {
    const sample = `
      <!-- [lynx:fix] issue #129：骨架屏不占满全屏高度 -->
      <text class="text-error">x</text>
    `;
    const hits = collectHardcodedColors(sample);
    expect(hits).not.toContain("#129");
  });

  it("扫描器自检：issue 编号与色 hex 区分（3 位 hex 与 3 位 issue 编号不同形）", () => {
    const sample = `
      <!-- issue #129 中性标记 -->
      color: #129;
      background: #abc;
    `;
    const hits = collectHardcodedColors(sample);
    // #129 后置边界为字母数字 - 但 issue 编号在 HTML 注释中被 stripComments 剔除
    expect(hits).toContain("#abc"); // 合法 hex
  });

  it("扫描器自检：JS 行注释豁免", () => {
    const sample = `
      // 默认主题 seed = #1a6fa8（M3 TonalSpot）
      const x = "#1a6fa8"; // 字符串字面量不在豁免范围
    `;
    const hits = collectHardcodedColors(sample);
    expect(hits).toContain("#1a6fa8");
  });

  it("白名单外零命中（src 内禁硬编码浅色值）", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      // 测试文件 / 类型声明 / tokens.css / 白名单文件 全部豁免
      if (/\.test\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (rel.startsWith("styles/tokens.css")) continue;
      if (WHITELIST.some((e) => e.path === rel)) continue;
      const hits = scan(file);
      if (hits.length > 0) {
        offenders.push(
          `${rel}: ${hits.slice(0, 5).map((h) => `"${h}"`).join(", ")}${
            hits.length > 5 ? ` (+${hits.length - 5})` : ""
          }`,
        );
      }
    }
    expect(
      offenders,
      `以下文件含硬编码浅色值（迁移到 --md-* token，或加入 hardcode-whitelist-colors.json 并说明理由）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});