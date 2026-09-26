// ─── i18n 死键门禁（spec #734 code-review F2 引入；防字典污染）───
//
// 背景：F2 review 发现 novelIntro.actionBookmark / novelIntro.actionBookmarked
// 在 zh-CN/en misc.ts 中定义但全仓无任何代码引用——收藏按钮走 BookmarkButton
// 自管 i18n，介绍页没有独立「收藏/已收藏」文案需求。死键堆积会污染字典、
// 误导未来 review（"这里有 key 必然有 caller"反推会出错）。
//
// oracle：字典 vs 源码双向比对——字典中每个 i18n key 必须至少在源码中作为
// `t('key')` / `tt('key')` / `i18n.key` / `ttKey('key')` 调用字面量出现一次。
// 实现策略：1) TS 编译器 API 抽 zh-CN/misc.ts 与 en/misc.ts 中「value 为
// 字符串字面量的顶层属性名」；2) 把 src/ 下所有 .ts/.vue 内容拼成单 buffer
//（排除 i18n/locales/** 防自指），`.includes(key)` 判定是否被引用。
//
// 例外豁免：本期仅扫描 misc.ts（zh-CN/en）。项目当前 i18n 字典拆分在
// misc.ts / pages.ts / novelTranslate.ts / time.ts / error.ts 五个文件，
// F2 死键所在文件恰好是 misc.ts；未来扩到多文件时改 MISC_FILES 列表即可。
//
// 解析器/检测逻辑约定：
// - 只抽「顶层 const 字面量中 value 为字符串字面量（含 no-substitution
//   template）的 PropertyAssignment」——天然排除嵌套对象、数字/布尔属性、
//   注释与 import 字符串。
// - 字符串里的花括号（{{name}}）由 TS AST 正确解析，无须手工处理。
// - 源 buffer 含注释（粗扫），但 i18n key 含 `.` 且与注释语境碰撞概率极低；
//   当前 dead key 全部零命中，故不做注释剥离。若未来出现误判再升级。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const pkgRoot = path.resolve(__dirname, "..");
const SRC = path.resolve(pkgRoot, "src");
const MISC_FILES = [
  path.join(SRC, "i18n/locales/zh-CN/misc.ts"),
  path.join(SRC, "i18n/locales/en/misc.ts"),
];

/** 剥 as / satisfies / type-assertion / 括号包装，还原到最内层表达式 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let cur = node;
  while (true) {
    if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
    } else {
      return cur;
    }
  }
}

/** 从 misc.ts 源里抽「顶层 const 字面量中 value 为字符串字面量的属性名」 */
function extractStringKeysFromSource(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer) continue;
      const obj = unwrapExpression(decl.initializer);
      if (!ts.isObjectLiteralExpression(obj)) continue;
      for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (!ts.isStringLiteral(prop.name)) continue;
        // value 必须是字符串字面量或 no-substitution 模板字面量
        if (!ts.isStringLiteralLike(prop.initializer)) continue;
        keys.push(prop.name.text);
      }
    }
  }
  return keys;
}

/** 从 misc.ts 文件抽 i18n key 列表（顶层字符串属性） */
function extractStringKeys(filePath: string): string[] {
  return extractStringKeysFromSource(fs.readFileSync(filePath, "utf-8"));
}

/** 拼 src/ 下所有 .ts/.vue 源码为单 buffer，排除 i18n/locales/**（防自指） */
function dumpSourceExcludingLocales(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const rel = path.relative(SRC, p).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (rel === "i18n/locales" || rel.startsWith("i18n/locales/")) continue;
        walk(p);
      } else if (/\.(ts|vue|tsx)$/.test(entry.name)) {
        parts.push(fs.readFileSync(p, "utf-8"));
      }
    }
  };
  walk(SRC);
  return parts.join("\n");
}

describe("i18n 死键门禁（spec #734 code-review F2；misc.ts vs 源码双向比对）", () => {
  // ── 解析器自检 4 case ──

  it("空字典 → 0 dead keys（解析器自检）", () => {
    const stub = "const x = {} as const;\nexport default x;\n";
    expect(extractStringKeysFromSource(stub)).toEqual([]);
  });

  it("全部引用 → 0 dead keys（解析器自检）", () => {
    const stub = [
      "const x = {",
      '  "foo.bar": "baz",',
      '  "qux.quux": "corge",',
      "} as const;",
      "",
    ].join("\n");
    const source = "t('foo.bar'); tt('qux.quux');";
    const dead = extractStringKeysFromSource(stub).filter((k) => !source.includes(k));
    expect(dead).toEqual([]);
  });

  it("部分死键 → 列出 dead key（解析器自检）", () => {
    const stub = [
      "const x = {",
      '  "alive.key": "x",',
      '  "dead.key": "y",',
      "} as const;",
      "",
    ].join("\n");
    const source = "t('alive.key');";
    const dead = extractStringKeysFromSource(stub).filter((k) => !source.includes(k));
    expect(dead).toContain("dead.key");
    expect(dead).not.toContain("alive.key");
  });

  it("字段值非字符串忽略（嵌套对象/数字/布尔 → 不计入 i18n key）", () => {
    const stub = [
      "const x = {",
      '  "string.key": "value",',
      '  nested: { "obj.inner": "should skip" },',
      "  count: 42,",
      "  flag: true,",
      "} as const;",
      "",
    ].join("\n");
    const keys = extractStringKeysFromSource(stub);
    expect(keys).toContain("string.key");
    // 嵌套对象的 inner key（PropertyAssignment 在 ObjectLiteralExpression 内部）
    expect(keys).not.toContain("obj.inner");
    // 非字符串字面量属性（数字/布尔）
    expect(keys).not.toContain("count");
    expect(keys).not.toContain("flag");
  });

  // ── 集成测试：真实 misc.ts vs 真实源码 ──

  it("zh-CN/misc.ts 与 en/misc.ts 中所有 i18n key 至少在 src 内被引用一次", () => {
    const source = dumpSourceExcludingLocales();
    const dead: string[] = [];
    for (const file of MISC_FILES) {
      const localeTag = `${path.basename(path.dirname(file))}/${path.basename(file)}`;
      for (const k of extractStringKeys(file)) {
        if (!source.includes(k)) dead.push(`${localeTag}: ${k}`);
      }
    }
    expect(
      dead,
      `以下 i18n key 在 misc.ts 中定义但 src/ 内无任何代码引用（删除或补 caller）：\n${dead.join("\n")}`,
    ).toEqual([]);
  });
});
