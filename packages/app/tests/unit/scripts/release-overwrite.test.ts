import { describe, it, expect, vi } from "vitest";
import {
  planOverwrite,
  executeOverwrite,
  probeRemote,
} from "../../../scripts/release-overwrite.mjs";

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

describe("probeRemote", () => {
  const REFS_OK = "d311a4284945\trefs/tags/v4.2.4";
  const VIEW_OK = JSON.stringify({
    isDraft: false,
    assets: [{ name: "pictelio-4.2.4-webview.apk" }],
  });

  it("tag 存在 + Release 已发布 → 完整 remote（git/gh 并行调用）", async () => {
    const run = vi.fn(async (cmd) => (cmd === "git" ? REFS_OK : VIEW_OK));
    const remote = await probeRemote({ tag: "v4.2.4", repo: REPO, run });
    expect(remote.tag).toBe("v4.2.4");
    expect(remote.release).toEqual({
      exists: true,
      draft: false,
      assets: ["pictelio-4.2.4-webview.apk"],
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("tag 存在但 Release 不存在（gh view 失败）→ release null", async () => {
    const run = vi.fn(async (cmd) => {
      if (cmd === "git") return REFS_OK;
      throw new Error("not found");
    });
    const remote = await probeRemote({ tag: "v4.2.4", repo: REPO, run });
    expect(remote).toEqual({ tag: "v4.2.4", release: null });
  });

  it("tag 不存在（ls-remote 无该 ref）→ { tag: null, release: null }", async () => {
    const run = vi.fn(async (cmd) => (cmd === "git" ? "" : VIEW_OK));
    const remote = await probeRemote({ tag: "v4.2.4", repo: REPO, run });
    expect(remote).toEqual({ tag: null, release: null });
  });

  it("网络异常（ls-remote 失败）→ throw，与 tag 不存在区分", async () => {
    const run = vi.fn(async (cmd) => {
      if (cmd === "git") throw new Error("network error");
      return VIEW_OK;
    });
    await expect(probeRemote({ tag: "v4.2.4", repo: REPO, run })).rejects.toThrow(/网络异常/);
  });
});

describe("executeOverwrite", () => {
  function successUpload() {
    return vi.fn(async ({ paths }) => ({
      succeeded: paths.map((p) => ({ name: p.split("/").pop() })),
      failed: [],
      totalElapsedMs: 0,
    }));
  }

  it("dryRun=true 时不调用 runGh，返回未执行结果", async () => {
    const runGh = vi.fn();
    const upload = vi.fn();
    const plan = makePlan();
    const result = await executeOverwrite(plan, { runGh, upload, dryRun: true });
    expect(runGh).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(result).toEqual({ edited: false, uploaded: [], restored: [], dryRun: true });
  });

  it("全流程：download 备份 → edit 文案 → 逐包上传深模块（注入 upload 端口）", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const upload = successUpload();
    const plan = makePlan();
    const result = await executeOverwrite(plan, { runGh, upload, dryRun: false });

    expect(calls[0][1]).toBe("download"); // 第一步：备份
    expect(calls.some((c) => c[1] === "edit" && c.includes("--notes-file"))).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    const uploadInput = upload.mock.calls[0][0];
    expect(uploadInput.tag).toBe("v4.2.4");
    expect(uploadInput.repo).toBe(REPO);
    expect(uploadInput.paths).toEqual(fullLocalApks.map((x) => x.path));
    expect(result.edited).toBe(true);
    expect(result.uploaded).toEqual(EXPECTED_ASSETS);
    expect(result.restored).toEqual([]);
  });

  it("notes=null → 不执行 edit", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const upload = successUpload();
    const plan = makePlan({ notes: null });
    await executeOverwrite(plan, { runGh, upload, dryRun: false });
    expect(calls.some((c) => c[1] === "edit")).toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("includeAssets=false（仅文案模式）→ execute 不备份不上传，仅 edit", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const upload = vi.fn();
    const plan = makePlan({ includeAssets: false });
    await executeOverwrite(plan, { runGh, upload, dryRun: false });
    expect(calls.some((c) => c[1] === "download")).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(calls.some((c) => c[1] === "edit")).toBe(true);
  });

  it("assetsToUpload 为空 → 不执行 upload", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const upload = vi.fn();
    // 本地全部缺失：不构建也不上传（仅文案模式），但远端有资产时仍备份——此处让 upload 清单为空
    const plan = makePlan({
      localApks: [
        { flavor: "full", path: null },
        { flavor: "webview", path: null },
        { flavor: "lynx", path: null },
      ],
    });
    expect(plan.assetsToUpload).toEqual([]);
    await executeOverwrite(plan, { runGh, upload, dryRun: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it("部分失败 → 仅恢复被覆盖资产（webview），新增资产（full/lynx）无备份跳过恢复", async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
    });
    const upload = vi.fn(async ({ paths }) => {
      const isFirst = upload.mock.calls.length === 1;
      if (isFirst) {
        return {
          succeeded: [],
          failed: paths.map((p) => ({ name: p.split("/").pop(), attempts: 3 })),
          totalElapsedMs: 0,
        };
      }
      return { succeeded: [], failed: [], totalElapsedMs: 0 };
    });
    const plan = makePlan();
    const err = await executeOverwrite(plan, { runGh, upload, dryRun: false }).catch((e) => e);
    expect(err.message).toMatch(/资产上传失败/);
    expect(err.message).toMatch(/备份目录已保留/);

    // 主上传 1 次 + 恢复 1 次（仅 webview，因为只有它在 assetsToReplace 里有备份）
    expect(upload).toHaveBeenCalledTimes(2);
    const mainInput = upload.mock.calls[0][0];
    expect(mainInput.paths).toHaveLength(3);
    const restoreInput = upload.mock.calls[1][0];
    expect(restoreInput.paths).toHaveLength(1);
    expect(restoreInput.paths[0].endsWith("pictelio-4.2.4-webview.apk")).toBe(true);
  });
});
