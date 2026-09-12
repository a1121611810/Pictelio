// B11 回潮门禁（spec docs/specs/i18n.md §6，副端）：扫描 src/**/*.{ts,vue}。
// .ts 用 TS 编译器 API 抽字符串字面量；.vue = <script> 块同法 + 模板区文本节点/属性值正则扫描。
// 豁免：i18n 字典、测试文件、console.* 参数；文件级白名单 hardcode-whitelist.json（收紧至零容忍——#510）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../src");
const WHITELIST = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "hardcode-whitelist.json"), "utf-8"),
) as string[];

const CJK = /[一-鿿]/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|vue)$/.test(entry.name)) yield p;
  }
}

function isConsoleArg(node: ts.Node): boolean {
  const p = node.parent;
  if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
    const obj = p.expression.expression;
    return ts.isIdentifier(obj) && obj.text === "console";
  }
  return false;
}

function collectTsLiterals(source: string, kind: ts.ScriptKind): string[] {
  const sf = ts.createSourceFile("x", source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      text = node.text;
    if (text !== undefined && CJK.test(text) && !isConsoleArg(node)) hits.push(text.trim());
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** vue 模板区：先扫属性值（静态 placeholder/aria-label/title 等，review P1-2 实证盲区——
 * 剥标签会把属性值一并剥掉），再剥插值与标签扫文本节点 */
function collectVueTemplate(source: string): string[] {
  const hits: string[] = [];
  const noScript = source.replace(/<script[\s\S]*?<\/script>/g, "");
  const attrRe = /[\w:-]+\s*=\s*"([^"]*)"/g;
  for (const m of noScript.matchAll(attrRe)) {
    const v = m[1]?.trim();
    if (v && CJK.test(v)) hits.push(v.slice(0, 40));
  }
  // 剥 {{ ... }} 插值与 < > 标签，剩文本节点
  const textOnly = noScript.replace(/\{\{[\s\S]*?\}\}/g, "").replace(/<[^>]*>/g, "\n");
  for (const line of textOnly.split("\n")) {
    const t = line.trim();
    if (t && CJK.test(t)) hits.push(t.slice(0, 40));
  }
  return hits;
}

function scan(file: string): string[] {
  const source = fs.readFileSync(file, "utf-8");
  if (file.endsWith(".vue")) {
    const m = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    return [...(m ? collectTsLiterals(m[1], ts.ScriptKind.TS) : []), ...collectVueTemplate(source)];
  }
  return collectTsLiterals(source, ts.ScriptKind.TS);
}

describe("i18n 回潮门禁（副端）：src 内禁硬编码中文文案", () => {
  it("扫描器自检：属性值与文本节点样例必须命中（防线有效性，review P1-2）", () => {
    const sample = [
      "<template>",
      '  <input placeholder="搜索作品" />',
      "  <text>暂无内容</text>",
      "</template>",
    ].join("\n");
    const hits = collectVueTemplate(sample);
    expect(hits).toContain("搜索作品");
    expect(hits).toContain("暂无内容");
  });

  it("白名单外零命中", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel.startsWith("i18n/locales/") || /\.test\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts")) {
        continue;
      }
      if (WHITELIST.includes(rel)) continue;
      const hits = scan(file);
      if (hits.length > 0) {
        offenders.push(`${rel}: ${hits.slice(0, 3).map((h) => `"${h}"`).join(", ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`);
      }
    }
    expect(offenders, `以下文件含硬编码中文文案（抽取到 i18n 字典，或加入 hardcode-whitelist.json 并说明理由）：\n${offenders.join("\n")}`).toEqual([]);
  });
});
