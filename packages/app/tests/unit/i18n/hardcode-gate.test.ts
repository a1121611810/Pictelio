// B11 回潮门禁（spec docs/specs/i18n.md §6）：AST 扫描 src/**/*.{ts,tsx} 的字符串字面量，
// 剥注释后标 CJK（[一-龥]）。i18n 字典、测试文件、console.* 参数豁免；其余命中即报错，
// 文件级白名单见 hardcode-whitelist.json（迁移期渐进收紧至零容忍——#510 决策）。
// Oracle：无——门禁本身即规范（fail-closed），期望值=白名单快照。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../../../src");
const WHITELIST = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "hardcode-whitelist.json"), "utf-8"),
) as string[];

const CJK = /[一-鿿]/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield p;
  }
}

/** 字符串字面量是否豁免：console.* 参数（开发者面向日志，禁不适用） */
function isConsoleArg(node: ts.Node): boolean {
  const p = node.parent;
  if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
    const obj = p.expression.expression;
    return ts.isIdentifier(obj) && obj.text === "console";
  }
  return false;
}

function scanSource(source: string, kind: ts.ScriptKind): string[] {
  const sf = ts.createSourceFile("sample", source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text;
    } else if (ts.isJsxText(node) && node.text.trim()) {
      // JSX 文本节点（<span>中文</span>）不是 StringLiteral——review P1-2 实证的主向量盲区
      text = node.text;
    }
    if (text !== undefined && CJK.test(text) && !isConsoleArg(node)) {
      hits.push(text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function collectLiterals(file: string): string[] {
  return scanSource(
    fs.readFileSync(file, "utf-8"),
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

describe("i18n 回潮门禁：src 内禁硬编码中文字符串字面量", () => {
  it("扫描器自检：JSX 文本节点与字符串字面量样例必须命中（防线有效性，review P1-2）", () => {
    const sample = [
      'const fallback = "加载失败";',
      "const el = (",
      "  <div>",
      "    <span>暂无内容</span>",
      '    <input placeholder="搜索作品" />',
      "  </div>",
      ");",
    ].join("\n");
    const hits = scanSource(sample, ts.ScriptKind.TSX);
    // 字符串字面量 + JSX 文本节点 + JSX 属性值，三类全命中才算防线有效
    expect(hits).toContain("加载失败");
    expect(hits).toContain("暂无内容");
    expect(hits).toContain("搜索作品");
  });

  it("白名单外零命中", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      // 字典/类型域文件本身就是中文源；测试文件自带的期望文案合法
      if (
        rel.startsWith("i18n/locales/") ||
        /\.test\.(ts|tsx)$/.test(rel) ||
        rel.endsWith(".d.ts")
      ) {
        continue;
      }
      if (WHITELIST.includes(rel)) continue;
      const hits = collectLiterals(file);
      if (hits.length > 0) {
        offenders.push(
          `${rel}: ${hits
            .slice(0, 3)
            .map((h) => `"${h.slice(0, 30)}"`)
            .join(", ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`,
        );
      }
    }
    expect(
      offenders,
      `以下文件含硬编码中文文案（抽取到 i18n 字典，或加入 hardcode-whitelist.json 并说明理由）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
