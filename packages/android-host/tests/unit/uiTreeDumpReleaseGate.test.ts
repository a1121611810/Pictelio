/**
 * release 门禁接线守卫：UI 树导出的**每个**调用点都必须传 `BuildConfig.DEBUG`。
 *
 * ## 判据来源（oracle 溯源，禁自洽反推）
 * - 门禁形态：spec `docs/specs/app-lynx-ui-tree-dump-t0.md`「Implementation Decisions · 门禁」
 *   —— 整段以 `BuildConfig.DEBUG` 包裹，release 编译下为恒 false 死代码、被 R8 移除。
 * - 决策与能力边界：ADR-0223 §2.2「门禁：BuildConfig.DEBUG 作为判定函数的入参」。
 * - 「release 变体里 DEBUG 是字面量 false ⇒ javac 内联 ⇒ 整块成死代码」这一层由
 *   宿主侧可执行门禁 `verifyReleaseBuildConfig` 承担（只证取值，不证 R8 移除）。
 * - 接线点清单：`io.pictelio.app.UiTreeDump.scheduleIfRequested` 的全部调用点。
 *
 * ## 为什么需要这道门禁（Spec 轴 finding：调用点完备性无机器防线）
 * 宿主侧 `UiTreeDumpTest` 只直接调 `UiTreeDump.shouldDump(...)`，**不碰调用点**。
 * 于是把 `LynxActivity` 两处的 `BuildConfig.DEBUG` 改成 `true`，宿主单测仍全绿，
 * 而 release 包会真的导出 UI 树 —— 门禁只由「约定」保证，没有机器防线。
 *
 * ## 扫描面（第 2 轮 review 修过两次）
 * ① 扫描根**不是**写死的 `LynxActivity.java`，而是**同包全部生产 Java 源文件**
 *    （`src/lynx/java/**` + `src/main/java/**` 递归）。第 1 版只扫单文件 ⇒
 *    「第三个调用点放进别的 .java 文件」实测**骗过守卫**（外部复核的变异体 M4 GREEN）。
 *    `UiTreeDump` 是 package-private，只有 `io.pictelio.app` 包内的类能合法调用它，
 *    所以「同包生产源集」就是**完备**的调用点全集。
 * ② 实参文本**先剥注释再判定**：第 1 版用裸 `args.includes("BuildConfig.DEBUG")`，
 *    实参真值写成 `true`、同一实参列表里留一句 `// TODO 改回 BuildConfig.DEBUG`
 *    ⇒ 实测守卫 7/7 全绿而 release 真的会导出（Spec 轴 F2 阻塞项）。
 *
 * ## 阳性对照（强制项，不是加分项）
 * 本仓此前多条防线在「改动前就已经绿」，是恒真的假防线。唯一能识破的办法是反事实：
 * ① 合成源码（把 `BuildConfig.DEBUG` 换成 `true`）必须打红；
 * ② **注释里含 `BuildConfig.DEBUG`、实参为 `true`** 必须打红；
 * ③ 实参里含 `);` 字符串时**不得误截断**成别的实参；
 * ④ 跨文件调用点必须被扫到（否则「完备性」是假的）；
 * ⑤ **对真实源码**做同样的反事实替换（内存中替换，不落盘）必须打红。
 *
 * ## 已知失效面（显式登记，非缺陷）
 * - **只认 `BuildConfig.DEBUG` 字面量**：若将来改成 `BuildConfig.DEBUG && someFlag`，
 *   本守卫会判红（这是刻意保守：宁可多问一次，也不要放过 release 导出能力）。
 * - **不覆盖 R8 移除**：本守卫只证「调用点传的是 DEBUG 闸门」，不证「R8 确实移除了本类」
 *   （无 dex 级断言，见 ADR-0223 §3.3）。
 * - **不扫描测试源集**（`src/test/`、`src/testLynx/`）：测试代码不进生产 APK，
 *   在那里调用本方法不构成 release 导出风险。
 * - **只覆盖 Java 调用点**：本守卫不证「宿主侧没有别的出口导出 UI 树」
 *   （例如未来新增的另一个触发通道）——那需要另一道门禁，见 **#1049**。
 * - **不识别被拆开拼接的标识符**（如 `"BuildConfig" + ".DEBUG"`）：实参里必须出现
 *   完整字面量才判定通过——Java 编译器要求编译期常量才能做条件编译，
 *   拼接出来的字符串**不可能**参与 `if (BuildConfig.DEBUG)` 这类常量折叠，
 *   故本守卫的窄化不会放过真实的 release 导出。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOST_APP_DIR = join(REPO_ROOT, "packages/android-host/android/app");

/** 生产 Java 源集根（递归扫描）。测试源集不在其中——见文件头「已知失效面」。 */
const PRODUCTION_JAVA_ROOTS = [
  join(HOST_APP_DIR, "src/lynx/java"),
  join(HOST_APP_DIR, "src/main/java"),
];

const CALL_MARKER = "UiTreeDump.scheduleIfRequested(";

/** 一次调用的实参文本（源码原样，已剥注释）。 */
interface CallSite {
  /** 相对仓库根的文件路径。 */
  file: string;
  /** 源码中的行号（1 基）。 */
  line: number;
  /** 该次调用的实参列表（括号内原文，已剥注释）。 */
  args: string;
}

/**
 * 把 Java 注释替换成**等长空格**（保留换行）。
 *
 * <p>等长是关键：替换后**偏移量与行号与原文完全一致** ⇒ 实参提取可以复用原文的行号，
 * 且 `indexOf` 的位置在两份文本间通用。
 *
 * <p>字符串字面量内的 `//` 与 `/*` 不当注释处理（逐字符扫，识别引号与转义）。
 */
function stripJavaComments(text: string): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (two === "/*") {
      while (i < text.length && text.slice(i, i + 2) !== "*/") {
        if (text[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < text.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * 从 `CALL_MARKER` 起做**括号配平**取出实参原文。
 *
 * <p>为什么不用 `lastIndexOf(");")`：实参里出现字符串 `"x);y"` 时会**误截断**成
 * `…setAction("x`（第 2 轮 review 实测：误红，fail-safe 但报错具误导性）。
 *
 * @param clean 已剥注释的文本
 * @param from 在该文本里开始找 marker 的偏移
 * @returns 实参原文（不含两侧括号）；括号未配平则 null
 */
function extractArgs(clean: string, from: number): string | null {
  const start = clean.indexOf(CALL_MARKER, from);
  if (start === -1) return null;
  let depth = 0;
  let i = start + CALL_MARKER.length - 1; // 指向 '('
  for (; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < clean.length) {
        if (clean[i] === "\\") {
          i++;
          continue;
        }
        if (clean[i] === quote) break;
        i++;
      }
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return clean.slice(start + CALL_MARKER.length, i);
    }
  }
  return null;
}

/** 递归收集目录下的 .java 文件（相对仓库根的路径 → 源码文本）。 */
function collectProductionJavaSources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.name.endsWith(".java")) {
        out.set(relative(REPO_ROOT, p), readFileSync(p, "utf-8"));
      }
    }
  };
  for (const root of PRODUCTION_JAVA_ROOTS) {
    if (existsSync(root)) walk(root);
  }
  return out;
}

/**
 * 抽出 `UiTreeDump.scheduleIfRequested(...)` 的全部调用点。
 *
 * <p>扫描面不失效：调用点一个都没找到时返回空数组，由调用方断言数量下界
 * （「零命中 ≠ 不支持」—— 空数组必须让断言转红，不能静默恒真）。
 */
function findCallSites(sources: Map<string, string>): CallSite[] {
  const out: CallSite[] = [];
  for (const [file, source] of sources) {
    const clean = stripJavaComments(source);
    const lines = clean.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let searchFrom = 0;
      while (true) {
        const idx = lines[i].indexOf(CALL_MARKER, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + CALL_MARKER.length;
        // 跨行调用：逐行往后拼，凑齐括号再切实参（不 trim ⇒ 行内偏移量保持不变）
        let joined = "";
        let j = i;
        let args: string | null = null;
        while (j < lines.length) {
          joined += (joined ? "\n" : "") + lines[j];
          j++;
          args = extractArgs(joined, idx);
          if (args !== null) break;
        }
        if (args === null) continue;
        out.push({ file, line: i + 1, args: args.trim() });
      }
    }
  }
  return out;
}

/** 实参列表里是否出现 `BuildConfig.DEBUG`（DEBUG 闸门接线）。 */
function passesDebugGate(args: string): boolean {
  return args.includes("BuildConfig.DEBUG");
}

/** 实参列表里是否出现采样点标识（产物名靠它区分两轮）。 */
function passesPointGate(args: string): boolean {
  return args.includes("UiTreeDump.POINT_");
}

describe("UI 树导出的 release 门禁接线", () => {
  const sources = collectProductionJavaSources();
  const sites = findCallSites(sources);

  it("扫描面有效：至少找到 2 个调用点（冷启动 + 热启动）", () => {
    // 抽取器有效性：零命中必须是「转红」而不是「恒真通过」
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it("每个调用点都必须传 BuildConfig.DEBUG 作门禁入参", () => {
    for (const site of sites) {
      // ⚠️ Vitest 的签名是 expect(actual, message)：实参在前、错误消息在后。
      //   写反了不会报错，只会变成「拿消息字符串去比 true」——断言恒假。
      expect(
        passesDebugGate(site.args),
        `${site.file}:${site.line} 的 scheduleIfRequested 调用必须传 BuildConfig.DEBUG` +
          `（实参：${site.args}）——否则 release 包也会导出 UI 树`,
      ).toBe(true);
    }
  });

  it("每个调用点都必须传采样点标识（cold / hot）——产物名靠它区分两轮", () => {
    for (const site of sites) {
      expect(
        passesPointGate(site.args),
        `${site.file}:${site.line} 必须传采样点标识 UiTreeDump.POINT_COLD / POINT_HOT` +
          `（实参：${site.args}）`,
      ).toBe(true);
    }
  });

  it("生产源集目录确实存在（路径没写错，否则上面全是空断言）", () => {
    for (const root of PRODUCTION_JAVA_ROOTS) {
      expect(existsSync(root)).toBe(true);
    }
  });
});

describe("检测式阳性对照（反事实：把门禁换成 true 必须被抓住）", () => {
  const compliant = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), BuildConfig.DEBUG,
              UiTreeDump.POINT_COLD);
  `;
  const violating = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), true,
              UiTreeDump.POINT_COLD);
  `;

  it("合规调用点：扫描得到 1 处且通过门禁检查", () => {
    const sites = findCallSites(new Map([["A.java", compliant]]));
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(true);
  });

  it("违规调用点（DEBUG → true）：扫描仍得到 1 处，但门禁检查必须打红", () => {
    const sites = findCallSites(new Map([["A.java", violating]]));
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(false);
  });

  it("漏传采样点标识：采样点检查必须打红", () => {
    const sites = findCallSites(
      new Map([["A.java", compliant.replace("UiTreeDump.POINT_COLD", '"cold"')]]),
    );
    expect(sites).toHaveLength(1);
    expect(passesPointGate(sites[0].args)).toBe(false);
  });

  it("注释里含 BuildConfig.DEBUG、实参却是 true ⇒ 必须打红（第 2 轮 Spec 轴 F2 阻塞项）", () => {
    const sneaky = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), true, // TODO 改回 BuildConfig.DEBUG
              UiTreeDump.POINT_COLD);
  `;
    const sites = findCallSites(new Map([["A.java", sneaky]]));
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(false);
  });

  it("块注释里含 BuildConfig.DEBUG、实参却是 true ⇒ 同样必须打红", () => {
    const sneaky = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), true,
              /* BuildConfig.DEBUG */ UiTreeDump.POINT_COLD);
  `;
    const sites = findCallSites(new Map([["A.java", sneaky]]));
    expect(sites).toHaveLength(1);
    expect(passesDebugGate(sites[0].args)).toBe(false);
  });

  it("实参里含 ');' 字符串时不得误截断（第 2 轮 Spec 轴 F8）", () => {
    const tricky = `
      UiTreeDump.scheduleIfRequested(
              LynxActivity.this, lynxView, getIntent(), BuildConfig.DEBUG,
              UiTreeDump.POINT_COLD, "x);y");
  `;
    const sites = findCallSites(new Map([["A.java", tricky]]));
    expect(sites).toHaveLength(1);
    expect(sites[0].args).toContain('"x);y"');
    expect(passesDebugGate(sites[0].args)).toBe(true);
  });

  it("跨文件调用点必须被扫到（第 1 版失效面：写死单文件 ⇒ 看不见别的文件里的调用点）", () => {
    const sites = findCallSites(
      new Map([
        ["A.java", compliant],
        ["B.java", violating],
      ]),
    );
    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.file)).toEqual(["A.java", "B.java"]);
    // 合规的那个过、违规的那个红
    expect(passesDebugGate(sites[0].args)).toBe(true);
    expect(passesDebugGate(sites[1].args)).toBe(false);
  });
});

describe("对真实源码的反事实（变异只在内存里做，不落盘）", () => {
  const real = collectProductionJavaSources();

  it("真实源码原样扫描：全部调用点都过门禁（基线）", () => {
    const sites = findCallSites(real);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const site of sites) {
      expect(passesDebugGate(site.args)).toBe(true);
    }
  });

  it("把真实源码里的 BuildConfig.DEBUG 全换成 true ⇒ 必须被判红", () => {
    const mutated = new Map<string, string>();
    for (const [file, source] of real) {
      mutated.set(file, source.replaceAll("BuildConfig.DEBUG", "true"));
    }
    const sites = findCallSites(mutated);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    const stillPassing = sites.filter((s) => passesDebugGate(s.args));
    expect(
      stillPassing.map((s) => `${s.file}:${s.line}`),
      "变异后必须一处都过不了 DEBUG 门禁，否则说明本守卫对真实源码没有判别力",
    ).toEqual([]);
  });
});
