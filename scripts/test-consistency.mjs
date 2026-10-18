#!/usr/bin/env node
// test-consistency：测试套件一致性度量（flaky 前置统计）
//
// 用途：Google《Flaky Tests at Google》的第一阶段是「重复跑算一致性率」，
//   据此把低一致性的用例移出 gating CI、保留在可靠性套件里继续发现问题。
//   本脚本只做**度量**，不替你定策略——它回答「哪些用例不稳定」，
//   「移不移、移多少」是维护者的决策。
//
// 用法：
//   node scripts/test-consistency.mjs [轮数=5] [工作目录=packages/app-lynx]
//
// 输出：每轮一个 json 到临时目录，汇总后打印「至少失败过一次」的用例与失败率。
// 退出码恒 0 —— 这是**度量**不是**门禁**，不稳定本身不该让 CI 红。
// 要接进 CI 做趋势，需要另开决策（见下方「刻意不做」）。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUNDS = Number(process.argv[2] ?? 5);
const CWD = process.argv[3] ?? "packages/app-lynx";

if (!Number.isInteger(ROUNDS) || ROUNDS < 2) {
  console.error(`轮数须为 ≥2 的整数（1 轮量不出任何一致性），收到 ${process.argv[2]}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "test-consistency-"));
const files = [];

console.error(`跑 ${ROUNDS} 轮 · 工作目录 ${CWD}`);
for (let i = 1; i <= ROUNDS; i++) {
  const out = join(dir, `run-${i}.json`);
  const r = spawnSync("pnpm", ["exec", "vitest", "run", "--reporter=json", `--outputFile=${out}`], {
    cwd: CWD,
    stdio: "ignore",
  });
  if (r.status !== 0 && r.status !== 1) {
    console.error(`第 ${i} 轮 vitest 异常退出（code ${r.status}），中止`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  files.push(out);
  console.error(`  第 ${i} 轮完成`);
}

const stats = new Map();
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  for (const tr of j.testResults ?? []) {
    for (const a of tr.assertionResults ?? []) {
      const key = `${tr.name}::${a.fullName ?? a.title}`;
      if (!stats.has(key)) {
        stats.set(key, { file: tr.name, name: a.fullName ?? a.title, passed: 0, runs: 0 });
      }
      const s = stats.get(key);
      s.runs++;
      if (a.status === "passed") s.passed++;
    }
  }
}

const all = [...stats.values()];
const flaky = all.filter((s) => s.passed < s.runs);

console.log(`轮次: ${ROUNDS}`);
console.log(`用例总数（去重）: ${all.length}`);
console.log(`至少失败过一次的用例: ${flaky.length}`);
console.log(`未在每轮都执行到的用例: ${all.filter((s) => s.runs < ROUNDS).length}`);

if (flaky.length === 0) {
  console.log(`\n✅ 全绿：${all.length} 个用例在每一轮都通过。`);
  console.log("   这**不**等于「不存在 flaky」——见下节样本量说明。");
} else {
  console.log("\n--- 不稳定用例（按失败率降序）---");
  flaky
    .toSorted((a, b) => a.passed / a.runs - b.passed / b.runs)
    .forEach((s) => {
      const pct = Math.round(((s.runs - s.passed) / s.runs) * 100);
      console.log(`  ${String(pct).padStart(3)}% 失败  ${s.runs - s.passed}/${s.runs}  ${s.file}`);
      console.log(`        ${s.name}`);
    });
}

console.log("\n--- 样本量说明（读数前必看）---");
console.log(
  `  · ${ROUNDS} 轮只能发现失败率 ≥${Math.ceil(100 / ROUNDS)}% 的不稳定用例；偶发失败会被漏掉。`,
);
console.log("    Google 的做法是「数百次重复执行」，本仓库的规模下不可行——");
console.log("    本脚本的定位是**粗筛**，不是 flaky 的完备判定。");
console.log("  · 单机单 OS 的结果不代表 CI（ubuntu runner 的 CPU 过订阅量级不同，");
console.log("    时序敏感的用例恰恰在那里才现形）。要覆盖 CI 需接 CI 侧度量。");
console.log("  · 「本轮全绿」的正确读法是「没有可复现的不稳定」，不是「没有不稳定」。");

rmSync(dir, { recursive: true, force: true });
