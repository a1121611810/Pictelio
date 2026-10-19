import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_NAME_RE_SOURCE,
  EXTRA_TRIGGER,
  FILE_PREFIX,
  FILE_SUFFIX,
  OUT_DIR_NAME,
  POINT_IDS_CSV,
  SAMPLE_DELAYS_CSV,
  SAMPLE_DELAYS_MS,
  parseArtifactName,
  planWait,
  summarize,
} from "../../../scripts/lib/ui-tree-dump-core.mjs";

// ── oracle 溯源（测试硬约束 #2「契约测试必须使用真实样例」）──
//
// 1. 摘要的期望值来自**真实抓取样本**（模拟器 pictelio_ui，2026-10-20，推荐页，
//    140 节点 / 55,895B / 深度 10），样本脱敏后入库于
//    packages/android-host/tests/fixtures/ui-tree/recommend-page.sample.json。
//    脱敏只改**内容值**（作品 id 数字、标题/作者名文本），不改结构
//    （节点数 / 深度 / 字段覆盖 / 事件分布均与原始抓取逐项一致，见 spec「T0 实测结论」）。
// 2. 落齐判据的期望值来自 spec「Implementation Decisions · 连拍」：0 / 1.5 / 4s 三档，
//    且 spec 明写「4s 那份才是完整树」（实测 8KB → 9KB → 61KB）。
// 3. 协议常量的期望值来自**宿主侧** io.pictelio.app.UiTreeDump —— 两侧逐字一致性由
//    宿主侧 JVM 单测 UiTreeDumpProtocolContractTest 承担（Java/Node 无共享代码，
//    只能各写各的字面量 + 逐字比对）。本文件断言的是「脚本侧常量自洽」。

const FIXTURE = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/ui-tree/recommend-page.sample.json",
);

const realTree = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;

describe("协议常量（脚本侧自洽）", () => {
  it("采样档位：CSV 形态与数值形态一致，且是 spec 约定的三档", () => {
    expect(SAMPLE_DELAYS_CSV).toBe("0,1500,4000");
    expect(SAMPLE_DELAYS_MS).toEqual([0, 1500, 4000]);
    // CSV → 数值 的派生必须无损（否则跨端比对会因格式差异假红）
    expect(SAMPLE_DELAYS_CSV.split(",").map(Number)).toEqual(SAMPLE_DELAYS_MS);
  });

  it("采样点：cold 与 hot 两个（冷启动会同时命中两轮，各 3 份）", () => {
    expect(POINT_IDS_CSV).toBe("cold,hot");
  });

  it("触发 extra 键 / 目录名 / 文件名前缀后缀均为非空字面量", () => {
    expect(EXTRA_TRIGGER).toBe("uiTreeDump");
    expect(OUT_DIR_NAME).toBe("ui-tree");
    expect(FILE_PREFIX).toBe("ui-tree-");
    expect(FILE_SUFFIX).toBe(".json");
  });
});

describe("parseArtifactName", () => {
  it("成功路径：从产物名反解出采样点与档位", () => {
    expect(parseArtifactName("ui-tree-cold-4000ms-3-1700000000000.json")).toEqual({
      point: "cold",
      delayMs: 4000,
      seq: 3,
      ts: 1_700_000_000_000,
    });
  });

  it("失败路径：不是本通道产物名 → null（不得抛错，脚本按后缀筛到的可能是噪声）", () => {
    expect(parseArtifactName("random.json")).toBeNull();
    expect(parseArtifactName("ui-tree-cold-4000ms-3-1700000000000.json.tmp")).toBeNull();
    expect(parseArtifactName("")).toBeNull();
  });

  it("产物名正则源码可编译（脚本侧与宿主侧读的是同一份模式）", () => {
    expect(() => new RegExp(ARTIFACT_NAME_RE_SOURCE)).not.toThrow();
  });
});

describe("planWait（落齐判据）", () => {
  it("成功路径：一轮三档齐 ⇒ settled（这是「4s 那份已到手」的判据）", () => {
    const plan = planWait(
      [
        "ui-tree-cold-0ms-1-1700000000000.json",
        "ui-tree-cold-1500ms-2-1700000001500.json",
        "ui-tree-cold-4000ms-3-1700000004000.json",
      ],
      SAMPLE_DELAYS_MS,
    );
    expect(plan.settled).toBe(true);
    expect(plan.seenDelays).toEqual([0, 1500, 4000]);
    expect(plan.groups).toEqual([{ point: "cold", delays: [0, 1500, 4000] }]);
  });

  it("关键回归：只到 0 与 1500ms（缺 4s）⇒ **不得**判落齐", () => {
    // 这正是旧实现丢最完整那份的现场：计数「连续两次不变」⇒ 误判落齐 ⇒ 4s 那份被丢
    const plan = planWait(
      ["ui-tree-cold-0ms-1-1700000000000.json", "ui-tree-cold-1500ms-2-1700000001500.json"],
      SAMPLE_DELAYS_MS,
    );
    expect(plan.settled).toBe(false);
    expect(plan.seenDelays).toEqual([0, 1500]);
  });

  it("冷启动两轮（cold + hot）⇒ 至少一轮齐即算落齐（另一轮可迟到）", () => {
    const plan = planWait(
      [
        "ui-tree-cold-0ms-1-1700000000000.json",
        "ui-tree-cold-1500ms-2-1700000001500.json",
        "ui-tree-cold-4000ms-3-1700000004000.json",
        "ui-tree-hot-0ms-4-1700000000000.json",
      ],
      SAMPLE_DELAYS_MS,
    );
    expect(plan.settled).toBe(true);
    expect(plan.groups.map((g) => g.point)).toEqual(["cold", "hot"]);
  });

  it("失败路径：空输入 ⇒ 不落齐、无档位", () => {
    const plan = planWait([], SAMPLE_DELAYS_MS);
    expect(plan.settled).toBe(false);
    expect(plan.seenDelays).toEqual([]);
    expect(plan.groups).toEqual([]);
  });
});

describe("summarize（真实样本回放）", () => {
  const s = summarize(realTree);

  it("节点数 / 深度：与真实抓取一致（spec「T0 实测结论」）", () => {
    expect(s.nodeCount).toBe(140);
    expect(s.maxDepth).toBe(10);
  });

  it("字段覆盖：class 138/140、语义 id 16、a11y 标签 2（spec 字段表）", () => {
    expect(s.withClass).toBe(138);
    expect(s.ids).toHaveLength(16);
    expect(s.a11yLabels).toHaveLength(2);
  });

  it("节点字段清单：七个字段全覆盖 140（除 events 为 50 个节点带）", () => {
    const fields = Object.fromEntries(s.fieldCounts);
    expect(fields.tag).toBe(140);
    expect(fields.attributes).toBe(140);
    expect(fields.position).toBe(140);
    expect(fields.nodeId).toBe(140);
    expect(fields.id).toBe(140);
    expect(fields.debugInfo).toBe(140);
    expect(fields.events).toBe(50);
  });

  it("事件名分布：tap 29 / load 20 / error 20 / touchstart 5 / touchmove 5 / touchend 5", () => {
    expect(Object.fromEntries(s.eventNames)).toEqual({
      tap: 29,
      touchstart: 5,
      touchmove: 5,
      touchend: 5,
      load: 20,
      error: 20,
    });
  });

  it("tag 分布：page 1 / view 107 / image 20 / text 12", () => {
    expect(Object.fromEntries(s.tagCounts)).toEqual({
      page: 1,
      view: 107,
      image: 20,
      text: 12,
    });
  });

  it("失败路径：非对象输入 ⇒ 零节点零深度（不得抛错）", () => {
    const empty = summarize(null as unknown as Record<string, unknown>);
    expect(empty.nodeCount).toBe(0);
    expect(empty.maxDepth).toBe(0);
    expect(empty.tagCounts).toEqual([]);
  });
});
