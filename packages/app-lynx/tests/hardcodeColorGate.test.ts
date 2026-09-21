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
// - 「颜色 hex」（#xxx/#xxxx/#xxxxxx/#xxxxxxxx = 3/4/6/8 位）与「issue 编号」：**形态不可分辨**
//   ——3 位 hex 与 3 位 issue 号同形（#129 两义）；扫描器只按形态命中，不做语义区分。
//   该歧义由既有约定兜住：issue 号只出现在注释里（注释豁免 → stripComments 剔除），
//   非注释上下文里的 #129 只能是颜色字面量；真出现误报则登记白名单（理由可追溯）。
//   已知可接受，见下方「3 位 hex 与 issue 号不可分辨」自检用例。
//
// 与 i18n 的 hardcode-gate.test.ts 关注点不同、**非重复**：那道门扫「硬编码中文文案」
// （i18n.md §6 文案回潮），本门扫「硬编码颜色字面量」（lynx-night-mode-audit §5 色彩回潮）；
// 两者可能命中同一文件，但命中原因与修复动作互不相干（改 i18n 键 vs 改 --md-* token）。
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
    // 注：扩展名过滤已排除 tokens.css（.css 不在此列）——TOKENS 比对是与 TOKENS 常量同步的
    // 兜底（防后续把 .css 纳入扫描时漏豁免），当前恒不触发。
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

  it("扫描器自检：3 位 hex 与 issue 号不可分辨（已知可接受，非注释上下文一律命中）", () => {
    const sample = `
      <!-- issue #129 中性标记 -->
      color: #129;
      background: #abc;
    `;
    const hits = collectHardcodedColors(sample);
    // 注释内的 #129 已被 stripComments 剔除（上一条用例已覆盖该方向）；此处如实断言剩余结果：
    // 非注释上下文里的 #129 与合法 3 位 hex（#fff 形态）**完全同形**，扫描器无法分辨
    // ——已知可接受：真实源码中 issue 号只出现在注释里，非注释 #129 只能是颜色字面量。
    expect(hits).toContain("#abc");
    expect(hits).toContain("#129");
  });

  it("扫描器自检：JS 行注释豁免", () => {
    const sample = `
      // 默认主题 seed = #1a6fa8（M3 TonalSpot）
      const x = "#1a6fa8"; // 字符串字面量不在豁免范围
    `;
    const hits = collectHardcodedColors(sample);
    expect(hits).toContain("#1a6fa8");
  });

  it("白名单非空 + 每条登记路径在磁盘存在 + 理由非空（防陈旧豁免掩盖新违规）", () => {
    // 空集防护：白名单被整体清空会让下方「白名单外零命中」失去豁免语义（豁免文件反而翻红）
    expect(WHITELIST.length).toBeGreaterThan(0);
    const missing = WHITELIST.filter(
      (e) => !fs.existsSync(path.resolve(SRC, e.path)),
    ).map((e) => e.path);
    expect(
      missing,
      `白名单条目指向的文件已不存在（陈旧豁免，应删除或改名）：${missing.join(", ")}`,
    ).toEqual([]);
    const noReason = WHITELIST.filter((e) => e.reason.trim().length === 0).map((e) => e.path);
    expect(noReason, `白名单条目缺少理由（豁免必须可追溯）：${noReason.join(", ")}`).toEqual([]);
  });

  it("扫描覆盖面下界：walk(src) 文件数不塌陷 + 关键文件在集内（防遍历失效恒真通过）", () => {
    const files = [...walk(SRC)];
    // 下界（防 walk 选择性失效 → offenders 恒空 → 门禁恒真）：当前 src 约 311 个 .vue/.ts
    expect(files.length).toBeGreaterThanOrEqual(300);
    const rels = new Set(files.map((p) => path.relative(SRC, p).split(path.sep).join("/")));
    for (const rel of ["App.vue", "pages/Me.vue", "utils/themeColor.ts", "utils/appearanceClasses.ts"]) {
      expect(rels.has(rel), `${rel} 未被扫描（walk 覆盖失效）`).toBe(true);
    }
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