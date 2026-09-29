import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVersionJson } from "../../../scripts/lib/release-version-json.mjs";

// ── oracle 溯源（测试硬约束 6：期望值出处可追溯）──
//
// 1. 字段清单（version / url / changelog）的出处是**消费端契约**而非本模块实现：
//    packages/update-check/src/index.ts 顶部契约注释写明「契约：packages/website/
//    version.json，字段 version / url / release_url / changelog（url 为
//    scripts/release.mjs 生成的历史字段，release_url 为未来扩展兼容项）」——
//    release_url 是消费端的前向兼容项，写入侧不产出，故断言键集合不含它。
// 2. 真实样例：`packages/website/version.json` 是线上已发布的真实产物（2026-09-29 实测
//    version=6.3.0 / tag=v6.3.0 / repo=a1121611810/Pictelio）。下方「真实样例回放」用例
//    直接读该文件取期望值，而非把实现输出抄成常量（backupRulesConsistency 模式）。
// 3. URL 形态 `https://github.com/<repo>/releases/tag/<tag>`：与真实样例文件中的 url 字段
//    逐字比对；tag 形态 `v<version>` 取自真实样例（version 6.3.0 ↔ tag v6.3.0）。
// 4. 序列化格式（双空格缩进 + 尾随换行）：出处是落盘约定——release.mjs step 2 用
//    writeText 落盘该字符串，仓库内所有 JSON 产物（package.json / version.json）统一
//    2 空格缩进 + 末尾换行；docs/release-checklist.md 记录 version.json 是发布文案的
//    四处落点之一（commit body / fastlane / Release notes / version.json），即该文件
//    会被人和工具直接阅读，不接受压缩单行。

// 真实样例文件的绝对路径（tests/unit/scripts → 上溯四级 = packages/website/version.json）
const REAL_VERSION_JSON = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../website/version.json",
);

// 真实样例：线上已发布产物（读取失败即让用例失败，不静默跳过——契约测试的 mock 必须来自真实数据源）
const realVersionJson = JSON.parse(readFileSync(REAL_VERSION_JSON, "utf-8")) as {
  version: string;
  url: string;
  changelog: string;
};

const REPO = "a1121611810/Pictelio";

describe("buildVersionJson", () => {
  it("正常发布：恰好三个字段（version / url / changelog）", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        version: "6.3.0",
        repo: REPO,
        tag: "v6.3.0",
        changelog: "小修复与改进",
      }),
    );
    // 消费端契约（update-check 顶部注释）的写入侧字段集合；release_url 是消费端前向兼容项，
    // 不由发布脚本产出（update-check 对缺失字段 fail-open，不要求写入侧伪造）
    expect(Object.keys(parsed).toSorted()).toEqual(["changelog", "url", "version"]);
    // 键序断言独立于上面的集合断言（toSorted 会抹掉顺序，故必须用未排序的 keys 比）
    expect(Object.keys(parsed)).toEqual(["version", "url", "changelog"]);
  });

  it("OTA 通道下线后不再产出 webBundle / minWebVersion 字段（WebView 留存消费层读到 undefined）", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        version: "6.3.0",
        repo: REPO,
        tag: "v6.3.0",
        changelog: "c",
      }),
    );
    // packages/update-check 的 WebBundleMeta / minWebVersion 属消费端契约字段，缺失时
    // 消费层按「未知字段忽略 + 缺失 = 显式 undefined」处理（update-check 顶部契约注释）
    expect(Object.hasOwn(parsed, "webBundle")).toBe(false);
    expect(Object.hasOwn(parsed, "minWebVersion")).toBe(false);
  });

  it("url = Release 页地址：https://github.com/<repo>/releases/tag/<tag>", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        version: "6.4.0",
        repo: REPO,
        tag: "v6.4.0",
        changelog: "c",
      }),
    );
    expect(parsed.url).toBe(`https://github.com/${REPO}/releases/tag/v6.4.0`);
  });

  it("真实样例回放：用线上 version.json 的 version/repo/tag 重新生成，url 与已发布产物逐字一致", () => {
    // 期望值来自真实产物文件本身（packages/website/version.json），不是从本实现抄来的常量
    const parsed = JSON.parse(
      buildVersionJson({
        version: realVersionJson.version,
        repo: REPO,
        tag: `v${realVersionJson.version}`,
        changelog: realVersionJson.changelog,
      }),
    );
    expect(parsed.url).toBe(realVersionJson.url);
    expect(parsed.version).toBe(realVersionJson.version);
  });

  it("序列化格式锁定：双空格缩进 + 固定键序 + 尾随换行，且是合法 JSON", () => {
    const json = buildVersionJson({
      version: "6.3.0",
      repo: REPO,
      tag: "v6.3.0",
      changelog: "小修复与改进",
    });
    expect(json).toBe(
      [
        "{",
        '  "version": "6.3.0",',
        `  "url": "https://github.com/${REPO}/releases/tag/v6.3.0",`,
        '  "changelog": "小修复与改进"',
        "}",
        "",
      ].join("\n"),
    );
    // 尾随换行 + 可被 JSON.parse 往返（release.mjs step 2 直接把该字符串落盘）
    expect(json.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("changelog 含换行/引号/Markdown 标记 → 正确转义，解析后与原文逐字相等", () => {
    // 真实样例形态：发布文案由 AI 总结或 commit 生成，含换行与 Markdown 标记
    // （docs/release-checklist.md 已知后果：changelog 流入 version.json 后按纯文本渲染）
    const changelog = '# 标题\n\n- **加粗**\n- 引号 " 与反斜杠 \\';
    const parsed = JSON.parse(
      buildVersionJson({ version: "6.3.0", repo: REPO, tag: "v6.3.0", changelog }),
    );
    expect(parsed.changelog).toBe(changelog);
  });
});
