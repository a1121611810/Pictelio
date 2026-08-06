import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { uploadReleaseAssets } from "../../../scripts/lib/release-uploader.mjs";

const MIB = 1048576;

let dir;
const apks = [];

function makeFakeGh({ fail = {} } = {}) {
  const calls = [];
  const perName = new Map();
  const gh = async (args) => {
    calls.push(args);
    const path = args[args.length - 1];
    const name = path.split("/").pop();
    const record = perName.get(name) || { count: 0 };
    record.count += 1;
    perName.set(name, record);
    const spec = fail[name];
    if (spec && record.count <= spec.times) {
      const e = new Error(`upload failed for ${name}`);
      e.stderr = spec.stderr ?? "boom";
      throw e;
    }
    return { elapsedMs: spec?.elapsedMs ?? 2000 };
  };
  gh.calls = calls;
  return gh;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pictelio-uploader-"));
  await mkdir(join(dir, "sub"), { recursive: true });
  apks.push(join(dir, "full.apk"), join(dir, "webview.apk"), join(dir, "lynx.apk"));
  await writeFile(apks[0], Buffer.alloc(2 * MIB));
  await writeFile(apks[1], Buffer.alloc(MIB));
  await writeFile(apks[2], Buffer.alloc(3 * MIB));
  await writeFile(join(dir, "sub", "full.apk"), Buffer.alloc(MIB));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("uploadReleaseAssets", () => {
  it("全部成功：报告含 size/elapsedMs/avgMBps，顺序与输入一致", async () => {
    const gh = makeFakeGh();
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: apks,
      gh,
    });
    expect(report.failed).toEqual([]);
    expect(report.succeeded.map((s) => s.name)).toEqual(["full.apk", "webview.apk", "lynx.apk"]);
    expect(report.succeeded[0].size).toBe(2 * MIB);
    expect(report.succeeded[0].elapsedMs).toBe(2000);
    expect(report.succeeded[0].avgMBps).toBeCloseTo(2 / (2000 / 1000), 2);
    expect(report.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(gh.calls).toHaveLength(3);
    // 并发启动，gh 调用顺序不定；按参数集合断言（每个包恰好一次）
    const expected = apks.map((p) =>
      [
        "release",
        "upload",
        "v4.4.0",
        "--repo",
        "a1121611810/Pictelio",
        "--clobber",
        resolve(p),
      ].join("|"),
    );
    expect(gh.calls.map((c) => c.join("|")).toSorted()).toEqual(expected.toSorted());
  });

  it("失败隔离：webview 3 次重试后失败，其余包成功；只重试失败包", async () => {
    const gh = makeFakeGh({ fail: { "webview.apk": { times: 3, stderr: "network down" } } });
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: apks,
      gh,
    });
    expect(report.succeeded.map((s) => s.name)).toEqual(["full.apk", "lynx.apk"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].name).toBe("webview.apk");
    expect(report.failed[0].attempts).toBe(3);
    expect(report.failed[0].stderrTail).toContain("network down");
    // full/lynx 各 1 次 + webview 3 次 = 5
    expect(gh.calls).toHaveLength(5);
  }, 20000);

  it("退避时序 1s/2s（retry 事件），第 3 次尝试成功", async () => {
    const delays = [];
    const gh = makeFakeGh({ fail: { "full.apk": { times: 2, stderr: "x" } } });
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: [apks[0]],
      gh,
      render: (e) => {
        if (e.type === "retry") delays.push(e.delayMs);
      },
    });
    expect(delays).toEqual([1000, 2000]);
    expect(report.failed).toEqual([]);
    expect(report.succeeded[0].name).toBe("full.apk");
  }, 20000);

  it("basename 重复时启动前拒绝（防止并发同名删除竞争）", async () => {
    const gh = makeFakeGh();
    await expect(
      uploadReleaseAssets({
        tag: "v4.4.0",
        repo: "a1121611810/Pictelio",
        paths: [apks[0], join(dir, "sub", "full.apk")],
        gh,
      }),
    ).rejects.toThrow(/重复/u);
    expect(gh.calls).toHaveLength(0);
  });

  it("上传失败不 throw 整个调用：进 failed[]", async () => {
    const gh = makeFakeGh({ fail: { "lynx.apk": { times: 3, stderr: "boom" } } });
    await expect(
      uploadReleaseAssets({
        tag: "v4.4.0",
        repo: "a1121611810/Pictelio",
        paths: [apks[0], apks[2]],
        gh,
      }),
    ).resolves.toMatchObject({
      failed: [{ name: "lynx.apk", attempts: 3 }],
      succeeded: [{ name: "full.apk" }],
    });
  }, 20000);

  it("stderr 只保留 8KB 尾部", async () => {
    const tail = "x".repeat(20000);
    const gh = makeFakeGh({ fail: { "full.apk": { times: 3, stderr: tail } } });
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: [apks[0]],
      gh,
    });
    expect(report.failed[0].stderrTail.length).toBeLessThanOrEqual(8192);
    expect(report.failed[0].stderrTail.endsWith(tail.slice(-8192))).toBe(true);
  }, 20000);

  it("文件不存在：该包 failed（attempts=1），不调用 gh", async () => {
    const gh = makeFakeGh();
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: [join(dir, "missing.apk")],
      gh,
    });
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].attempts).toBe(1);
    expect(report.failed[0].stderrTail).toBeTruthy();
    expect(gh.calls).toHaveLength(0);
  });

  it("render 收到 started → succeeded → summary 事件", async () => {
    const events = [];
    const gh = makeFakeGh();
    await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: [apks[0]],
      gh,
      render: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual(["started", "succeeded", "summary"]);
    expect(events[0]).toMatchObject({ type: "started", name: "full.apk", size: 2 * MIB });
    expect(events[2]).toMatchObject({
      type: "summary",
      report: { succeeded: [{ name: "full.apk" }] },
    });
  });
});
