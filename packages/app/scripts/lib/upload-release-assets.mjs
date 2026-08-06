// Node https 原生 release asset 上传器（研究：docs/research/github-release-upload-acceleration.md 附录 B/C）
//
// 替代 gh release upload 的上传段：直接调 GitHub REST API（uploads.github.com），
// 实测端到端吞吐约为 gh 的 2.1×（缓存 upload_url 复用连接 + 并发；gh 每次调用都重新 FetchRelease）。
//
// 设计：
//   - 默认直连：Node https 不读代理环境变量，绕过代理（实测直连更快且无 api.github.com 403 风险）。
//   - token：`gh auth token`（gh keyring），不写入环境变量、不打印日志。
//   - clobber：上传返回 422（同名已存在）→ 查 assets 列表 → DELETE 同名 → 重传一次（对齐 gh --clobber）。
//   - 错误语义：网络错误/5xx 标 retryable（由 release-uploader 的 uploadOne 层 1s/2s/4s 退避重试）；
//     其他 4xx 标 permanent 立即失败（如 401 token 无效、422 处理后的残余冲突）。

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import https from "node:https";

const API_BASE = "https://api.github.com";
const MAX_BODY_TAIL = 8 * 1024;
const STREAM_HWM = 64 * 1024;
const UA = "pictelio-release/1.0 (+https://github.com/a1121611810/pixivizer)";

// ── token ──

/**
 * 从 gh keyring 取 token（不打印、不进环境变量）。
 * @returns {Promise<string>}
 */
export function getGhToken() {
  return new Promise((resolve, reject) => {
    execFile("gh", ["auth", "token"], { encoding: "utf8", maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`gh auth token 失败: ${err.message}`));
        return;
      }
      const token = stdout.trim().split(/\r?\n/u)[0].trim();
      if (!token) {
        reject(new Error("gh auth token 返回空，请先 gh auth login"));
        return;
      }
      resolve(token);
    });
  });
}

// ── 纯工具（可独立单测） ──

// uploadReleaseAssets 的 gh(args) seam 形状（见 release-uploader.mjs uploadOne）：
//   ["release","upload",tag,"--repo",repo,"--clobber",resolvePath(path)]
export function parseGhUploadArgs(args) {
  if (
    !Array.isArray(args) ||
    args[0] !== "release" ||
    args[1] !== "upload" ||
    args[3] !== "--repo" ||
    args[5] !== "--clobber"
  ) {
    throw new Error(`无法识别的上传参数形状: ${JSON.stringify(args)}`);
  }
  return { tag: args[2], repo: args[4], path: args[6] };
}

// GitHub 返回的 upload_url 形如
//   https://uploads.github.com/repos/{o}/{r}/releases/{id}/assets{?name,label}
// 剥掉花括号模板部分。
export function cleanUploadUrl(uploadUrl) {
  return String(uploadUrl).replace(/\{[^}]*\}$/u, "");
}

// ── 网络层 ──

// socket 空闲超时：慢链路是持续有数据的（38KB/s 也在流动），不会误杀；
// 只兜底「坏网络无数据挂起」。触发后 destroy → error → 按网络错误重试。
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 生产网络层：单个 https 请求。
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.method
 * @param {Record<string,string>} [opts.headers]
 * @param {import("node:stream").Readable} [opts.body] 请求体流（自动 end）
 * @returns {Promise<{status: number, body: string}>}
 */
export function defaultRequest({ url, method, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          "User-Agent": UA,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.setTimeout(IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`请求超时（socket 空闲超过 ${IDLE_TIMEOUT_MS / 60000} 分钟）`));
    });
    req.on("error", reject);
    if (body) {
      body.on("error", reject);
      body.pipe(req); // pipe 自动处理 backpressure，流结束时自动 end
    } else {
      req.end();
    }
  });
}

// ── 内部错误构造 ──

function apiError(message, { status, body, retryable }) {
  const tail = String(body ?? "")
    .replace(/\s+/gu, " ")
    .slice(-MAX_BODY_TAIL);
  const err = new Error(`${message}${tail ? `: ${tail}` : ""}`);
  err.stderr = tail || message;
  if (retryable) err.retryable = true;
  else err.permanent = true;
  if (status !== undefined) err.status = status;
  return err;
}

function withBearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// GET /repos/{repo}/releases/tags/{tag} → { id, upload_url }
async function fetchReleaseInfo({ request, token, repo, tag }) {
  const url = `${API_BASE}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const res = await request({
    url,
    method: "GET",
    headers: withBearer(token),
  });
  if (res.status === 200) {
    let json;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw apiError(`解析 release 响应失败`, { status: res.status, body: res.body });
    }
    if (!json.upload_url || !json.id) {
      throw apiError(`release 响应缺少 upload_url/id`, { status: res.status, body: res.body });
    }
    return { id: json.id, uploadUrl: cleanUploadUrl(json.upload_url) };
  }
  if (res.status >= 500) {
    throw apiError(`获取 release 信息失败 (HTTP ${res.status})`, {
      status: res.status,
      body: res.body,
      retryable: true,
    });
  }
  throw apiError(`获取 release 信息失败 (HTTP ${res.status})`, {
    status: res.status,
    body: res.body,
  });
}

// POST {upload_url}?name={name}，body 为文件流。
async function uploadAsset({ request, token, uploadUrl, name, size, path }) {
  const url = new URL(uploadUrl);
  url.searchParams.set("name", name);
  const res = await request({
    url: url.toString(),
    method: "POST",
    headers: {
      ...withBearer(token),
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
    },
    body: createReadStream(path, { highWaterMark: STREAM_HWM }),
  });
  if (res.status >= 200 && res.status < 300) return;
  if (res.status === 422) {
    throw apiError("上传返回 422（同名资产已存在，将触发 clobber）", {
      status: res.status,
      body: res.body,
    });
  }
  if (res.status >= 500) {
    throw apiError(`上传失败 (HTTP ${res.status})`, {
      status: res.status,
      body: res.body,
      retryable: true,
    });
  }
  throw apiError(`上传失败 (HTTP ${res.status})`, { status: res.status, body: res.body });
}

// GET /repos/{repo}/releases/{releaseId}/assets → 同名资产 id（无则 null）
async function findAssetIdByName({ request, token, repo, releaseId, name }) {
  const url = `${API_BASE}/repos/${repo}/releases/${releaseId}/assets?per_page=100`;
  const res = await request({ url, method: "GET", headers: withBearer(token) });
  if (res.status !== 200) {
    throw apiError(`获取资产列表失败 (HTTP ${res.status})`, {
      status: res.status,
      body: res.body,
      retryable: res.status >= 500,
    });
  }
  let list;
  try {
    list = JSON.parse(res.body);
  } catch {
    throw apiError("解析资产列表失败", { status: res.status, body: res.body });
  }
  const hit = list.find((a) => a && a.name === name);
  return hit ? hit.id : null;
}

// DELETE /repos/{repo}/releases/assets/{assetId}
async function deleteAsset({ request, token, repo, assetId }) {
  const url = `${API_BASE}/repos/${repo}/releases/assets/${assetId}`;
  const res = await request({ url, method: "DELETE", headers: withBearer(token) });
  if (res.status !== 204 && res.status !== 200) {
    throw apiError(`删除旧资产失败 (HTTP ${res.status})`, {
      status: res.status,
      body: res.body,
      retryable: res.status >= 500,
    });
  }
}

// ── 上传器工厂 ──

/**
 * 创建 Node 原生上传适配器（兼容 uploadReleaseAssets 的 gh(args) seam）。
 *
 * @param {object} [deps]
 * @param {typeof defaultRequest} [deps.request] 网络层（单测注入 fake）
 * @param {() => Promise<string>} [deps.getToken] token 提供者（默认 gh keyring）
 * @param {() => number} [deps.now]
 * @returns {(args: string[]) => Promise<{elapsedMs: number}>}
 */
export function createNodeUploader({
  request = defaultRequest,
  getToken = getGhToken,
  now = Date.now,
} = {}) {
  let tokenPromise = null;
  let releaseCache = null; // { tag, promise }（promise 级缓存：并发上传共享一次 GET）

  return async function nodeUpload(args) {
    const { tag, repo, path } = parseGhUploadArgs(args);
    const { size } = await stat(path);

    tokenPromise ??= getToken().catch((e) => {
      tokenPromise = null; // 失败后下次重试重新获取
      throw e;
    });
    const token = await tokenPromise;

    if (!releaseCache || releaseCache.tag !== tag) {
      releaseCache = {
        tag,
        promise: fetchReleaseInfo({ request, token, repo, tag }).catch((e) => {
          if (releaseCache?.tag === tag) releaseCache = null; // 失败后下次重新获取
          throw e;
        }),
      };
    }
    const { id: releaseId, uploadUrl } = await releaseCache.promise;
    const name = path.split(/[\\/]/u).pop();

    const started = now();
    try {
      await uploadAsset({ request, token, uploadUrl, name, size, path });
      return { elapsedMs: now() - started };
    } catch (e) {
      if (e.status === 422) {
        // clobber：先删同名再重传一次（对齐 gh --clobber）
        const assetId = await findAssetIdByName({ request, token, repo, releaseId, name });
        if (assetId === null) {
          throw apiError(`422 但资产列表中未找到同名资产 "${name}"`, {
            status: 422,
            body: e.stderr,
          });
        }
        await deleteAsset({ request, token, repo, assetId });
        await uploadAsset({ request, token, uploadUrl, name, size, path });
        return { elapsedMs: now() - started };
      }
      throw e;
    }
  };
}
