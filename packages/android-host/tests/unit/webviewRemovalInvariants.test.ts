/**
 * 仓库不变量契约：WebView 客户端「删干净了吗」——本轮唯一总闸（spec 核心缝 / ADR-0203）
 *
 * ## 判据来源（oracle 溯源，禁自洽反推）
 * - 七组不变量清单：`docs/specs/webview-client-removal.md` §Testing Decisions「核心缝：单一仓库不变量契约测试」
 * - 术语与「存量格式契约」定义：`docs/adr/glossary-webview-client-removal.md`
 *   （§三「必须分清的三类 capacitor 字样」、§风险与易错点 1）
 * - 宿主包新身份与复核命令：`docs/adr/ADR-0203-webview-client-source-removal.md` §决策 2 + §复核判据
 * - 存量格式契约字面量不可动：ADR-0203 §存量格式契约（不可动）+ ADR-0050
 * - 根命令裸名改指 Lynx 客户端：spec §决策六
 * - 门面措辞收敛（技术栈无 Capacitor/SolidJS、入口指向 Lynx）：ADR-0201 + ADR-0203 措辞锚点
 * - 路径反 cwd 定位仓库根：`packages/app/tests/unit/agentsMd.contract.test.ts:17-27`（既有先例）
 * - 「清单为空会让全称断言静默恒真」：`noControlChars.test.ts:71`（既有先例）
 *
 * ## 阳性对照（强制项，不是加分项）
 * 本仓此前多条防线在「改动前就已经绿」，是恒真的假防线（spec 核心缝「阳性对照是强制项」）。
 * 唯一能识破的办法是反事实。本文件底部 describe「检测式阳性对照」把反事实**常驻**成测试：
 * 在 `os.tmpdir()` 造一棵合规仓库树（应七条全绿），再逐条塞回违规（应各自转红），
 * 跑的就是上面那**同一个** `evaluateInvariants`，所以后人重构扫描逻辑也逃不掉。
 *
 * 2026-09-29 首次执行（`pnpm --filter @pictelio/android-host test`）结果，7 / 7 全部转红：
 *
 * | 注入的违规 | 转红的不变量 | 其它 6 条是否被波及 |
 * | --- | --- | --- |
 * | 造出 `packages/app/src/main.tsx` | 1 转红 | 否 |
 * | 给 `packages/app-lynx/package.json` 加回 `@capacitor/core` | 2 转红 | 否 |
 * | 删掉 `packages/android-host/android/settings.gradle` | 3 转红 | 否 |
 * | 把 `capacitor-storage_` / `CapacitorStorage` 改名（数据事故模拟） | 4 转红 | 否 |
 * | 让 `lynx.config.ts` 重新读 `../app/package.json` 与 `../../app/android` | 5 转红 | 否 |
 * | 把根 `dev` 改回 `vp run --filter pictelio-app dev` | 6 转红 | 否 |
 * | 技术栈行写回 `Capacitor 8.5`、入口指回 `packages/app/src` | 7 转红 | 否 |
 *
 * 同批基线：合规树 7 / 7 全绿 ⇒ 上表的红是注入造成的，不是「本来就不算」。
 * - 对照 5 用 `minHits = 2`（`../app/` 与 `../../app/` 两种层级都要抓到），
 *   且同一行里的 `../app-lynx/src` 不得被误报——反向误报与正向漏报写在同一条断言里。
 * - 对照 2 只认**依赖声明**；散文里的 "Capacitor" 字样不算违规。
 *   这正是「不变量 2（依赖声明 = 0）+ 不变量 4（存量契约 ≥ 1）」必须配对的原因。
 *
 * ## ⚠️ 恒假断言警告（ADR-0203 存量格式契约）
 * 「全仓 capacitor 字样 = 0」是**恒假**断言：`capacitor-storage_` / `CapacitorStorage`
 * 是存量用户数据格式（ADR-0050），必须一字不改。正确形态恒为
 * 「依赖声明 = 0」**且**「存量格式契约命中 ≥ 1」——本文件的不变量 2 + 4 就是这一对。
 *
 * ## 当前状态（2026-09-29，T01 交付时）
 * 刻意为**红**：宿主迁移与客户端删除尚未执行，7 组不变量全部未满足
 * （实测 `7 failed | 8 passed`，红的 7 条全部是不变量断言本身）。
 * 红的必须是**不变量**而非语法错 / import 错 / 路径写错造成的假红。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * 从 cwd 向上找仓库根；`pnpm --filter` 下 cwd = 包目录，直接从仓根跑 vitest 时 cwd = 仓根。
 * 两种都要能找到——先例 `packages/app/tests/unit/agentsMd.contract.test.ts:17-27` 只测了前者，
 * 本文件补上「起点目录自身也要检查」（req D：路径计算必须抗 cwd）。
 */
function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `repo root not found from ${start}（需要同时存在 AGENTS.md + pnpm-workspace.yaml）`,
      );
    }
    dir = parent;
  }
}

/** 被删除的 WebView 客户端包（ADR-0203 决策 2 的删除对象）。 */
const DELETED_PKG_DIR_NAME = "app";
/** 宿主包（ADR-0203 决策 2 的迁入目标）。 */
const HOST_PKG_DIR_NAME = "android-host";
/** 唯一客户端（事实源归属变更后的版本/凭证持有方，ADR-0203 决策 3）。 */
const CLIENT_PKG_DIR_NAME = "app-lynx";

/** 不遍历的目录名：依赖树、构建产物、缓存、生成物——它们不是「仓库形态」的一部分。 */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  // Android 宿主工程的拷贝/生成物目录（app-lynx 侧为同步进来的 bundle）
  "android",
  "capacitor-cordova-android-plugins",
]);

/** package.json 里可能声明依赖的字段（npm 全集）。 */
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * 「委托给已删客户端包」的两种写法都要抓（ADR-0203 后果 1：根脚本裸名约定失效）：
 * 1. 包名形式 `--filter pictelio-app`（否定前瞻排除 `pictelio-app-lynx`，那是唯一客户端、必须留存）
 * 2. 路径形式 `packages/app/node_modules/...`（结尾前瞻排除 `packages/app-lynx/`）
 */
const DELETED_PKG_NAME_RE = /\bpictelio-app\b(?!-lynx)/;
const DELETED_PKG_PATH_RE = /(?:^|[^\w-])packages\/app(?=$|[/\\])/;

/** app-lynx 跨包引用被删目录：`../app/` 或 `../../app/`（结尾前瞻排除 `../app-lynx/`）。 */
const CROSS_PACKAGE_REF_RE = /(?:^|[^\w-])\.\.\/app(?=$|[/\\])/;

/** 会被文本扫描的源码/文档扩展名（含 README——命令教学文档同样会把人引到已删目录）。 */
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".json5",
  ".sh",
  ".md",
  ".yml",
  ".yaml",
]);

/**
 * 存量格式契约字面量（ADR-0203 §存量格式契约「不可动」+ ADR-0050）。
 * ⚠️ 这些是**必须保留**的，不是待清理的；改动会让已安装用户读不到 refresh_token 与全部设置。
 */
const PERSISTED_FORMAT_LITERALS = [
  { literal: "capacitor-storage_", owner: "安全存储前缀常量（SecureStorageCompat.PREFIX）" },
  { literal: "CapacitorStorage", owner: "偏好存储 SharedPreferences 名称（PREFS_NAME）" },
] as const;

/** 存量格式契约的三个权威落点（ADR-0203 复核判据给的实测路径，保真迁移后应原样成立）。 */
const PERSISTED_FORMAT_SITES = [
  {
    file: "android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java",
    literal: "capacitor-storage_",
  },
  {
    file: "android/app/src/main/java/io/pictelio/app/ImageHostConfig.java",
    literal: "CapacitorStorage",
  },
  {
    file: "android/app/src/lynx/java/io/pictelio/app/PictelioPrefsModule.java",
    literal: "CapacitorStorage",
  },
] as const;

/** 宿主资产清单（spec 核心缝不变量 3 + ADR-0203 §复核判据 `test -d packages/android-host/android/app/src/lynx`）。 */
const HOST_ASSETS = [
  { rel: "android/settings.gradle", kind: "file", label: "Gradle 工程根配置" },
  { rel: "android/build.gradle", kind: "file", label: "Gradle 工程根构建脚本" },
  { rel: "android/app/build.gradle", kind: "file", label: "Gradle 模块构建脚本" },
  { rel: "android/gradlew", kind: "file", label: "Gradle wrapper" },
  {
    rel: "android/app/src/lynx/java/io/pictelio/app",
    kind: "dir",
    minFiles: 1,
    ext: ".java",
    label: "Lynx 原生模块源集",
  },
  { rel: "scripts", kind: "dir", minFiles: 1, ext: ".mjs", label: "发布脚本目录" },
  { rel: "scripts/release.mjs", kind: "file", label: "发布入口脚本" },
  { rel: "tests/android-e2e", kind: "dir", minFiles: 1, ext: ".ts", label: "原生 E2E 目录" },
  {
    rel: "android/app/src/test/java/io/pictelio/app",
    kind: "dir",
    minFiles: 1,
    ext: ".java",
    label: "JVM/Robolectric 单测源集",
  },
] as const;

interface Layout {
  repoRoot: string;
  packagesDir: string;
  hostDir: string;
  deletedClientDir: string;
  clientDir: string;
}

function resolveLayout(repoRoot: string): Layout {
  const packagesDir = join(repoRoot, "packages");
  return {
    repoRoot,
    packagesDir,
    hostDir: join(packagesDir, HOST_PKG_DIR_NAME),
    deletedClientDir: join(packagesDir, DELETED_PKG_DIR_NAME),
    clientDir: join(packagesDir, CLIENT_PKG_DIR_NAME),
  };
}

function* walkFiles(dir: string, accept: (file: string) => boolean): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      yield* walkFiles(full, accept);
    } else if (entry.isFile() && accept(full)) {
      yield full;
    }
  }
}

function countFilesIn(dir: string, ext: string): number {
  let n = 0;
  for (const _file of walkFiles(dir, (f) => f.endsWith(ext))) n++;
  return n;
}

/** 一份 package.json 里的 Capacitor 依赖声明（只看**依赖名**，不看 description 之类的散文）。 */
function capacitorDepsInManifest(label: string, text: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    // 禁止静默降级（测试硬约束 3）：解析失败若只 return []，不变量 2 会空转通过
    console.warn(
      `[webviewRemovalInvariants] package.json 解析失败，已跳过：${label}（${String(err)}）`,
    );
    return [];
  }
  const hits: string[] = [];
  for (const field of DEP_FIELDS) {
    const bucket = parsed[field];
    if (!bucket || typeof bucket !== "object") continue;
    for (const name of Object.keys(bucket as Record<string, string>)) {
      if (/capacitor/i.test(name)) hits.push(`${label} → ${field}.${name}`);
    }
  }
  return hits;
}

/** 全文里对已删客户端包的引用（包名形式 + 路径形式），逐条返回行号便于定位。 */
function deletedPkgRefsInText(text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (DELETED_PKG_NAME_RE.test(line) || DELETED_PKG_PATH_RE.test(line)) {
      hits.push(`L${i + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

type InvariantId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Verdict = Record<InvariantId, string[]>;

/** 逐条求值七组不变量；返回每个不变量的**违规清单**（空 = 满足）。 */
function evaluateInvariants(l: Layout): Verdict {
  const rel = (p: string) => relative(l.repoRoot, p);
  const verdict = {
    1: [] as string[],
    2: [] as string[],
    3: [] as string[],
    4: [] as string[],
    5: [] as string[],
    6: [] as string[],
    7: [] as string[],
  };

  // 不变量 1 —— packages/app 目录不存在（ADR-0203 决策 2 + 复核判据 `test ! -d packages/app`）
  if (existsSync(l.deletedClientDir)) {
    verdict[1].push(`packages/${DELETED_PKG_DIR_NAME} 目录仍存在（WebView 客户端未删除）`);
  }
  // 检测式非空转锚点：证明定位到的是真实 packages 目录，而不是拼错的路径
  if (!existsSync(join(l.clientDir, "package.json"))) {
    verdict[1].push(
      `[检测式不可信] packages/${CLIENT_PKG_DIR_NAME} 也不存在，无法证明 packages/ 路径解析正确`,
    );
  }

  // 不变量 2 —— 任何 package.json 都不再声明 Capacitor 依赖（ADR-0203 §依赖清零）
  const manifests = [...walkFiles(l.repoRoot, (f) => f.endsWith("package.json"))];
  for (const m of manifests) {
    verdict[2].push(...capacitorDepsInManifest(rel(m), readFileSync(m, "utf8")));
  }
  if (manifests.length < 5) {
    verdict[2].push(
      `[检测式不可信] 只扫描到 ${manifests.length} 份 package.json，「依赖声明为 0」的结论不可信`,
    );
  }

  // 不变量 3 —— 宿主资产齐全（spec 核心缝 3；ADR-0203 复核判据）
  for (const asset of HOST_ASSETS) {
    const abs = join(l.hostDir, ...asset.rel.split("/"));
    if (asset.kind === "file") {
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        verdict[3].push(`缺 ${asset.label}：${rel(abs)}`);
      }
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      verdict[3].push(`缺 ${asset.label}：${rel(abs)}`);
      continue;
    }
    const ext = "ext" in asset ? asset.ext : "";
    const found = countFilesIn(abs, ext);
    if (found < asset.minFiles) {
      verdict[3].push(`${asset.label}为空或无 ${ext} 文件：${rel(abs)}（实得 ${found} 份）`);
    }
  }

  // 不变量 4 —— 存量格式契约仍在（ADR-0203 §存量格式契约 + ADR-0050）
  // ⚠️ 与不变量 2 配对：依赖声明 0 **且** 契约命中 ≥ 1；单断言任一侧都不成立。
  const javaSrc = join(l.hostDir, "android", "app", "src");
  const javaFiles = [...walkFiles(javaSrc, (f) => f.endsWith(".java"))];
  if (javaFiles.length === 0) {
    verdict[4].push(
      `[检测式不可信] 宿主 java 源集不存在或为空：${rel(javaSrc)}，存量格式契约无从校验`,
    );
  } else {
    for (const { literal, owner } of PERSISTED_FORMAT_LITERALS) {
      const hits = javaFiles.filter((f) => readFileSync(f, "utf8").includes(literal));
      if (hits.length === 0) {
        verdict[4].push(
          `存量格式契约字面量「${literal}」在 ${rel(javaSrc)} 下命中 0 次（${owner}）——改动即数据事故`,
        );
      }
    }
  }
  for (const { file, literal } of PERSISTED_FORMAT_SITES) {
    const abs = join(l.hostDir, ...file.split("/"));
    if (!existsSync(abs)) {
      verdict[4].push(`存量格式契约落点缺失：${rel(abs)}`);
    } else if (!readFileSync(abs, "utf8").includes(literal)) {
      verdict[4].push(`${rel(abs)} 不再含「${literal}」`);
    }
  }

  // 不变量 5 —— app-lynx 不再跨包引用被删目录（spec 核心缝 5；ADR-0203 决策 3「跨包 fail-closed 读取已解除」）
  const clientFiles = [...walkFiles(l.clientDir, (f) => [...TEXT_EXT].some((e) => f.endsWith(e)))];
  if (clientFiles.length === 0) {
    verdict[5].push(`[检测式不可信] 未扫描到 packages/${CLIENT_PKG_DIR_NAME} 下任何文本文件`);
  }
  for (const f of clientFiles) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (CROSS_PACKAGE_REF_RE.test(line)) {
        verdict[5].push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  // 不变量 6 —— 根命令表不再委托给已删包（spec 核心缝 6 + §决策六；ADR-0203 后果 1）
  const rootManifest = join(l.repoRoot, "package.json");
  if (!existsSync(rootManifest)) {
    verdict[6].push("根 package.json 不存在");
  } else {
    const rootText = readFileSync(rootManifest, "utf8");
    verdict[6].push(...deletedPkgRefsInText(rootText).map((h) => `根 package.json ${h}`));
    // 裸名命令不得消失（spec §决策六：dev/build/check/test/preview 五条裸命令改指 Lynx 客户端）
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(rootText) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch (err) {
      console.warn(`[webviewRemovalInvariants] 根 package.json 解析失败：${String(err)}`);
    }
    for (const name of ["dev", "build", "check", "test", "preview"]) {
      if (typeof scripts[name] !== "string") {
        verdict[6].push(`根命令表缺裸名命令「${name}」（spec §决策六 要求保留并改指）`);
      }
    }
    if (
      Object.keys(scripts).length > 0 &&
      !Object.values(scripts).some((v) => v.includes(CLIENT_PKG_DIR_NAME))
    ) {
      verdict[6].push(`根命令表没有任何命令指向唯一客户端 ${CLIENT_PKG_DIR_NAME}，检测式存疑`);
    }
  }

  // 不变量 7 —— 门面措辞收敛（spec 核心缝 7；用户故事 13/14；ADR-0201 措辞锚点）
  const agentsMd = join(l.repoRoot, "AGENTS.md");
  if (!existsSync(agentsMd)) {
    verdict[7].push("AGENTS.md 不存在");
  } else {
    const text = readFileSync(agentsMd, "utf8");
    const lines = text.split("\n");
    const stackLine = lines.find((x) => /^\s*[-*]\s*\*\*技术栈\*\*/.test(x));
    const entryLine = lines.find((x) => /^\s*[-*]\s*\*\*入口\*\*/.test(x));
    if (stackLine === undefined) {
      verdict[7].push("AGENTS.md 缺「技术栈」行（负面断言不得靠文档被清空空转通过）");
    } else {
      if (/capacitor/i.test(stackLine))
        verdict[7].push(`技术栈行仍含 Capacitor：${stackLine.trim()}`);
      if (/solid-?js/i.test(stackLine))
        verdict[7].push(`技术栈行仍含 SolidJS：${stackLine.trim()}`);
      // 配对正面锚点：防止「把整行删了也算修好」。
      // oracle = glossary-webview-client-removal.md §措辞锚点「Pictelio 是 Lynx 单引擎客户端」
      if (!/lynx/i.test(stackLine)) {
        verdict[7].push(
          `技术栈行未点名 Lynx（唯一运行时）：${stackLine.trim()}——须按 ADR-0201 措辞锚点改写`,
        );
      }
    }
    if (entryLine === undefined) {
      verdict[7].push("AGENTS.md 缺「入口」行");
    } else {
      if (!entryLine.includes(CLIENT_PKG_DIR_NAME)) {
        verdict[7].push(`入口行未指向 ${CLIENT_PKG_DIR_NAME}：${entryLine.trim()}`);
      }
      if (CROSS_PACKAGE_REF_RE.test(entryLine) || entryLine.includes("packages/app/src")) {
        verdict[7].push(`入口行仍指向已删的 packages/app 源码：${entryLine.trim()}`);
      }
    }
  }

  return verdict;
}

// ── 真实仓库求值（模块加载时跑一次）──────────────────────────────────────────
const LAYOUT = resolveLayout(findRepoRoot(process.cwd()));
const VIOLATIONS = evaluateInvariants(LAYOUT);

/** 统一的失败信息：把违规清单原文带出去，避免只看到一个光秃秃的 assert。 */
function assertSatisfied(id: InvariantId): void {
  expect(
    VIOLATIONS[id],
    `不变量 ${id} 未满足：\n${VIOLATIONS[id].map((v) => `  - ${v}`).join("\n") || "  （无）"}`,
  ).toEqual([]);
}

describe("不变量 1：WebView 客户端包已删除（ADR-0203 决策 2 / 复核判据 `test ! -d packages/app`）", () => {
  it("packages/app 目录不存在", () => assertSatisfied(1));
});

describe("不变量 2：Capacitor 依赖声明清零（ADR-0203 §依赖清零；glossary §三 第 1 类「依赖声明」）", () => {
  it("任何 package.json 都不再声明 Capacitor 依赖（配对不变量 4，此处绝不写成「全仓 capacitor 字样为 0」）", () =>
    assertSatisfied(2));
});

describe("不变量 3：宿主资产齐全（spec 核心缝 3；ADR-0203 复核判据 `test -d packages/android-host/android/app/src/lynx`）", () => {
  it("Gradle 工程 / Lynx 原生模块 / 发布脚本 / android-e2e / JVM 单测源集逐件在位", () =>
    assertSatisfied(3));
});

describe("不变量 4：存量格式契约仍在（ADR-0203 §存量格式契约「不可动」+ ADR-0050）", () => {
  it("capacitor-storage_ 与 CapacitorStorage 在宿主源集内均命中（与不变量 2 配对：一侧归零、一侧不得归零）", () =>
    assertSatisfied(4));
});

describe("不变量 5：app-lynx 不再跨包引用被删目录（ADR-0203 决策 3「跨包 fail-closed 读取已解除」）", () => {
  it("packages/app-lynx 下无 ../app/ 相对路径引用", () => assertSatisfied(5));
});

describe("不变量 6：根命令表不再委托给已删包（spec 核心缝 6 / §决策六；ADR-0203 后果 1）", () => {
  it("根 package.json 无 pictelio-app 委托，裸名命令保留且有命令指向唯一客户端", () =>
    assertSatisfied(6));
});

describe("不变量 7：门面措辞收敛（spec 核心缝 7 / 用户故事 13·14；ADR-0201 措辞锚点）", () => {
  it("AGENTS.md 技术栈不含 Capacitor / SolidJS 且点名 Lynx，入口指向 packages/app-lynx", () =>
    assertSatisfied(7));
});

// ── 阳性对照：真实临时目录 + 同一批扫描函数 ──────────────────────────────────
// 目的：证明上面七条**不是恒绿假防线**。做法是造一棵合规仓库树（应全绿），
// 再逐条塞回违规（应各自转红），跑的就是上面那个 evaluateInvariants。
const TMP_ROOTS: string[] = [];

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const abs = join(root, ...relPath.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function removeFixtureFile(root: string, relPath: string): void {
  rmSync(join(root, ...relPath.split("/")), { force: true, recursive: true });
}

/** 造一棵「删除已完成」的合规仓库树：满足全部七条不变量。 */
function writeCompliantFixture(root: string): void {
  writeFixtureFile(
    root,
    "AGENTS.md",
    [
      "# Pictelio",
      "",
      "- **技术栈**: vue-lynx + TypeScript 7.0 (strict) + Vite 8.3（vite-plus 统一工具链）",
      "- **入口**: `packages/app-lynx/src/index.ts`（渲染、auth 恢复）→ `App.vue`",
      "",
    ].join("\n"),
  );
  writeFixtureFile(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "pictelio",
        private: true,
        scripts: {
          dev: "vp run --filter pictelio-app-lynx dev",
          build: "vp run --filter pictelio-app-lynx build",
          check: "vp run --filter pictelio-app-lynx check",
          test: "vp run --filter pictelio-app-lynx test",
          preview: "vp run --filter pictelio-app-lynx preview",
        },
      },
      null,
      2,
    ),
  );

  // 宿主包：逐件齐全的最小树
  for (const asset of HOST_ASSETS) {
    if (asset.kind === "file") {
      writeFixtureFile(root, `packages/android-host/${asset.rel}`, "// fixture\n");
    } else {
      // 目录型资产必须真的带一个对应扩展名的文件，否则 minFiles 检查会判「空目录」
      const ext = "ext" in asset ? asset.ext : "";
      writeFixtureFile(root, `packages/android-host/${asset.rel}/Fixture${ext}`, "// fixture\n");
    }
  }
  writeFixtureFile(
    root,
    "packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java",
    "package io.pictelio.app;\npublic class LynxActivity {}\n",
  );
  writeFixtureFile(
    root,
    "packages/android-host/android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java",
    'final class SecureStorageCompat { static final String PREFIX = "capacitor-storage_"; }\n',
  );
  writeFixtureFile(
    root,
    "packages/android-host/android/app/src/main/java/io/pictelio/app/ImageHostConfig.java",
    'final class ImageHostConfig { static final String PREFS_NAME = "CapacitorStorage"; }\n',
  );
  writeFixtureFile(
    root,
    "packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioPrefsModule.java",
    'final class PictelioPrefsModule { static final String PREFS_NAME = "CapacitorStorage"; }\n',
  );
  writeFixtureFile(root, "packages/android-host/scripts/release.mjs", "export const steps = [];\n");
  writeFixtureFile(
    root,
    "packages/android-host/tests/android-e2e/specs/transition-matrix.spec.ts",
    "export const spec = true;\n",
  );
  writeFixtureFile(
    root,
    "packages/android-host/package.json",
    JSON.stringify({ name: "@pictelio/android-host" }),
  );
  writeFixtureFile(root, "packages/android-host/tsconfig.json", "{}\n");
  writeFixtureFile(root, "packages/android-host/vitest.config.ts", "export default {};\n");

  // 唯一客户端：无跨包引用
  writeFixtureFile(
    root,
    "packages/app-lynx/lynx.config.ts",
    "import { resolve } from 'node:path';\nconst pkg = resolve(_root, './package.json');\n",
  );
  writeFixtureFile(
    root,
    "packages/app-lynx/package.json",
    JSON.stringify({ name: "pictelio-app-lynx" }),
  );

  // 其余 workspace 包（保证不变量 2 的「扫描到 ≥5 份 package.json」非空转锚点成立）
  for (const name of ["ugoira", "novel-export", "search-core", "ranking-core"]) {
    writeFixtureFile(
      root,
      `packages/${name}/package.json`,
      JSON.stringify({ name: `@pictelio/${name}` }),
    );
  }
}

function evaluateFixture(mutate: (root: string) => void): Verdict {
  const root = mkdtempSync(join(tmpdir(), "pictelio-webview-removal-"));
  TMP_ROOTS.push(root);
  try {
    writeCompliantFixture(root);
    mutate(root);
    return evaluateInvariants(resolveLayout(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
    const idx = TMP_ROOTS.indexOf(root);
    if (idx >= 0) TMP_ROOTS.splice(idx, 1);
  }
}

/** 合规树必须七条全绿——否则下面的「转红」证明不了任何东西（可能一开始就没在算）。 */
function expectOnly(target: Verdict, id: InvariantId, minHits: number): void {
  for (const key of [1, 2, 3, 4, 5, 6, 7] as InvariantId[]) {
    if (key === id) {
      expect(
        target[key].length,
        `不变量 ${key} 应因注入的违规而红：${target[key].join("；")}`,
      ).toBeGreaterThanOrEqual(minHits);
    } else {
      expect(target[key], `不变量 ${key} 被 ${id} 的注入意外波及，注入不干净`).toEqual([]);
    }
  }
}

afterAll(() => {
  for (const root of TMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

describe("检测式阳性对照（临时合规树 + 逐条塞回违规，证明七条不是恒绿假防线）", () => {
  it("基线：合规仓库树七条全绿", () => {
    const v = evaluateFixture(() => {});
    for (const key of [1, 2, 3, 4, 5, 6, 7] as InvariantId[]) {
      expect(v[key], `合规树的不变量 ${key} 不该红：${v[key].join("；")}`).toEqual([]);
    }
  });

  it("对照 1：把 packages/app 塞回去 → 不变量 1 转红", () => {
    expectOnly(
      evaluateFixture((r) => writeFixtureFile(r, "packages/app/src/main.tsx", "export {};\n")),
      1,
      1,
    );
  });

  it("对照 2：加回 @capacitor/core 依赖声明 → 不变量 2 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          "packages/app-lynx/package.json",
          JSON.stringify({
            name: "pictelio-app-lynx",
            dependencies: { "@capacitor/core": "^8.5.2" },
          }),
        ),
      ),
      2,
      1,
    );
  });

  it("对照 3：删掉宿主 Gradle 工程 → 不变量 3 转红", () => {
    expectOnly(
      evaluateFixture((r) => removeFixtureFile(r, "packages/android-host/android/settings.gradle")),
      3,
      1,
    );
  });

  it("对照 4：把存量格式契约字面量改名（数据事故模拟）→ 不变量 4 转红", () => {
    expectOnly(
      evaluateFixture((r) => {
        writeFixtureFile(
          r,
          "packages/android-host/android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java",
          'final class SecureStorageCompat { static final String PREFIX = "pictelio_storage_"; }\n',
        );
        writeFixtureFile(
          r,
          "packages/android-host/android/app/src/main/java/io/pictelio/app/ImageHostConfig.java",
          'final class ImageHostConfig { static final String PREFS_NAME = "PictelioPrefs"; }\n',
        );
        writeFixtureFile(
          r,
          "packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioPrefsModule.java",
          'final class PictelioPrefsModule { static final String PREFS_NAME = "PictelioPrefs"; }\n',
        );
      }),
      4,
      1,
    );
  });

  it("对照 5：让 app-lynx 重新跨包读 ../app/ → 不变量 5 转红（且 ../../app/ 形式也能抓到）", () => {
    expectOnly(
      evaluateFixture((r) => {
        writeFixtureFile(
          r,
          "packages/app-lynx/lynx.config.ts",
          "import { resolve } from 'node:path';\nconst pkg = resolve(_root, '../app/package.json');\nconst j = resolve(_root, '../../app/android');\nconst ok = resolve(_root, '../app-lynx/src');\n",
        );
      }),
      5,
      2,
    );
  });

  it("对照 6：把裸名 dev 改回委托 pictelio-app → 不变量 6 转红", () => {
    expectOnly(
      evaluateFixture((r) => {
        const abs = join(r, "package.json");
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as { scripts: Record<string, string> };
        parsed.scripts.dev = "vp run --filter pictelio-app dev";
        writeFileSync(abs, JSON.stringify(parsed, null, 2), "utf8");
      }),
      6,
      1,
    );
  });

  it("对照 7：技术栈行写回 Capacitor 8.5、入口指回 packages/app/src → 不变量 7 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          "AGENTS.md",
          [
            "# Pictelio",
            "",
            "- **技术栈**: SolidJS 2.0 + Capacitor 8.5（源码引用，运行时已下线）",
            "- **入口**: `packages/app/src/main.tsx` → `App.tsx`",
            "",
          ].join("\n"),
        ),
      ),
      7,
      1,
    );
  });
});
