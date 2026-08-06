// 逐包上传编排深模块（ADR-0065）
//
// 接口（外部 seam）：
//   uploadReleaseAssets({ tag, repo, paths, gh?, render? }) → Promise<UploadReport>
//
// 契约/不变量：
//   - paths 非空数组，且 basename 必须互异（并发同名资产会产生「先删后传」竞争，启动前拒绝）。
//   - 上传失败不 throw 整个调用：逐包进 failed[]，调用方自行决定是否让步骤失败。
//   - 并发数 = paths.length（≤3，无需 worker pool）；单包最多 3 次尝试，失败后等待 1s/2s/4s。
//   - 报告顺序与输入顺序一致。
//   - Node 进程不读取 APK 内容（gh 子进程流式读盘）；不处理任何凭证（认证完全交给 gh）。

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_STDERR = 8 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 生产 gh 适配器：spawn + 管道，stderr 只保留 8KB 尾部（不整段缓冲）。
function defaultGhUpload(args) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-MAX_STDERR);
    });
    child.on("error", (err) => {
      const e = new Error(`gh 启动失败: ${err.message}`);
      e.stderr = stderrTail;
      reject(e);
    });
    child.on("close", (code) => {
      const elapsedMs = Date.now() - start;
      if (code === 0) {
        resolve({ elapsedMs });
        return;
      }
      const e = new Error(`gh release upload 失败 (退出码 ${code})`);
      e.stderr = stderrTail;
      reject(e);
    });
  });
}

async function uploadOne({ tag, repo, path, gh, render }) {
  let size;
  try {
    ({ size } = await stat(path));
  } catch (e) {
    render({
      type: "failed",
      name: basename(path),
      attempts: 1,
      stderrTail: String(e.message || e),
    });
    return Promise.reject({ attempts: 1, stderrTail: String(e.message || e) });
  }
  const name = basename(path);
  render({ type: "started", name, size });

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { elapsedMs } = await gh([
        "release",
        "upload",
        tag,
        "--repo",
        repo,
        "--clobber",
        resolvePath(path),
      ]);
      const avgMBps = Math.round((size / 1048576 / (elapsedMs / 1000)) * 100) / 100;
      render({ type: "succeeded", name, size, elapsedMs, avgMBps });
      return { size, elapsedMs, avgMBps };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = BACKOFF_MS[attempt - 1];
        render({ type: "retry", name, attempt, delayMs });
        await sleep(delayMs);
      }
    }
  }
  const stderrTail = String(lastErr?.stderr ?? lastErr?.message ?? lastErr).slice(-MAX_STDERR);
  render({ type: "failed", name, attempts: MAX_ATTEMPTS, stderrTail });
  return Promise.reject({ attempts: MAX_ATTEMPTS, stderrTail });
}

export async function uploadReleaseAssets({
  tag,
  repo,
  paths,
  gh = defaultGhUpload,
  render = () => {},
}) {
  const startAll = Date.now();
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths 不能为空");
  }
  const names = paths.map((p) => basename(p));
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`路径 basename 重复: ${name}`);
    }
    seen.add(name);
  }

  const settled = await Promise.allSettled(
    paths.map((p) => uploadOne({ tag, repo, path: p, gh, render })),
  );

  const succeeded = [];
  const failed = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      succeeded.push({ name: names[i], ...result.value });
    } else {
      failed.push({ name: names[i], ...result.reason });
    }
  });

  const report = { succeeded, failed, totalElapsedMs: Date.now() - startAll };
  render({ type: "summary", report });
  return report;
}
