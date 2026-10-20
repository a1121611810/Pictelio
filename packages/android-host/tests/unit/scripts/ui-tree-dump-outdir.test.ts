import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";

import {
  assertSafeOutDir,
  resolveOutDir,
  sameDirectory,
} from "../../../scripts/lib/ui-tree-dump-core.mjs";

// ── 这道门禁守什么 ──
//
// 诊断脚本 `dump-ui-tree.mjs` 的 `--out` 目录**曾经**是整目录递归删除：
//   rmSync(out, { recursive: true, force: true })
// ⇒ `--out ""`（`path.resolve("")` = 当前工作目录）实测**把用户的整个工作目录删掉**，
//   `--out <任意已有目录>` 会清空该目录里用户的其它文件（第 4 轮 review 实测复现）。
// 修法有两层：① 清理范围收紧到「只删本通道产物」（`artifactsToRemove`，另一道门禁）；
// ② **本文件**守第二层：输出目录不得是工作目录本身或它的祖先。
//
// 为什么判据要放在 lib 层而不是编排层：编排层要真跑 adb 才能进，**CI 里单测不到**
// ⇒ 放编排层就等于「没防线」。第 4 轮那个阻塞缺陷正是这样漏出去的。
//
// ── 已知失效面（显式登记，非缺陷）──
//
// - **只守「工作目录及其祖先」这一类误伤**：不守「输出目录里有同名文件会被删」这一层
//   （那由清理范围收紧兜底：只删 `ui-tree-*.json`）。
// - **不守编排层的参数解析本身**：`--out ""` 的空值**先**由编排层 `needValue` 拒绝
//   （CLI 路径根本到不了本文件的判据）；lib 层对空串**也有**判据（`resolveOutDir(cwd,"",…)`
//   会抛），但该分支在 CLI 上**不可达** ⇒ 暂无单测覆盖（第 7 轮 Standards 轴订正归因）。
//
// ── oracle 溯源 ──
//
// 期望值不是「设计意图」，是**实测到的失败形态**：第 4 轮 review 在真实文件系统上
// 复现过「整个 CWD 消失」；本文件的每条用例都是那条失败形态的最小复现。
// 符号链接那条是**第 4 轮外部锚点复验时新抓到的第二层绕过**（第 4 轮的第一版修复
// 只比字面路径，macOS 上 `/tmp` → `/private/tmp` 的符号链接让同一个目录被看成两个）。

const sandboxes: string[] = [];

/** 建一个临时工作目录，返回 { root, cwd }（cwd 是 root 下的子目录）。 */
function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "uitree-outdir-"));
  sandboxes.push(root);
  const cwd = join(root, "work");
  mkdirSync(cwd);
  return { root, cwd };
}

afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

describe("assertSafeOutDir（--out 不得指向工作目录或其祖先）", () => {
  it("目标就是工作目录 ⇒ 拒绝", () => {
    const { cwd } = makeSandbox();
    expect(() => assertSafeOutDir(cwd, cwd)).toThrow(/不能是当前工作目录/);
  });

  it("目标是工作目录的祖先 ⇒ 拒绝", () => {
    const { root, cwd } = makeSandbox();
    expect(() => assertSafeOutDir(cwd, root)).toThrow(/不能是当前工作目录的祖先/);
  });

  it("目标是根目录 ⇒ 拒绝（前缀写法在 '/' 上恒失效，必须用 relative 判定）", () => {
    const { cwd } = makeSandbox();
    expect(() => assertSafeOutDir(cwd, resolvePath("/"))).toThrow(/祖先/);
  });

  it("目标是工作目录的符号链接别名 ⇒ 拒绝（第 4 轮外部锚点实测抓到的绕过）", () => {
    const { cwd } = makeSandbox();
    const alias = join(cwd, "..", "alias-cwd");
    symlinkSync(cwd, alias);
    // 前置事实：两条路径**字面不同**（否则这条用例就退化成「目标就是 CWD」）
    expect(resolvePath(alias)).not.toBe(resolvePath(cwd));
    expect(() => assertSafeOutDir(cwd, alias)).toThrow(/不能是当前工作目录/);
  });

  it("目标是工作目录的**大小写变体** ⇒ 拒绝（第 5 轮 Standards 轴实测抓到的绕过）", () => {
    // macOS 默认 APFS **大小写不敏感** ⇒ `/x/work` 与 `/x/WORK` 是**同一 inode**；
    // 而 `realpathSync` **不归一化大小写** ⇒ 只比路径字符串会让这个变体绕过守卫。
    // 判据按 inode 判定 ⇒ 与大小写无关。
    const { cwd } = makeSandbox();
    const variant = join(dirname(cwd), basename(cwd).toUpperCase());
    // 前置事实：变体路径与原路径**字面不同**（否则这条用例就退化成「目标就是 CWD」）
    expect(variant).not.toBe(cwd);
    if (process.platform === "darwin") {
      // 大小写不敏感 ⇒ 变体与原目录是同一个目录 ⇒ 必须被拒
      expect(sameDirectory(cwd, variant), "前置事实：两者应是同一目录").toBe(true);
      expect(() => assertSafeOutDir(cwd, variant)).toThrow(/不能是当前工作目录/);
    } else {
      // 大小写敏感的文件系统上，变体是**另一个**目录 ⇒ 放行才是对的
      expect(sameDirectory(cwd, variant)).toBe(false);
      expect(() => assertSafeOutDir(cwd, variant)).not.toThrow();
    }
  });

  it("目标用相对路径给出 ⇒ 按 cwd 解析（不是按进程 CWD）", () => {
    const { cwd } = makeSandbox();
    // 相对路径 ".." = cwd 的父目录 ⇒ 是 cwd 的祖先 ⇒ 拒绝
    expect(() => assertSafeOutDir(cwd, "..")).toThrow(/祖先/);
    // 相对路径 "." = cwd 本身 ⇒ 拒绝
    expect(() => assertSafeOutDir(cwd, ".")).toThrow(/不能是当前工作目录/);
  });

  it("目标是工作目录的子目录 ⇒ 放行（正常用法）", () => {
    const { cwd } = makeSandbox();
    const out = join(cwd, "输出");
    expect(() => assertSafeOutDir(cwd, out)).not.toThrow();
  });

  it("目标是与工作目录无关的目录 ⇒ 放行", () => {
    const { root, cwd } = makeSandbox();
    const other = join(root, "别的目录");
    mkdirSync(other);
    expect(() => assertSafeOutDir(cwd, other)).not.toThrow();
  });

  it("目标尚不存在（稍后由 mkdir 创建）⇒ 放行且返回物理路径", () => {
    // 第 17 轮 Spec 轴实测：此前只断言「后缀是 尚未创建」⇒ 变异 `realish()` 的「目标不存在」
    // 兜底分支后 12/12 仍全绿 ⇒ 现断言**等于物理路径**（父目录 realpath + 末段）。
    const { cwd } = makeSandbox();
    const out = join(cwd, "尚未创建");
    const resolved = assertSafeOutDir(cwd, out);
    expect(resolved).toBe(join(realpathSync(cwd), "尚未创建"));
  });
});

describe("resolveOutDir（默认输出目录与显式 --out 走同一条防线）", () => {
  it("默认输出目录落在工作目录上 ⇒ 拒绝（第 6 轮 Standards 轴实测抓到的绕过）", () => {
    // 失败形态（第 6 轮 Standards 轴在真实文件系统上复现过）：未传 `--out` 时，
    // 默认输出目录 = <tmpRoot>/pictelio-ui-tree。此前**只有显式 --out 分支**调
    // assertSafeOutDir ⇒ 默认值完全绕过判据；当工作目录恰是默认输出目录时，
    // 清理动作落在 CWD 上（CWD 里的 ui-tree-*.json 被删），而同一时刻显式
    // `--out <同一目录>` 会被正确拒绝 ⇒ 两条路径行为分叉。
    const { root } = makeSandbox();
    const fakeTmp = join(root, "tmp-root");
    mkdirSync(fakeTmp);
    const cwd = join(fakeTmp, "pictelio-ui-tree");
    mkdirSync(cwd);
    // 默认路径（未传 requested）⇒ 同样被拒
    expect(() => resolveOutDir(cwd, undefined, fakeTmp)).toThrow(/不能是当前工作目录/);
  });

  it("默认路径与显式 --out 对同一目录的判定一致（不分叉）", () => {
    const { root } = makeSandbox();
    const fakeTmp = join(root, "tmp-root");
    mkdirSync(fakeTmp);
    const cwd = join(fakeTmp, "pictelio-ui-tree");
    mkdirSync(cwd);
    // 显式 --out 指向同一目录 ⇒ 拒
    expect(() => resolveOutDir(cwd, cwd, fakeTmp)).toThrow(/不能是当前工作目录/);
    // 默认路径指向同一目录 ⇒ 拒（**同一判据** ⇒ 两条路径不可能分叉）
    expect(() => resolveOutDir(cwd, undefined, fakeTmp)).toThrow(/不能是当前工作目录/);
  });

  it("默认输出目录与工作目录无关 ⇒ 放行，且显式取值优先于默认值", () => {
    const { root, cwd } = makeSandbox();
    const fakeTmp = join(root, "tmp-root");
    mkdirSync(fakeTmp);
    // 默认值 = <tmpRoot>/pictelio-ui-tree，与 CWD 无关 ⇒ 放行
    const def = resolveOutDir(cwd, undefined, fakeTmp);
    expect(basename(def)).toBe("pictelio-ui-tree");
    // 显式取值优先于默认值
    const custom = join(root, "自定义输出");
    expect(resolveOutDir(cwd, custom, fakeTmp).endsWith("自定义输出")).toBe(true);
  });
});
