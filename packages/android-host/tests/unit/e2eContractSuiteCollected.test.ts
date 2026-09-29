/**
 * 收集防线：`tests/android-e2e/unit/**` 的 8 个契约单测**必须**被本包的
 * `vitest.config.ts` 收进 `pnpm test`（进而进 `pnpm test:all` → CI）。
 *
 * ## 为什么需要这道防线（这是修过一次门禁漏洞的成果，issue #818）
 *
 * 这 8 个文件是 android-e2e 契约工具的**纯函数**单测（不碰 adb / 模拟器）。
 * 在 `packages/app` 时代，它们的唯一收集者是 `tests/android-e2e/vitest.config.ts`，
 * 而跑该目录的唯一脚本会连带编译 APK + 起模拟器。于是：
 *
 * ```
 * 这批单测默认永不执行  ⇒  不进 pnpm test  ⇒  不进 test:all  ⇒  不进 CI
 * ```
 *
 * 结果是 `env.flavor.test.ts`（`E2E_FLAVOR` 缺省翻转的唯一防线）**静默失明数月**，
 * 期间 CI 全绿。教训有两层：
 *   ① 收进主配置（#818 的修复）；
 *   ② **给「已收进」这件事本身装一道防线**——`passWithNoTests: false` 只能发现
 *      「一个都没收集到」，发现不了「少了一个目录」或「某个文件被移出 include」。
 * 本文件就是第 ② 层。
 *
 * ## oracle
 *
 * - 文件清单：`docs/testing/conventions.md` §核心规则·文件命名
 *   （`tests/android-e2e/unit/` 收录 android-e2e 契约工具的纯函数单测，#818 起并入主配置）
 * - 期望「它们在 CI 里跑」：ADR-0097（关键行为必须有 CI 内单测防线）+ AGENTS.md「测试」节门禁边界
 * - ADR-0203 决策 2：这些资产随宿主迁移到 `packages/android-host`
 *
 * ## 阳性对照
 *
 * 「文件在磁盘上」与「文件被收集」是两件事，只查前者是恒绿假防线。
 * 故下面对**真实配置文件**做 glob 匹配：把某条 include 摘掉，本文件立刻转红。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));

/** 宿主包根 = unit → tests → android-host，共 2 级。 */
const HOST_DIR = path.resolve(testDir, "../..");
const VITEST_CONFIG = path.join(HOST_DIR, "vitest.config.ts");
/** 被守卫的那 8 个契约单测所在目录（相对宿主包根）。 */
const CONTRACT_DIR_REL = "tests/android-e2e/unit";
const CONTRACT_DIR_ABS = path.join(HOST_DIR, "tests", "android-e2e", "unit");

/** 必须随 CI 执行的 8 个契约单测（文件名 ↔ 各自定义的 oracle 一一对应）。 */
const CONTRACT_UNIT_TESTS = [
  { file: "env.flavor.test.ts", covers: "E2E_FLAVOR 缺省/显式值判定（#818 失明数月的那一条）" },
  { file: "noControlChars.test.ts", covers: "源码裸控制字节防线" },
  { file: "prefs.devLogin.test.ts", covers: "dev intent 登录（adb 调用以 mock 顶掉）" },
  { file: "prefs.poll.test.ts", covers: "偏好轮询纯函数" },
  { file: "releaseGate.test.ts", covers: "发版门外层三态门 + doc-parity" },
  { file: "specSkipGuard.test.ts", covers: "spec skip 守卫" },
  { file: "transition-geometry.test.ts", covers: "转场几何纯函数" },
  { file: "transitionMatrixWiring.test.ts", covers: "转场矩阵 wiring" },
] as const;

/**
 * 把 vitest 的 include / exclude glob 翻译成正则。
 * **只实现本仓实际用到的记号**，不引入 minimatch/picomatch 依赖
 * （那会让一条防线多一个可失效的外部前提）：
 *   · 双星 + 斜杠 → 跨任意层目录（可为零层）
 *   · 结尾双星     → 该目录下全部（可为零层）
 *   · 单星         → 单层内任意字符（不含斜杠）
 *   · 其余         → 字面量（逐字符查表转义）
 *
 * ⚠️ 三条踩坑（都真实报过错，不是假想）：
 *   ① 注释里**不能出现「星号紧邻斜杠」的字面量**——它会当场结束块注释，
 *      后半段全被当成代码解析（所以上面刻意用中文描述记号）。
 *   ② 「正则转义正则」本身要写一个含方括号与反斜杠的字符类，部分解析器拒绝。
 *      故转义走查表，见下。
 *   ③ **不能先转义再替换单星**：转义把单星变成「反斜杠 + 星号」，随后的替换会把
 *      那个转义反斜杠一起吃掉，产出 `[^/]*` 缺了转义斜杠的破损模式——
 *      实测表现为「include 里明明有这条 glob，8 个文件却全被判未收集」。
 *      故按字符扫一遍，单星在转义**之前**就处理掉。
 */
const REGEX_META = new Set(".*+?^${}()|[]\\/".split(""));

function escapeChar(c: string): string {
  return REGEX_META.has(c) ? `\\${c}` : c;
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    // ⚠️ 「斜杠 + 结尾双星」必须**整段**吃掉：若先按字面量吐出那个斜杠、再把结尾
    // 双星译成「(斜杠 + 任意)」，就会拼出 `specs//` 这种永不匹配的模式
    // （实测就栽在这：include 那条过、exclude 那条恒 false）。
    if (glob.startsWith("/**", i) && i + 3 === glob.length) {
      out += "(?:/.*)?";
      i += 3;
      continue;
    }
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (glob.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    if (glob[i] === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    out += escapeChar(glob[i]);
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

describe("收集防线：android-e2e 契约单测必须进 pnpm test → test:all → CI（#818）", () => {
  const configSrc = readFileSync(VITEST_CONFIG, "utf8");

  it("8 个契约单测都在磁盘上（迁移丢件即红）", () => {
    const missing = CONTRACT_UNIT_TESTS.filter(
      (t) => !existsSync(path.join(CONTRACT_DIR_ABS, t.file)),
    ).map((t) => t.file);
    expect(missing, `缺失的契约单测：${missing.join("、")}`).toEqual([]);
  });

  it("本包 vitest 配置的 include 覆盖这 8 个文件（glob 匹配真实配置，非字面量比对）", () => {
    const includeBlock = configSrc.match(/include:\s*\[([^\]]*)\]/)?.[1];
    expect(includeBlock, "vitest.config.ts 必须显式声明 include（#818 的修复形态）").toBeDefined();

    const globs = [...(includeBlock ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(globs.length, "include 里至少有一条 glob").toBeGreaterThan(0);
    const regexes = globs.map(globToRegExp);

    const notCollected = CONTRACT_UNIT_TESTS.filter(
      (t) =>
        !regexes.some((re) => re.test(`${CONTRACT_DIR_REL}/${t.file}`)),
    ).map((t) => t.file);
    expect(
      notCollected,
      `以下契约单测不在 vitest.config.ts 的 include 命中范围内（会静默失明）：${notCollected.join("、")}`,
    ).toEqual([]);
  });

  it("反事实：glob 翻译本身能区分「收」与「没收」（阳性对照，防翻译器恒真放行）", () => {
    const re = globToRegExp("tests/android-e2e/unit/**/*.test.ts");
    expect(re.test("tests/android-e2e/unit/releaseGate.test.ts")).toBe(true);
    expect(re.test("tests/android-e2e/unit/env.flavor.test.ts")).toBe(true);
    // 不在 android-e2e 下的同名文件必须**不**被这条 glob 收走
    expect(re.test("tests/unit/releaseGate.test.ts")).toBe(false);
    // .spec.ts 不是 .test.ts，不得被收
    expect(re.test("tests/android-e2e/unit/releaseGate.spec.ts")).toBe(false);
  });

  it("模拟器 spec 不得被主配置捞进来（否则 CI 会被 AVD 依赖拖死）", () => {
    const excludeBlock = configSrc.match(/exclude:\s*\[([^\]]*)\]/)?.[1] ?? "";
    const globs = [...excludeBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const re = globs.map(globToRegExp);
    expect(
      re.some((r) => r.test("tests/android-e2e/specs/smoke.spec.ts")),
      "vitest.config.ts 必须显式 exclude tests/android-e2e/specs/**",
    ).toBe(true);
  });

  it("T0 门禁在位：passWithNoTests 必须为 false（空壳漂移防线，ADR-0097）", () => {
    expect(configSrc).toMatch(/passWithNoTests:\s*false/);
  });

  it("清单非空锚点：8 条不是抄来的常量（防止有人把数组清空后全绿）", () => {
    expect(CONTRACT_UNIT_TESTS.length).toBe(8);
    for (const t of CONTRACT_UNIT_TESTS) expect(t.covers.length).toBeGreaterThan(0);
  });
});
