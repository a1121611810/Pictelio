// AGENTS.md 契约测试（wayfinder #597 验证方式决议：CI 体积门禁 + Fluent 规范逐字复述防线）
// 期望值来源（oracle 溯源）：
// - 体积阈值 28,672B：wayfinder #599 决议（双锚之硬门槛 ≤28KiB）
// - Fluent 曲线/时长白名单：Microsoft Fluent 2 官方 motion 规范（cubic-bezier 标准曲线 + duration 档位）
//   + #599 保留底线（Fluent 禁令表逐字保留、措辞不降级）
// - 硬约束锚点句：#599 保留底线点名清单（含 R3 三处「规范藏描述」：即时导航硬约束 / 工作流强制规范 / Notes CDN 禁令）
// - 三张路由表表头：#598 审计 R4（首跳路由层，不可指针化）
// - OPENWIKI 标记对：openwiki@0.2.5 code-mode.js 块级替换机制实证（#597 preflight 评论）
// - 陈腐清零断言（"15 格"/"ADR-0096"）：#598 审计 E1/E2 实证
// - 单引擎措辞锚点与清零判据（ADR-0201 + glossary-single-engine-facade.md）：
//   真实入口类 = LynxActivity.java，MainActivity / registerPlugin() 已随 #610 删除
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

  // ADR-0201：宿主 Activity 硬约束的**机制**已从 Capacitor 插件注册改为 AndroidX SplashScreen，
  // 但「必须在 super.onCreate() 之前」这半句是**改写**而非删除的契约锚点（见下方单引擎 describe）。
  it("onCreate 前置约束语气存活（机制自 #610 起为 SplashScreen，见 ADR-0201）", () => {
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
  // vite 自 ADR-0185 起为 npm 别名（vite-plus-core），Vite 本体版本由 vite-plus 内置，
  // 文档锚点改读 vite-plus 依赖版本。
  // 已知盲区（ADR-0186 review P3）：技术栈行的独立陈述「Vite 8.3」自此无 oracle
  // （vite-plus-core 内置 vite 升版时该数字会静默陈旧），1.0 stable 后以 vp toolchain 数据补挂。
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
    const viteSpec = (manifest.devDependencies["vite"] ?? "").replace(/^[\^~]/, "");
    if (viteSpec.startsWith("npm:@voidzero-dev/vite-plus-core@")) {
      expect(agentsMd).toContain(`vite-plus ${major(manifest.devDependencies["vite-plus"] ?? "")}`);
    } else {
      expectMajor("vite", `Vite ${major(viteSpec)}`);
    }
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

// ADR-0201 单引擎门面收口：AGENTS.md 曾指示 agent 修改一个**已不存在**的类
// （「自定义 Capacitor 插件在 MainActivity.java 经 registerPlugin() 注册」）。
// 旧防线只断言那句半截措辞**存活**，从不断言旧机制**已清零**——文档删干净也算过。
// 本 describe 补上双向：负面（清零）+ 正面（指向真实单引擎入口类）。
describe("AGENTS.md 契约（单引擎门面，ADR-0201）", () => {
  // oracle 判据（2026-09-29 实测）：
  // - packages/app/android/app/src/lynx/java/io/pictelio/app/ 下无 MainActivity.java（已删）
  // - src/lynx 源集对 registerPlugin 的引用 = 0（仅 packages/app/src/native 留存 WebView 源码仍引用）
  // - 真实约束：LynxActivity.java onCreate() 中 SplashScreen.installSplashScreen(this) 先于 super.onCreate()
  it("已删除的宿主 Activity 名与插件注册机制清零（#610 运行时下线）", () => {
    // 先证文档主体存活：负面断言不能靠「文档被清空/截断」空转通过
    expect(agentsMd).toContain("## 即时导航硬约束");
    expect(agentsMd).not.toContain("MainActivity");
    expect(agentsMd).not.toContain("registerPlugin");
  });

  it("双引擎表述清零（#610 后指令文件只描述 Lynx 单引擎）", () => {
    expect(agentsMd).toContain("Lynx 单引擎");
    expect(agentsMd).not.toContain("双引擎");
  });

  // 配对正面锚点：防止「把错的删了就当修好」——必须指名真实入口类与其真实机制
  it("真实单引擎入口类与机制被点名（SplashScreen 先于 super.onCreate）", () => {
    expect(agentsMd).toContain("LynxActivity.java");
    expect(agentsMd).toContain("`SplashScreen.installSplashScreen()`");
  });

  // ADR-0201 明确不删「Capacitor 8.5」：@capacitor/core@^8.5.2 仍在 packages/app/package.json
  // 声明（留存 WebView 源码仍 import 它），删字会击穿上方以 package.json 为 oracle 的漂移防线。
  // 正确处置是**加限定语**，本断言守的就是这半截限定语不被后人抹平。
  it("Capacitor 版本号带「运行时已下线」限定语（依赖留存≠运行时在用）", () => {
    const stackLine = agentsMd.split("\n").find((line) => line.includes("Capacitor 8.5"));
    expect(stackLine).toBeDefined();
    expect(stackLine).toContain("运行时已下线");
  });

  // ADR-0201 决策 2 要求三处门面**逐字复用**措辞锚点，否则它们会再次各写各的（本次分叉的根因）。
  // 首轮 review 的反事实 CF7 证明：把锚点同义改写，整套断言全绿——即「逐字复用」此前零机器防线。
  // 本断言把「锚点存在且逐字」变成门禁。oracle = ADR-0201 决策 2 + glossary §措辞锚点 首句。
  // ⚠️ 覆盖面仅 AGENTS.md 一处：落地页与 README 无测试接缝，改动它们仍须人工比对术语文档
  //    （缺口已由 glossary §措辞锚点 的「机器强制」表与 ADR-0201 后果段显式披露，非静默）。
  it("措辞锚点逐字存活（AGENTS.md 侧防门面分叉，ADR-0201 决策 2）", () => {
    expect(agentsMd).toContain("WebView 客户端已随 #610 下线");
    expect(agentsMd).toContain("唯一运行时形态");
  });
});
