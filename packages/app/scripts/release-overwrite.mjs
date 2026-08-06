#!/usr/bin/env node

/**
 * ReleaseOverwriter —— 覆盖发布模块（deep module）
 *
 * 对已存在且已发布的 GitHub Release 做覆盖更新：
 *   - 更新 title / notes 文案（gh release edit）
 *   - 覆盖 / 补齐 APK 资产（gh release upload --clobber）
 * 不 bump 版本号、不移动 tag、不创建新 commit。
 *
 * Interface（仅两个导出函数）：
 *   planOverwrite(input)      → OverwritePlan   纯逻辑，零副作用（可单测、可展示）
 *   executeOverwrite(plan)    → OverwriteResult 副作用执行（gh 进程调用），依赖注入
 *
 * 硬约束：
 *   覆盖发布 versionCode 不变 → 已安装用户无法通过系统覆盖安装获得新 APK。
 *   本模块只修正 GitHub Release 页面的文案与资产；代码功能修复请发布新版本。
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { parseVersion, DEFAULT_VARIANTS, runOutputAsync } from "./lib/release-utils.mjs";

/**
 * 远端状态探测（纯逻辑，run 依赖注入便于单测四分支）。
 * git ls-remote（tag 存在性）与 gh release view（Release 状态）互不依赖，并行发起。
 *
 * @param {object} input
 * @param {string} input.tag    远端 tag，如 "v4.2.4"
 * @param {string} input.repo   GitHub 仓库，如 "a1121611810/pixivizer"
 * @param {(cmd: string, args: string[]) => Promise<string>} [input.run] 进程调用（默认 runOutputAsync）
 * @returns {Promise<{tag: string|null, release: {exists: boolean, draft: boolean, assets: string[]}|null}>}
 * @throws 网络异常（ls-remote 失败）时抛出，与"tag 不存在"区分
 */
export async function probeRemote({ tag, repo, run = runOutputAsync }) {
  const [refsResult, viewResult] = await Promise.allSettled([
    run("git", ["ls-remote", "--tags", "origin", tag]),
    run("gh", ["release", "view", tag, "--repo", repo, "--json", "isDraft,assets"]),
  ]);
  // ls-remote 失败 = 网络异常（显式中止，避免误判为版本问题）；gh view 失败 = Release 不存在
  if (refsResult.status === "rejected") {
    throw new Error("无法检查远端 tag（网络异常），已中止覆盖发布。请检查网络后重试");
  }
  if (!refsResult.value.includes(`refs/tags/${tag}`)) {
    return { tag: null, release: null };
  }
  if (viewResult.status === "rejected") {
    return { tag, release: null };
  }
  const view = JSON.parse(viewResult.value);
  return {
    tag,
    release: { exists: true, draft: view.isDraft, assets: view.assets.map((a) => a.name) },
  };
}

/**
 * 纯逻辑：输入 → 覆盖计划，零副作用。
 *
 * @param {object} input
 * @param {string} input.version      package.json version，如 "4.2.4"
 * @param {string[]} [input.variants] 期望变体，默认全量三变体
 * @param {string} input.repo         GitHub 仓库，如 "a1121611810/pixivizer"
 * @param {{flavor: string, path: string|null}[]} input.localApks 本地 APK 探测结果（null=未构建）
 * @param {{tag: string|null, release: {exists: boolean, draft: boolean, assets: string[]}|null}} input.remote 远端状态
 * @param {string|null} [input.notes] 新文案（null = 本次不更新文案）
 * @returns {{
 *   tag: string, title: string, repo: string, notes: string|null,
 *   assetsToUpload: string[], assetsToReplace: string[], assetsMissing: string[],
 *   buildRequired: string[], needsBackup: boolean, warnings: string[],
 * }}
 */
export function planOverwrite({
  version,
  variants = [...DEFAULT_VARIANTS],
  repo,
  localApks,
  remote,
  notes = null,
  includeAssets = true, // false = 仅文案模式：不备份、不覆盖/上传任何资产
}) {
  // ── 校验（全部在此，调用方无需重复） ──
  const parsed = parseVersion(version); // 格式 + versionCode 范围

  if (!remote?.tag) {
    throw new Error(`远端 tag v${version} 不存在，无法覆盖发布。若为新版本请走正常发布`);
  }
  if (remote.tag !== `v${version}`) {
    throw new Error(
      `package.json 版本 ${version} 与远端 Release tag ${remote.tag} 不一致。覆盖发布只允许对当前版本操作，请检查版本号`,
    );
  }
  if (!remote.release) {
    throw new Error(`Release ${remote.tag} 不存在。请先创建 Release 再覆盖，或走正常发布`);
  }
  if (remote.release.draft) {
    throw new Error(
      `Release ${remote.tag} 是 draft，不能覆盖。请先发布（gh release edit ${remote.tag} --draft=false）`,
    );
  }

  // ── 差异检测 ──
  const versionCode = parsed.major * 10_000 + parsed.minor * 100 + parsed.patch;
  const expectedAssets = variants.map((f) => `pictelio-${version}-${f}.apk`);
  const remoteAssets = remote.release.assets ?? [];
  const assetsMissing = expectedAssets.filter((a) => !remoteAssets.includes(a));
  const assetsToReplace = expectedAssets.filter((a) => remoteAssets.includes(a));
  const extraRemote = remoteAssets.filter((a) => !expectedAssets.includes(a));

  const pathByFlavor = new Map(localApks.map((x) => [x.flavor, x.path]));
  const assetsToUpload = includeAssets
    ? variants.filter((f) => pathByFlavor.get(f)).map((f) => pathByFlavor.get(f))
    : [];
  const buildRequired = includeAssets ? variants.filter((f) => !pathByFlavor.get(f)) : [];

  const needsBackup = includeAssets && assetsToReplace.length > 0;

  // ── 警告（确认前展示） ──
  const warnings = [
    `覆盖发布不会 bump 版本号（versionCode 仍为 ${versionCode}）：已安装 ${version} 的用户无法通过系统覆盖安装获得新 APK。` +
      `本操作仅修正 GitHub Release 页面的文案与资产；代码功能修复请发布新版本（如 v${parsed.major}.${parsed.minor}.${parsed.patch + 1}）。`,
  ];
  if (extraRemote.length > 0) {
    warnings.push(
      `远端存在不属于本版本的资产（${extraRemote.join(", ")}），将保留并存，不会被删除。`,
    );
  }
  if (buildRequired.length > 0) {
    warnings.push(
      `本地缺少以下变体 APK：${buildRequired.join(", ")}。本次覆盖将不包含它们（请先构建或检查 --variants）。`,
    );
  }
  if (!includeAssets) {
    warnings.push("已选择仅文案模式：不会备份、覆盖或上传任何 APK 资产。");
  }

  return {
    tag: remote.tag,
    title: `Pictelio v${version}`,
    repo,
    notes,
    assetsToUpload,
    assetsToReplace,
    assetsMissing,
    buildRequired,
    needsBackup,
    warnings,
  };
}

/**
 * 副作用执行：备份 → 更新文案 → 覆盖上传资产 → 失败自动恢复。
 *
 * @param {ReturnType<typeof planOverwrite>} plan
 * @param {object} deps
 * @param {(args: string[]) => Promise<void>} deps.runGh gh 进程调用（可注入 mock；args 不含可执行名）
 * @param {boolean} [deps.dryRun] true = 只打印将执行的 gh 命令，零调用
 * @returns {Promise<{edited: boolean, uploaded: string[], restored: string[], dryRun: boolean}>}
 */
export async function executeOverwrite(plan, { runGh, dryRun = false }) {
  const result = { edited: false, uploaded: [], restored: [], dryRun };
  const tmpDirs = [];
  let backupDir = null;
  let keepBackup = false; // 主上传失败后置位：保留备份目录供人工恢复/重试

  try {
    // ── 1. 备份：覆盖前下载旧资产到临时目录（clobber 先删后传，失败可恢复） ──
    if (plan.needsBackup && plan.assetsToUpload.length > 0) {
      backupDir = await mkdtemp(resolvePath(tmpdir(), "pictelio-overwrite-backup-"));
      tmpDirs.push(backupDir);
      if (dryRun) {
        console.log(
          `[release] [dry-run] gh release download ${plan.tag} --repo ${plan.repo} --dir ${backupDir}`,
        );
      } else {
        await runGh(["release", "download", plan.tag, "--repo", plan.repo, "--dir", backupDir]);
      }
    }

    // ── 2. 更新文案 ──
    if (plan.notes !== null) {
      if (dryRun) {
        console.log(
          `[release] [dry-run] gh release edit ${plan.tag} --repo ${plan.repo} --title "${plan.title}" --notes-file <临时文件>`,
        );
      } else {
        const notesDir = await mkdtemp(resolvePath(tmpdir(), "pictelio-overwrite-notes-"));
        tmpDirs.push(notesDir);
        const notesFile = resolvePath(notesDir, "release-notes.md");
        await writeFile(notesFile, plan.notes, "utf-8");
        await runGh([
          "release",
          "edit",
          plan.tag,
          "--repo",
          plan.repo,
          "--title",
          plan.title,
          "--notes-file",
          notesFile,
        ]);
        // edited 仅在真正执行后为 true（dryRun 不置位）
        result.edited = true;
      }
    }

    // ── 3. 覆盖上传资产（3 次重试；失败从备份恢复被删资产） ──
    if (plan.assetsToUpload.length > 0) {
      const uploadArgs = [
        "release",
        "upload",
        plan.tag,
        "--repo",
        plan.repo,
        "--clobber",
        ...plan.assetsToUpload,
      ];
      if (dryRun) {
        console.log(`[release] [dry-run] gh ${uploadArgs.join(" ")}`);
      } else {
        let lastErr;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await runGh(uploadArgs);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 3) {
              const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
              console.log(`[release] APK 上传失败（第 ${attempt} 次），${delay / 1000}s 后重试...`);
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }
        if (lastErr) {
          keepBackup = true; // 失败路径保留备份，供自动恢复失败后人工处理
          if (backupDir) {
            for (const asset of plan.assetsToReplace) {
              try {
                // 恢复同样使用 --clobber：若旧资产仍存在（主上传在删除前失败），
                // 不带 --clobber 的上传会因同名资产已存在而失败，恢复将落空。
                await runGh([
                  "release",
                  "upload",
                  plan.tag,
                  "--repo",
                  plan.repo,
                  "--clobber",
                  resolvePath(backupDir, asset),
                ]);
                result.restored.push(asset);
              } catch (restoreErr) {
                console.error(`[release] ⚠ 从备份恢复失败: ${asset}: ${restoreErr.message}`);
              }
            }
          }
          lastErr.message =
            `${lastErr.message}\n已尝试从备份恢复被覆盖的资产: ${result.restored.join(", ") || "无"}。` +
            (backupDir ? `\n备份目录已保留：${backupDir}` : "");
          throw lastErr;
        }
        result.uploaded = plan.assetsToUpload.map((p) => p.split(/[\\/]/u).pop());
      }
    }
  } finally {
    if (keepBackup && backupDir) {
      console.log(
        `[release] ⚠ 覆盖上传失败，备份保留于: ${backupDir}。` +
          `可重跑本命令（将重新下载备份），或从该目录手动 gh release upload --clobber。`,
      );
      // 保留备份目录，仅清理其他临时目录
      for (const dir of tmpDirs) {
        if (dir !== backupDir) {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return result;
}
