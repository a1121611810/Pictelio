// release-version-json.mjs —— version.json 内容构造（可测纯模块）
//
// 为什么要提取成纯模块：release.mjs 是 CLI 编排脚本，顶层即执行 main() + TTY 检查 +
// process.exit，import 即产生副作用，无法直接单测——先例：release-overwrite.mjs 的
// plan/execute 分离。
//
// 契约字段：version / url / changelog（url 为 Release 页地址；update-check 的契约注释
// 列出的 release_url 是消费端的未来扩展兼容项，本模块不产出）。

/**
 * 构造 version.json 内容（单坐标语义：version 就是本次发布的版本）。
 *
 * @param {object} input
 * @param {string} input.version    本次发布版本（package.json bump 结果）
 * @param {string} input.repo       GitHub repo slug（如 a1121611810/Pictelio，动态取 git remote）
 * @param {string} input.tag        Release tag（如 v6.3.0）
 * @param {string} input.changelog  截断后的 changelog 文本
 * @returns {string} 格式化 JSON（双空格缩进 + 尾随换行，对齐落盘格式）
 */
export function buildVersionJson({ version, repo, tag, changelog }) {
  return (
    JSON.stringify(
      {
        version,
        // P7：repo 名动态取 git remote，避免硬编码旧 repo 名
        url: `https://github.com/${repo}/releases/tag/${tag}`,
        changelog,
      },
      null,
      2,
    ) + "\n"
  );
}
