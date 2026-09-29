/**
 * 源码**控制字节**防线（issue #819 第 13 轮 review）。
 *
 * ## 为什么需要它
 *
 * `releaseGate.test.ts` 曾被我写成含**裸 NUL 字节**（`0x00`）的样子：
 * `const SENTINEL = "<NUL>";`。后果不是「跑不起来」，而是**静默失明**——
 * `file` 把该文件判成 binary、`grep -c` 对 NUL 偏移之后的全部内容返回 0（rc=1）、
 * `rg` 只打印 `binary file matches` 不给行号。而失明的范围恰好覆盖了那个文件里
 * **最承重的一批断言**（全部 doc-parity 断言）。
 *
 * ⚠️ **`pnpm check:all` 完全不拦**：oxfmt、oxlint、tsc 都接受裸 NUL。
 * 也就是说，这类损坏能一路进 main，直到有人恰好 grep 到它。
 * ⇒ 必须有独立于 formatter/linter/type-checker 的机械防线。
 *
 * ## 扫描根为什么变了（ADR-0203）
 *
 * 原实现扫 `packages/app/{src,tests}`。WebView 客户端删除后 `src/` 不复存在，
 * 承重的文本源码变成两处，扫描根随之改为宿主包的：
 *   - `tests`   —— 单元 / 契约测试 + 模拟器 E2E 套件
 *   - `scripts` —— 发布脚本本体（`.mjs`，发布链的唯一事实源）
 * 扩展名同时补上 `.mjs`/`.js`/`.cjs`：原清单只收 `.ts*`，而迁移进来的发布脚本
 * 是 `.mjs`——不加就等于把最该被扫的文件排除在外。
 *
 * ## 判据
 *
 * 源码文本里**不得出现控制字符**（`\x00`–`\x08` / `\x0B` / `\x0C` / `\x0E`–`\x1F`）。
 * 允许的：制表符（`\x09`）、换行（`\x0A`）、回车（`\x0D`），以及 U+FFFD 之外的
 * 全部可打印字符（含中文与全角标点）。
 *
 * ⚠️ 查这类问题**不能用** `grep -rn $'\ufffd'` 之类的 shell 展开（macOS bash 3.2
 * 不展开 `\uXXXX`，是假阴性），本文件直接用 `charCodeAt` 逐字符判。
 *
 * ## 阳性对照（强制项，常驻）
 *
 * 「全仓无控制字符」这类全称断言是**恒真假防线**的经典形态：扫描根写错、
 * 扩展名写错、walk 提前 return，它照样绿。故本文件把反事实**常驻**成测试：
 * 在 `os.tmpdir()` 造一个含**裸 NUL** 的文件，喂给**同一个** `firstControlChar`，
 * 必须报出行号与码位。扫描逻辑日后被重构，这条也跟着一起验。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * 宿主包根 = unit → android-e2e → tests → android-host，共 3 级。
 * ⚠️ 别写成 4 级（那是 `packages/`）。
 */
const HOST_DIR = path.resolve(testDir, "../../..");
const SCAN_ROOTS = ["tests", "scripts"];
const SCAN_EXT = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];

/**
 * 扫描下限：低于此数说明**迁移丢件**或扫描根被改坏，下一条全称断言会静默恒真。
 * 依据 = 2026-09-29 迁移后的实测清单（tests 51 + scripts ≥ 13），取 40 留出
 * T05 脚本增删的余量，同时仍远高于「只收到一两个文件」的空转态。
 * ⚠️ 这个数不是随手写的：它与 `webviewRemovalInvariants` 不变量 3
 * （宿主资产齐全）是同一次迁移的两侧——那边保「件在」，这边保「件被扫到」。
 */
const MIN_SCANNED_FILES = 40;

/** 允许出现的控制字符：制表、换行、回车。 */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCAN_EXT.some((e) => full.endsWith(e))) yield full;
  }
}

const files = SCAN_ROOTS.flatMap((r) => [...walk(path.join(HOST_DIR, r))]);

/** 找第一个不允许的控制字符，返回它的行号与码位。 */
function firstControlChar(text: string): { line: number; code: number } | undefined {
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      line++;
      continue;
    }
    if (c < 0x20 && !ALLOWED_CONTROL.has(c)) return { line, code: c };
  }
  return undefined;
}

/** 把一批文件跑一遍检测，返回违规清单（与上面那条全称断言同一个函数）。 */
function scanOffenders(paths: string[]): { f: string; hit: { line: number; code: number } }[] {
  return paths
    .map((f) => ({ f, hit: firstControlChar(readFileSync(f, "utf8")) }))
    .filter((x) => x.hit !== undefined);
}

describe("源码控制字节防线（裸 NUL 会让 grep 对该文件后半段静默失明）", () => {
  it("必须真的扫到文件（清单为空会让下一条全称断言静默恒真）", () => {
    expect(SCAN_ROOTS.map((r) => statSync(path.join(HOST_DIR, r)).isDirectory())).toEqual([
      true,
      true,
    ]);
    // 逐根给下限：只保住总数会让「tests 丢了、scripts 撑住总数」照样通过。
    for (const root of SCAN_ROOTS) {
      const prefix = path.join(HOST_DIR, root);
      const n = files.filter((f) => f.startsWith(prefix)).length;
      expect(n, `扫描根 ${root}/ 下的 .ts/.mjs 文件数`).toBeGreaterThan(0);
    }
    expect(files.length, "宿主包下 .ts/.tsx/.mts/.cts/.mjs/.js/.cjs 文件数").toBeGreaterThanOrEqual(
      MIN_SCANNED_FILES,
    );
  });

  it("tests/ 与 scripts/ 下不得有裸控制字符（check:all 不拦这类损坏）", () => {
    const offenders = scanOffenders(files);
    expect(
      offenders,
      offenders
        .map(
          (o) =>
            `${path.relative(HOST_DIR, o.f)}:${String(o.hit?.line)} 控制字符 U+${(o.hit?.code ?? 0)
              .toString(16)
              .padStart(4, "0")
              .toUpperCase()}`,
        )
        .join("；"),
    ).toEqual([]);
  });

  it("本测试自身不含裸控制字符（否则它也进失明区）", () => {
    expect(firstControlChar(readFileSync(fileURLToPath(import.meta.url), "utf8"))).toBeUndefined();
  });
});

/**
 * 阳性对照（常驻）：把事故原样重演一次——造一个**真的含裸 NUL**的文件，
 * 喂给上面那个 `firstControlChar`，必须红。验的是同一个函数，不是替身。
 *
 * ⚠️ 建目录必须在 `beforeAll`：`describe` 的函数体在**收集阶段**就跑完了，
 * 写在外层的 `finally` 会在任何一个 `it` 执行前把文件删掉 ⇒ 恒绿假防线。
 */
describe("阳性对照：检测式本身必须能抓到裸 NUL（改动前就已绿的防线不算防线）", () => {
  const NUL = String.fromCharCode(0);
  let dir = "";
  let victim = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "no-control-chars-"));
    victim = path.join(dir, "victim.ts");
    // 逐字符写入，避免任何 shell / 编辑器转义把 NUL 吃掉——本仓的原始事故
    // 就是「以为写进去了、实际没写进去」才逃过 grep 的。
    // NUL 放在**第 2 行**：若行号恒返回 1，本断言也会绿——那就不是真在数行。
    writeFileSync(victim, `const HEADER = "ok";\nconst SENTINEL = "${NUL}";\nconst AFTER = 1;\n`, "utf8");
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("裸 NUL 被判为违规，且行号/码位可定位", () => {
    // 前置：文件确实含 U+0000（否则下面的红是自己造的假象）
    const raw = readFileSync(victim, "utf8");
    expect([...raw].some((ch) => ch.charCodeAt(0) === 0x00)).toBe(true);

    const hit = firstControlChar(raw);
    expect(hit).toBeDefined();
    expect(hit?.code).toBe(0x00);
    expect(hit?.line).toBe(2);
  });

  it("真实扫描路径上同一份文件确实会被列进 offenders（端到端，不只验纯函数）", () => {
    const offenders = scanOffenders([...files, victim]);
    expect(offenders.map((o) => o.f)).toContain(victim);
  });

  it("反事实：把 NUL 换成合法文本后，同一个文件不再被判违规（证明红不是无差别报错）", () => {
    const clean = path.join(dir, "clean.ts");
    writeFileSync(clean, 'const SENTINEL = "ok";\nconst AFTER = 1;\n', "utf8");
    expect(scanOffenders([...files, clean]).map((o) => o.f)).not.toContain(clean);
  });
});
