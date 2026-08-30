// release-webonly.mjs —— web-only 发布模式的纯逻辑（#255）
//
// 从 release.mjs 提取的可测纯函数：release.mjs 是 CLI 编排脚本（顶层执行 main() +
// TTY 检查 + process.exit），不可直接单测——先例：release-overwrite.mjs 的
// plan/execute 分离、release-bundle-core.mjs 的 plan 构造。
//   parseWebOnlyArgs(argv)   参数解析（--web-only / --min-web=x.y.z）
//   buildVersionJson(...)    version.json 内容构造（正常发布与 web-only 共用双坐标语义）

import { bundleAssetUrlBase } from "./release-bundle-core.mjs";

/**
 * 解析 web-only 相关 CLI 参数（release.mjs 顶层调用；解析风格对齐 --variants=）。
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ isWebOnly: boolean, minWeb: string|undefined, error: string|null }}
 *   - isWebOnly：是否传入 --web-only
 *   - minWeb：--min-web=x.y.z 的 trim 后值，x.y.z 格式校验通过；undefined = 未提供
 *     （step 2 缺省继承旧 version.json 的 minWebVersion，旧文件无该字段 = 不设门槛）
 *   - error：非空时调用方应终止（消息含用户可读原因），minWeb 无有效值
 */
export function parseWebOnlyArgs(argv) {
  const isWebOnly = new Set(argv).has("--web-only");
  const raw = argv.find((a) => a.startsWith("--min-web="))?.slice("--min-web=".length);
  if (raw === undefined) {
    return { isWebOnly, minWeb: undefined, error: null };
  }
  const minWeb = raw.trim();
  if (!/^\d+\.\d+\.\d+$/u.test(minWeb)) {
    return {
      isWebOnly,
      minWeb: undefined,
      error: `--min-web 值无效，需要 x.y.z 格式（如 --min-web=4.21.0），收到: ${raw}`,
    };
  }
  return { isWebOnly, minWeb, error: null };
}

/**
 * 构造 version.json 内容（双坐标语义，规格 docs/specs/ota-web-bundle.md「版本与数据源」）：
 *   version              = APK 坐标（APK 弹窗比较对象）：正常发布传 apkVersion = newVersion；
 *                          web-only 传从旧 version.json 继承的已发布 APK 版本（不前进，弹窗不响）
 *   url                  = 新 tag 的 Release 页（web-only 也指向本次 tag，version 与 url 解耦）
 *   webBundle.version    = bundle 坐标（OTA 与 floor 比较对象）：一律 = newVersion（前进）
 *   webBundle.url        = 三件套资产前缀 URL（App 端自行拼 -manifest.json 等后缀）
 *   minWebVersion        = floor（web 层最低可用版本）：undefined = 不写字段（App 端 fail-open）
 *
 * @param {object} input
 * @param {string} input.newVersion   本次发布版本（package.json bump 结果，= webBundle.version）
 * @param {string} input.apkVersion   version 字段（web-only = 旧 APK 版本；正常发布 = newVersion）
 * @param {string} input.repo         GitHub repo slug（如 a1121611810/Pictelio，动态取 git remote）
 * @param {string} input.tag          Release tag（如 v4.22.0）
 * @param {string} input.changelog    截断后的 changelog 文本
 * @param {string|undefined} [input.minWebVersion] 覆写/继承后的 floor 值
 * @returns {string} 格式化 JSON（双空格缩进 + 尾随换行，对齐落盘格式）
 */
export function buildVersionJson({ newVersion, apkVersion, repo, tag, changelog, minWebVersion }) {
  return (
    JSON.stringify(
      {
        version: apkVersion,
        // P7：repo 名动态取 git remote，避免硬编码旧 repo 名
        url: `https://github.com/${repo}/releases/tag/${tag}`,
        changelog,
        // #250 新增：web 层最低可用版本（floor，缺省/未继承到 = 不设门槛，App 端 fail-open）；
        // 旧 APK 客户端只读已知字段，新增字段零影响（ADR-0089 单一事实源扩展）
        ...(minWebVersion !== undefined ? { minWebVersion } : {}),
        // #250 新增：OTA 元数据（url 为三件套资产前缀，App 端自行拼 -manifest.json 等后缀）
        webBundle: {
          version: newVersion,
          url: bundleAssetUrlBase(newVersion, repo),
        },
      },
      null,
      2,
    ) + "\n"
  );
}
