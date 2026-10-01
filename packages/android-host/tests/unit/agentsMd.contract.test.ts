// AGENTS.md 契约测试（wayfinder #597 验证方式决议：CI 体积门禁 + Fluent 规范逐字复述防线）
// 期望值来源（oracle 溯源）：
// - 体积阈值 30,720B：#599 决议的硬门槛 ≤28KiB 已被 ADR-0203 决策 2 的宿主迁移作废
//   （文档必须新增宿主包角色 + 改指唯一客户端，28KiB 下改写过程必然中途越界）；
//   重设为 30KiB 的依据是 #599 决议中「双锚」的第二锚（观察项 ~300 行）
//   与硬门槛同量级，且留出 1,364B 余量——**不是**「随便挑个圆整数」，
//   判据：余量须 > 单次门面改写的实测增量（T11 实测 680B），否则门禁形同虚设。
// - Fluent 曲线/时长白名单：Microsoft Fluent 2 官方 motion 规范（cubic-bezier 标准曲线 + duration 档位）
//   + #599 保留底线（Fluent 禁令表逐字保留、措辞不降级）
// - 硬约束锚点句：#599 保留底线点名清单（含 R3 三处「规范藏描述」：即时导航硬约束 / 工作流强制规范 / Notes CDN 禁令）
// - 三张路由表表头：#598 审计 R4（首跳路由层，不可指针化）
// - OPENWIKI 标记对：openwiki@0.2.5 code-mode.js 块级替换机制实证（#597 preflight 评论）
// - 陈腐清零断言（"15 格"/"ADR-0096"）：#598 审计 E1/E2 实证
// - 单引擎措辞锚点与清零判据（ADR-0201 + glossary-single-engine-facade.md）：
//   真实入口类 = LynxActivity.java，MainActivity / registerPlugin() 已随 #610 删除
// - 根命令表可达性：根 `package.json` 的 `scripts` 键（独立来源），
//   判据出自 spec 用户故事 16「命令表里的每条命令都还真实存在」
//
// ADR-0203 迁移说明（本文件随测试资产迁到宿主包 `packages/android-host`）：
// **删掉**的断言只有一条组——「技术栈行的主版本号与 package.json 一致」。
// 它的 oracle 是 `packages/app/package.json`，而该文件随 WebView 客户端整包删除
// （ADR-0203 决策 2）；把 oracle 改指 `packages/app-lynx/package.json` 也不成立——
// 后者没有 solid-js / vite / unocss（Lynx 侧是 vue-lynx + Tailwind），
// 拿它当 oracle 会得到一条恒假的断言。故整组删除，**不**放宽阈值蒙混过去。
// 连带删除「Capacitor 版本号带「运行时已下线」限定语」：它的存在前提是
// ADR-0201「不删 Capacitor 8.5 字样」，而 ADR-0203 决策 4/7 与
// `webviewRemovalInvariants` 不变量 7 已要求技术栈**不含** Capacitor
// ——留着它就是把一条已被决策取代的断言钉成门禁。
// **保留**体积门禁（#599 双锚之硬门槛），并新增根命令表可达性防线（见文件末尾）。
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

const REPO_ROOT = findRepoRoot(process.cwd());
const agentsMd = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");
const byteLength = Buffer.byteLength(agentsMd, "utf8");

/**
 * Fluent 2 规范原文的**新位置**。
 *
 * 背景：AGENTS.md 的 Fluent 章节已按 ADR 判定为「与现行约束无关却占用指令字节预算
 * （运行时按 32 KiB 截断）」，整章原文拆出到本归档文件，AGENTS.md 只留判读规则与指针。
 * 本组断言原先指向 AGENTS.md，于是全部转红——但**内容一条没丢**，只是断言指错了文件。
 *
 * 因此这里改判归档文件，并**追加**一条「AGENTS.md 必须保留指向归档的指针」：
 * 契约从「原文在 AGENTS.md」升级为「原文在归档 + 入口在 AGENTS.md」，
 * 删任一侧都会转红（比改前更强，不是放宽）。
 */
const fluentArchive = readFileSync(
  join(REPO_ROOT, "docs/adr/glossary-fluent-design-chapter-archive.md"),
  "utf8",
);

describe("AGENTS.md 契约（体积门禁）", () => {
  // 阈值从 28,672 抬到 30,720（28KiB → 30KiB），ADR-0203 决策 2 的直接后果：
  // 文档需新增宿主包（构建/发布/E2E 宿主）这一此前不存在的角色，
  // 并把命令表与架构分层改指唯一客户端——净变化方向不定（加长与删行相互抵消）。
  // **不得**因此把门禁放宽到失去约束力：它的存在意义是阻止本文件无限膨胀，
  // 而「每次都调阈值」会让它退化成装饰。抬到 30KiB 已给足本次改写的余量。
  it("总字节 ≤ 30,720B（30KiB 硬门槛，ADR-0203 后重设）", () => {
    expect(byteLength).toBeLessThanOrEqual(30_720);
  });

  it("行数锚点：~300 行观察指标（#599 双锚之观察项，不设硬门禁，超阈仅提示）", () => {
    const lineCount = agentsMd.split("\n").length;
    console.warn(`[agentsMd] 当前行数 ${lineCount}（观察指标 ~300，阈值非硬门禁）`);
    expect(lineCount).toBeGreaterThan(0);
  });
});

describe("Fluent 规范逐字复述防线（原文在归档文件，入口在 AGENTS.md）", () => {
  it("AGENTS.md 保留指向归档的入口（否则逐字防线在运行时不可达）", () => {
    expect(agentsMd).toContain("glossary-fluent-design-chapter-archive.md");
    expect(agentsMd).toContain("历史存档");
  });

  it("缓动曲线白名单 4 条齐全（Fluent 2 标准曲线）", () => {
    for (const curve of [
      "cubic-bezier(0,0,0,1)",
      "cubic-bezier(0.33,0,0.67,1)",
      "cubic-bezier(0.33,0,0,1)",
      "linear",
    ]) {
      expect(fluentArchive).toContain(curve);
    }
    expect(fluentArchive).toContain("禁止** `ease`、`ease-in`、`ease-out`、`ease-in-out`");
  });

  it("动画时长白名单 5 档齐全（Fluent duration 档位）", () => {
    for (const duration of ["100ms", "150ms", "200ms", "300ms", "500ms"]) {
      expect(fluentArchive).toContain(`| ${duration} |`);
    }
  });

  it("Fluent 禁止清单表存活（硬编码颜色 / 圆角 / 阴影 / 裸 focus 等 10 行级）", () => {
    for (const row of [
      "| 硬编码颜色值（`#xxx`、`rgb()`）",
      "| 裸 `:focus` 伪类",
      "| `duration-200` / `duration-300` 等",
    ]) {
      expect(fluentArchive).toContain(row);
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

// 【墓碑，ADR-0203】原 describe「技术栈与 package.json 一致」**整组删除**，无替代断言。
//   · oracle = `packages/app/package.json`，随决策 2 整包删除；
//   · 改指 `packages/app-lynx/package.json` 不成立——那边没有 solid-js / vite / unocss
//     （Lynx 侧是 vue-lynx + Tailwind），拿它当 oracle 只会得到一条恒假断言；
//   · 同组的 `expectMajor("capacitor", …)` 断言「Capacitor 8.5」字样存活，
//     其存在前提是 ADR-0201「不删 Capacitor 字样」，已被 ADR-0203 决策 4/7 与
//     `webviewRemovalInvariants` 不变量 7（技术栈**不含** Capacitor）取代。
// 门面措辞的收敛防线由 `webviewRemovalInvariants.test.ts` 不变量 7 单独承担，
// 此处不重复设防——重复设防只会让两份断言在改文档时一起红、互相掩盖。

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
  // oracle 判据（2026-09-29 实测；ADR-0203 迁移后路径已更新）：
  // - packages/android-host/android/app/src/lynx/java/io/pictelio/app/ 下无 MainActivity.java（已删）
  // - 宿主 src/lynx 源集对 registerPlugin 的引用 = 0（WebView 源码已随包删除）
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

  // 【墓碑，ADR-0203】原 it「Capacitor 版本号带「运行时已下线」限定语」**删除**。
  // 它的前提是 ADR-0201「@capacitor/core 仍被声明，故字样不能删」；
  // ADR-0203 决策 4/7 与不变量 7 之后，技术栈行必须**不含** Capacitor——
  // 留着这条等于把一条已被决策取代的断言继续钉成门禁。

  // ADR-0201 决策 2 要求三处门面**逐字复用**措辞锚点，否则它们会再次各写各的（本次分叉的根因）。
  // 首轮 review 的反事实 CF7 证明：把锚点同义改写，整套断言全绿——即「逐字复用」此前零机器防线。
  // 本断言把「锚点存在且逐字」变成门禁。oracle = ADR-0201 决策 2 + glossary §措辞锚点 首句。
  // ⚠️ 覆盖面仅 AGENTS.md 一处：落地页与 README 无测试接缝，改动它们仍须人工比对术语文档
  //    （缺口已由 glossary §措辞锚点 的「机器强制」表与 ADR-0201 后果段显式披露，非静默）。
  //
  // ADR-0203 起锚点改用 `glossary-webview-client-removal.md` §措辞锚点 的新表述：
  // 旧锚点「WebView 客户端已随 #610 下线 / 唯一运行时形态」只描述**运行时**下线，
  // 在源码删除后是不完整的——它会让人以为源码还在。ADR-0203 把它扩为
  // 「运行时随 #610 下线 + 源码与依赖随 ADR-0203 删除」两段式，正是为了堵这个缺口。
  it("措辞锚点逐字存活（AGENTS.md 侧防门面分叉，ADR-0201 决策 2 + ADR-0203 扩写）", () => {
    expect(agentsMd).toContain("WebView 客户端的运行时随 #610 下线");
    expect(agentsMd).toContain("其源码与依赖随 ADR-0203 删除");
  });
});

/**
 * 根命令表可达性防线（ADR-0203 新增，替换被删的版本号断言）。
 *
 * ## 为什么加这条
 *
 * 本轮删除让**命令表**成为最易陈旧的一份文档：根 `package.json` 里
 * `dev:android` / `build:android` / `release` / `test:android:e2e` 等命令
 * 全部 `--filter pictelio-app`（ADR-0203 后果 1：裸名约定失效）。
 * 命令名一旦随重构改名，AGENTS.md 的命令表就会教人跑出一个 `command not found`
 * ——spec 用户故事 16 点名的正是这件事，而删除版本号断言后本文件少了一层覆盖。
 *
 * ## oracle
 *
 * 根 `package.json` 的 `scripts` 键（**独立来源**，与 AGENTS.md 无派生关系）。
 *
 * ## 匹配规则（刻意保守，宁可漏报不可误报）
 *
 * 1. 只取反引号内的代码片段，且只取表格行（`| ... |`）——散文里的命令不算命令表；
 * 2. 去掉 `pnpm ` 前缀，按 `/` 拆并列写法（`` `pnpm dev` / `build` ``）；
 * 3. 去掉 `(:release)` / `(:dry)` 这类可选后缀；
 * 4. **含 `<` `>` `|` 的片段是参数化占位**（`` `pnpm <命令>:app-lynx|…` ``），跳过；
 * 5. **以 `:` 开头的片段是后缀标记**（`:all` 并行形式、`:包名` 委托形式），不是独立命令，跳过。
 *
 * ⚠️ 规则 5 是实测得来：不过滤时 `:包名` 与 `:all` 会各报一次假缺失。
 * 该规则是**语义**判定（后缀 vs 命令）而非字面量匹配，字段改名不会让它漏过。
 */
describe("AGENTS.md 契约（根命令表可达性，spec 用户故事 16）", () => {
  const rootScripts =
    (
      JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {};

  /**
   * 从「## 命令」小节的表格行里抽出所有具体命令名（去重、保序）。
   * ⚠️ 这里**不调用 expect**：本函数在 describe 体（收集阶段）求值，
   * 断言写在这里会变成「收集期抛错」，错误信息只会是一句无关的 import 失败。
   */
  function commandsInTable(): { sectionFound: boolean; commands: string[] } {
    const section = agentsMd.match(/^## 命令\s*$(.*?)^## /ms)?.[1];
    const out: string[] = [];
    for (const line of (section ?? "").split("\n")) {
      if (!line.trimStart().startsWith("|")) continue;
      for (const code of line.matchAll(/`([^`]+)`/g)) {
        for (const piece of code[1].split(/\s*\/\s*/)) {
          let cmd = piece.trim();
          if (cmd.startsWith("pnpm ")) cmd = cmd.slice(5).trim();
          cmd = cmd.replace(/\(:[a-z:]+\)$/, "");
          if (!cmd) continue;
          if (/[<>|]/.test(cmd)) continue; // 规则 4：参数化占位
          if (cmd.startsWith(":")) continue; // 规则 5：后缀标记
          if (!out.includes(cmd)) out.push(cmd);
        }
      }
    }
    return { sectionFound: section !== undefined, commands: out };
  }

  const { sectionFound, commands } = commandsInTable();

  it("必须真的抽到命令表（清单为空会让下一条全称断言静默恒真）", () => {
    expect(sectionFound, "AGENTS.md 必须有「## 命令」小节").toBe(true);
    // 下限 10 = 2026-09-29 实测 14 条留余量；空表 / 表格被改成散文时这里先红。
    expect(commands.length, "命令表里抽出的具体命令数").toBeGreaterThanOrEqual(10);
  });

  it("命令表里每条具体命令都真实存在于根 package.json 的 scripts（教人跑空即红）", () => {
    const missing = commands.filter((c) => !Object.prototype.hasOwnProperty.call(rootScripts, c));
    expect(
      missing,
      `AGENTS.md 命令表里这些命令在根 package.json 中不存在：${missing.join("、")}`,
    ).toEqual([]);
  });

  it("检测式自身能命中已知目标（阳性对照：真删掉一条根命令，本条必须转红）", () => {
    // 证明上面的「缺失即红」不是恒绿：拿一条**确实存在**的命令做阴性对照。
    expect(Object.prototype.hasOwnProperty.call(rootScripts, "test:all")).toBe(true);
    // 同一判定函数喂一个不存在的名字 → 必被判缺失
    const probe = "dev:no-such-command";
    expect(commands.includes(probe)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rootScripts, probe)).toBe(false);
  });
});
