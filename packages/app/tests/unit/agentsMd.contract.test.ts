// AGENTS.md 契约测试（wayfinder #597 验证方式决议：CI 体积门禁 + Fluent 规范逐字复述防线）
// 期望值来源（oracle 溯源）：
// - 体积阈值 28,672B：wayfinder #599 决议（双锚之硬门槛 ≤28KiB）
// - Fluent 曲线/时长白名单：Microsoft Fluent 2 官方 motion 规范（cubic-bezier 标准曲线 + duration 档位）
//   + #599 保留底线（Fluent 禁令表逐字保留、措辞不降级）
// - 硬约束锚点句：#599 保留底线点名清单（含 R3 三处「规范藏描述」：即时导航硬约束 / 工作流强制规范 / Notes CDN 禁令）
// - 三张路由表表头：#598 审计 R4（首跳路由层，不可指针化）
// - OPENWIKI 标记对：openwiki@0.2.5 code-mode.js 块级替换机制实证（#597 preflight 评论）
// - 陈腐清零断言（"15 格"/"ADR-0096"）：#598 审计 E1/E2 实证
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 从 cwd 向上找仓库根（pnpm --filter 下 cwd = 包目录；向上搜索对调用位置免疫）
function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found (AGENTS.md + pnpm-workspace.yaml)");
    dir = parent;
  }
}

const agentsMd = readFileSync(join(findRepoRoot(process.cwd()), "AGENTS.md"), "utf8");
const byteLength = Buffer.byteLength(agentsMd, "utf8");

describe("AGENTS.md 契约（体积门禁）", () => {
  it("总字节 ≤ 28,672B（28KiB 硬门槛，wayfinder #599）", () => {
    expect(byteLength).toBeLessThanOrEqual(28_672);
  });

  it("行数锚点：~300 行观察指标（#599 双锚之观察项，不设硬门禁，超阈仅提示）", () => {
    const lineCount = agentsMd.split("\n").length;
    console.warn(`[agentsMd] 当前行数 ${lineCount}（观察指标 ~300，阈值非硬门禁）`);
    expect(lineCount).toBeGreaterThan(0);
  });
});

describe("AGENTS.md 契约（Fluent 规范逐字复述防线）", () => {
  it("缓动曲线白名单 4 条齐全（Fluent 2 标准曲线）", () => {
    for (const curve of [
      "cubic-bezier(0,0,0,1)",
      "cubic-bezier(0.33,0,0.67,1)",
      "cubic-bezier(0.33,0,0,1)",
      "linear",
    ]) {
      expect(agentsMd).toContain(curve);
    }
    expect(agentsMd).toContain("禁止** `ease`、`ease-in`、`ease-out`、`ease-in-out`");
  });

  it("动画时长白名单 5 档齐全（Fluent duration 档位）", () => {
    for (const duration of ["100ms", "150ms", "200ms", "300ms", "500ms"]) {
      expect(agentsMd).toContain(`| ${duration} |`);
    }
  });

  it("Fluent 禁止清单表存活（硬编码颜色 / 圆角 / 阴影 / 裸 focus 等 10 行级）", () => {
    for (const row of [
      "| 硬编码颜色值（`#xxx`、`rgb()`）",
      "| 裸 `:focus` 伪类",
      "| `duration-200` / `duration-300` 等",
    ]) {
      expect(agentsMd).toContain(row);
    }
  });
});

describe("AGENTS.md 契约（硬约束锚点，#599 点名清单）", () => {
  it("两块「藏描述」硬约束提升为顶级 section 且 4+4 条款存活（R3）", () => {
    expect(agentsMd).toContain("## 即时导航硬约束");
    expect(agentsMd).toContain("## 工作流强制规范");
    for (const anchor of [
      "先渲染、后加载",
      "全局最优",
      "竞态防护",
      "数据层分流",
      "Grill 澄清 → to-spec → to-tickets → implement",
      "强制闭环",
      "自我监督规则",
    ]) {
      expect(agentsMd).toContain(anchor);
    }
  });

  it("Notes 内 CDN 代理禁令存活（R3 第三处）", () => {
    expect(agentsMd).toContain("/pixiv-img/");
    expect(agentsMd).toContain("在 HTML/CSS/JS 中硬编码 Pixiv CDN URL");
  });

  it("registerPlugin 硬约束语气存活（必须在 super.onCreate() 之前）", () => {
    expect(agentsMd).toContain("**必须在 `super.onCreate()` 之前**");
  });
});

describe("AGENTS.md 契约（首跳路由三表，#598 R4）", () => {
  it("工具触发协议 / 代码智能速查 / OpenWiki 查询三张表头存活", () => {
    expect(agentsMd).toContain("| 任务涉及 | 第一步必须 | 依据 |");
    expect(agentsMd).toContain("### 工具选择速查");
    expect(agentsMd).toContain("| 场景 | 首选文档 | 说明 |");
  });
});

describe("AGENTS.md 契约（技术栈与 package.json 一致）", () => {
  // oracle = packages/app/package.json（版本号唯一权威源），防指令文件与依赖清单漂移
  it("技术栈行的主版本号与 package.json 一致", () => {
    const manifest = JSON.parse(
      readFileSync(join(findRepoRoot(process.cwd()), "packages/app/package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const major = (v: string) =>
      v
        .replace(/^[\^~]/, "")
        .split(".")
        .slice(0, 2)
        .join(".");
    const expectMajor = (_dep: string, expected: string) => {
      expect(agentsMd).toContain(expected);
    };
    expectMajor("solid-js", `SolidJS ${major(manifest.dependencies["solid-js"] ?? "")}`);
    expectMajor("typescript", `TypeScript ${major(manifest.devDependencies["typescript"] ?? "")}`);
    expectMajor("vite", `Vite ${major(manifest.devDependencies["vite"] ?? "")}`);
    expectMajor("unocss", `UnoCSS ${major(manifest.devDependencies["unocss"] ?? "")}`);
    expectMajor("capacitor", `Capacitor ${major(manifest.dependencies["@capacitor/core"] ?? "")}`);
  });
});

describe("AGENTS.md 契约（CI 维护块与陈腐清零）", () => {
  it("OPENWIKI 标记对存活（CI 块级管理，openwiki@0.2.5 code-mode.js）", () => {
    expect(agentsMd).toContain("<!-- OPENWIKI:START -->");
    expect(agentsMd).toContain("<!-- OPENWIKI:END -->");
  });

  it("已实证陈腐表述清零（E1 ADR 计数 / E2 引擎矩阵格数）", () => {
    expect(agentsMd).not.toContain("ADR-0096");
    expect(agentsMd).not.toContain("15 格");
  });
});
