// @vitest-environment node
/**
 * `ui-tree.ts` 的**设备侧 IO 边界**单测（issue #1047 · ADR-0223；不碰 adb / 模拟器）。
 *
 * ## 为什么必须有这个文件（测试硬约束 #1：IO 边界测试强制覆盖）
 *
 * `ui-tree.ts` 的 IO 边界有四处，每一处都自带**失败/降级分支**：
 *
 * | 边界 | 成功 | 失败 / 降级 |
 * |---|---|---|
 * | `triggerUiTreeDump` | adb exit 0 | adb 非 0 ⇒ 抛错 |
 * | `listRemoteArtifacts` | 列出 `.json` | 目录不存在 ⇒ 空数组（正常态，不告警）；其它 adb 错误 ⇒ 告警 + 空数组 |
 * | 产物拉回 | 拉到本地 | 拉取失败 / 落本地后不在 / JSON 非法 ⇒ 告警 + 跳过该份 |
 * | `collectUiTree` | 等齐 + 至少一份产物 | 未落齐 ⇒ 告警；零产物 ⇒ 抛错 |
 *
 * 只测纯函数而不测这四条 ⇒ 失败路径在 CI 里**永远不会被执行**，降级是否「不静默」
 * 也无从验证——那正是测试硬约束 #1 要防的事。
 *
 * ## 为什么能测（接缝在哪）
 *
 * 全部 adb 调用都走 `tests/android-e2e/env.ts` 的 `adbPath` / `runCapture` / `runOrThrow`
 * ⇒ 用 `vi.mock("../env")` 顶掉（先例：`unit/prefs.devLogin.test.ts`）。
 * ⚠️ `ui-tree.ts` 的产物拉取**必须**走 `env.runOrThrow` 而**不能**直接
 * `execFileSync`：直接 spawn 就没法顶掉，IO 边界将永远没有机器防线。
 *
 * ## oracle
 *
 * - **协议字面量**（extra 键 `uiTreeDump` / 组件名 `io.pictelio.app/.LynxActivity`）——
 *   与宿主侧 `UiTreeDumpProtocolContractTest` 逐字比对的是同一组值。
 * - **落齐判据**（0 / 1500 / 4000 三档齐 ⇒ 落齐）——`scripts/lib/ui-tree-dump-core.mjs`
 *   的 `planWait`，其单测在 `tests/unit/scripts/ui-tree-dump-core.test.ts`。
 * - **节点数口径**——`summarize()`，与 core 门禁同源。
 *
 * ## 已知失效面
 *
 * 本文件**不**证明「adb 真能连上设备」「引擎真会吐树」——那两件事只有真机能证。
 * 本文件证明的是：IO 边界的**分支处理**（成功 / 失败 / 降级）在 CI 里是绿的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  captureUiTree,
  collectUiTree,
  listRemoteArtifacts,
  snapshotRemoteArtifacts,
  triggerUiTreeDump,
} from "../ui-tree";

const adbPath = vi.hoisted(() => vi.fn(() => "/fake/adb"));
const runCapture = vi.hoisted(() => vi.fn());
const runOrThrow = vi.hoisted(() => vi.fn());

vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return { ...actual, adbPath, runOrThrow, runCapture };
});

/** 协议字面量（与宿主侧 `UiTreeDump` 逐字对应，跨端契约门禁比对同一组值）。 */
const LYNX_ACTIVITY_LITERAL = "io.pictelio.app/.LynxActivity";
const EXTRA_TRIGGER_LITERAL = "uiTreeDump";

/** 产物名 → 树里的子节点数（⇒ 节点数 = 子节点数 + 1，便于区分哪份最完整）。 */
const DEVICE_FILES: Record<string, number> = {
  "ui-tree-hot-0ms-1-1700000000000.json": 1,
  "ui-tree-hot-1500ms-2-1700000000001.json": 3,
  "ui-tree-hot-4000ms-3-1700000000002.json": 10,
};

/** 生成一棵「N 个子节点」的树（根 + 子节点 = N+1 个对象节点）。 */
function treeJson(childCount: number): string {
  const children = Array.from({ length: childCount }, (_, i) => ({ tag: "view", nodeId: i + 1 }));
  return JSON.stringify({ tag: "page", nodeId: 0, children });
}

/** 产物名 → 树内容（未登记的名字给一棵最小树）。 */
function contentOf(name: string): string {
  return treeJson(DEVICE_FILES[name] ?? 1);
}

/** 模拟设备目录当前有哪些产物（可变 ⇒ 可表达「触发前 / 触发后」两个时刻）。 */
let deviceFiles: string[] = [];

let outDir = "";
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  deviceFiles = [];
  outDir = mkdtempSync(join(tmpdir(), "pictelio-uitree-io-"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  runCapture.mockImplementation((_bin: string, args: string[]) => {
    if (args.includes("ls")) {
      return { code: 0, stdout: deviceFiles.join("\n"), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
});

afterEach(() => {
  warn.mockRestore();
  rmSync(outDir, { recursive: true, force: true });
  adbPath.mockClear();
  runCapture.mockClear();
  runOrThrow.mockClear();
});

/** 让产物拉取成功，并在本地写出对应内容。 */
function pullSucceeds(): void {
  runOrThrow.mockImplementation((_bin: string, args: string[]) => {
    const local = args[args.length - 1] as string;
    const name = basename(args[args.length - 2] as string);
    writeFileSync(local, contentOf(name));
    return "";
  });
}

describe("ui-tree · IO 边界 · 触发（triggerUiTreeDump）", () => {
  it("成功路径：向 LynxActivity 发一条带 uiTreeDump=1 的 intent（协议字面量逐字比对）", () => {
    triggerUiTreeDump("emulator-5556");
    expect(runCapture).toHaveBeenCalledTimes(1);
    expect(runCapture).toHaveBeenCalledWith("/fake/adb", [
      "-s",
      "emulator-5556",
      "shell",
      "am",
      "start",
      "-n",
      LYNX_ACTIVITY_LITERAL,
      "--es",
      EXTRA_TRIGGER_LITERAL,
      "1",
    ]);
  });

  it("「Activity not started, intent has been delivered…」是**成功**不是失败（exit 0 即成功）", () => {
    runCapture.mockReturnValue({
      code: 0,
      stdout:
        "Activity not started, intent has been delivered to currently running top-most instance",
      stderr: "",
    });
    expect(() => triggerUiTreeDump("emulator-5556")).not.toThrow();
  });

  it("失败路径：adb 非 0 ⇒ 抛错（不静默、不当成功）", () => {
    runCapture.mockReturnValue({ code: 1, stdout: "", stderr: "device offline" });
    expect(() => triggerUiTreeDump("emulator-5556")).toThrow(/adb exit 1/);
    expect(() => triggerUiTreeDump("emulator-5556")).toThrow(/device offline/);
  });

  it("合并进既有 intent：额外参数附在同一条命令尾部（不另发一条）", () => {
    triggerUiTreeDump("emulator-5556", ["--es", "benchNav", "scene-a"]);
    const args = runCapture.mock.calls[0]![1] as string[];
    expect(args.slice(-3)).toEqual(["--es", "benchNav", "scene-a"]);
    // 仍只有**一条**命令 ⇒ 没把深链目标冲掉
    expect(runCapture).toHaveBeenCalledTimes(1);
  });
});

describe("ui-tree · IO 边界 · 列目录（listRemoteArtifacts）", () => {
  it("成功路径：只返回本通道的 .json 产物", () => {
    deviceFiles = [
      "ui-tree-hot-0ms-1-1700000000000.json",
      "ui-tree-hot-1500ms-2-1700000000001.json",
      "not-an-artifact.txt",
    ];
    expect(listRemoteArtifacts("emulator-5556")).toEqual([
      "ui-tree-hot-0ms-1-1700000000000.json",
      "ui-tree-hot-1500ms-2-1700000000001.json",
    ]);
  });

  it("目录不存在是**正常状态**（首次触发前）⇒ 空数组且**不**告警", () => {
    runCapture.mockReturnValue({ code: 1, stdout: "", stderr: "No such file or directory" });
    expect(listRemoteArtifacts("emulator-5556")).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("其它 adb 错误 ⇒ 告警 + 空数组（禁静默降级）", () => {
    runCapture.mockReturnValue({ code: 1, stdout: "", stderr: "device offline" });
    expect(listRemoteArtifacts("emulator-5556")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("device offline");
  });

  it("snapshot 形态：返回产物名的 Set（用于「本次新增了哪些」）", () => {
    deviceFiles = ["ui-tree-hot-0ms-1-1700000000000.json"];
    const snap = snapshotRemoteArtifacts("emulator-5556");
    expect(snap).toBeInstanceOf(Set);
    expect(snap.has("ui-tree-hot-0ms-1-1700000000000.json")).toBe(true);
  });
});

describe("ui-tree · IO 边界 · 等落齐 + 拉回（collectUiTree）", () => {
  it("成功路径：三档齐 ⇒ settled，best = 节点数最多的那份（4s 档）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    deviceFiles = Object.keys(DEVICE_FILES);
    pullSucceeds();
    const r = await collectUiTree("emulator-5556", { before, outDir, quietPeriodMs: 0 });
    expect(r.settled).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.artifacts).toHaveLength(3);
    // 根 + 10 个子节点 = 11 个对象节点 ⇒ 节点数最多的那份是 4000ms 档
    expect(r.best.name).toBe("ui-tree-hot-4000ms-3-1700000000002.json");
    expect(r.best.nodeCount).toBe(11);
    expect(r.best.point).toBe("hot");
    expect(r.best.delayMs).toBe(4000);
  });

  it("落齐判据按**档位**而非「计数不变」：缺 4s 档 ⇒ 未落齐（告警 + timedOut）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    deviceFiles = ["ui-tree-hot-0ms-1-1700000000000.json"];
    pullSucceeds();
    const r = await collectUiTree("emulator-5556", {
      before,
      outDir,
      waitMs: 1,
      quietPeriodMs: 0,
    });
    expect(r.settled).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("未落齐");
  });

  it("零产物 ⇒ 抛错（不返回空树：空树会让「找不到节点」报出误导性失败信息）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    await expect(
      collectUiTree("emulator-5556", { before, outDir, waitMs: 0, quietPeriodMs: 0 }),
    ).rejects.toThrow(/未产出任何产物/);
  });

  it("拉取失败 ⇒ 告警 + 跳过该份（其余产物照常拿回）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    deviceFiles = Object.keys(DEVICE_FILES);
    runOrThrow.mockImplementation((_bin: string, args: string[]) => {
      const name = basename(args[args.length - 2] as string);
      if (name.includes("4000ms")) throw new Error("adb exit 1: remote object does not exist");
      writeFileSync(args[args.length - 1] as string, contentOf(name));
      return "";
    });
    const r = await collectUiTree("emulator-5556", { before, outDir, quietPeriodMs: 0 });
    expect(r.artifacts.map((a) => a.name)).not.toContain("ui-tree-hot-4000ms-3-1700000000002.json");
    expect(r.artifacts).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("拉回失败");
  });

  it("拉回成功但本地没有该文件 ⇒ 告警 + 跳过（半截/残留不算本次产物）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    deviceFiles = Object.keys(DEVICE_FILES);
    runOrThrow.mockImplementation((_bin: string, args: string[]) => {
      const name = basename(args[args.length - 2] as string);
      if (name.includes("4000ms")) return ""; // 拉回「成功」但不落文件
      writeFileSync(args[args.length - 1] as string, contentOf(name));
      return "";
    });
    const r = await collectUiTree("emulator-5556", { before, outDir, quietPeriodMs: 0 });
    expect(r.artifacts).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("不在本地");
  });

  it("JSON 非法 ⇒ 告警 + 跳过（不是引擎原始 JSON ⇒ 通道本身出问题）", async () => {
    const before = snapshotRemoteArtifacts("emulator-5556");
    deviceFiles = Object.keys(DEVICE_FILES);
    runOrThrow.mockImplementation((_bin: string, args: string[]) => {
      const name = basename(args[args.length - 2] as string);
      writeFileSync(
        args[args.length - 1] as string,
        name.includes("4000ms") ? "{not json" : contentOf(name),
      );
      return "";
    });
    const r = await collectUiTree("emulator-5556", { before, outDir, quietPeriodMs: 0 });
    expect(r.artifacts).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("不是合法 JSON");
  });
});

describe("ui-tree · IO 边界 · 一体流程（captureUiTree）", () => {
  it("触发前先取快照、触发、再等落齐拉回 ⇒ 拿到的是**本次新增**的产物", async () => {
    // 设备侧状态随时间变化：第 1 次 ls（capture 内部取的触发前快照）只有旧的；
    // 触发之后（后续 ls）多出 4s 那份 ⇒ 快照差集只含新增的
    const old = "ui-tree-hot-0ms-9-1699999999999.json";
    const fresh = "ui-tree-hot-4000ms-3-1700000000002.json";
    let lsCalls = 0;
    runCapture.mockImplementation((_bin: string, args: string[]) => {
      if (args.includes("ls")) {
        lsCalls += 1;
        return lsCalls === 1
          ? { code: 0, stdout: old, stderr: "" }
          : { code: 0, stdout: `${old}\n${fresh}`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    pullSucceeds();
    const r = await captureUiTree("emulator-5556", { outDir, quietPeriodMs: 0, waitMs: 50 });
    // 只拿到**新增**的那份（旧的那份在触发前快照里）
    expect(r.artifacts.map((a) => a.name)).toEqual([fresh]);
    expect(r.best.nodeCount).toBe(11);
  });
});
