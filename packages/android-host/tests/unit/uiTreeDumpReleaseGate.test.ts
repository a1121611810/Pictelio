/**
 * release 门禁接线守卫：UI 树导出的**每个**调用点都必须传 `BuildConfig.DEBUG`。
 *
 * ## 判据来源（oracle 溯源，禁自洽反推）
 * - 门禁形态：spec `docs/specs/app-lynx-ui-tree-dump-t0.md`「Implementation Decisions · 门禁」
 *   —— 整段以 `BuildConfig.DEBUG` 包裹，release 编译下为恒 false 死代码、被 R8 移除。
 * - 决策与能力边界：ADR-0223 §2.2「门禁：BuildConfig.DEBUG 作为判定函数的入参」。
 * - 「release 变体里 DEBUG 是字面量 false ⇒ javac 内联 ⇒ 整块成死代码」这一层由
 *   宿主侧可执行门禁 `verifyReleaseBuildConfig` 承担（只证取值，不证 R8 移除）。
 * - 接线点清单：`io.pictelio.app.UiTreeDump.scheduleIfRequested` 的全部调用点
 *   （生产代码里只有 `LynxActivity` 两处：冷启动 `onLoadSuccess` / 热启动 `onNewIntent`）。
 *
 * ## 为什么需要这道门禁（Spec 轴 finding：调用点完备性无机器防线）
 * 宿主侧 `UiTreeDumpTest` 只直接调 `UiTreeDump.shouldDump(...)`，**不碰调用点**。
 * 于是把 `LynxActivity` 两处的 `BuildConfig.DEBUG` 改成 `true`，宿主单测仍全绿，
 * 而 release 包会真的导出 UI 树 —— 门禁只由「约定」保证，没有机器防线。
 *
 * ## 阳性对照（强制项，不是加分项）
 * 本仓此前多条防线在「改动前就已经绿」，是恒真的假防线。唯一能识破的办法是反事实：
 * 文件底部 describe「检测式阳性对照」把反事实**常驻**成测试 —— 同一套扫描逻辑，
 * 喂进一份「把 BuildConfig.DEBUG 换成 true」的合成源码，必须转红。
 *
 * ## 已知失效面（显式登记，非缺陷）
 * - **只认 `BuildConfig.DEBUG` 字面量**：若将来改成 `BuildConfig.DEBUG && someFlag`，
 *   本守卫会判红（这是刻意保守：宁可多问一次，也不要放过 release 导出能力）。
 * - **不覆盖 R8 移除**：本守卫只证「调用点传的是 DEBUG 闸门」，不证「R8 确实移除了本类」
 *   （无 dex 级断言，见 ADR-0223 §3.3）。
 * - **不覆盖调用点数量**：调用点若被删光（0 处），下面「至少 2 处」的断言会转红，
 *   所以数量是被钉住的；但**新增**调用点不受数量断言约束（只被逐点检查覆盖）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ACTIVITY_SOURCE = join(
  REPO_ROOT,
  "packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java",
);

/** 一次调用的实参文本（源码原样）。 */
interface CallSite {
  /** 源码中的行号（1 基）。 */
  line: number;
  /** 该次调用的实参列表（括号内原文）。 */
  args: string;
}

/**
 * 抽出 `UiTreeDump.scheduleIfRequested(...)` 的全部调用点。
 *
 * <p>扫描面不失效：调用点一个都没找到时返回空数组，由调用方断言数量下界
 * （「零命中 ≠ 不支持」—— 空数组必须让断言转红，不能静默恒真）。
 */
function findCallSites(source: string): CallSite[] {
  const out: CallSite[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf("UiTreeDump.scheduleIfRequested(");
    if (idx === -1) continue;
    // 跨行调用：把从这一行起的若干行拼起来，凑齐括号再切实参
    let joined = "";
    let j = i;
    while (j < lines.length && !joined.includes(");")) {
      joined += (joined ? " " : "") + lines[j].trim();
      j++;
    }
    const start = joined.indexOf("UiTreeDump.scheduleIfRequested(");
    const open = start + "UiTreeDump.scheduleIfRequested(".length;
    const close = joined.lastIndexOf(");");
    out.push({ line: i + 1, args: joined.slice(open, close) });
  }
  return out;
}

/** 实参列表里是否出现 `BuildConfig.DEBUG`（DEBUG 闸门接线）。 */
function passesDebugGate(args: string): boolean {
  return args.includes("BuildConfig.DEBUG");
}

describe("UI 树导出的 release 门禁接线", () => {
  const source = readFileSync(ACTIVITY_SOURCE, "utf-8");
  const sites = findCallSites(source);

  it("扫描面有效：至少找到 2 个调用点（冷启动 + 热启动）", () => {
    // 抽取器有效性：零命中必须是「转红」而不是「恒真通过」
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it("每个调用点都必须传 BuildConfig.DEBUG 作门禁入参", () => {
    for (const site of sites) {
      // ⚠️ Vitest 的签名是 expect(actual, message)：实参在前、错误消息在后。
      //   写反了不会报错，只会变成「拿消息字符串去比 true」——断言恒假。
      expect(
        passesDebugGate(site.args),
        `LynxActivity.java:${site.line} 的 scheduleIfRequested 调用必须传 BuildConfig.DEBUG` +
          `（实参：${site.args}）——否则 release 包也会导出 UI 树`,
      ).toBe(true);
    }
  });

  it("每个调用点都必须传采样点标识（cold / hot）——产物名靠它区分两轮", () => {
    for (const site of sites) {
      expect(
        site.args.includes("UiTreeDump.POINT_"),
        `LynxActivity.java:${site.line} 必须传采样点标识 UiTreeDump.POINT_COLD / POINT_HOT` +
          `（实参：${site.args}）`,
      ).toBe(true);
    }
  });

  it("宿主源码文件存在（路径没写错，否则上面全是空断言）", () => {
    expect(existsSync(ACTIVITY_SOURCE)).toBe(true);
  });
});

describe("检测式阳性对照（反事实：把门禁换成 true 必须被抓住）", () => {
  const compliant = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), BuildConfig.DEBUG,
              UiTreeDump.POINT_COLD);
  `;
  const violating = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), true,
              UiTreeDump.POINT_COLD);
  `;

  it("合规调用点：扫描得到 1 处且通过门禁检查", () => {
    const sites = findCallSites(compliant);
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(true);
  });

  it("违规调用点（DEBUG → true）：扫描仍得到 1 处，但门禁检查必须打红", () => {
    const sites = findCallSites(violating);
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(false);
  });

  it("漏传采样点标识：采样点检查必须打红", () => {
    const sites = findCallSites(compliant.replace("UiTreeDump.POINT_COLD", '"cold"'));
    expect(sites).toHaveLength(1);
    expect(sites[0].args.includes("UiTreeDump.POINT_")).toBe(false);
  });
});
