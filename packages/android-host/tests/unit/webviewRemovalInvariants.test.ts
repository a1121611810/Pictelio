/**
 * 仓库不变量契约：WebView 客户端「删干净了吗」——本轮唯一总闸（spec 核心缝 / ADR-0203）
 *
 * ## 判据来源（oracle 溯源，禁自洽反推）
 * - 不变量清单（已扩至 10 组，见文件末尾「不变量 ↔ 决策」表）：`docs/specs/webview-client-removal.md` §Testing Decisions「核心缝：单一仓库不变量契约测试」
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
 * 在 `os.tmpdir()` 造一棵合规仓库树（应十组全绿），再逐条塞回违规（应各自转红），
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
 * ## 当前状态（2026-09-29，T13 交付后）
 * **全绿**：10 组不变量全部满足（`pnpm --filter @pictelio/android-host test` 实测通过）。
 * 本段曾记录「T01 交付时刻意为红（7 failed | 8 passed）」的快照——那是**写门禁阶段**的
 * 中间态（先立红再实现），现已失效。保留此行只为提醒：这份文件的绿是**实现的结果**，
 * 不是它一开始就是绿的；是否真在守，由下方 17 条反事实注入当场证明。
 * 另有 2 条「扫描覆盖」断言，钉住扫描根/排除清单本身不失效。
 *
 * | 不变量 | 守什么 | 对应反事实注入 |
 * | --- | --- | --- |
 * | 1 | `packages/app` 目录不存在 | 对照 1 |
 * | 2 | Capacitor 依赖声明清零 | 对照 2（配对不变量 4） |
 * | 3 | 宿主资产齐全 | 对照 3 |
 * | 4 | 存量格式契约仍在 | 对照 4 |
 * | 5 | app-lynx 不跨包读已删目录 | 对照 5 |
 * | 6 | 根命令表指向唯一客户端 | 对照 6 |
 * | 7 | 门面措辞收敛 | 对照 7 |
 * | 8 | 客户端切换能力已下线（决策 7） | 对照 8a / 8b / 8c / 8d |
 * | 9 | gradle 入口自带生成物前置（决策 8） | 对照 9a / 9b |
 * | 10 | pnpm 调用点在其**解析目标包**里存在（决策 2 改名须同步调用点） | 对照 10a / 10b / 10c / 10d |
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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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
  // ⚠️ `.vue` 必须在内：唯一客户端的页面是 Vue SFC，clientSwitch 的 UI 引用
  // （Me.vue 里 20 处）全在 `.vue` 里。漏掉它会让不变量 8 的引用扫描对最脏的那个文件失明——
  // 这是对照 8b 当场抓出来的（漏扫时注入的 `.vue` 引用零命中、断言转红）。
  ".vue",
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
    // 下界实测 19（2026-09-29）。原值 1 形同无断言：删掉九成 Java 文件仍全绿，
    // 而 ADR-0203 §复核判据 6 承诺的是「逐件没丢东西」。留约 15% 余量容忍正常增删。
    minFiles: 16,
    ext: ".java",
    label: "Lynx 原生模块源集",
  },
  // 下界实测 17 → 取 14
  { rel: "scripts", kind: "dir", minFiles: 14, ext: ".mjs", label: "发布脚本目录" },
  { rel: "scripts/release.mjs", kind: "file", label: "发布入口脚本" },
  // 下界实测 31 → 取 26
  { rel: "tests/android-e2e", kind: "dir", minFiles: 26, ext: ".ts", label: "原生 E2E 目录" },
  {
    rel: "android/app/src/test/java/io/pictelio/app",
    kind: "dir",
    // 下界实测 41 → 取 34
    minFiles: 34,
    ext: ".java",
    label: "JVM/Robolectric 单测源集",
  },
] as const;

/**
 * 客户端切换能力的残留面（不变量 8；ADR-0203 §决策 7「WebView 下线后单态收敛」）。
 *
 * 背景：WebView 客户端是「webview ↔ lynx 双客户端切换」的唯一切换对象。它被删除后，
 * 整个 clientSwitch 能力失去存在依据——运行时虽已被 `CLIENT_KINDS={"lynx"}` 门控为
 * 不可达（`supportsClientSwitch` 返回 false，整张切换卡片不渲染），但源码、Java 原生
 * 方法与 UI 文案会继续留在树里并被打进 APK bundle（含失实文案 "SolidJS + Capacitor"）。
 * 「不可达」不等于「已下线」——残留会误导 grep APK 的人，也会在日后被误当作可用功能。
 */
const CLIENT_SWITCH_STORE_REL = "src/stores/clientSwitchStore.ts";

/** clientSwitch 在 app-lynx 里的标识符形态：store 名、UI 引用、切换专用文案。 */
// ⚠️ 必须覆盖**原生桥方法名**形态：code-review 抓到 Java 实现删了、TS 类型声明
// （`rspeedy-env.d.ts` 的 `NativeModules.PictelioApp`）还留着。strict 下那种残留
// 会让 vue-tsc 放行、运行时静默失败——比留代码更难发现。
const CLIENT_SWITCH_REF_RE =
  /(?:set|get)ClientKind(?:s)?|clientSwitch|selectedClient|pickClient|supportsClientSwitch/;

/**
 * Java 侧切换专用方法（`PictelioAppModule` 内）。
 * ⚠️ 判据只认这 4 个**方法签名**；`PictelioAppModule` 其余 10 个 `@LynxMethod`
 * 是通用能力（视口/退出/安全区/深色模式/分享/诊断…），有 9–11 处调用，**必须保留**。
 */
const CLIENT_SWITCH_JAVA_METHODS = [
  "setClientKind",
  "getClientKind",
  "getClientKinds",
  "restart",
] as const;

/**
 * 配对正面锚点（不变量 8 的「防糊弄」半边）。
 * 没有它，「把 PictelioAppModule 整份删掉」和「把 Me.vue 整页删掉」都会让
 * 所有负面断言转绿——那是事故不是修好。数字取自删除前的实测值，留足下限余量。
 */
const CLIENT_SWITCH_POSITIVE_ANCHORS = [
  { method: "getViewportSize", minHits: 1, owner: "通用：视口尺寸" },
  { method: "exitApp", minHits: 1, owner: "通用：退出应用" },
  { method: "getSafeAreaInsets", minHits: 1, owner: "通用：安全区内边距" },
  { method: "applyDarkModePreference", minHits: 1, owner: "通用：深色模式同步" },
  { method: "openUrl", minHits: 1, owner: "通用：外链打开" },
  { method: "exportDiagLog", minHits: 1, owner: "通用：诊断日志导出" },
] as const;

/**
 * 生成物依赖的前置接线（不变量 9；ADR-0203 §决策 8「Gradle 入口必须自带生成物」）。
 *
 * 背景：T12 的「全新 clone 可复现性」验证当场抓到——`pnpm test:android-host:unit`
 * 在干净检出上**编译失败**（388 个「找不到符号」），而主工作区全绿。原因：
 * gradle 配置依赖 gitignored 的生成物 `io.pictelio.app.config`（OAuthConfig.java，
 * 由 `sync:credentials` 从 `packages/app-lynx/credentials.json5` 生成），
 * 而 CI 在 gradle 步骤前**显式**跑了该脚本，本地便捷命令却没有。
 * ⇒ 「本地绿 / 干净环境红」的接线遗漏，且错误信息完全指不到真因。
 *
 * 判据取自 CI 既有约定（`.github/workflows/ci.yml` 的 gradle 步骤前置）：
 * 凡执行 `gradlew` 的脚本，都必须自带 `sync:credentials`。
 */
const GRADLE_ENTRY_RE = /gradlew/;
const CREDENTIALS_SYNC = "sync:credentials";

/** 配对正面锚点：宿主包里跑 gradlew 的脚本下界（防「全删就算修好」）。 */
const GRADLE_ENTRY_MIN = 3;

/**
 * `.mjs` 侧的同样判据（code-review 修 blocking 后新增）。
 * 缺口原委：ADR-0203 §决策 8 承诺「**凡**执行 gradlew 的宿主脚本都必须接 sync:credentials」，
 * 但防线只扫 package.json 的 scripts 字面量，而 `dev:android` / `release` 的值是
 * `node scripts/xxx.mjs`（无 gradlew 字面量）→ 真正跑 gradlew 的两条路径完全在防线外。
 * 实测两条路径的手工接线都是对的（`dev-android.mjs` 与 `release-build-steps.mjs`），
 * 但「手工且正确」不等于「被钉住」：删掉那一行仍全绿，干净检出即复现决策 8 记录的故障。
 */
const MJS_GRADLE_MIN = 3;

/** 剥掉 JS 行注释与块注释——否则注释里提一句 `sync-credentials` 就能骗过「前置」判据。 */
function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * 根命令调用点完备性（不变量 10；ADR-0204 §决策 2「改名必须同步调用点」）。
 *
 * 背景：本轮**两次**栽在同一形态上——
 * ① T07 把根 `build:android` 改名为 `build:android-host`（ADR-0204），
 *    却漏了 `tests/android-e2e/build-install.ts` 的调用点 ⇒ `pnpm test:android-host:e2e`
 *    100% 失败于 `Missing script: build:android`；
 * ② T05 迁移时 `packages/app` 的 devDependencies 没跟着搬，`appium` 整个丢失。
 * 两者都不是「代码写错」，是**改名/迁移时漏了另一端**——缺席的文件不进 diff，
 * 逐行评审与全绿门禁都看不到。
 *
 * ## 判据：按**解析目标包**查表——「取 workspace 并集」与「统一查根」都是错解
 *
 * `pnpm run <name>` 查的是**进程 cwd 所在**的 package.json。本仓两个真实调用恰好分处两端：
 * - `build-install.ts` 以 `cwd: REPO_ROOT` 起 pnpm ⇒ 只能查**根** package.json。
 *   而 `build:android` 这个名字**仍然活在宿主包内部**（根 `build:android-host` 正是委托给它），
 *   所以**取并集会让刚修好的缺陷原样放行**——恒真的假防线，正是本条最危险的形态。
 * - `release-build-steps.mjs` 的 `["run","sync:credentials"]` 继承进程 cwd（宿主包），
 *   而**根** package.json 里没有 `sync:credentials` ⇒ **统一查根会误报**。
 * 两个方向同时有真实反例，故只能逐调用点解析目标包。
 *
 * 目标包判定顺序（先命中先算）：
 * 1. `["--dir", "<rel>", "run", "<name>"]` ⇒ `<rel>` 相对**文件所属包的目录**解析；
 * 2. 文件里出现 `cwd: REPO_ROOT` ⇒ 目标 = 仓库根；
 * 3. 其余 ⇒ 目标 = 文件所属包（pnpm 以 `--filter` 起包内脚本时 cwd 即该包目录）。
 *
 * 两条**已知局限**，方向都是「响的」而非「静默的」：
 * - cwd 识别按**文件**粒度且只认 `cwd: REPO_ROOT` 这一种写法。同一个文件里若出现
 *   「一部分步骤带自定义 cwd、另一部分不带」，会被判成所属包 ⇒ 可能误报（红），不会漏报。
 * - 不解析 `pnpm run ${x}` 这类字符串拼接（静态不可知），也不解析 shell 字符串形态
 *   （如根 package.json 里的 `vp run --filter X build`）。本仓所有 pnpm 调用点均为
 *   数组字面量（已实测，见下方扫描覆盖断言）。
 */

/** `["run", "<name>"]` —— 目标包 = 显式 cwd（若指向仓库根），否则文件所属包。 */
const PNPM_RUN_ARRAY_RE = /\[\s*"run",\s*"([^"]+)"\s*\]/g;

/** `["--dir", "<rel>", "run", "<name>"]` —— 目标包 = `<rel>` 相对**所属包目录**解析。 */
const PNPM_DIR_RUN_RE = /\[\s*"--dir",\s*"([^"]+)",\s*"run",\s*"([^"]+)"\s*\]/g;

/** 显式把 cwd 指向仓库根的写法（本仓唯一形态，见 `build-install.ts`）。 */
const PNPM_CWD_ROOT_RE = /\bcwd:\s*REPO_ROOT\b/;

/** 扫描根：真正会 shell out 跑 pnpm 的源码位置。 */
const INV10_SCAN_ROOTS = [
  "packages/android-host/scripts",
  "packages/android-host/tests/android-e2e",
  "packages/app-lynx/src",
] as const;

/**
 * 刻意排除 `packages/android-host/tests/unit/**`：那里存的是**历史形态 / 改名复活**的
 * 负样本 fixture（如 `["run","build:web"]` 断言它**不得**复活），本就该引用已不存在的名字。
 * 排除本身是个洞，所以配一条「扫描覆盖」断言（见 describe「不变量 10：扫描覆盖」）：
 * 全仓命中若落在扫描根之外，必须全部落在这一条排除清单里，且排除清单不得空转。
 */
const INV10_EXCLUDED_ROOTS = ["packages/android-host/tests/unit"] as const;

/** 配对正面锚点：扫到的 pnpm 数组调用点下界（防「零调用点」让全称断言静默恒真）。 */
const INV10_CALLSITE_MIN = 2;

interface PkgNode {
  /** 包目录（绝对路径） */
  dir: string;
  /** 相对仓库根，用于报错 */
  rel: string;
  scripts: Set<string>;
}

/** 载入根 + packages/ 下所有 package.json。解析失败不静默：登记空集 ⇒ 该包的名字全判「不存在」。 */
function loadWorkspacePackages(l: Layout, rel: (p: string) => string): PkgNode[] {
  const files = [
    join(l.repoRoot, "package.json"),
    ...walkFiles(l.packagesDir, (f) => f.endsWith("package.json")),
  ];
  const out: PkgNode[] = [];
  for (const f of files) {
    const dir = dirname(f);
    let scripts: Set<string>;
    try {
      const parsed = JSON.parse(readFileSync(f, "utf8")) as { scripts?: Record<string, string> };
      scripts = new Set(Object.keys(parsed.scripts ?? {}));
    } catch {
      scripts = new Set();
      console.warn(`[webviewRemovalInvariants] 不变量 10 解析失败：${rel(f)}`);
    }
    out.push({ dir, rel: rel(dir), scripts });
  }
  return out;
}

/** 最近的祖先包（dir 是 fromDir 的前缀，取最长者）。 */
function nearestPackage(pkgs: PkgNode[], fromDir: string): PkgNode | undefined {
  return pkgs
    .filter((p) => fromDir === p.dir || fromDir.startsWith(p.dir + sep))
    .toSorted((a, b) => b.dir.length - a.dir.length)[0];
}

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

type InvariantId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
type Verdict = Record<InvariantId, string[]>;

/**
 * 全部不变量编号（单一事实源）。
 * 加第 10 条时只改这里；「N 组」文案由 `ALL_INVARIANTS.length` 派生，不再各处各写一份计数
 * ——计数散落正是本文件头曾与实现漂移的成因。
 */
const ALL_INVARIANTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as InvariantId[];

/** 逐条求值十组不变量；返回每个不变量的**违规清单**（空 = 满足）。 */
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
    8: [] as string[],
    9: [] as string[],
    10: [] as string[],
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

  // 不变量 8 —— 客户端切换能力已随 WebView 客户端下线（ADR-0203 §决策 7「单态收敛」）
  // 负面：store / UI 引用 / Java 切换方法 全部不在
  const switchStore = join(l.clientDir, ...CLIENT_SWITCH_STORE_REL.split("/"));
  if (existsSync(switchStore)) {
    verdict[8].push(`客户端切换 store 仍存在：${rel(switchStore)}——WebView 已删除，切换无对象`);
  }
  // 检测式非空转锚点：证明确实扫到了客户端源集，而不是路径写错导致恒绿
  if (clientFiles.length === 0) {
    verdict[8].push("[检测式不可信] 未扫描到客户端源集任何文本文件，残留检测空转");
  }
  // 剥注释后再扫：`.d.ts` 里的方法声明是**代码**（要抓），而「这些方法已删除」这类
  // 说明性注释不是（不该抓）。不剥注释会自指撞自己的断言——本仓已有先例。
  for (const f of clientFiles) {
    const lines = stripJsComments(readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (CLIENT_SWITCH_REF_RE.test(line)) {
        verdict[8].push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  // Java 侧：切换专用方法 + 配对正面锚点（同一个文件里做，才能防「整份删掉也算修好」）
  const appModule = join(
    l.hostDir,
    "android",
    "app",
    "src",
    "lynx",
    "java",
    "io",
    "pictelio",
    "app",
    "PictelioAppModule.java",
  );
  if (!existsSync(appModule)) {
    verdict[8].push(`[检测式不可信] ${rel(appModule)} 不存在，无从校验切换方法是否已下线`);
  } else {
    const moduleText = readFileSync(appModule, "utf8");
    for (const method of CLIENT_SWITCH_JAVA_METHODS) {
      // 只认方法签名（public void xxx(Callback)），不认 javadoc/散文里的提及——
      // 否则「注释里解释为什么删了它」会把这条判红
      const sig = new RegExp(`public\\s+void\\s+${method}\\s*\\(`);
      if (sig.test(moduleText)) {
        verdict[8].push(
          `${rel(appModule)} 仍定义切换专用原生方法 ${method}(Callback)——WebView 已删除，切换无对象`,
        );
      }
    }
    for (const { method, minHits, owner } of CLIENT_SWITCH_POSITIVE_ANCHORS) {
      const sig = new RegExp(`public\\s+void\\s+${method}\\s*\\(`);
      const hits = moduleText.match(new RegExp(sig.source, "g"))?.length ?? 0;
      if (hits < minHits) {
        verdict[8].push(
          `[配对正面锚点失效] ${rel(appModule)} 的通用原生方法 ${method} 命中 ${hits} < ${minHits}（${owner}）——` +
            `切换方法该删、通用方法不该跟着没，一起没说明是事故不是下线`,
        );
      }
    }
  }

  // 不变量 9 —— 跑 gradlew 的脚本必须自带生成物前置（ADR-0203 §决策 8）
  // 判据来源是 CI 既有约定，不是拍脑袋：CI 在 gradle 步骤前显式跑 sync:credentials。
  const hostManifestPath = join(l.hostDir, "package.json");
  if (!existsSync(hostManifestPath)) {
    verdict[9].push("[检测式不可信] 宿主 package.json 不存在，无从校验 gradle 入口接线");
  } else {
    let hostScripts: Record<string, string> = {};
    try {
      hostScripts =
        (JSON.parse(readFileSync(hostManifestPath, "utf8")) as { scripts?: Record<string, string> })
          .scripts ?? {};
    } catch (err) {
      console.warn(`[webviewRemovalInvariants] 宿主 package.json 解析失败：${String(err)}`);
    }
    const gradleEntries = Object.entries(hostScripts).filter(([, v]) => GRADLE_ENTRY_RE.test(v));
    // 配对正面锚点：扫描集本身不能为空，否则「零个 gradle 脚本」会让全称断言静默恒真
    if (gradleEntries.length < GRADLE_ENTRY_MIN) {
      verdict[9].push(
        `[配对正面锚点失效] 宿主包只扫到 ${gradleEntries.length} 个 gradle 入口 < ${GRADLE_ENTRY_MIN}——` +
          `入口几乎全没，比「某个入口漏了前置」更严重`,
      );
    }
    for (const [name, cmd] of gradleEntries) {
      if (!cmd.includes(CREDENTIALS_SYNC)) {
        verdict[9].push(
          `脚本 ${name} 执行 gradlew 却未接 ${CREDENTIALS_SYNC}：` +
            `gradle 配置依赖 gitignored 的 OAuthConfig，干净检出会编译失败（主工作区因残留生成物而绿）`,
        );
      }
    }
  }

  // `.mjs` 侧：真正跑 gradlew 的两条路径在 package.json 字面量之外
  // （`dev:android` = `node scripts/dev-android.mjs`、`release` = `node scripts/release.mjs`）。
  // 这里断的是**顺序**而不只是存在：sync 必须早于 gradlew，否则「先生成的删了、照样编不过」。
  const scriptsDir = join(l.hostDir, "scripts");
  const mjsFiles = [...walkFiles(scriptsDir, (f) => f.endsWith(".mjs"))];
  const mjsGradle = mjsFiles.filter((f) =>
    GRADLE_ENTRY_RE.test(stripJsComments(readFileSync(f, "utf8"))),
  );
  if (mjsGradle.length < MJS_GRADLE_MIN) {
    verdict[9].push(
      `[配对正面锚点失效] scripts/ 下只扫到 ${mjsGradle.length} 个跑 gradlew 的 .mjs < ${MJS_GRADLE_MIN}`,
    );
  }
  /** 每个 .mjs 的「同步早于 gradlew」结果，供委托链解析复用。 */
  const syncBeforeGradle = new Map<string, boolean>();
  for (const f of mjsGradle) {
    const stripped = stripJsComments(readFileSync(f, "utf8"));
    const gradleAt = stripped.search(GRADLE_ENTRY_RE);
    // 两种接线写法都算：npm 脚本名（"sync:credentials"）与直调脚本（sync-credentials.mjs）
    const syncCandidates = [
      stripped.indexOf(CREDENTIALS_SYNC),
      stripped.indexOf("sync-credentials.mjs"),
    ].filter((i) => i >= 0);
    const syncAt = syncCandidates.length > 0 ? Math.min(...syncCandidates) : undefined;
    const ok = syncAt !== undefined && syncAt <= gradleAt;
    syncBeforeGradle.set(f, ok);
    if (syncAt !== undefined && syncAt > gradleAt) {
      verdict[9].push(
        `${rel(f)} 的凭证同步出现在 gradlew 调用**之后**（offset ${syncAt} > ${gradleAt}）——` +
          `顺序错则生成物缺失，等同未接`,
      );
    }
  }
  // 委托形态：`release.mjs` 只按 `cmd === "./gradlew"` 消费步骤数组，
  // 真正的前置在被它 import 的步骤定义模块里。判据沿链解析一层——
  // **不解析就会误报**（把正确的委托判成缺陷）；解析了但被委托方不合规，仍要报。
  for (const f of mjsGradle) {
    if (syncBeforeGradle.get(f)) continue;
    const stripped = stripJsComments(readFileSync(f, "utf8"));
    const delegates = mjsGradle.filter((g) => g !== f && stripped.includes(basename(g)));
    const delegatedOk = delegates.length > 0 && delegates.every((g) => syncBeforeGradle.get(g));
    if (!delegatedOk) {
      verdict[9].push(
        `${rel(f)} 执行 gradlew 但全篇未接凭证同步（注释里的提及不算，须为实际调用）`,
      );
    }
  }

  // 不变量 10 —— 根命令调用点完备性（改名/迁移不得漏掉另一端）
  // 逐调用点解析「pnpm 到底查哪份 package.json」，理由见 PNPM_RUN_ARRAY_RE 上方注释：
  // 取并集会让 `build:android`（仍活在宿主包内、根上已改名）原样放行；统一查根则误报
  // `sync:credentials`（只在宿主包、继承宿主 cwd）。两个方向都有真实反例。
  const pkgs = loadWorkspacePackages(l, rel);
  const rootPkg = pkgs.find((p) => p.dir === l.repoRoot);
  if (!rootPkg) verdict[10].push("[检测式不可信] 未找到根 package.json，调用点检测式空转");
  if (pkgs.filter((p) => p.scripts.size > 0).length === 0) {
    verdict[10].push("[检测式不可信] 未解析到任何非空 scripts 表，调用点检测式空转");
  }
  let callSiteCount = 0;
  for (const scanRel of INV10_SCAN_ROOTS) {
    for (const f of walkFiles(join(l.repoRoot, ...scanRel.split("/")), (x) => {
      const e = x.endsWith(".ts") || x.endsWith(".mjs");
      return e;
    })) {
      const stripped = stripJsComments(readFileSync(f, "utf8"));
      const owning = nearestPackage(pkgs, dirname(f));
      const cwdIsRoot = PNPM_CWD_ROOT_RE.test(stripped);

      // 形态 1：`["--dir", "<rel>", "run", "<name>"]`，目标包由 <rel> 决定
      for (const m of stripped.matchAll(PNPM_DIR_RUN_RE)) {
        const [, dirArg, script] = m;
        if (script === undefined || dirArg === undefined) continue;
        callSiteCount++;
        const target = nearestPackage(pkgs, resolve(owning?.dir ?? l.repoRoot, dirArg));
        if (!target) {
          verdict[10].push(
            `${rel(f)} 调用 \`pnpm --dir ${dirArg} run ${script}\`，但 ${dirArg} 解析不到任何 workspace 包` +
              `（目标包静态不可知 ⇒ 判红，不放行）`,
          );
        } else if (!target.scripts.has(script)) {
          verdict[10].push(
            `${rel(f)} 调用 \`pnpm --dir ${dirArg} run ${script}\`，但 ${target.rel} 无此脚本` +
              `（ADR-0204：改名须同步所有调用点）`,
          );
        }
      }

      // 形态 2：`["run", "<name>"]`，目标包 = 显式根 cwd，否则文件所属包
      for (const m of stripped.matchAll(PNPM_RUN_ARRAY_RE)) {
        const script = m[1];
        if (script === undefined) continue;
        callSiteCount++;
        const target = cwdIsRoot ? rootPkg : owning;
        if (!target) {
          verdict[10].push(
            `${rel(f)} 调用 \`pnpm run ${script}\`，但无法判定其解析目标包 ⇒ 判红，不放行`,
          );
        } else if (!target.scripts.has(script)) {
          verdict[10].push(
            `${rel(f)} 调用 \`pnpm run ${script}\`（cwd ${cwdIsRoot ? "= 仓库根" : `= ${target.rel}`}），` +
              `但该 package.json 无此脚本` +
              `（ADR-0204：宿主动作一律 :android-host 显式命名；改名须同步所有调用点）`,
          );
        }
      }
    }
  }
  // 配对正面锚点：扫描集不能空，否则「零调用点」会让全称断言静默恒真
  if (callSiteCount < INV10_CALLSITE_MIN) {
    verdict[10].push(
      `[配对正面锚点失效] 只扫到 ${callSiteCount} 处 pnpm 数组调用 < ${INV10_CALLSITE_MIN}，调用点检测式可能已失明`,
    );
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

describe("不变量 8：客户端切换能力已随 WebView 下线（ADR-0203 §决策 7「单态收敛」）", () => {
  it("clientSwitch store / UI 引用 / Java 切换专用方法均已清空，且通用原生方法仍在（配对正面锚点）", () =>
    assertSatisfied(8));
});

describe("不变量 9：gradle 入口自带生成物前置（ADR-0203 §决策 8；CI 既有约定）", () => {
  it("宿主包每个执行 gradlew 的脚本都接了 sync:credentials，且 gradle 入口数不低于下界（配对正面锚点）", () =>
    assertSatisfied(9));
});

describe("不变量 10：pnpm 调用点完备性（ADR-0204 §决策 2「改名必须同步调用点」）", () => {
  it("每个 pnpm 数组调用在其**解析目标包**的 package.json 里都存在，且调用点数不低于下界（配对正面锚点）", () =>
    assertSatisfied(10));
});

describe("不变量 10：扫描覆盖（防止「扫描根」本身变成失明的洞）", () => {
  // 排除 tests/unit 是**刻意**的（那里是「改名复活」负样本 fixture，本就该引用已不存在的名字），
  // 但排除清单天然是洞：新增的扫描根若忘了加、或调用点长在别处，就静默失明了。
  // 故：全仓搜同一批形态，扫描根之外的命中必须全部落在排除清单里，且排除清单不得空转。
  const scanRootAbs = INV10_SCAN_ROOTS.map((r) => join(LAYOUT.repoRoot, ...r.split("/")));
  const excludedAbs = INV10_EXCLUDED_ROOTS.map((r) => join(LAYOUT.repoRoot, ...r.split("/")));

  function classify(absFile: string): "scan" | "excluded" | "stray" {
    if (scanRootAbs.some((r) => absFile.startsWith(r + sep))) return "scan";
    if (excludedAbs.some((r) => absFile.startsWith(r + sep))) return "excluded";
    return "stray";
  }

  const allHits: Array<{ file: string; kind: ReturnType<typeof classify> }> = [];
  for (const f of walkFiles(LAYOUT.repoRoot, (x) => {
    return (
      (x.endsWith(".ts") || x.endsWith(".mjs")) &&
      // 判据自测文件本身必然含这两个形态（正例 + 反事实注入），否则本断言自指失败
      basename(x) !== "webviewRemovalInvariants.test.ts"
    );
  })) {
    const src = stripJsComments(readFileSync(f, "utf8"));
    const hit = PNPM_RUN_ARRAY_RE.test(src) || PNPM_DIR_RUN_RE.test(src);
    PNPM_RUN_ARRAY_RE.lastIndex = 0;
    PNPM_DIR_RUN_RE.lastIndex = 0;
    if (hit) allHits.push({ file: relative(LAYOUT.repoRoot, f), kind: classify(f) });
  }

  it("扫描根之外没有漏网的 pnpm 数组调用（否则不变量 10 对该文件完全失明）", () => {
    expect(allHits.filter((h) => h.kind === "stray").map((h) => h.file)).toEqual([]);
  });

  it("配对正面锚点：扫描集非空、排除集非空（证明两条清单都真的在承担判定，不是空转）", () => {
    expect(allHits.filter((h) => h.kind === "scan").length).toBeGreaterThan(0);
    expect(allHits.filter((h) => h.kind === "excluded").length).toBeGreaterThan(0);
  });
});

// ── 阳性对照：真实临时目录 + 同一批扫描函数 ──────────────────────────────────
// 目的：证明上面十条**不是恒绿假防线**。做法是造一棵合规仓库树（应全绿），
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

/** 造一棵「删除已完成」的合规仓库树：满足全部十组不变量。 */
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
          "build:android-host": "vp run --filter @pictelio/android-host build:android",
        },
      },
      null,
      2,
    ),
  );

  // 宿主包：逐件齐全的最小树。
  // 目录型资产要写满 minFiles 个文件——下界是真实约束（ADR-0203 §复核判据 6），
  // fixture 只放 1 个会让「基线全绿」本身变成假绿。
  for (const asset of HOST_ASSETS) {
    if (asset.kind === "file") {
      writeFixtureFile(root, `packages/android-host/${asset.rel}`, "// fixture\n");
    } else {
      const ext = "ext" in asset ? asset.ext : "";
      const n = "minFiles" in asset ? asset.minFiles : 1;
      for (let i = 0; i < n; i++) {
        writeFixtureFile(
          root,
          `packages/android-host/${asset.rel}/Fixture${i}${ext}`,
          "// fixture\n",
        );
      }
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
  // 不变量 8 的正面锚点载体：合规态 = 只剩通用原生方法，切换专用方法一个都不在。
  // 判定只认 `public void xxx(` 签名，故这里也只用签名形态造点。
  writeFixtureFile(
    root,
    "packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java",
    [
      "package io.pictelio.app;",
      "class PictelioAppModule {",
      ...CLIENT_SWITCH_POSITIVE_ANCHORS.map(
        (a) => `  public void ${a.method}(Callback callback) { callback.invoke(null, null); }`,
      ),
      "}",
      "",
    ].join("\n"),
  );
  writeFixtureFile(root, "packages/android-host/scripts/release.mjs", "export const steps = [];\n");
  // 不变量 9 的 `.mjs` 侧载体：合规态 = 凭证同步先于 gradlew 调用。
  // 刻意覆盖两种接线写法（npm 脚本名 / 直调脚本），证明判据认的是调用形态而非某一种字面量。
  writeFixtureFile(
    root,
    "packages/android-host/scripts/mjsGradleA.mjs",
    'await run("pnpm", ["run", "sync:credentials"]);\nawait run("./gradlew", ["assembleDebug"]);\n',
  );
  writeFixtureFile(
    root,
    "packages/android-host/scripts/mjsGradleB.mjs",
    'await run("node", ["scripts/sync-credentials.mjs"]);\nawait run("./gradlew", ["assembleRelease"]);\n',
  );
  writeFixtureFile(
    root,
    "packages/android-host/scripts/lib/mjsGradleC.mjs",
    'steps = [["同步", "pnpm", ["run", "sync:credentials"]], ["./gradlew", "assembleRelease"]];\n',
  );
  writeFixtureFile(
    root,
    "packages/android-host/tests/android-e2e/specs/transition-matrix.spec.ts",
    "export const spec = true;\n",
  );
  writeFixtureFile(
    root,
    "packages/android-host/package.json",
    JSON.stringify({
      name: "@pictelio/android-host",
      scripts: {
        // 不变量 9 的前置脚本（`npm run ${CREDENTIALS_SYNC}` 引用的就是它）
        [CREDENTIALS_SYNC]: "node scripts/sync-credentials.mjs",
        // ⚠️ 刻意保留包内的 `build:android`：**它仍然活着**（根 `build:android-host` 委托给它）。
        // 这正是「取 workspace 并集」会漏掉真缺陷的陷阱载体——对照 10a/10b 就靠它。
        "build:android": `npm run ${CREDENTIALS_SYNC} && ./gradlew assembleDebug`,
        ...Object.fromEntries(
          Array.from({ length: GRADLE_ENTRY_MIN }, (_, i) => [
            `gradleTask${i}`,
            `npm run ${CREDENTIALS_SYNC} && ./gradlew task${i}`,
          ]),
        ),
      },
    }),
  );
  writeFixtureFile(root, "packages/android-host/tsconfig.json", "{}\n");
  writeFixtureFile(root, "packages/android-host/vitest.config.ts", "export default {};\n");

  // 不变量 10 的两个调用点载体：① cwd=REPO_ROOT ⇒ 目标包是**根**；② --dir ⇒ 目标包是 app-lynx。
  // 二者的目标包刻意不同，正是「统一查根」「取并集」两种简化判据都会出错的根据。
  writeFixtureFile(
    root,
    "packages/android-host/tests/android-e2e/build-install.ts",
    [
      'import { spawn } from "node:child_process";',
      'import { REPO_ROOT } from "./env";',
      'const buildArgs = ["run", "build:android-host"];',
      'spawn("pnpm", buildArgs, { cwd: REPO_ROOT });',
      "",
    ].join("\n"),
  );
  writeFixtureFile(
    root,
    "packages/android-host/scripts/pnpmDirCall.mjs",
    'await run("pnpm", ["--dir", "../app-lynx", "run", "build"]);\n',
  );

  // 唯一客户端：无跨包引用
  writeFixtureFile(
    root,
    "packages/app-lynx/lynx.config.ts",
    "import { resolve } from 'node:path';\nconst pkg = resolve(_root, './package.json');\n",
  );
  writeFixtureFile(
    root,
    "packages/app-lynx/package.json",
    JSON.stringify({ name: "pictelio-app-lynx", scripts: { dev: "", build: "", test: "" } }),
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

/** 合规树必须十组全绿——否则下面的「转红」证明不了任何东西（可能一开始就没在算）。 */
function expectOnly(target: Verdict, id: InvariantId, minHits: number): void {
  for (const key of ALL_INVARIANTS) {
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

describe("检测式阳性对照（临时合规树 + 逐条塞回违规，证明十组不是恒绿假防线）", () => {
  it("基线：合规仓库树十组全绿", () => {
    const v = evaluateFixture(() => {});
    for (const key of ALL_INVARIANTS) {
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
      evaluateFixture((r) => {
        // 合并而非整份覆盖：scripts 是不变量 10 的载体，整份重写会把别的注入也搅进来
        const abs = join(r, "packages/app-lynx/package.json");
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as {
          dependencies?: Record<string, string>;
        };
        parsed.dependencies = { ...parsed.dependencies, "@capacitor/core": "^8.5.2" };
        writeFileSync(abs, JSON.stringify(parsed), "utf8");
      }),
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

  // ── 不变量 8 的三个注入 ──────────────────────────────────────────────────
  // 8a 塞回 store 文件：证明「store 是否还在」这条不是恒绿
  it("对照 8a：把 clientSwitchStore.ts 塞回去 → 不变量 8 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          `packages/app-lynx/${CLIENT_SWITCH_STORE_REL}`,
          "export const useClientSwitchStore = () => ({});\n",
        ),
      ),
      8,
      1,
    );
  });

  // 8b 塞回 UI 引用：证明「引用扫描」这条不是恒绿
  // ⚠️ 注入的是**一个** clientSwitch 引用就要求 ≥1 命中，不要求 ≥2：
  // 若这里写死 2，塞回单个引用反而会红，等于把「刚好一处残留」判成合格。
  it("对照 8b：让客户端页面重新引用 clientSwitch → 不变量 8 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          "packages/app-lynx/src/pages/Me.vue",
          [
            "<template>",
            '  <view v-if="supportsClientSwitch(clientSwitch.availableKinds)">',
            "    <text>SolidJS + Capacitor</text>",
            "  </view>",
            "</template>",
            "",
          ].join("\n"),
        ),
      ),
      8,
      1,
    );
  });

  // 8c 塞回 Java 切换方法：证明「原生方法签名」这条不是恒绿
  it("对照 8c：把 setClientKind(Callback) 加回 PictelioAppModule → 不变量 8 转红", () => {
    expectOnly(
      evaluateFixture((r) => {
        const abs = join(
          r,
          "packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java",
        );
        writeFileSync(
          abs,
          `${readFileSync(abs, "utf8").replace(
            "\n}",
            "\n  public void setClientKind(String kind, Callback callback) {}\n}",
          )}`,
          "utf8",
        );
      }),
      8,
      1,
    );
  });

  // 8d 误删通用方法：证明「配对正面锚点」真的在断——这是本条不变量的防糊弄半边。
  // 若删掉这条，正面锚点就只剩装饰：把 PictelioAppModule 整份删光也能让 8a/8b/8c 全绿。
  // 9a 把某个 gradle 入口的 sync:credentials 前置摘掉：证明这条在断真实接线
  it("对照 9a：摘掉某 gradle 入口的 sync:credentials 前置 → 不变量 9 转红", () => {
    expectOnly(
      evaluateFixture((r) => {
        const abs = join(r, "packages/android-host/package.json");
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as {
          scripts: Record<string, string>;
        };
        parsed.scripts.gradleTask0 = "./gradlew gradleTask0";
        writeFileSync(abs, JSON.stringify(parsed), "utf8");
      }),
      9,
      1,
    );
  });

  // 9b 把 gradle 入口删到下界以下：证明配对正面锚点在断（不是「零入口恒绿」）
  it("对照 9b：gradle 入口删到下界以下 → 不变量 9 转红（配对正面锚点在断）", () => {
    expectOnly(
      evaluateFixture((r) => {
        const abs = join(r, "packages/android-host/package.json");
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as {
          scripts: Record<string, string>;
        };
        // 保留 sync:credentials 与 build:android：它们是不变量 10 的载体，
        // 删掉会把「gradle 入口数跌破下界」这一个注入，扩散成两条不变量同时红。
        parsed.scripts = {
          [CREDENTIALS_SYNC]: "node scripts/sync-credentials.mjs",
          "build:android": `npm run ${CREDENTIALS_SYNC} && ./gradlew assembleDebug`,
          onlyOne: `npm run ${CREDENTIALS_SYNC} && ./gradlew onlyOne`,
        };
        writeFileSync(abs, JSON.stringify(parsed), "utf8");
      }),
      9,
      1,
    );
  });

  it("对照 8d：误删通用原生方法 exitApp → 不变量 8 转红（配对正面锚点在断）", () => {
    expectOnly(
      evaluateFixture((r) => {
        const abs = join(
          r,
          "packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java",
        );
        writeFileSync(
          abs,
          readFileSync(abs, "utf8").replace(
            /^\s*public void exitApp\(Callback callback\).*\n/m,
            "",
          ),
          "utf8",
        );
      }),
      8,
      1,
    );
  });

  // ── 不变量 10 的四条反事实 ────────────────────────────────────────────────
  // 10a 是**本轮真缺陷的原样复现**：`build-install.ts` 以 cwd=REPO_ROOT 起 pnpm，
  // 却引用了只在宿主包内活着的 `build:android` ⇒ 运行时 `Missing script`。
  it("对照 10a：把根 cwd 的调用点改回包内旧名 build:android → 不变量 10 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          "packages/android-host/tests/android-e2e/build-install.ts",
          [
            'import { spawn } from "node:child_process";',
            'import { REPO_ROOT } from "./env";',
            // 缺陷形态：这个名字**在宿主包 package.json 里确实存在**，只因 cwd 是仓库根才失败
            'const buildArgs = ["run", "build:android"];',
            'spawn("pnpm", buildArgs, { cwd: REPO_ROOT });',
            "",
          ].join("\n"),
        ),
      ),
      10,
      1,
    );
  });

  // 10b 是**「取并集」这种错解的反事实**：把脚本名搬到另一个包里去（于是并集里能找到它），
  // 目标包依然没有 ⇒ 仍须转红。若这条转绿，说明判据偷偷退化成了「workspace 并集」，
  // 也就是本轮真缺陷会被原样放行的那条假防线。
  it("对照 10b：把脚本挪到**别的**包（并集里有、目标包里没有）→ 不变量 10 仍转红（证明没在取并集）", () => {
    expectOnly(
      evaluateFixture((r) => {
        const rootAbs = join(r, "package.json");
        const rootPkg = JSON.parse(readFileSync(rootAbs, "utf8")) as {
          scripts: Record<string, string>;
        };
        delete rootPkg.scripts["build:android-host"];
        writeFileSync(rootAbs, JSON.stringify(rootPkg), "utf8");

        const hostAbs = join(r, "packages/android-host/package.json");
        const hostPkg = JSON.parse(readFileSync(hostAbs, "utf8")) as {
          scripts: Record<string, string>;
        };
        // 刻意用**不含 gradlew** 的值：否则会连带触发不变量 9，注入就不干净了
        hostPkg.scripts["build:android-host"] = "echo moved";
        writeFileSync(hostAbs, JSON.stringify(hostPkg), "utf8");
      }),
      10,
      1,
    );
  });

  // 10c `--dir` 形态的反事实：证明「目标包由 --dir 决定」这条分支真的在断，
  // 而非所有 `--dir` 调用都被当成宿主包从而恒绿。
  it("对照 10c：--dir 指向一个没有该脚本的包 → 不变量 10 转红", () => {
    expectOnly(
      evaluateFixture((r) =>
        writeFixtureFile(
          r,
          "packages/android-host/scripts/pnpmDirCall.mjs",
          'await run("pnpm", ["--dir", "../ugoira", "run", "build"]);\n',
        ),
      ),
      10,
      1,
    );
  });

  // 10d 配对正面锚点：把 4 处 pnpm 数组调用点全部撤掉，证明「查表」不是对着空表恒绿。
  // 改写而非删文件：HOST_ASSETS 有 .mjs/.ts 数量下界，删文件会连带触发不变量 3。
  // mjsGradleA/C 改用「直调脚本」形态——不变量 9 认的是「同步先于 gradlew」的文本序，不认调用形态。
  it("对照 10d：撤掉全部 pnpm 数组调用点 → 不变量 10 转红（配对正面锚点在断）", () => {
    expectOnly(
      evaluateFixture((r) => {
        writeFixtureFile(
          r,
          "packages/android-host/tests/android-e2e/build-install.ts",
          [
            'import { spawn } from "node:child_process";',
            'import { REPO_ROOT } from "./env";',
            'spawn("pnpm", ["exec", "true"], { cwd: REPO_ROOT });',
            "",
          ].join("\n"),
        );
        writeFixtureFile(
          r,
          "packages/android-host/scripts/pnpmDirCall.mjs",
          'await run("pnpm", ["--dir", "../app-lynx", "exec", "true"]);\n',
        );
        writeFixtureFile(
          r,
          "packages/android-host/scripts/mjsGradleA.mjs",
          'await run("node", ["scripts/sync-credentials.mjs"]);\nawait run("./gradlew", ["assembleDebug"]);\n',
        );
        writeFixtureFile(
          r,
          "packages/android-host/scripts/lib/mjsGradleC.mjs",
          'steps = [["同步", "node", ["../../scripts/sync-credentials.mjs"]], ["./gradlew", "assembleRelease"]];\n',
        );
      }),
      10,
      1,
    );
  });
});
