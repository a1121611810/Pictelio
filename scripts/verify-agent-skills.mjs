#!/usr/bin/env node
// T0.5 门禁：校验仓库级 .agents/skills/ 的格式与关键内容，防漂移（机制借鉴 DSH verify-skill-invocation-metadata，
// 见 docs/research/deepseek-harness-agents-analysis.md §6.1「T0.5 层」）。
// 校验内容：
//   - 每个 skill 目录必须含 SKILL.md，frontmatter 合法
//   - frontmatter name 必须与目录名一致（加载匹配依赖此约定）
//   - frontmatter 必须含 description
//   - 指定 skill 必须包含关键段落标记（防 oracle check 被删/漂移）
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const skillsRoot = join(root, ".agents", "skills");

// 目录名 → 必须出现的子串（维护：新增关键检查段落时在此登记）
const REQUIRED_MARKERS = {
  "code-review": [
    "Oracle check",
    "Test strength",
    "期望值",
    "调用点完备性",
    "机器防线",
  ],
};

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return meta;
}

const errors = [];
if (!existsSync(skillsRoot)) {
  console.log("verify-agent-skills: .agents/skills 不存在，跳过");
  process.exit(0);
}

const dirs = readdirSync(skillsRoot)
  .filter((d) => statSync(join(skillsRoot, d)).isDirectory())
  .sort();

for (const dir of dirs) {
  const skillFile = join(skillsRoot, dir, "SKILL.md");
  if (!existsSync(skillFile)) {
    errors.push(`[${dir}] 缺少 SKILL.md`);
    continue;
  }
  const text = readFileSync(skillFile, "utf-8");
  const meta = parseFrontmatter(text);
  if (!meta) {
    errors.push(`[${dir}] frontmatter 缺失或格式非法（需 --- 包裹的 YAML 头）`);
    continue;
  }
  if (!meta.name) {
    errors.push(`[${dir}] frontmatter 缺少 name`);
  } else if (meta.name !== dir) {
    errors.push(`[${dir}] frontmatter name 与目录名不一致: ${meta.name}`);
  }
  if (!meta.description) errors.push(`[${dir}] frontmatter 缺少 description`);

  const markers = REQUIRED_MARKERS[dir];
  if (markers) {
    for (const mk of markers) {
      if (!text.includes(mk)) errors.push(`[${dir}] 缺少关键段落标记: ${mk}`);
    }
  }
}

if (errors.length > 0) {
  console.error("verify-agent-skills: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`verify-agent-skills: OK (${dirs.length} skills)`);
