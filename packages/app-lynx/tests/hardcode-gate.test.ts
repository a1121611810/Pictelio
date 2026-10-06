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
) as { path: string; reason: string }[];

const CJK = /[一-鿿]/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|vue)$/.test(entry.name)) yield p;
  }
}

function isConsoleArg(node: ts.Node): boolean {
  // ⚠️ 模板各片段的**直接父节点不是 console 调用**：TemplateHead 的父是 TemplateExpression，
  //   而 TemplateTail 的父是 TemplateSpan（再上一级才是 TemplateExpression）。
  //   不穿透这一层，`console.log(\`中文 ${x}\`)` 会被判成用户可见文案，而同文件的
  //   `console.log('中文')` 不会 —— 同一批日志两种待遇，纯属检测器形态差异。
  //   实证来源：deliveryProbe 的两条插值日志被判红、单引号日志没被判（同文件同批次）。
  //   与 review P1-2 的属性值盲区同款：检测器把「碰巧没扫到」当成了「不存在」。
  let target: ts.Node = node;
  while (
    target.parent &&
    (ts.isTemplateSpan(target.parent) || ts.isTemplateExpression(target.parent))
  ) {
    target = target.parent;
  }
  const p = target.parent;
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
 *  剥标签会把属性值一并剥掉），再剥插值与标签扫文本节点 */
function collectVueTemplate(source: string): string[] {
  const hits: string[] = [];
  // ⚠️ 必须先剥 HTML 注释，且必须用注释专用正则——不能指望下面的 /<[^>]*>/g。
  // 该正则把 `<!--` 当成标签起点，于是注释内**含 `>` 时**只剥掉 `<!-- …>` 这一段，
  // 剩下的 `… 正文 -->` 落入"文本节点"扫描，被当成硬编码文案（假阳性）。
  // 实证：T12 迁移写入的中文注释里只要有 `:active 表达。 -->` 这类含 `>` 的片段就会触发。
  // 注释不渲染，不是用户可见文案，故应当豁免——与 console 参数豁免同款。
  const noScript = source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "\n");
  const attrRe = /[\w:-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of noScript.matchAll(attrRe)) {
    const v = (m[1] ?? m[2] ?? "").trim();
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

  it("扫描器自检：console 参数豁免对**模板字面量**同样成立（非只对单引号串）", () => {
    // 防「为了让 deliveryProbe 的日志过门禁而放宽检测器」——两条必须同时成立：
    // console 的插值日志豁免，且**非** console 的插值中文照样被抓。
    const src = (code: string): string[] => collectTsLiterals(code, ts.ScriptKind.TS);

    const consoleTpl = src('console.log(`[probe] 已排判定（${n}ms 后）`);');
    expect(consoleTpl).toEqual([]);

    const uiTpl = src('const label = `你有 ${n} 条新通知`;');
    // 插值把一段拆成 head/tail 两段，故断言段数与内容（逐字数组会随 trim 规则变脆）
    expect(uiTpl).toHaveLength(2);
    expect(uiTpl.join("")).toContain("条新通知");

    const uiPlain = src('const label = "你有新通知";');
    expect(uiPlain).toEqual(["你有新通知"]);

    // 与单引号形态对齐：修复前后 console 串的待遇必须一致
    expect(src("console.log('进入前台');")).toEqual(src("console.log(`进入前台`);"))
  });

  it("白名单外零命中", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel.startsWith("i18n/locales/") || /\.test\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts")) {
        continue;
      }
      if (WHITELIST.some((e) => e.path === rel)) continue;
      const hits = scan(file);
      if (hits.length > 0) {
        offenders.push(`${rel}: ${hits.slice(0, 3).map((h) => `"${h}"`).join(", ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`);
      }
    }
    expect(offenders, `以下文件含硬编码中文文案（抽取到 i18n 字典，或加入 hardcode-whitelist.json 并说明理由）：\n${offenders.join("\n")}`).toEqual([]);
  });
});
