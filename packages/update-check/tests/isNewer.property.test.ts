// ─── @pictelio/update-check isNewer 属性测试 ───
// 期望值来源 = 性质/不变量（oracle 为性质本身，不从实现反推）：
//
// isNewer(local, remote) 的问题定义：按 major.minor.patch 三段数值序比较版本，
// remote 比 local 新返回 true（实现注释声明的兼容面：可选 v 前缀、首尾空白）。
// 因此「版本比较」必须满足版本序（>）的数学性质：
//   - 自反：a > a 为假 ⇒ isNewer(x, x) === false
//   - 严格反称：a > b 与 b > a 不可能同时为真
//   - 传递性：a > b 且 b > c ⇒ a > c
//   - 与版本序定义一致：isNewer(a, b) ⟺ a 的三段数值字典序小于 b（差分 oracle = 问题定义本身）
//   - 书写形式等价：v 前缀（含大写）与首尾空白不改变版本含义 ⇒ 同一版本的任意书写形式比较结果一致
//
// 生成域限定为「有效三段数字版本」（实现声明的比较域；prerelease/build metadata
// 属脏输入防御面，不在有效 semver 性质域内）。
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isNewer } from "../src/index";

/** 有效版本：major.minor.patch 三段非负整数 */
const numVersion = fc.record({
  major: fc.integer({ min: 0, max: 999 }),
  minor: fc.integer({ min: 0, max: 999 }),
  patch: fc.integer({ min: 0, max: 999 }),
});

const plainVersion = numVersion.map(({ major, minor, patch }) => `${major}.${minor}.${patch}`);

/** 书写形式装饰：前导/后缀空白 + v 前缀（含大写） */
const writing = fc.tuple(
  fc.constantFrom("", " ", "  "),
  fc.constantFrom("", "v", "V"),
  fc.constantFrom("", " ", "  "),
);

/** 任意书写形式的版本串 */
const anyVersion = fc
  .tuple(plainVersion, writing)
  .map(([v, [lead, prefix, trail]]) => `${lead}${prefix}${v}${trail}`);

/** 三段数值元组（供版本序差分 oracle 使用） */
function toTuple(v: string): [number, number, number] {
  const [major, minor, patch] = v.split(".").map(Number);
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

/** 版本序定义：字典序比较三段数值 */
function isLess(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

describe("isNewer 属性（oracle=性质/不变量）", () => {
  it("自反：isNewer(x, x) === false", () => {
    fc.assert(
      fc.property(anyVersion, (x) => {
        expect(isNewer(x, x)).toBe(false);
      }),
    );
  });

  it("严格反称：isNewer(a, b) 与 isNewer(b, a) 至多一个为真", () => {
    fc.assert(
      fc.property(anyVersion, anyVersion, (a, b) => {
        const ab = isNewer(a, b);
        const ba = isNewer(b, a);
        expect(ab && ba).toBe(false);
      }),
    );
  });

  it("传递性：isNewer(a, b) 且 isNewer(b, c) ⇒ isNewer(a, c)", () => {
    fc.assert(
      fc.property(anyVersion, anyVersion, anyVersion, (a, b, c) => {
        if (isNewer(a, b) && isNewer(b, c)) {
          expect(isNewer(a, c)).toBe(true);
        }
      }),
    );
  });

  it("与版本序定义一致：isNewer(a, b) ⟺ a 的三段数值字典序小于 b", () => {
    fc.assert(
      fc.property(plainVersion, plainVersion, (a, b) => {
        const aLess = isLess(toTuple(a), toTuple(b));
        expect(isNewer(a, b)).toBe(aLess);
      }),
    );
  });

  it("v 前缀/首尾空白等价：同一版本的任意两种书写形式比较结果一致", () => {
    fc.assert(
      fc.property(plainVersion, writing, writing, anyVersion, (v, w1, w2, y) => {
        const x1 = `${w1[0]}${w1[1]}${v}${w1[2]}`;
        const x2 = `${w2[0]}${w2[1]}${v}${w2[2]}`;
        // 与任意第三方的比较不因书写形式改变
        expect(isNewer(x1, y)).toBe(isNewer(x2, y));
        expect(isNewer(y, x1)).toBe(isNewer(y, x2));
        // 同一版本的两种书写形式互相比较为「不更新」
        expect(isNewer(x1, x2)).toBe(false);
      }),
    );
  });
});
