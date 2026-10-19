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
  exitCodeFor,
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
//
// ── 已知失效面（显式登记，非缺陷）──
//
// - **样本是单页快照**：fixture 是 2026-10-20 在模拟器 `pictelio_ui` 上抓的**推荐页**
//   脱敏样本，只覆盖这一个页面的结构；换页面 / 换引擎版本后字段分布会漂移
//   ⇒ 本文件断言的是「摘要口径对这份样本成立」，不是「所有页面的字段分布」。
// - **只认「至少一轮齐」**：`planWait` 的落齐判据是「出现的采样点里至少有一轮三档齐」，
//   不是「所有轮都齐」——冷启动会命中 cold + hot 两轮，另一轮迟到不应误判超时。
// - **「两侧 CSV 逐字相等」即认定同步**：本文件不解析协议的实际语义，只比对字符串；
//   语义是否被真正消费由宿主侧 JVM 门禁与实机锚点承担。
// - **协议方向不对称**：宿主侧的 `SAMPLE_DELAYS_CSV` 由数组**派生**（改档位只改一处），
//   而脚本侧是**手写字面量** ⇒ 脚本侧改档位不会自动传播，必须靠跨端门禁比对出来。

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

describe("fixture 脱敏（防复发：脱敏声明必须是真的）", () => {
  // 第 2 轮 review 实测抓到：只脱敏了 `attributes.id`，**顶层 `node.id` 仍是明文作品 id**
  // （15 处）——而摘要取 `node.id || attributes.id` ⇒ 明文会从顶层漏出来。
  // ⇒ 这条断言是「脱敏声明」的机器防线，不是走过场。
  const raw = readFileSync(FIXTURE, "utf-8");

  it("fixture 不含明文作品 id（pictelio-hero-source-<数字>）", () => {
    const plaintext = raw.match(/pictelio-hero-source-\d{6,}/g) ?? [];
    expect(
      plaintext,
      `fixture 残留 ${plaintext.length} 处明文作品 id —— 脱敏只改了 attributes.id、漏了顶层 node.id`,
    ).toEqual([]);
  });

  it("脱敏占位符确实存在于两处（attributes.id 与顶层 node.id 都换掉了）", () => {
    const topLevelIds: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (typeof n.id === "string") topLevelIds.push(n.id);
      for (const child of (n.children ?? []) as unknown[]) walk(child);
    };
    walk(realTree);
    expect(topLevelIds.filter((id) => id.includes("<illustId>")).length).toBe(15);
  });
});

describe("exitCodeFor（退出码 = 机器读得到的那一半失败信号）", () => {
  it("成功路径：落齐 + 未超时 + 无拉回失败 + JSON 合法 ⇒ 0", () => {
    expect(exitCodeFor({ settled: true, timedOut: false, pullFailures: 0, invalidJson: 0 })).toBe(
      0,
    );
  });

  it("失败路径 · 采样未落齐 ⇒ 非零（丢 4s 那份最不能算成功）", () => {
    expect(exitCodeFor({ settled: false, timedOut: false })).toBe(1);
  });

  it("失败路径 · 等待超时 ⇒ 非零", () => {
    expect(exitCodeFor({ settled: true, timedOut: true })).toBe(1);
  });

  it("失败路径 · 拉回失败 ⇒ 非零（设备上有、本地没有 ⇒ 产物集不完整）", () => {
    expect(exitCodeFor({ settled: true, timedOut: false, pullFailures: 1 })).toBe(1);
  });

  it("失败路径 · JSON 不合法 ⇒ 非零（不是引擎原始 JSON ⇒ 通道本身出问题）", () => {
    expect(exitCodeFor({ settled: true, timedOut: false, invalidJson: 1 })).toBe(1);
  });

  it("缺省字段按 0 处理（拉回失败/非法 JSON 未发生时不得误判失败）", () => {
    expect(exitCodeFor({ settled: true })).toBe(0);
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
