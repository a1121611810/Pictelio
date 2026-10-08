#!/usr/bin/env node
// ADR 索引生成器（确定性，无模型）——docs/specs/openwiki-retirement.md T5 的保鲜件。
// 用法：node scripts/generate-adr-index.mjs   （ADR 增删或改名后重跑，输出勿手改）
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = "docs/adr";
const OUT = join(ADR_DIR, "README.md");

function walk(dir, base = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name), base + d.name + "/") : [base + d.name],
  );
}
const files = walk(ADR_DIR).filter((f) => f.endsWith(".md") && !f.endsWith("README.md"));

function titleOf(file) {
  const first = readFileSync(join(ADR_DIR, file), "utf8")
    .split("\n")
    .find((l) => l.startsWith("# "));
  return first ? first.replace(/^#\s+/, "").trim() : file;
}

function numOf(file) {
  const m = file.match(/^(?:ADR-)?(\d{4})[-\-：:]/i);
  return m ? Number(m[1]) : null;
}

function klassOf(file) {
  const base = file.split("/").pop();
  if (base.startsWith("glossary-")) return "glossary";
  if (/^\d{4}-/.test(base)) return "legacy";
  if (numOf(base) === null) return "other";
  return "adr";
}

const entries = files.map((f) => ({
  file: f,
  title: titleOf(f),
  num: numOf(f),
  klass: klassOf(f),
}));

// 被引统计：全文检索 ADR-NNNN 引用（排除自身）
const all = Object.fromEntries(
  entries.map((e) => [e.file, readFileSync(join(ADR_DIR, e.file), "utf8")]),
);
const cited = new Map();
for (const e of entries) {
  if (e.klass !== "adr") continue;
  const label = "ADR-" + String(e.num).padStart(4, "0");
  let n = 0;
  for (const [f, body] of Object.entries(all)) {
    if (f === e.file) continue;
    n += (body.match(new RegExp("\\b" + label + "\\b", "g")) ?? []).length;
  }
  if (n > 0) cited.set(label, n);
}
const topCited = [...cited.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 20);

const byKlass = (k) =>
  entries.filter((e) => e.klass === k).toSorted((a, b) => (a.num ?? 9999) - (b.num ?? 9999));
const adr = byKlass("adr");
const glossary = byKlass("glossary");
const legacy = byKlass("legacy");
const other = byKlass("other");

const L = [];
L.push("# ADR 索引", "");
L.push(
  "> 本文件由 scripts/generate-adr-index.mjs 确定性生成，**勿手改**；ADR 增删、改名后重跑该脚本。",
  "",
);
L.push("| 类别 | 数量 |");
L.push("| --- | --- |");
L.push("| 编号 ADR（ADR-NNNN） | " + adr.length + " |");
L.push("| 术语表（glossary-*.md） | " + glossary.length + " |");
L.push("| 遗留编号（0001-0021，无 ADR- 前缀） | " + legacy.length + " |");
L.push("| 其他（迁移计划 / spikes 等） | " + other.length + " |");
L.push("| **合计** | **" + entries.length + "** |", "");
L.push("## 编号 ADR（按编号排序）", "");
for (const e of adr) L.push("- [" + e.file + "](" + e.file + ") — " + e.title);
L.push("", "## 术语表（glossary）", "");
for (const e of glossary) L.push("- [" + e.file + "](" + e.file + ") — " + e.title);
L.push("", "## 遗留编号（0001-0021）", "");
for (const e of legacy) L.push("- [" + e.file + "](" + e.file + ") — " + e.title);
if (other.length) {
  L.push("", "## 其他", "");
  for (const e of other) L.push("- [" + e.file + "](" + e.file + ") — " + e.title);
}
L.push("", "## 被引最多的 ADR（Top 20，全文交叉引用计数）", "");
L.push("| ADR | 被引次数 |");
L.push("| --- | --- |");
for (const [label, n] of topCited) L.push("| " + label + " | " + n + " |");
L.push("", "## 消费规则", "");
L.push("- 读 ADR 前先按本索引对号入座；精确语义以 ADR 正文与源码为准。");
L.push(
  "- 与源码冲突时按 [docs/agents/domain.md](../agents/domain.md)「标记 ADR 冲突」的句式浮出，不静默覆盖。",
);
L.push("- 新增 ADR 后重跑生成脚本；本索引的活性由 AGENTS.md「地图保鲜」自检条目兜底。");
L.push("");
writeFileSync(OUT, L.join("\n"));
console.log(
  "ADR index written: " + entries.length + " files, " + cited.size + " ADRs cited by others",
);
