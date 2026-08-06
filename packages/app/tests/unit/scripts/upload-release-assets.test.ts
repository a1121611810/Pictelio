import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseGhUploadArgs,
  cleanUploadUrl,
  createNodeUploader,
} from "../../../scripts/lib/upload-release-assets.mjs";
import { uploadReleaseAssets } from "../../../scripts/lib/release-uploader.mjs";

const MIB = 1048576;

// GitHub 真实响应样例（upload_url 形状来自官方 REST 文档 / 实测响应）
const RELEASE_JSON = JSON.stringify({
  id: 123,
  tag_name: "v4.4.0",
  upload_url:
    "https://uploads.github.com/repos/a1121611810/Pictelio/releases/123/assets{?name,label}",
});

// 可路由的 fake 网络层：{ method, url(子串或谓词), response(对象或函数/Error) }
function makeRequest(routes) {
  const calls = [];
  const request = async ({ url, method, headers = {} }) => {
    calls.push({ url, method, hasAuth: Boolean(headers.Authorization) });
    const route = routes.find(
      (r) =>
        r.method === method && (typeof r.url === "function" ? r.url(url) : url.includes(r.url)),
    );
    if (!route) {
      throw new Error(`unexpected request: ${method} ${url}`);
    }
    const res = typeof route.response === "function" ? route.response(url) : route.response;
    if (res instanceof Error) throw res;
    return res;
  };
  request.calls = calls;
  return request;
}

const routes = ({ uploadStatus = 201, existingAsset = null } = {}) => [
  {
    method: "GET",
    url: (u) => u.includes("/releases/tags/"),
    response: { status: 200, body: RELEASE_JSON },
  },
  {
    method: "POST",
    url: "/assets?name=",
    response:
      uploadStatus === 422
        ? { status: 422, body: '{"errors":[{"code":"already_exists"}]}' }
        : { status: uploadStatus, body: "{}" },
  },
  {
    method: "GET",
    url: "/assets?per_page=100",
    response: { status: 200, body: JSON.stringify(existingAsset ? [existingAsset] : []) },
  },
  {
    method: "DELETE",
    url: `/assets/${existingAsset?.id ?? 456}`,
    response: { status: 204, body: "" },
  },
];

let dir;
const apks = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pictelio-node-upload-"));
  await mkdir(join(dir, "sub"), { recursive: true });
  apks.push(join(dir, "full.apk"), join(dir, "webview.apk"), join(dir, "lynx.apk"));
  await writeFile(apks[0], Buffer.alloc(2 * MIB));
  await writeFile(apks[1], Buffer.alloc(MIB));
  await writeFile(apks[2], Buffer.alloc(3 * MIB));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const GH_ARGS = (path, tag = "v4.4.0", repo = "a1121611810/Pictelio") => [
  "release",
  "upload",
  tag,
  "--repo",
  repo,
  "--clobber",
  path,
];

describe("parseGhUploadArgs / cleanUploadUrl（纯函数）", () => {
  it("解析 gh(args) seam 形状", () => {
    expect(parseGhUploadArgs(GH_ARGS("/tmp/full.apk"))).toEqual({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      path: "/tmp/full.apk",
    });
  });
  it("形状异常时抛错", () => {
    expect(() => parseGhUploadArgs(["release", "create", "v4.4.0"])).toThrow(/无法识别/u);
  });
  it("剥掉 upload_url 的花括号模板", () => {
    expect(
      cleanUploadUrl(
        "https://uploads.github.com/repos/a1121611810/Pictelio/releases/123/assets{?name,label}",
      ),
    ).toBe("https://uploads.github.com/repos/a1121611810/Pictelio/releases/123/assets");
  });
});

describe("createNodeUploader 上传", () => {
  it("成功：POST 201，带 Bearer token，返回 elapsedMs", async () => {
    const request = makeRequest(routes());
    const getToken = vi.fn(async () => "fake-token");
    let t = 0;
    const uploader = createNodeUploader({ request, getToken, now: () => (t += 5) });
    const { elapsedMs } = await uploader(GH_ARGS(apks[0]));
    expect(elapsedMs).toBe(5);
    const uploadCall = request.calls.find((c) => c.method === "POST");
    expect(uploadCall.url).toContain("/assets?name=full.apk");
    expect(uploadCall.hasAuth).toBe(true);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("token 与 release 信息按 tag 缓存：并发 3 文件仅 1 次取 token + 1 次 GET release", async () => {
    const request = makeRequest(routes());
    const getToken = vi.fn(async () => "fake-token");
    const uploader = createNodeUploader({ request, getToken });
    const results = await Promise.all(apks.map((p) => uploader(GH_ARGS(p))));
    expect(results).toHaveLength(3);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(
      request.calls.filter((c) => c.method === "GET" && c.url.includes("/releases/tags/")),
    ).toHaveLength(1);
    expect(request.calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });

  it("换 tag 重新获取 release 信息", async () => {
    const request = makeRequest(routes());
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    await uploader(GH_ARGS(apks[0], "v4.4.0"));
    await uploader(GH_ARGS(apks[0], "v4.4.1"));
    expect(
      request.calls.filter((c) => c.method === "GET" && c.url.includes("/releases/tags/")),
    ).toHaveLength(2);
  });

  it("网络错误（request reject）：抛错且不标 permanent（由上层重试）", async () => {
    const request = makeRequest([
      {
        method: "GET",
        url: "/releases/tags/v4.4.0",
        response: () => {
          throw new Error("socket hang up");
        },
      },
    ]);
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    const err = await uploader(GH_ARGS(apks[0])).catch((e) => e);
    expect(err.message).toContain("socket hang up");
    expect(err.permanent).toBeUndefined(); // 网络错误可重试，不标 permanent
    expect(err.retryable).toBeUndefined();
  });

  it("HTTP 5xx：抛 retryable（不标 permanent）", async () => {
    const request = makeRequest(routes({ uploadStatus: 502 }));
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    const err = await uploader(GH_ARGS(apks[0])).catch((e) => e);
    expect(err.permanent).toBeUndefined(); // 5xx 可重试
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(502);
  });

  it("HTTP 401：标 permanent", async () => {
    const request = makeRequest(routes({ uploadStatus: 401 }));
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    const err = await uploader(GH_ARGS(apks[0])).catch((e) => e);
    expect(err.permanent).toBe(true);
    expect(err.status).toBe(401);
  });

  it("422 → clobber：查列表 → 删同名 → 重传成功", async () => {
    const existingAsset = { id: 456, name: "full.apk" };
    // 上传第一次 422，第二次成功：按 POST 次数切换响应
    const request = makeRequest([
      {
        method: "GET",
        url: "/releases/tags/v4.4.0",
        response: { status: 200, body: RELEASE_JSON },
      },
      {
        method: "POST",
        url: "/assets?name=",
        response: (() => {
          let n = 0;
          return () =>
            ++n === 1
              ? { status: 422, body: '{"errors":[{"code":"already_exists"}]}' }
              : { status: 201, body: "{}" };
        })(),
      },
      {
        method: "GET",
        url: "/assets?per_page=100",
        response: { status: 200, body: JSON.stringify([existingAsset]) },
      },
      {
        method: "DELETE",
        url: "/assets/456",
        response: { status: 204, body: "" },
      },
    ]);
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    await expect(uploader(GH_ARGS(apks[0]))).resolves.toMatchObject({
      elapsedMs: expect.any(Number),
    });
    const methods = request.calls.map((c) => c.method);
    expect(methods).toEqual(["GET", "POST", "GET", "DELETE", "POST"]); // 422 → 查 → 删 → 重传
  });

  it("422 但列表无同名资产：标 permanent（不无限循环）", async () => {
    const request = makeRequest(routes({ uploadStatus: 422, existingAsset: null }));
    const uploader = createNodeUploader({ request, getToken: async () => "t" });
    await expect(uploader(GH_ARGS(apks[0]))).rejects.toMatchObject({
      permanent: true,
      message: /未找到同名资产/u,
    });
  });
});

describe("uploadReleaseAssets × Node 上传器集成（uploadOne 层）", () => {
  it("permanent 错误不重试：attempts=1，其余包正常", async () => {
    const request = makeRequest(routes());
    // lynx.apk 上传返回 401（permanent）→ uploadOne 应立即失败不重试
    const lynxRequest = makeRequest(routes({ uploadStatus: 401 }));
    // 分别构造：full/webview 走正常路由；lynx 走 401
    const hybrid = async ({ url, method }) => {
      if (url.includes("name=lynx.apk")) {
        return lynxRequest({ url, method });
      }
      return request({ url, method });
    };
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: apks,
      gh: createNodeUploader({ request: hybrid, getToken: async () => "t" }),
    });
    expect(report.succeeded.map((s) => s.name)).toEqual(["full.apk", "webview.apk"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].name).toBe("lynx.apk");
    expect(report.failed[0].attempts).toBe(1); // permanent：不做 3 次重试
  }, 20000);

  it("网络错误仍走 1s/2s 退避重试（与 gh 适配器行为一致）", async () => {
    // 首次 GET release 网络错误 → 重试 2 次后成功
    const request = makeRequest([
      {
        method: "GET",
        url: "/releases/tags/v4.4.0",
        response: (() => {
          let n = 0;
          return () =>
            ++n <= 2 ? { status: 502, body: "oops" } : { status: 200, body: RELEASE_JSON };
        })(),
      },
      {
        method: "POST",
        url: "/assets?name=",
        response: { status: 201, body: "{}" },
      },
    ]);
    const delays = [];
    const report = await uploadReleaseAssets({
      tag: "v4.4.0",
      repo: "a1121611810/Pictelio",
      paths: [apks[0]],
      gh: createNodeUploader({ request, getToken: async () => "t" }),
      render: (e) => {
        if (e.type === "retry") delays.push(e.delayMs);
      },
    });
    expect(delays).toEqual([1000, 2000]);
    expect(report.failed).toEqual([]);
    expect(report.succeeded[0].name).toBe("full.apk");
  }, 20000);
});
