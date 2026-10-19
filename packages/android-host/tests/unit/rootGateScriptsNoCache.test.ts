// ─── 根门禁脚本「不得启用 vp run 缓存」防线（AGENTS.md「门禁边界」机器化）───
//
// ## 为什么有这条门禁（判据来源 / oracle 溯源）
//
// 事故实证（同一口径已固化进 AGENTS.md「门禁边界」）：
// 根 `check:all` 曾带 `--cache`。`vp run --cache` 会把 `run.cache = { scripts: false }` 的默认
// **覆盖成 script 也缓存**（语义依据 = `node_modules/vite-plus/docs/config/run.md` §`run.cache`：
// 默认 `{ scripts: false, tasks: true }`，`cache: true` 同时打开 task 与 script 缓存；CLI 侧
// `vp run --help` 对 `--cache` 的描述是 "Force caching on for all tasks and scripts"）。
// 实证：工作区放一个**必然类型错误**的文件，`check:all` 仍 `8/8 cache hit (100%)` 且 exit 0
// —— 门禁根本没跑，只重放了历史日志。上轮 bf2641b1 已从两个脚本删掉 `--cache`，
// AGENTS.md 写死「check:all / test:all 一律不带 --cache」，但那份约束**只在文档里**：
// 没有机器防线时，任何人一次「顺手提速」就能把它加回来，加回后 CI 依旧常绿。
//
// ## 判据（2026-10-19 扩展：命令行开关 + runner 配置 + vp 别名三类缓存使能形态）
//
// 1. 两脚本存在且非空（被删/改名即红——CI 的 check:all / test:all 步骤会 Missing script）；
// 2. 经 `vp run` 执行（不是裸 tsc / 裸 vitest 绕过 runner；`pnpm vp` 解析后就是
//    `node_modules/.bin/vp`，故 token 按 basename 判，容忍等价写法）；
// 3. **不含任何 cache 使能形态**：token 恰为 `--cache` 或前缀 `--cache=`（含被引号包住的
//    写法）。`--no-cache` 是**关闭**开关（`vp run --help`），不得误报。
//    实测位置语义（vp 1.0.0-rc.0）：只有出现在 TASK_SPECIFIER **之前**的 `--cache` 才会被 runner
//    解析成缓存开关；写在任务名之后的形式会被当作 ADDITIONAL_ARGS 透传给底层命令（实测
//    `vp run … check --cache=true` → tsc 收到 `--cache=true` 并报 TS5023）。本判据仍**首/中/尾
//    一视同仁**判红 —— fail-closed：尾部形态是「缓存使能意图」，位置稍前移半格就变成真缓存；
//    且 `--cache=<v>` 会被 CLI 直接拒绝（exit 2，尚不是假绿）也照样纳入，防止升级 vp 后形态
//    合法化。真正会静默假绿的是 `vp run --cache <task>` 与 `run.cache.scripts: true`（失效面 2）；
// 4. 阳性锚点（防全称断言静默恒真）：两脚本各含 CI 覆盖承诺的 `--filter` 子集
//    （`@pictelio/android-host` = bf2641b1 才补上的**最近一次漏包事故点**；
//    `pictelio-app-lynx` = 唯一客户端），且 token 数 / filter 命中数达下界（扫描面非空）；
// 5. `.github/workflows/*.yml` 的**字面量命令**不得出现 cache 使能 token（尤其 `vp run` 行）；
// 6. 根 `vite.config.ts` 的 `run.cache` 不得对 script 开缓存（`cache: true` / `scripts: true` 等）；
//    fail-closed：配置形态无法静态判定时判红，不放行（「没解析出来」≠「没开」）；
// 7. 根 `package.json` 的 `scripts.vp` 别名（全部 `pnpm vp …` 的中转点）不得注入 cache token。
//
// ## 判据实现 = 纯函数 + 反事实常驻
//
// 判据抽成 `evaluateGateScripts()` / `findCacheEnablingTokens()` 纯函数；文件上部读**真实**根
// package.json 求值，下部 describe 把反事实**常驻成测试**：同一个纯函数喂 ≥2 种坏形态换皮
// （尾部 / 中段 / `--cache=true` / 带引号 / `--cache=<v>`）必须命中，喂好形态（当前真实脚本 /
// `--no-cache`）不得误报，另有阳性对照逐条证明每个判据分支真的在断。反事实是**纯内存注入**
// （注入的是真实 scripts 表的内存副本，不碰仓库文件、不落临时文件），所以它在任何环境下都跑得动。
// 标记 `[root-gate-detector-start/end]` 之间是完整判据区间，可原样抽取给 /tmp 副本做人工反事实。
//
// ## 体量裁决（门禁冻结线，2026-10-19 round 5 review 记录）
//
// 本文件 523 行，被守对象（根 package.json 两脚本 + 3 份 workflow + 根 vite.config）按行数
// 字面算超过「单个门禁文件 > 被测对象 30%」的冻结线；按契约门禁先例（agentsMd.contract
// 305 行守 311 行 AGENTS.md，已被接受）判**不过度**：判据核心约 200 行（纯函数 + 反事实
// 常驻 + 失效面登记），体量由门禁纪律要求的要素决定，不是加码刷门禁。**后续停止加码**；
// 若要再大，先把判据/夹具拆成 helper 并重新论证分子口径。
//
// ## 已知失效面（抓不到什么）—— 显式登记，见 `workflows/review-fix-loop.md` §门禁纪律
//
// **已覆盖范围（2026-10-19；别读成「全管」）**：根 package.json 的 check:all / test:all 与
// scripts.vp；.github/workflows/*.yml 的字面量 cache token；vite.config.ts 的 run.cache.scripts。
// **残余盲区**：
// 1. **CI 的非字面量路径**：.github/actions/** 的 composite action、`uses:` 远端/可复用 workflow、
//    动态 shell（变量展开/命令替换/alias）、环境变量（`VP_CACHE=1`）、Gradle 缓存均不在扫描面。
//    ①-a **workflow 扫描器本体**：按行去 `#` 注释时不区分引号 —— 同一行引号内先出现 `#` 时，
//    后续 token 会被当注释跳过（可能漏报）；`echo --cache` 这类非 `vp run` 文本会 fail-closed
//    误报。二者均为已知残余（误报方向安全），出现实例再按「显式登记 + 正反例」扩展。
// 2. **run.cache 的其它注入形态**：函数/异步工厂配置、或 `run: { cache: 表达式 }` 时按 fail-closed
//    判红（宁可误报）；`run.tasks` 的 task 缓存默认开启，但门禁脚本是 script 非 task，不属本防线。
// 3. 其它 vp run 脚本（`build:all` / `dev:all` / 各包裸命令…）被加缓存开关抓不到 —— 只守
//    「门禁边界」点名的两个 CI 脚本；`lint:all` 不在判据面是因为 `vp lint` 没有 `--cache` 开关。
// 4. **子脚本 / 包脚本级 cache 抓不到**：包内脚本嵌套 `vp run --cache`、或 check 改成
//    `vite.config.ts` 的 task 并配 `cache: true`；vp 别名只守**根** scripts.vp，包级同名不在面内。
// 5. **不证明「本次真跑了」**：它不校验 CI 确实执行了这两个脚本，也不校验 runner 输出了
//    `⊘ cache disabled` / `0/N cache hit (0%)`。绿灯结论仍要按 AGENTS.md 口径看日志。
// 6. **等价写法盲区**：判据是「按空白切分 + 剥成对引号」后按 token 比对，抓不到 shell 变量展开
//    （`CACHE_FLAG=--cache`）、命令替换、alias、Unicode 破折号等换皮。当前零实例；出现即属绕过。
// 7. **不证明 filter 列表完备**：只钉必含包 + 下界，不从 workspace 自动推导（`pictelio-website`
//    刻意不在 CI 门禁面内，自动推导会把它误报成漏包）。新增包若忘进 check:all/test:all，本门禁不红。
// 8. 退出码被吞（`… || true` / `… ; true`）抓不到 —— 那是另一种假绿，不属本判据。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 从 cwd 向上找仓库根（pnpm --filter 下 cwd = 包目录；向上搜索对调用位置免疫）。 */
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
const ROOT_MANIFEST_PATH = join(REPO_ROOT, "package.json");

/**
 * 读根 package.json 的 scripts 表。
 * 解析失败直接抛（JSON 坏掉本身就该红）；scripts 缺失返回空表，由判据报「[缺失]」，
 * 这样失败信息指向「门禁脚本不见了」而不是一句无关的 TypeError。
 */
function readRootScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(ROOT_MANIFEST_PATH, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

// ── [root-gate-detector-start] 手工反事实验证脚本按这两个标记抽取本区间，保证人工证据与测试内判据是同一份源码
/** 守护的根门禁脚本（AGENTS.md「门禁边界」：CI 门禁 = check:all + lint:all + test:all）。 */
const GATE_SCRIPT_NAMES = ["check:all", "test:all"] as const;

/** CI 覆盖承诺必含的 --filter（理由见头注释判据 4）。 */
const REQUIRED_FILTERS = ["@pictelio/android-host", "pictelio-app-lynx"] as const;

/**
 * filter 命中数下界：2026-10-18 实测两脚本各 8 个 `--filter`，取 6 留正常删包/合并余量。
 * 跌破说明 filter 面被大面积删掉、检测式可能已失明 —— 这是**阳性锚点**（证明扫描非空），
 * 不是覆盖率门禁：单包漏掉由 REQUIRED_FILTERS 与人工 review 兜，覆盖面见头注释失效面 7。
 */
const MIN_FILTER_HITS = 6;

/** token 数下界：2026-10-18 实测 23，取 10 只用于证明脚本没被截断/改写。 */
const MIN_TOKEN_COUNT = 10;

/**
 * 把 package.json 脚本字面量切成 token：按空白切分，再剥掉包裹**整个** token 的一对引号。
 * 只做保守切分，不解析 shell 引号/转义/变量展开 —— 那些是头注释失效面 6。
 */
function tokenizeScript(script: string): string[] {
  return script
    .split(/\s+/)
    .map((token) => token.replace(/^(["'])(.*)\1$/, "$2"))
    .filter((token) => token.length > 0);
}

/** cache 使能形态 = token 恰为 `--cache`，或 `--cache=<v>`（头注释判据 3）。 */
function findCacheEnablingTokens(script: string): string[] {
  return tokenizeScript(script).filter(
    (token) => token === "--cache" || token.startsWith("--cache="),
  );
}

/** `vp` 的 token 形态判定：`vp` / `node_modules/.bin/vp` 都算（pnpm vp 别名解析后就是它）。 */
function isVpToken(token: string): boolean {
  return token === "vp" || token.endsWith("/vp") || token.endsWith("\\vp");
}

/** 抽 `--filter <v>` / `--filter=<v>` / `-F <v>` 的值。 */
function extractFilterValues(tokens: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--filter" || token === "-F") {
      const value = tokens[i + 1];
      if (value !== undefined) values.push(value);
    } else if (token.startsWith("--filter=")) {
      values.push(token.slice("--filter=".length));
    }
  }
  return values;
}

interface ScriptScan {
  name: string;
  present: boolean;
  tokenCount: number;
  usesVpRun: boolean;
  filterValues: string[];
  cacheEnablingTokens: string[];
}

interface GateVerdict {
  scripts: ScriptScan[];
  problems: string[];
}

/** 纯函数判据：输入 scripts 表，输出逐脚本扫描证据 + 违规清单（problems 为空 = 门禁成立）。 */
function evaluateGateScripts(scripts: Record<string, string> | undefined): GateVerdict {
  const problems: string[] = [];
  const scans: ScriptScan[] = [];
  for (const name of GATE_SCRIPT_NAMES) {
    const script = scripts?.[name];
    if (typeof script !== "string" || script.trim() === "") {
      problems.push(
        `[缺失] 根 package.json 的 scripts.${name} 不存在或为空 —— CI 会 Missing script、门禁面消失`,
      );
      scans.push({
        name,
        present: false,
        tokenCount: 0,
        usesVpRun: false,
        filterValues: [],
        cacheEnablingTokens: [],
      });
      continue;
    }
    const tokens = tokenizeScript(script);
    const filterValues = extractFilterValues(tokens);
    const usesVpRun = tokens.some((token, i) => isVpToken(token) && tokens[i + 1] === "run");
    const cacheEnablingTokens = findCacheEnablingTokens(script);
    scans.push({
      name,
      present: true,
      tokenCount: tokens.length,
      usesVpRun,
      filterValues,
      cacheEnablingTokens,
    });

    if (!usesVpRun) {
      problems.push(
        `[绕过 runner] scripts.${name} 未经 vp run 执行 —— 真实命令脱离 runner 的汇总语义，` +
          `且本判据再也无法定位缓存开关`,
      );
    }
    if (cacheEnablingTokens.length > 0) {
      const rendered = cacheEnablingTokens.map((token) => `\`${token}\``).join("、");
      problems.push(
        `[缓存使能] scripts.${name} 含 ${rendered}：vp run --cache 会把 run.cache.scripts=false 的` +
          `默认覆盖成脚本也缓存（run.md §run.cache），缓存命中 = 没跑、只重放日志 ⇒ 假绿` +
          `（AGENTS.md「门禁边界」实证 8/8 cache hit 仍 exit 0）。删掉它，runner 应打印 ⊘ cache disabled。`,
      );
    }
    if (filterValues.length < MIN_FILTER_HITS) {
      problems.push(
        `[检测式不可信] scripts.${name} 只扫到 ${filterValues.length} 个 --filter < ${MIN_FILTER_HITS}，` +
          `扫描面可能已失明（阳性锚点失效）`,
      );
    }
    if (tokens.length < MIN_TOKEN_COUNT) {
      problems.push(
        `[检测式不可信] scripts.${name} 只扫到 ${tokens.length} 个 token < ${MIN_TOKEN_COUNT}，` +
          `脚本可能被截断/改写`,
      );
    }
    for (const required of REQUIRED_FILTERS) {
      if (!filterValues.includes(required)) {
        problems.push(
          `[漏包] scripts.${name} 的 --filter 缺少 ${required}（CI 覆盖承诺，见头注释判据 4；` +
            `最近一次漏包事故 = bf2641b1 补 android-host）`,
        );
      }
    }
  }
  // 残余 4 中唯一被收窄的别名盲区：根 scripts.vp 是全部 `pnpm vp …` 的中转点，禁止注入 token
  const vpAlias = scripts?.vp;
  const aliasTokens = typeof vpAlias === "string" ? findCacheEnablingTokens(vpAlias) : [];
  if (typeof vpAlias !== "string" || vpAlias.trim() === "") {
    problems.push("[别名缺失] 根 scripts.vp 不存在或为空 —— 根命令表的 `pnpm vp …` 会全线断掉");
  } else if (aliasTokens.length > 0) {
    const tokens = aliasTokens.map((t) => `\`${t}\``).join("、");
    problems.push(`[别名注入] scripts.vp 含 ${tokens}：全部 \`pnpm vp …\` 调用都会带缓存，删掉它`);
  }
  return { scripts: scans, problems };
}
/** 扫一份 CI workflow 源文本：只认命令上下文的**字面量** cache token（去行内/整行 `#` 注释；残余 1）。 */
function scanWorkflowText(source: string): string[] {
  const cacheHits: string[] = [];
  source.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "");
    if (line.trimStart().startsWith("#")) return;
    for (const token of findCacheEnablingTokens(line)) cacheHits.push(`:${i + 1} \`${token}\``);
  });
  return cacheHits;
}

/** fail-closed：根 vite.config.ts 默认导出是否把 package.json script 缓存打开（run.md §`run.cache`）。 */
function detectRunCacheScriptCaching(config: unknown): string[] {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return ["[检测式不可信] vite.config 默认导出不是普通对象——无法证明 script 缓存未开"];
  }
  const run = (config as Record<string, unknown>).run;
  if (run === undefined) return [];
  if (typeof run !== "object" || run === null || Array.isArray(run)) {
    return ["[检测式不可信] vite.config 的 run 不是普通对象——无法证明 run.cache.scripts 未开"];
  }
  const cache = (run as Record<string, unknown>).cache;
  if (cache === undefined || cache === false) return [];
  if (cache === true) return ["[缓存配置] run.cache: true 同时打开 task/script 缓存 ⇒ 假绿"];
  if (typeof cache !== "object" || cache === null || Array.isArray(cache)) {
    return ["[检测式不可信] run.cache 既非 boolean 也非普通对象——fail-closed 判红"];
  }
  const scripts = (cache as Record<string, unknown>).scripts;
  if (scripts === undefined || scripts === false) return [];
  return [
    `[缓存配置] run.cache.scripts = ${JSON.stringify(scripts)}：script 缓存被配置打开 ⇒ 假绿`,
  ];
}
// ── [root-gate-detector-end]

// ── 真实仓库求值（模块加载时跑一次；读的是仓库根 package.json 字面量）────────────────
const ROOT_SCRIPTS = readRootScripts();
const REAL_VERDICT = evaluateGateScripts(ROOT_SCRIPTS);

/** 取某脚本的扫描证据；拿不到直接抛（证明调用方写错名字，而不是静默跳过断言）。 */
function scanOf(verdict: GateVerdict, name: string): ScriptScan {
  const scan = verdict.scripts.find((s) => s.name === name);
  if (!scan) throw new Error(`verdict 缺少 scripts.${name} 的扫描证据`);
  return scan;
}

/** 克隆真实 scripts 表并替换单个脚本值 —— 反事实注入只拿内存副本，绝不碰仓库文件。 */
function withScript(name: string, value: string): Record<string, string> {
  return { ...ROOT_SCRIPTS, [name]: value };
}

/** 断言：把 inject 作用到两脚本后，同一个 detector 必须命中 expectedToken 且产出一条违规。 */
function expectCacheHit(
  label: string,
  inject: (script: string) => string,
  expectedToken: string,
): void {
  for (const name of GATE_SCRIPT_NAMES) {
    const verdict = evaluateGateScripts(withScript(name, inject(ROOT_SCRIPTS[name])));
    expect(
      scanOf(verdict, name).cacheEnablingTokens,
      `${label}：注入 scripts.${name} 后必须被命中`,
    ).toContain(expectedToken);
    expect(verdict.problems.length, `${label}：注入后 problems 不能为空`).toBeGreaterThan(0);
  }
}

// ── 扩展求值（2026-10-19）：CI workflow / 根 vite.config.ts / scripts.vp 别名 ────────────
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");
const WORKFLOW_ENTRIES = readdirSync(WORKFLOWS_DIR)
  .filter((file) => /\.ya?ml$/.test(file))
  .toSorted()
  .map((file) => ({ file, source: readFileSync(join(WORKFLOWS_DIR, file), "utf8") }));
const WORKFLOW_SCANS = WORKFLOW_ENTRIES.map(({ file, source }) => ({
  file,
  hits: scanWorkflowText(source),
}));
const WORKFLOW_RUN_LINES = WORKFLOW_ENTRIES.reduce(
  (n, { source }) => n + (source.match(/^\s*(?:-\s*)?run:/gm) ?? []).length,
  0,
);
/** 真实配置动态 import 求值（defineConfig 只回填入参）；字面量路径由 vitest 转译 TS，CI Node22 可移植。 */
async function loadRootViteConfig(): Promise<unknown> {
  return ((await import("../../../../vite.config.ts")) as { default?: unknown }).default;
}
describe("真实仓库：check:all / test:all 不得启用 vp run 缓存（AGENTS.md 门禁边界）", () => {
  it("核心判据：两脚本的缓存使能 token = 0", () => {
    for (const name of GATE_SCRIPT_NAMES) {
      expect(
        scanOf(REAL_VERDICT, name).cacheEnablingTokens,
        `scripts.${name} 禁止出现 --cache / --cache=<v>（见文件头判据 3）`,
      ).toEqual([]);
    }
  });

  it("阳性锚点 A：两脚本存在、非空且经 vp run 执行", () => {
    for (const name of GATE_SCRIPT_NAMES) {
      const scan = scanOf(REAL_VERDICT, name);
      expect(scan.present, `scripts.${name} 必须存在且非空`).toBe(true);
      expect(scan.usesVpRun, `scripts.${name} 必须含 vp run`).toBe(true);
    }
  });

  it("阳性锚点 B：--filter 覆盖承诺（含 @pictelio/android-host）+ 扫描面达下界", () => {
    for (const name of GATE_SCRIPT_NAMES) {
      const scan = scanOf(REAL_VERDICT, name);
      for (const required of REQUIRED_FILTERS) {
        expect(scan.filterValues, `scripts.${name} 的 --filter 列表`).toContain(required);
      }
      expect(
        scan.filterValues.length,
        `scripts.${name} 的 --filter 命中数（实测 8，下界 ${MIN_FILTER_HITS}）`,
      ).toBeGreaterThanOrEqual(MIN_FILTER_HITS);
      expect(
        scan.tokenCount,
        `scripts.${name} 的 token 数（实测 23，下界 ${MIN_TOKEN_COUNT}）`,
      ).toBeGreaterThanOrEqual(MIN_TOKEN_COUNT);
    }
  });

  it("聚合判据零违规（新增判据若红会在这里带出完整理由）", () => {
    const detail = REAL_VERDICT.problems.map((p) => `  - ${p}`).join("\n");
    expect(REAL_VERDICT.problems, `门禁脚本判据违规：\n${detail}`).toEqual([]);
  });
});

describe("反事实自检（常驻；门禁纪律「判别力三要件」之反事实 + 阳性对照）", () => {
  it("基线（好形态）：当前真实脚本零 cache 命中、零违规（防误报）", () => {
    const verdict = evaluateGateScripts(ROOT_SCRIPTS);
    expect(verdict.scripts.map((s) => s.cacheEnablingTokens)).toEqual([[], []]);
    expect(verdict.problems).toEqual([]);
  });

  it("坏形态 1：尾部追加 --cache（最可能的回加形态：… check --cache）→ 命中", () => {
    expectCacheHit("尾部 --cache", (script) => `${script} --cache`, "--cache");
  });

  it("坏形态 2：中段插入 --cache（与 --parallel/--filter 混排，不只尾部）→ 命中", () => {
    expectCacheHit(
      "中段 --cache",
      (script) => script.replace("--parallel", "--parallel --cache"),
      "--cache",
    );
  });

  it("坏形态 3：--cache=true（--cache=<v> 换皮）→ 命中", () => {
    expectCacheHit("--cache=true", (script) => `${script} --cache=true`, "--cache=true");
  });

  it("坏形态 4：--cache=false（=v 形态一律 fail-closed，不看值）→ 命中", () => {
    expectCacheHit("--cache=false", (script) => `${script} --cache=false`, "--cache=false");
  });

  it("坏形态 5：带引号的 --cache（shell 同义写法，tokenizer 必须剥引号）→ 命中", () => {
    expectCacheHit("带引号 --cache", (script) => `${script} "--cache"`, "--cache");
  });

  it("好形态对照：--no-cache（vp run --help 的关闭开关）不得误报", () => {
    for (const name of GATE_SCRIPT_NAMES) {
      const verdict = evaluateGateScripts(withScript(name, `${ROOT_SCRIPTS[name]} --no-cache`));
      expect(
        scanOf(verdict, name).cacheEnablingTokens,
        `scripts.${name} 追加 --no-cache 后不得被判成缓存使能`,
      ).toEqual([]);
      expect(verdict.problems, `scripts.${name} 追加 --no-cache 后不得产生违规`).toEqual([]);
    }
  });

  it("等价写法对照：node_modules/.bin/vp run 不被误判为「未使用 vp run」", () => {
    const rewritten = ROOT_SCRIPTS["check:all"].replace("pnpm vp run", "node_modules/.bin/vp run");
    const verdict = evaluateGateScripts(withScript("check:all", rewritten));
    expect(scanOf(verdict, "check:all").usesVpRun).toBe(true);
    expect(verdict.problems, "等价 vp 路径写法不得产生违规").toEqual([]);
  });

  it("范围对照：只守两个门禁脚本——其它脚本带 --cache 不触发本门禁（失效面 3 的机器化登记）", () => {
    const scripts = { ...ROOT_SCRIPTS, "not-a-gate": "vp run --cache build" };
    expect(evaluateGateScripts(scripts).problems).toEqual([]);
  });

  it("阳性对照：删掉 scripts.test:all → 「存在」判据转红", () => {
    const scripts = { ...ROOT_SCRIPTS };
    delete scripts["test:all"];
    const verdict = evaluateGateScripts(scripts);
    expect(
      verdict.problems.some((p) => p.startsWith("[缺失]") && p.includes("test:all")),
      "test:all 被删后必须报 [缺失]",
    ).toBe(true);
  });

  it("阳性对照：check:all 改成裸 tsc（绕过 vp run）→ 「绕过 runner」判据转红", () => {
    const verdict = evaluateGateScripts(
      withScript("check:all", "tsc --noEmit -p packages/android-host/tsconfig.json"),
    );
    expect(
      verdict.problems.some((p) => p.startsWith("[绕过 runner]")),
      "未用 vp run 时必须报 [绕过 runner]",
    ).toBe(true);
  });

  it("阳性对照：从 check:all 移除 --filter @pictelio/android-host → 「漏包」判据转红", () => {
    const current = ROOT_SCRIPTS["check:all"];
    expect(current, "注入前先证明该 filter 真的存在，否则这条对照会恒真").toContain(
      " --filter @pictelio/android-host",
    );
    const verdict = evaluateGateScripts(
      withScript("check:all", current.replace(" --filter @pictelio/android-host", "")),
    );
    expect(
      verdict.problems.some((p) => p.startsWith("[漏包]") && p.includes("@pictelio/android-host")),
      "缺 android-host filter 时必须报 [漏包]",
    ).toBe(true);
  });

  it("阳性对照：把 test:all 的 --filter 全删 → 「检测式不可信」判据转红", () => {
    const stripped = ROOT_SCRIPTS["test:all"].replace(/ --filter \S+/g, "");
    const verdict = evaluateGateScripts(withScript("test:all", stripped));
    expect(
      verdict.problems.some((p) => p.startsWith("[检测式不可信]") && p.includes("--filter")),
      "filter 扫描面清空后必须报 [检测式不可信]",
    ).toBe(true);
  });
});

describe("扩展判据（2026-10-19）：CI workflow / vite run.cache / scripts.vp 别名", () => {
  it("CI workflow：无字面量 cache token；扫描面非空（失效面 #1 覆盖 + 阳性锚）", () => {
    const hits = WORKFLOW_SCANS.flatMap((s) => s.hits.map((hit) => `${s.file}${hit}`));
    expect(hits, `CI workflow 出现 cache 使能 token：\n${hits.join("\n")}`).toEqual([]);
    expect(WORKFLOW_ENTRIES.length, "至少 2 份 workflow（实测 3）").toBeGreaterThanOrEqual(2);
    expect(WORKFLOW_RUN_LINES, "run 命令行数下界 10（实测 21）").toBeGreaterThanOrEqual(10);
  });

  it("CI workflow 反事实：坏样例命中 / 好样例不误报", () => {
    expect(scanWorkflowText("- run: pnpm vp run --cache check:all"), "坏样例").toHaveLength(1);
    expect(scanWorkflowText("- run: vp run --cache=true x")[0]).toContain("--cache=true");
    for (const good of [
      "- run: pnpm check:all",
      "- run: pnpm vp run --no-cache check:all",
      "with:\n  cache: pnpm",
      "# 严禁 --cache（注释不执行）",
    ]) {
      expect(scanWorkflowText(good), `好样例不得误报：${good}`).toEqual([]);
    }
  });

  it("根 vite.config.ts：真实配置动态 import + run.cache 坏配置反事实（fail-closed）", async () => {
    const config = await loadRootViteConfig();
    expect(config, "真实 vite.config 必须加载成功（失败即红，不 skip）").toHaveProperty("lint");
    expect(detectRunCacheScriptCaching(config), "真实配置不得开 script 缓存").toEqual([]);
    for (const [label, bad] of [
      ["cache: true", { run: { cache: true } }],
      ["scripts: true", { run: { cache: { scripts: true } } }],
      ['scripts: "true"', { run: { cache: { scripts: "true" } } }],
      ["scripts 表达式", { run: { cache: { scripts: () => true } } }],
    ] as [string, unknown][]) {
      expect(detectRunCacheScriptCaching(bad), `坏配置必须命中：${label}`).not.toEqual([]);
    }
    const goodCases: unknown[] = [
      {},
      { run: {} },
      { run: { cache: false } },
      { run: { cache: { scripts: false } } },
      { run: { cache: { tasks: true } } },
    ];
    for (const good of goodCases) expect(detectRunCacheScriptCaching(good)).toEqual([]);
    expect(detectRunCacheScriptCaching(undefined), "无法判定时 fail-closed").not.toEqual([]);
    expect(detectRunCacheScriptCaching("not-a-config"), "无法判定时 fail-closed").not.toEqual([]);
  });

  it("scripts.vp 别名：无 cache token；注入 --cache 即红（失效面 #4 已覆盖）", () => {
    expect(ROOT_SCRIPTS["vp"], "根 scripts.vp 必须存在").toBeTruthy();
    expect(findCacheEnablingTokens(ROOT_SCRIPTS["vp"])).toEqual([]);
    const injected = evaluateGateScripts(withScript("vp", `${ROOT_SCRIPTS["vp"]} --cache`));
    expect(
      injected.problems.some((p) => p.startsWith("[别名注入]")),
      "别名注入必须判红",
    ).toBe(true);
  });
});
