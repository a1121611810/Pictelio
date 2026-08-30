import { describe, expect, it } from "vitest";
import { buildVersionJson, parseWebOnlyArgs } from "../../../scripts/lib/release-webonly.mjs";

// ── oracle 溯源（测试硬约束 6：期望值出处可追溯）──
//
// 1. version.json schema 与双坐标语义：docs/specs/ota-web-bundle.md「版本与数据源」——
//    version = APK 坐标（APK 弹窗比较对象，web-only 继承旧值不前进）；
//    webBundle.version = bundle 坐标（OTA 与 floor 比较对象，一律前进到本次版本）；
//    minWebVersion = floor，缺省不写字段（App 端 fail-open）。
// 2. 真实样例：packages/website/version.json 实测当前值 version=4.21.0、
//    repo=a1121611810/Pictelio（线上单一事实源），继承/覆写场景由此派生
//    （4.21.0 为最后完整 APK 版本，web-only 热修 4.21.1 → 4.21.2）。
// 3. url/webBundle.url 拼装规则：release.mjs 既有行为（P7 动态 repo）+
//    release-bundle-core.mjs 的 bundleAssetUrlBase（独立实现，release-bundle.test.ts 已测）。

const REPO = "a1121611810/Pictelio";

describe("parseWebOnlyArgs", () => {
  it("传入 --web-only → isWebOnly=true（可与 -i 等其余参数共存）", () => {
    expect(parseWebOnlyArgs(["--web-only"]).isWebOnly).toBe(true);
    expect(parseWebOnlyArgs(["-i", "--web-only"]).isWebOnly).toBe(true);
  });

  it("未传 --web-only → isWebOnly=false", () => {
    expect(parseWebOnlyArgs([]).isWebOnly).toBe(false);
    expect(parseWebOnlyArgs(["-i"]).isWebOnly).toBe(false);
  });

  it("--min-web=x.y.z → 返回 trim 后值，error 为空", () => {
    expect(parseWebOnlyArgs(["--min-web=4.21.0"])).toEqual({
      isWebOnly: false,
      minWeb: "4.21.0",
      error: null,
    });
  });

  it("--min-web 值带首尾空白 → 先 trim 再校验并返回 trim 值", () => {
    expect(parseWebOnlyArgs(["--min-web= 4.21.0 "]).minWeb).toBe("4.21.0");
  });

  it("--min-web 值格式无效 → error 非空、minWeb undefined（调用方应终止）", () => {
    const r = parseWebOnlyArgs(["--min-web=4.21"]);
    expect(r.minWeb).toBeUndefined();
    expect(r.error).toContain("--min-web 值无效");
    expect(r.error).toContain("x.y.z");
  });

  it("--min-web= 空值 → error 非空（空串不过 x.y.z 校验）", () => {
    expect(parseWebOnlyArgs(["--min-web="]).error).not.toBeNull();
  });

  it("未传 --min-web → minWeb undefined、error 为 null", () => {
    expect(parseWebOnlyArgs(["--web-only"])).toEqual({
      isWebOnly: true,
      minWeb: undefined,
      error: null,
    });
  });

  it("--web-only 与 --min-web 组合解析", () => {
    expect(parseWebOnlyArgs(["--web-only", "--min-web=4.21.0"])).toEqual({
      isWebOnly: true,
      minWeb: "4.21.0",
      error: null,
    });
  });
});

describe("buildVersionJson", () => {
  it("正常发布（apkVersion = newVersion）：双坐标同为本次版本，序列化格式锁定", () => {
    const json = buildVersionJson({
      newVersion: "4.21.0",
      apkVersion: "4.21.0",
      repo: REPO,
      tag: "v4.21.0",
      changelog: "小修复与改进",
    });
    // 精确字符串断言：双空格缩进 + 固定键序（version → url → changelog → webBundle）
    // + 尾随换行（对齐 writeText 落盘格式，release.mjs step 2 既有行为）
    expect(json).toBe(
      [
        "{",
        '  "version": "4.21.0",',
        `  "url": "https://github.com/${REPO}/releases/tag/v4.21.0",`,
        '  "changelog": "小修复与改进",',
        '  "webBundle": {',
        '    "version": "4.21.0",',
        `    "url": "https://github.com/${REPO}/releases/download/v4.21.0/pictelio-4.21.0"`,
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("web-only 双坐标：version 继承旧 APK 版本不动，webBundle.version 前进到本次版本", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        newVersion: "4.21.1",
        apkVersion: "4.21.0", // 从旧 version.json 继承的已发布 APK 版本
        repo: REPO,
        tag: "v4.21.1",
        changelog: "fix: 热修",
        minWebVersion: "4.21.0",
      }),
    );
    expect(parsed.version).toBe("4.21.0"); // APK 坐标不前进（APK 弹窗不响）
    expect(parsed.webBundle.version).toBe("4.21.1"); // bundle 坐标前进
    // url 仍指向本次新 tag 的 Release 页（与 version 字段解耦）
    expect(parsed.url).toBe(`https://github.com/${REPO}/releases/tag/v4.21.1`);
    // webBundle.url = 三件套资产前缀（App 端拼 -manifest.json 等后缀）
    expect(parsed.webBundle.url).toBe(
      `https://github.com/${REPO}/releases/download/v4.21.1/pictelio-4.21.1`,
    );
    expect(parsed.minWebVersion).toBe("4.21.0");
  });

  it("minWebVersion undefined → 不写该字段（App 端 fail-open 不设门槛）", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        newVersion: "4.21.1",
        apkVersion: "4.21.0",
        repo: REPO,
        tag: "v4.21.1",
        changelog: "c",
      }),
    );
    expect(parsed).not.toHaveProperty("minWebVersion");
  });

  it("连续两次 web-only（patch+1 → patch+1）：version 坐标不动、webBundle 坐标单调前进（验收标准 2）", () => {
    const first = JSON.parse(
      buildVersionJson({
        newVersion: "4.21.1",
        apkVersion: "4.21.0",
        repo: REPO,
        tag: "v4.21.1",
        changelog: "c",
      }),
    );
    const second = JSON.parse(
      buildVersionJson({
        newVersion: "4.21.2",
        apkVersion: "4.21.0",
        repo: REPO,
        tag: "v4.21.2",
        changelog: "c",
      }),
    );
    expect(first.version).toBe("4.21.0");
    expect(second.version).toBe("4.21.0"); // APK 坐标连续两次不前进
    expect(first.webBundle.version).toBe("4.21.1");
    expect(second.webBundle.version).toBe("4.21.2"); // bundle 坐标单调
  });

  it("web-only 之后正常发布：一次 commit 原子翻转全部坐标（version 与 webBundle 同到新 APK 版本）", () => {
    const parsed = JSON.parse(
      buildVersionJson({
        newVersion: "4.22.0",
        apkVersion: "4.22.0", // 正常发布：apkVersion = newVersion
        repo: REPO,
        tag: "v4.22.0",
        changelog: "c",
        minWebVersion: "4.21.0", // floor 继承自 web-only 期间的值
      }),
    );
    expect(parsed.version).toBe("4.22.0");
    expect(parsed.webBundle.version).toBe("4.22.0");
    expect(parsed.minWebVersion).toBe("4.21.0");
  });
});
