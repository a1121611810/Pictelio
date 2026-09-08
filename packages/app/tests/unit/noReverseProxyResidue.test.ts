// @vitest-environment node
/**
 * 反代残留检测单测（T12 CI 防线）—— 与 scripts/check-no-reverse-proxy.sh 配套。
 *
 * <p>vitest 测试运行速度远快于 shell 脚本（毫秒级），可作为 PR 预检；CI 流水线仍跑
 * shell 脚本作为最终门禁。两者规则一致，发现违规立即报错阻断合并。
 *
 * <p><b>检测目标</b>（任何匹配 = 违规，违反 ADR-0147 D4）：
 * <ul>
 *   <li>源码中出现 ApiEndpoints / apiProxyBase / api_proxy_base 等标识符；</li>
 *   <li>源码中出现 /pixiv-app-api / hibiy / loliko / workers.dev 等反代 / Worker 路由引用；</li>
 *   <li>settings/ 出现反代相关键；</li>
 *   <li>workflow 文件包含 Worker 测试任务。</li>
 * </ul>
 *
 * <p><b>合法引用</b>（不视为违规）：
 * <ul>
 *   <li>/pixiv-oauth / /pixiv-api（Vite dev 期代理路径，vite.config.ts 配置）；</li>
 *   <li>/pixiv-img/（图片代理路径，Java shouldInterceptRequest 拦截直连）；</li>
 *   <li>docs/adr/ ADR-0146 历史记录；</li>
 *   <li>docs/research/ 调研文档（必须保留作为技术记录）。</li>
 * </ul>
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(process.cwd(), "..", "..");

/** 在指定目录递归 grep 模式（排除 build/ 和 docs/） */
function grepRecursive(
  pattern: string,
  paths: string[],
  extensions = [".ts", ".tsx", ".java", ".kt"],
): string[] {
  const args = [
    "-rln",
    "--include=*" + extensions.join(" --include=*"),
    "-E",
    pattern,
    ...paths,
  ].filter((_, i, arr) => !(arr[i] === "--include=*" && arr[i + 1] === arr[i]));
  // 简化：用更稳的方式
  try {
    const includeArgs = extensions.flatMap((e) => [`--include=*${e}`]);
    const output = execSync(
      `grep -rln --include=*${extensions[0]} ${includeArgs
        .slice(1)
        .map((i) => `'${i}'`)
        .join(" ")} -E '${pattern}' ${paths.map((p) => `'${p}'`).join(" ")} 2>/dev/null || true`,
      { encoding: "utf-8", cwd: ROOT },
    );
    return output.split("\n").filter((line) => line && !line.includes("/build/"));
  } catch {
    return [];
  }
}

describe("T12 CI 防线：反代残留检测（ADR-0147 D4）", () => {
  it("worker/ 目录不存在（CF Worker 反代源码已删除）", () => {
    expect(existsSync(join(ROOT, "worker"))).toBe(false);
  });

  it("ApiEndpoints.java 不存在（Java 反代端点提供者已删除）", () => {
    const matches = grepRecursive("\\bApiEndpoints\\b", [
      "packages/app/src",
      "packages/app/android/app/src",
    ]);
    expect(matches).toEqual([]);
  });

  it("反代设置键常量不存在", () => {
    const matches = grepRecursive(
      "\\b(apiProxyBase|api_proxy_base|API_PROXY_PREF_KEY|apiProxyUrl|setApiProxyBase|SettingsApiProxy)\\b",
      ["packages/app/src", "packages/app/android/app/src"],
    );
    expect(matches).toEqual([]);
  });

  it("HibiAPI / 公共镜像域名引用不存在", () => {
    const matches = grepRecursive(
      "\\b(hibiy|loliko|pixiv-app-api|api\\.hibiy\\.cn|api\\.loliko\\.cn)\\b",
      ["packages/app/src", "packages/app/android/app/src"],
    );
    expect(matches).toEqual([]);
  });

  it("workers.dev 部署形态引用不存在（源码层）", () => {
    const matches = grepRecursive("workers\\.dev", [
      "packages/app/src",
      "packages/app/android/app/src",
    ]);
    expect(matches).toEqual([]);
  });

  it("CI workflow 不含 Worker 测试任务（已删除）", () => {
    const matches = grepRecursive("(worker\\.test|wrangler)", [".github"], [".yml", ".yaml"]);
    expect(matches).toEqual([]);
  });

  it("/pixiv-oauth 路径仅在合法位置（vite.config.ts + dev proxy，3 处）", () => {
    // Vite dev 期代理路径——vite.config.ts 1 处 + client.ts 1 处 + _oauthFetch.ts 1 处
    // 不阻断但审计数；如未来 src 路径中出现 /pixiv-oauth 作为生产路径则违规
    const srcMatches = grepRecursive("/pixiv-oauth", ["packages/app/src"]);
    expect(srcMatches.length).toBeLessThanOrEqual(3);
    // 确认 src 中所有引用都在 client.ts / _oauthFetch.ts（dev 模式专用）
    const outOfPlace = srcMatches.filter((f) => {
      const filename = f.split("/").pop() || "";
      return filename !== "client.ts" && filename !== "_oauthFetch.ts";
    });
    expect(outOfPlace).toEqual([]);
  });

  it("ADR-0146 顶部包含「状态变更：已废弃」横幅（可作为机器门禁）", () => {
    const adr0146Path = join(ROOT, "docs/adr/ADR-0146-reverse-proxy-primary.md");
    expect(existsSync(adr0146Path)).toBe(true);
    const content = readFileSync(adr0146Path, "utf-8");
    expect(content).toMatch(/已废弃/);
    expect(content).toMatch(/2026-09-08/);
  });

  it("ADR-0145 顶部包含「D3 部分废弃」横幅", () => {
    const adr0145Path = join(ROOT, "docs/adr/ADR-0145-direct-access-v2.md");
    expect(existsSync(adr0145Path)).toBe(true);
    const content = readFileSync(adr0145Path, "utf-8");
    expect(content).toMatch(/D3.*废弃/);
  });

  it("ADR-0147 存在并被 marked accepted", () => {
    const adr0147Path = join(ROOT, "docs/adr/ADR-0147-pure-client-direct-access.md");
    expect(existsSync(adr0147Path)).toBe(true);
    const content = readFileSync(adr0147Path, "utf-8");
    expect(content).toMatch(/状态.*accepted/);
  });
});
