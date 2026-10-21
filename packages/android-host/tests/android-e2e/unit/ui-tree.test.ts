// @vitest-environment node
/**
 * `ui-tree.ts` 纯查询层单测（issue #1047 · ADR-0223；不碰 adb / 模拟器）。
 *
 * ## oracle 溯源（测试硬约束 #2「契约测试必须使用真实样例」）
 *
 * 期望值全部来自**真实抓取样本**：`tests/fixtures/ui-tree/recommend-page.sample.json`
 * （模拟器 `pictelio_ui`，2026-10-20，推荐页，140 节点 / 深度 10；脱敏只改内容值，
 * 不改结构）。该样本的入库与摘要口径由
 * `tests/unit/scripts/ui-tree-dump-core.test.ts` 承担。
 *
 * ## 本文件守的是什么
 *
 * ① **坐标系口径**（`frameInScreen` vs `frameInRoot`，实测差 81px）——这条错了，
 *    所有几何断言都会挂在偏了 81px 的盒上，而**数字看着仍然合理**（不报错、只是错）。
 * ② **按 class 定位的唯一性**——`absolute` 这类 token 在树里命中几十处，
 *    「任一命中」返回的就不是一个元素。
 * ③ **模块不导出 `frameInRoot` 访问器**——把口径从「写在注释里」变成「编译期做不到」。
 *
 * ## 已知失效面
 *
 * 样本是**单页快照**（推荐页）：换页面 / 换引擎版本后字段分布会漂 ⇒ 本文件断言的是
 * 「口径对这份样本成立」，不是「所有页面都长这样」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import * as uiTree from "../ui-tree";
import {
  FAB_CLASS_TOKENS,
  classTokens,
  deriveBleedLowerBound,
  describeNode,
  dpToPx,
  fabCenter,
  findByClass,
  findBySemanticId,
  findByText,
  findFab,
  nodeEventNames,
  nodeHasEvent,
  pickBest,
  screenFrame,
  surfaceWindowsFromTree,
  walkNodes,
  type UiTreeFrame,
  type UiTreeNode,
} from "../ui-tree";

const FIXTURE = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/ui-tree/recommend-page.sample.json",
);

const tree = JSON.parse(readFileSync(FIXTURE, "utf-8")) as UiTreeNode;

/**
 * 主 CTA 的 class 定位口径**直接取共享模块的 `FAB_CLASS_TOKENS`**（不复制一份）。
 *
 * ⚠️ 为什么不能在本文件里手写一份（`["absolute","z-30","bg-primary-container"]`）：
 *   手写副本 ⇒ 出厂常量漂移时（加/减 token）本文件**仍全绿** ⇒ 护栏失守，
 *   而「按 class 定位的唯一性」恰恰是本文件要守的东西。测试硬约束 #2：
 *   契约测试必须使用**真实来源**的字段，不得手写自洽副本。
 *
 * ⚠️ 三个 token **必须全部命中**：`absolute` / `z-30` 单独用都命中几十处。
 */

/**
 * 取出唯一命中的节点。
 *
 * ⚠️ 不用 `hits[0]!`：可选链后接非空断言在 lint 规则
 *   `typescript(no-non-null-asserted-optional-chain)` 下是**错误**（可选链按设计可能
 *   返回 undefined，非空断言是错的），且 `expect(...)` **不参与** TS 的类型窄化
 *   ⇒ 断言过了类型上仍可能 undefined。这里显式抛错，类型与运行时都对。
 */
function only(hits: UiTreeNode[]): UiTreeNode {
  expect(hits.length, "应唯一命中").toBe(1);
  const hit = hits[0];
  if (!hit) throw new Error("应唯一命中");
  return hit;
}

/** 取出节点的屏幕布局盒（缺失就抛错）。 */
function frameOf(node: UiTreeNode): UiTreeFrame {
  const frame = screenFrame(node);
  if (!frame) throw new Error("节点缺 frameInScreen");
  return frame;
}

describe("ui-tree 纯查询层（真实样本驱动）", () => {
  it("样本规模：140 节点（与 core 门禁的摘要口径同源）", () => {
    expect(walkNodes(tree)).toHaveLength(140);
  });

  it("按 class 全命中定位到**唯一**的主 CTA", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    expect(classTokens(cta)).toEqual(expect.arrayContaining([...FAB_CLASS_TOKENS]));
  });

  it("坐标系口径：CTA 的 frameInScreen = (872,1808,162,162)，与像素实测经验值逐字一致", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    expect(screenFrame(cta)).toEqual({ x: 872, y: 1808, width: 162, height: 162 });
    // 既有 e2e 的像素实测经验值（md3-visual-tokens 的注释里逐字记着 x 872..1033 / y 1808..1969）
    const f = frameOf(cta);
    expect([f.x, f.x + f.width - 1]).toEqual([872, 1033]);
    expect([f.y, f.y + f.height - 1]).toEqual([1808, 1969]);
  });

  it("坐标系口径：frameInRoot 与 frameInScreen 差 81px ⇒ 用错坐标系会静默挂错盒", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    const screen = frameOf(cta);
    const root = cta.position?.frameInRoot;
    if (!root) throw new Error("样本节点应带 frameInRoot（用于对照两套坐标系）");
    // 差值就是横向 swiper 的滚动偏移（81px）——**不是**测量误差，是两套坐标系的不同。
    expect(root.x - screen.x).toBe(81);
    expect(root.y - screen.y).toBe(81);
    // 反证：若两套坐标系本就相同，上面这条恒 0 ⇒ 「用错坐标系」这件事就发现不了。
    expect(root.x).not.toBe(screen.x);
  });

  it("模块**不导出** frameInRoot 的访问器（让用错坐标系在编译期就做不到）", () => {
    const exported = Object.keys(uiTree);
    expect(
      exported.filter((k) => /root/iu.test(k)),
      `出现了疑似 frameInRoot 的导出：${exported.join(", ")}`,
    ).toEqual([]);
  });

  it("语义 id 定位：hero-root 唯一、hero-source 占位符 15 处（与 core 门禁同数）", () => {
    expect(findBySemanticId(tree, "pictelio-hero-root")).toHaveLength(1);
    expect(findBySemanticId(tree, "pictelio-hero-source-<illustId>")).toHaveLength(15);
  });

  it("可交互性：CTA 绑定了 tap 事件（树能答「能不能点」，像素答不了）", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    expect(nodeEventNames(cta)).toEqual(["tap"]);
    expect(nodeHasEvent(cta, "tap")).toBe(true);
    expect(nodeHasEvent(cta, "longpress")).toBe(false);
  });

  it("尺寸换算：162px = 54dp ≥ 48dp（触控目标门限成立）", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    const f = frameOf(cta);
    const minPx = dpToPx(48, 3);
    expect(minPx).toBe(144);
    expect(f.width).toBeGreaterThanOrEqual(minPx);
    expect(f.height).toBeGreaterThanOrEqual(minPx);
  });

  it("describeNode 把 frame / events / class 都带进失败信息", () => {
    const cta = only(findByClass(tree, FAB_CLASS_TOKENS));
    const text = describeNode(cta);
    expect(text).toContain("frame=(872,1808,162,162)");
    expect(text).toContain("events=[tap]");
    expect(text).toContain("bg-primary-container");
  });

  it("按文本定位：样本里的文本节点可被 findByText 命中（脱敏后是「文本#N」形态）", () => {
    // 样本的文本被脱敏成「文本#N」⇒ 这里只断言「机制可用」：命中数与位置自洽。
    const hits = findByText(tree, "文本#1");
    expect(hits.length).toBeGreaterThan(0);
    expect(screenFrame(hits[0]!)).not.toBeNull();
    expect(findByText(tree, "文本#1").length).toBe(1);
  });
});

describe("ui-tree · 采样窗推导（树给布局事实，不用像素反推）", () => {
  it("渗色带下界 = 树里第一个「全宽且非零起始 y」的节点（样本实测 72px）", () => {
    // oracle：真实样本里全宽 x=0 节点的起始 y 集合 = {0, 72, 213, 1201} ⇒ 下界 72，
    // 与 spec 注释里的 safeTop=72 独立吻合。
    expect(deriveBleedLowerBound(tree, 1080)).toBe(72);
  });

  it("采样窗：y 区间由树给出，x 区间沿用人工校准的中央带", () => {
    const xRanges = [
      { x0: 380, x1: 600 },
      { x0: 620, x1: 840 },
    ];
    expect(surfaceWindowsFromTree(tree, 1080, xRanges)).toEqual([
      { x0: 380, y0: 0, x1: 600, y1: 72 },
      { x0: 620, y0: 0, x1: 840, y1: 72 },
    ]);
  });

  it("推不出来就抛错（不静默退回常量）", () => {
    // 只有根节点的树 ⇒ 找不到全宽非零起始 y 的节点
    const bare: UiTreeNode = {
      tag: "page",
      children: [
        {
          tag: "view",
          position: { frameInScreen: { x: 10, y: 0, width: 100, height: 50 } },
        },
      ],
    };
    expect(() => deriveBleedLowerBound(bare, 1080)).toThrow(/渗色带下界/u);
  });

  it("半成品树（只有根）同样抛错 —— 抓到半棵树时不能默默给出一个错的窗口", () => {
    const rootOnly: UiTreeNode = { tag: "page" };
    expect(() => deriveBleedLowerBound(rootOnly, 1080)).toThrow(/渗色带下界/u);
  });
});

describe("ui-tree 纯查询层 · 反事实（判据不是恒真）", () => {
  it("不存在的 class token ⇒ 命中 0 处（定位失败要能显式判否）", () => {
    expect(findByClass(tree, [...FAB_CLASS_TOKENS, "no-such-class-xyz"])).toEqual([]);
  });

  it("单 token 命中多处 ⇒ 「全部命中」这条口径承重", () => {
    // 若实现退化成「任一命中」，这一条会从「多处」变成「唯一」——反证用的就是它。
    const absoluteOnly = findByClass(tree, ["absolute"]);
    expect(absoluteOnly.length).toBeGreaterThan(1);
    expect(findByClass(tree, FAB_CLASS_TOKENS)).toHaveLength(1);
  });

  it("不存在的语义 id ⇒ 命中 0 处", () => {
    expect(findBySemanticId(tree, "pictelio-no-such-id")).toEqual([]);
  });

  it("缺 position 的节点 ⇒ screenFrame 返回 null（**不静默回退**到 frameInRoot）", () => {
    const bare: UiTreeNode = {
      tag: "view",
      position: { frameInRoot: { x: 1, y: 2, width: 3, height: 4 } },
    };
    expect(screenFrame(bare)).toBeNull();
  });
});

describe("ui-tree · FAB 定位口径（findFab / fabCenter）", () => {
  it("findFab 在真实样本上唯一命中，且就是那个 class 组合的节点", () => {
    const fab = findFab(tree);
    expect(classTokens(fab)).toEqual(expect.arrayContaining([...FAB_CLASS_TOKENS]));
    expect(screenFrame(fab)).toEqual({ x: 872, y: 1808, width: 162, height: 162 });
  });

  it("树里没有 FAB ⇒ 抛错并说清「可能不是推荐页 / FAB 未挂载」（0 命中分支）", () => {
    const bare: UiTreeNode = { tag: "page", children: [{ tag: "view" }] };
    expect(() => findFab(bare)).toThrow(/定位到 0 个节点/);
  });

  it("命中多处 ⇒ 抛错并说清「口径漂了」（>1 命中分支：改 token 组合前先转红）", () => {
    const dup: UiTreeNode = {
      tag: "page",
      children: [1, 2].map((i) => ({
        tag: "view",
        attributes: { class: [...FAB_CLASS_TOKENS] },
        position: { frameInScreen: { x: i, y: 0, width: 10, height: 10 } },
      })),
    };
    expect(() => findFab(dup)).toThrow(/定位到 2 个节点/);
  });

  it("命中了但没有 frameInScreen ⇒ 抛错（不静默用 frameInRoot 顶替）", () => {
    const noFrame: UiTreeNode = {
      tag: "page",
      children: [{ tag: "view", attributes: { class: [...FAB_CLASS_TOKENS] } }],
    };
    expect(() => findFab(noFrame)).toThrow(/没有 frameInScreen/);
  });

  it("fabCenter = 布局盒圆心（873+81=953 / 1808+81=1889）", () => {
    // oracle：162px 见方的盒子 ⇒ 圆心 = 左上角 + 81
    expect(fabCenter(tree)).toEqual({ x: 953, y: 1889 });
  });
});

describe("ui-tree · 「哪一份最完整」（pickBest）", () => {
  /** 造一份产物（只有排序用的三个字段与名字是承重的）。 */
  function artifact(
    name: string,
    nodeCount: number,
    delayMs: number,
    bytes: number,
  ): uiTree.UiTreeArtifact {
    return {
      name,
      point: "hot",
      delayMs,
      tree: { tag: "page" },
      nodeCount,
      bytes,
      localPath: `/tmp/${name}`,
    };
  }

  it("节点数多者胜（这是主键：半成品树的节点数少）", () => {
    const best = pickBest([artifact("a", 10, 4000, 100), artifact("b", 140, 0, 50)]);
    expect(best.name).toBe("b");
  });

  it("节点数相同 ⇒ 比**采样档位**（4s 档通常是完整树）", () => {
    const best = pickBest([artifact("a", 140, 0, 900), artifact("b", 140, 4000, 100)]);
    expect(best.name).toBe("b");
  });

  it("节点数与档位都相同 ⇒ 比字节数", () => {
    const best = pickBest([artifact("a", 140, 4000, 100), artifact("b", 140, 4000, 900)]);
    expect(best.name).toBe("b");
  });

  it("空集合 ⇒ 抛错（不返回 undefined 让调用方拿到空树）", () => {
    expect(() => pickBest([])).toThrow(/产物集合为空/);
  });
});
