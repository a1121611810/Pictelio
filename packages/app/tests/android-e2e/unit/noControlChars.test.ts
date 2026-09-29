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
 * ## 判据
 *
 * 源码文本里**不得出现控制字符**（`\x00`–`\x08` / `\x0B` / `\x0C` / `\x0E`–`\x1F`）。
 * 允许的：制表符（`\x09`）、换行（`\x0A`）、回车（`\x0D`），以及 U+FFFD 之外的
 * 全部可打印字符（含中文与全角标点）。
 *
 * ⚠️ 查这类问题**不能用** `grep -rn $'\ufffd'` 之类的 shell 展开（macOS bash 3.2
 * 不展开 `\uXXXX`，是假阴性），本文件直接用 `charCodeAt` 逐字符判。
 *
 * @see 早先教训：「`grep -rn $'\ufffd'` 在 macOS bash 3.2 下是假阴性，查编码损坏必须用 python」
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * `packages/app` 根 = unit → android-e2e → tests → app，共 3 级。
 * ⚠️ 别写成 4 级（那是 `packages/`）——`releaseGate.test.ts` 里的 `SPEC_MD_PATH`
 * 要去**仓根**所以是 5 级，两个路径层数不同、别互相抄。
 */
const APP_DIR = path.resolve(testDir, "../../..");
const SCAN_ROOTS = ["src", "tests"];
const SCAN_EXT = [".ts", ".tsx", ".mts", ".cts"];

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

const files = SCAN_ROOTS.flatMap((r) => [...walk(path.join(APP_DIR, r))]);

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

describe("源码控制字节防线（裸 NUL 会让 grep 对该文件后半段静默失明）", () => {
  it("必须真的扫到文件（清单为空会让下一条全称断言静默恒真）", () => {
    expect(SCAN_ROOTS.map((r) => statSync(path.join(APP_DIR, r)).isDirectory())).toEqual([
      true,
      true,
    ]);
    expect(files.length, "src + tests 下 .ts/.tsx 文件数").toBeGreaterThanOrEqual(500);
  });

  it("src/ 与 tests/ 下不得有裸控制字符（check:all 不拦这类损坏）", () => {
    const offenders = files
      .map((f) => ({ f, hit: firstControlChar(readFileSync(f, "utf8")) }))
      .filter((x) => x.hit !== undefined);
    expect(
      offenders,
      offenders
        .map(
          (o) =>
            `${path.relative(APP_DIR, o.f)}:${String(o.hit?.line)} 控制字符 U+${(o.hit?.code ?? 0)
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
