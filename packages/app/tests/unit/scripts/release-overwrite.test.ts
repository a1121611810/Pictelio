import { describe, it, expect, vi } from "vitest";
import { planOverwrite, executeOverwrite } from "../../../scripts/release-overwrite.mjs";

// 真实样例契约（2026-08-05 实测远端 v4.2.4 状态）：
// 远端 Release 仅含 webview APK，缺 full / lynx；本地三变体 APK 齐全
const VERSION = "4.2.4";
const VARIANTS = ["full", "webview", "lynx"];
const REPO = "a1121611810/pixivizer";
const EXPECTED_ASSETS = [
  "pictelio-4.2.4-full.apk",
  "pictelio-4.2.4-webview.apk",
  "pictelio-4.2.4-lynx.apk",
];

const fullLocalApks = [
  {
    flavor: "full",
    path: "/abs/android/app/build/outputs/apk/full/release/pictelio-4.2.4-full.apk",
  },
  {
    flavor: "webview",
    path: "/abs/android/app/build/outputs/apk/webview/release/pictelio-4.2.4-webview.apk",
  },
  {
    flavor: "lynx",
    path: "/abs/android/app/build/outputs/apk/lynx/release/pictelio-4.2.4-lynx.apk",
  },
];

const currentRemote = {
  tag: "v4.2.4",
  release: { exists: true, draft: false, assets: ["pictelio-4.2.4-webview.apk"] },
};

function makePlan(overrides = {}) {
  return planOverwrite({
    version: VERSION,
    variants: VARIANTS,
    repo: REPO,
    localApks: fullLocalApks,
    remote: currentRemote,
    notes: "test notes",
    ...overrides,
  });
}

describe("planOverwrite", () => {
  it("检出缺失资产与将被覆盖的资产（当前 v4.2.4 实测状态）", () => {
    const plan = makePlan();
    expect(plan.tag).toBe("v4.2.4");
    expect(plan.title).toBe("Pictelio v4.2.4");
    expect(plan.assetsMissing).toEqual(["pictelio-4.2.4-full.apk", "pictelio-4.2.4-lynx.apk"]);
    expect(plan.assetsToReplace).toEqual(["pictelio-4.2.4-webview.apk"]);
    expect(plan.assetsToUpload).toHaveLength(3);
    expect(plan.buildRequired).toEqual([]);
    expect(plan.needsBackup).toBe(true);
    expect(plan.notes).toBe("test notes");
    // 硬约束警告：versionCode 不变
    expect(plan.warnings.join("\n")).toContain("versionCode 仍为 40204");
  });

  it("远端 tag 不存在 → 拒绝", () => {
    expect(() => makePlan({ remote: { tag: null, release: null } })).toThrow(
      /远端 tag v4\.2\.4 不存在/,
    );
  });

  it("package.json 版本与远端 Release tag 不一致 → 拒绝（防误用覆盖发布新版本）", () => {
    expect(() =>
      makePlan({
        remote: { tag: "v4.2.5", release: { exists: true, draft: false, assets: [] } },
      }),
    ).toThrow(/不一致/);
  });

  it("Release 不存在 → 拒绝", () => {
    expect(() => makePlan({ remote: { tag: "v4.2.4", release: null } })).toThrow(
      /Release v4\.2\.4 不存在/,
    );
  });

  it("Release 是 draft → 拒绝", () => {
    expect(() =>
      makePlan({
        remote: { tag: "v4.2.4", release: { exists: true, draft: true, assets: [] } },
      }),
    ).toThrow(/draft/);
  });

  it("版本号格式无效 → 拒绝", () => {
    expect(() => makePlan({ version: "4.2" })).toThrow(/版本号格式无效/);
  });

  it("本地缺少某变体 APK → 列入 buildRequired，不进入上传清单", () => {
    const plan = makePlan({
      localApks: [
        { flavor: "full", path: null },
        {
          flavor: "webview",
          path: "/abs/android/app/build/outputs/apk/webview/release/pictelio-4.2.4-webview.apk",
        },
        {
          flavor: "lynx",
          path: "/abs/android/app/build/outputs/apk/lynx/release/pictelio-4.2.4-lynx.apk",
        },
      ],
    });
    expect(plan.buildRequired).toEqual(["full"]);
    expect(plan.assetsToUpload).toHaveLength(2);
    expect(plan.warnings.join("\n")).toContain("本地缺少以下变体 APK：full");
  });

  it("远端存在不属于本版本的资产 → 提示并存，不纳入覆盖", () => {
    const plan = makePlan({
      remote: {
        tag: "v4.2.4",
        release: {
          exists: true,
          draft: false,
          assets: ["pictelio-4.2.4-webview.apk", "app-release.apk"],
        },
      },
    });
    expect(plan.assetsToReplace).toEqual(["pictelio-4.2.4-webview.apk"]);
    expect(plan.warnings.join("\n")).toContain("将保留并存");
  });

  it("notes 为 null → 本次不更新文案", () => {
    expect(makePlan({ notes: null }).notes).toBeNull();
  });

  it("includeAssets=false（仅文案模式）→ 不覆盖/上传任何资产", () => {
    const plan = makePlan({ includeAssets: false });
    expect(plan.assetsToUpload).toEqual([]);
    expect(plan.buildRequired).toEqual([]);
    expect(plan.needsBackup).toBe(false);
    expect(plan.warnings.join("\n")).toContain("仅文案模式");
  });
});

describe("executeOverwrite", () => {
  it("dryRun=true 时不调用 runGh，返回未执行结果", async () => {
    const runGh = vi.fn();
    const plan = makePlan();
    const result = await executeOverwrite(plan, { runGh, dryRun: true });
    expect(runGh).not.toHaveBeenCalled();
    expect(result).toEqual({ edited: false, uploaded: [], restored: [], dryRun: true });
  });

  it("全流程调用顺序：download 备份 → edit 文案 → upload --clobber 资产", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const plan = makePlan();
    const result = await executeOverwrite(plan, { runGh, dryRun: false });

    expect(calls[0][1]).toBe("download"); // 第一步：备份
    expect(calls.some((c) => c[1] === "edit" && c.includes("--notes-file"))).toBe(true);
    const uploadCall = calls.find((c) => c[1] === "upload" && c.includes("--clobber"));
    expect(uploadCall).toBeDefined();
    const uploadNames = uploadCall.filter((a) => a.endsWith(".apk")).map((p) => p.split("/").pop());
    expect(uploadNames).toEqual(EXPECTED_ASSETS);
    expect(result.edited).toBe(true);
    expect(result.uploaded).toEqual(EXPECTED_ASSETS);
    expect(result.restored).toEqual([]);
  });

  it("notes=null → 不执行 edit", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const plan = makePlan({ notes: null });
    await executeOverwrite(plan, { runGh, dryRun: false });
    expect(calls.some((c) => c[1] === "edit")).toBe(false);
    expect(calls.some((c) => c[1] === "upload" && c.includes("--clobber"))).toBe(true);
  });

  it("includeAssets=false（仅文案模式）→ execute 不备份不上传，仅 edit", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const plan = makePlan({ includeAssets: false });
    await executeOverwrite(plan, { runGh, dryRun: false });
    expect(calls.some((c) => c[1] === "download")).toBe(false);
    expect(calls.some((c) => c[1] === "upload")).toBe(false);
    expect(calls.some((c) => c[1] === "edit")).toBe(true);
  });

  it("assetsToUpload 为空 → 不执行 upload", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    // 本地全部缺失：不构建也不上传（仅文案模式），但远端有资产时仍备份——此处让 upload 清单为空
    const plan = makePlan({
      localApks: [
        { flavor: "full", path: null },
        { flavor: "webview", path: null },
        { flavor: "lynx", path: null },
      ],
    });
    expect(plan.assetsToUpload).toEqual([]);
    await executeOverwrite(plan, { runGh, dryRun: false });
    expect(calls.some((c) => c[1] === "upload")).toBe(false);
  });

  it("upload 失败（重试耗尽）→ 从备份恢复被覆盖资产后抛出错误", async () => {
    const runGh = vi.fn(async (args) => {
      // 仅主上传（多文件，>7 参数）抛错；恢复上传（单文件 --clobber，7 参数）成功
      if (args[1] === "upload" && args.includes("--clobber") && args.length > 7) {
        throw new Error("upload failed");
      }
    });
    const plan = makePlan();
    await expect(executeOverwrite(plan, { runGh, dryRun: false })).rejects.toThrow(/upload failed/);

    const clobberUploads = runGh.mock.calls.filter(
      ([a]) => a[1] === "upload" && a.includes("--clobber"),
    );
    const mainUploads = clobberUploads.filter(([a]) => a.length > 7);
    expect(mainUploads.length).toBe(3); // 主上传 3 次重试
    const restoreCalls = clobberUploads.filter(([a]) => a.length === 7);
    // 仅被覆盖的 webview 需要恢复；恢复同样带 --clobber（旧资产仍存在时可覆盖）
    expect(restoreCalls.length).toBe(1);
    expect(restoreCalls[0][0].includes("--clobber")).toBe(true);
    expect(restoreCalls[0][0].at(-1)).toMatch(/pictelio-4\.2\.4-webview\.apk$/);
  });
});
