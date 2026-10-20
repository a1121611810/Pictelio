// ui-tree-dump-core.mjs —— 运行时 UI 树导出诊断脚本的**可测纯逻辑**
//
// 为什么要拆出纯模块：dump-ui-tree.mjs 是 CLI 编排脚本，顶层即调 adb + 跑 main()，
// import 即产生副作用，无法直接单测——先例：release-version-json.mjs（release.mjs 的
// plan/execute 分离）。
//
// 本模块承载五件事：
// ① **跨端协议常量**（与宿主侧 io.pictelio.app.UiTreeDump 逐字对应，由宿主侧
//    UiTreeDumpProtocolContractTest 做两侧比对——Java/Node 两套运行时无共享代码）；
// ② **产物名解析**（从文件名反解采样点 + 采样档位）；
// ③ **落齐判据**（planWait：按已知档位等齐，而不是靠「计数不变」猜）；
// ④ **树摘要**（summarize：节点数 / tag 分布 / 字段清单 / 事件名分布 / 语义 id / a11y 标签）；
// ⑤ **输出目录安全校验**（assertSafeOutDir：拒绝把输出目录指到工作目录或其祖先；
//    resolveOutDir：默认路径与显式 `--out` 的**单一出口**——取值与校验收在一起，
//    避免「只有显式路径有校验」的两条路径分叉）。
//
// ⑤ 为什么在这里：编排层（dump-ui-tree.mjs）要真跑 adb 才能进，**无法在 CI 里单测**
// ——第 4 轮 review 的阻塞缺陷（`--out ""` 会删掉整个工作目录）正是这样漏出去的。
// 把判据下沉到本模块，它才有机器防线（见 tests/unit/scripts/ui-tree-dump-outdir.test.ts）。
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** 应用包名（宿主侧 applicationId）。 */
export const APP_PACKAGE = "io.pictelio.app";

/**
 * 组件名必须写成 `pkg/.Class` 形态。
 * 写成 `pkg.Class`（少个斜杠）会被 ActivityManager 判为「Bad component name」——
 * `am start` 直接 exit 255，且**不启动任何东西**（静默失败，最容易误判成「能力没落地」）。
 */
export const LYNX_ACTIVITY = `${APP_PACKAGE}/.LynxActivity`;

/** intent extra 键（必须与宿主侧 UiTreeDump.EXTRA_TRIGGER 逐字一致）。 */
export const EXTRA_TRIGGER = "uiTreeDump";

/** 落盘子目录名（必须与宿主侧 UiTreeDump.DIR_NAME 逐字一致）。 */
export const OUT_DIR_NAME = "ui-tree";

/** 产物文件名前缀（必须与宿主侧 UiTreeDump.FILE_PREFIX 逐字一致）。 */
export const FILE_PREFIX = "ui-tree-";

/** 产物文件名后缀（必须与宿主侧 UiTreeDump.FILE_SUFFIX 逐字一致）。 */
export const FILE_SUFFIX = ".json";

/**
 * 采样档位集合（ms），CSV 形态（必须与宿主侧 UiTreeDump.SAMPLE_DELAYS_CSV 逐字一致）。
 *
 * <p>为什么是 CSV 而不是数组：两侧字面量的打印形态不同，逐字比对会因格式差异假红。
 */
export const SAMPLE_DELAYS_CSV = "0,1500,4000";

/** 采样档位集合（ms），数值形态，供落齐判据使用。 */
export const SAMPLE_DELAYS_MS = SAMPLE_DELAYS_CSV.split(",").map(Number);

/** 采样点标识集合（CSV，必须与宿主侧 UiTreeDump.POINT_IDS_CSV 逐字一致）。 */
export const POINT_IDS_CSV = "cold,hot";

/** 设备上的落盘目录（宿主侧用 getExternalFilesDir(null) 取，路径形态由平台约定相等）。 */
export const REMOTE_DIR = `/sdcard/Android/data/${APP_PACKAGE}/files/${OUT_DIR_NAME}`;

/**
 * 产物名正则：从 `ui-tree-<point>-<delayMs>ms-<seq>-<ts>.json` 反解采样点与档位。
 *
 * <p>为什么产物名要带采样点与档位：① **每次触发**命中几个采样点**取决于进程怎么死的**（2026-10-20
 * 模拟器三场景实测；份数按**每次触发**计，同一会话可含多次触发）：App 在跑 ⇒ hot 3 份；进程死、
 * 任务记录还在 ⇒ cold + hot 共 6 份；`am force-stop` ⇒ cold 3 份——没有标识就分不清哪份属于哪一轮；
 * ② 实测 4s 那份才是完整树（8KB → 9KB → 61KB；⚠️ 单次抓取口径，字节数随内容漂移，见 ADR-0223 §3.2），没有档位就只能靠体积猜。
 */
export const ARTIFACT_NAME_RE_SOURCE =
  "^ui-tree-(?<point>[a-z]+)-(?<delay>\\d+)ms-(?<seq>\\d+)-(?<ts>\\d+)\\.json$";

const ARTIFACT_NAME_RE = new RegExp(ARTIFACT_NAME_RE_SOURCE);

/**
 * 解析产物文件名。
 *
 * @param {string} name 设备上的文件名
 * @returns {{point: string, delayMs: number, seq: number, ts: number} | null} 不认得则 null
 */
export function parseArtifactName(name) {
  const m = ARTIFACT_NAME_RE.exec(name);
  if (!m) return null;
  const g = m.groups;
  return {
    point: g.point,
    delayMs: Number(g.delay),
    seq: Number(g.seq),
    ts: Number(g.ts),
  };
}

/**
 * 落齐判据：按**已知采样档位**等齐，而不是靠「计数连续两次不变」猜。
 *
 * <p>为什么必须按档位：宿主侧每轮连拍 3 份，档位间隔 0 / 1.5 / 4s ⇒ 第 2→3 份间隔 2.5s。
 * 旧实现「连续两次轮询（间隔 600ms）计数不变」⇒ 窗口约 1.2s < 2.5s ⇒ **必然在空档里 break**，
 * 丢掉的正是 4s 那份（唯一完整树），且 exit 0 静默。实机复现：设备产出 3 份，脚本只报 2 份。
 *
 * <p>判据：出现的采样点里，**至少有一轮三档齐** ⇒ 落齐。
 * 为什么「至少一轮」而不是「所有轮」：冷启动会命中 cold + hot 两轮，两轮的 4s 档几乎同时落盘，
 * 只看「一轮齐」就能确认最完整的那份已经拿到；要求「所有轮齐」会因另一轮迟到而误判超时。
 *
 * @param {string[]} names 本次抓取中新出现的产物文件名
 * @param {number[]} expectedDelays 期望的采样档位（ms）
 * @returns {{settled: boolean, seenDelays: number[], groups: {point: string, delays: number[]}[]}}
 */
export function planWait(names, expectedDelays = SAMPLE_DELAYS_MS) {
  const groups = new Map();
  const seenDelays = [];
  for (const name of names) {
    const parsed = parseArtifactName(name);
    if (!parsed) continue;
    if (!groups.has(parsed.point)) groups.set(parsed.point, []);
    groups.get(parsed.point).push(parsed.delayMs);
    seenDelays.push(parsed.delayMs);
  }
  const expected = new Set(expectedDelays);
  let settled = false;
  const out = [];
  for (const [point, delays] of groups) {
    const unique = [...new Set(delays)].toSorted((a, b) => a - b);
    out.push({ point, delays: unique });
    if ([...expected].every((d) => unique.includes(d))) settled = true;
  }
  return { settled, seenDelays: [...new Set(seenDelays)].toSorted((a, b) => a - b), groups: out };
}

/**
 * 这个名字是不是本通道的产物？（产物名前缀 + 后缀）
 *
 * <p>用途：清理输出目录时**只删本通道自己的产物**，绝不整目录递归删除。
 */
export function isArtifactName(name) {
  return name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX);
}

/**
 * 从一个目录的条目里挑出「本次该清理的旧产物」。
 *
 * <p><b>为什么不做整目录递归删除</b>：第 4 轮 review 实测发现，旧实现
 * {@code rmSync(out, {recursive:true, force:true})} 在 {@code --out ""} 时
 * （{@code path.resolve("")} = 当前工作目录）会**把用户的整个目录删掉**，
 * {@code --out <任意已有目录>} 也会把该目录里用户的其它文件一并清空。
 * ⇒ 清理范围收紧到「只删本通道产物名的文件」，其余一律不动。
 *
 * <p><b>为什么只删「普通文件」</b>：第 5 轮 Standards 轴实测抓到一个 EISDIR 崩口——
 * 输出目录里若存在**名叫 {@code ui-tree-*.json} 的目录**，按名字过滤会把它挑出来，
 * {@code rmSync} 抛 {@code EISDIR} ⇒ 整跑批中止（fail-closed、无数据丢失，但白跑）。
 *
 * @param {{name: string, isDir: boolean}[]} entries 目录条目（名字 + 是否为目录）
 * @returns {string[]} 该删除的条目名（只含本通道产物的普通文件）
 */
export function artifactsToRemove(entries) {
  return entries.filter((e) => isArtifactName(e.name) && !e.isDir).map((e) => e.name);
}

/**
 * 把路径解析成「物理路径」（解析符号链接）；目标不存在时解析其最深的存在祖先再拼回末段。
 *
 * <p>为什么必须做：macOS 上 {@code /tmp} 是指向 {@code /private/tmp} 的符号链接，而
 * {@code process.cwd()} 返回的是**物理路径**、{@code path.resolve()} 返回的是**字面路径**
 * ⇒ 只比字面路径会把「同一个目录」判成两个（守卫被绕过）。
 * 这是第 4 轮外部锚点复验时实测抓到的：{@code --out /tmp/uitree-cwd}（CWD 正是它）
 * 因路径形态不同而**没被拒**。
 *
 * @param {string} p 路径
 * @param {string} [base] 相对路径的基准（默认进程 CWD）
 * @returns {string} 物理路径（解析不出来时退回字面绝对路径）
 */
export function realish(p, base = process.cwd()) {
  const abs = resolve(base, p);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    try {
      return join(realpathSync(parent), basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * 两个路径是不是**同一个目录**？**按 inode 判定**（dev + ino）。
 *
 * <p><b>为什么不能只比路径字符串</b>：macOS 默认 APFS **大小写不敏感** ⇒
 * {@code /tmp/x/work} 与 {@code /tmp/x/WORK} 是**同一个目录**（同一 inode）但字符串不等；
 * 而 {@code realpathSync} **不归一化大小写**（返回输入的大小写形态）⇒ 只比字符串会让
 * 「CWD 的大小写变体」绕过输出目录守卫。
 * ⚠️ 第 5 轮 Standards 轴实测抓到该绕过：{@code --out <cwd 的大小写变体>} **没被拒**，
 * 清理动作落在 CWD 上（同目录的通道产物被删）。inode 判定与大小写、符号链接都无关。
 *
 * @param {string} a 路径
 * @param {string} b 路径
 * @returns {boolean} 同一目录则 true
 */
export function sameDirectory(a, b) {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/**
 * `--out` 目录的安全校验：拒绝会波及工作目录本身的路径。
 *
 * <p>为什么必须挡：输出目录若就是当前工作目录（或它的祖先），清理动作会落在用户的
 * 工作目录上 ⇒ 目录直接消失。旧实现是整目录递归删除 ⇒ 第 4 轮 review 实测复现过
 * （整个 CWD 消失）。现在清理范围已收紧到「只删本通道产物」，本函数是**第二道**防线：
 * 即使清理逻辑再被改坏，也不让它落在工作目录上。
 *
 * <p>判定按 **inode**（{@link sameDirectory}）⇒ 大小写变体、符号链接别名都挡得住；
 * 祖先判定把 CWD 的物理路径逐级上溯、逐级比 inode。
 *
 * @param {string} cwd 当前工作目录（相对路径按进程 CWD 解析）
 * @param {string} target 待校验的输出目录（**相对路径按 cwd 解析**）
 * @returns {string} 目标的物理路径（供调用方直接使用）
 * @throws {Error} 目标是 CWD 本身、或 CWD 的祖先
 */
export function assertSafeOutDir(cwd, target) {
  const c = realish(cwd);
  const t = realish(target, c);
  if (sameDirectory(c, t) || c === t) {
    throw new Error(`--out 不能是当前工作目录（${c}）：那会清掉工作目录里的同名文件。`);
  }
  let dir = dirname(c);
  for (;;) {
    if (sameDirectory(dir, t) || dir === t) {
      throw new Error(`--out 不能是当前工作目录的祖先（${t}）：那会连带影响工作目录本身。`);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return t;
}

/** 默认输出目录名（未传 `--out` 时落在 `<tmpRoot>/<该名>` 下）。 */
export const DEFAULT_OUT_DIR_NAME = "pictelio-ui-tree";

/**
 * 解析**最终生效**的输出目录，并把安全校验收在这一个出口上。
 *
 * <p><b>为什么要有这个函数</b>（第 6 轮 Standards 轴实测抓到的产品面缺陷）：
 * 此前编排层只在 `--out` 分支里调 {@link assertSafeOutDir}，**默认值**
 * （`<tmpRoot>/pictelio-ui-tree`）**完全绕过判据** ⇒ 当工作目录恰好就是默认输出
 * 目录时，清理动作会落在 CWD 上（实测：CWD 里的 `ui-tree-*.json` 被删），而同一
 * 时刻显式 `--out <同一目录>` 会被正确拒绝 ⇒ **两条路径行为分叉**，ADR §3.4 登记表
 * 声明的契约在默认路径上不成立。
 *
 * <p><b>修法不是「给默认值也补一次校验」</b>（那仍是两条路径，将来还会分叉），
 * 而是把**取值与校验合成一个出口**：显式与默认都从这里出 ⇒ 行为不可能分叉；
 * 且这个出口在 lib 层 ⇒ 有机器防线（`tests/unit/scripts/ui-tree-dump-outdir.test.ts`）。
 *
 * @param {string} cwd 当前工作目录（相对路径按它解析）
 * @param {string|null|undefined} requested 显式 `--out` 的取值；`null`/`undefined` ⇒ 用默认值
 * @param {string} tmpRoot 临时根目录（默认值的父目录）
 * @returns {string} 校验通过后的物理路径（供调用方直接使用）
 * @throws {Error} 输出目录是 cwd 本身、或 cwd 的祖先
 */
export function resolveOutDir(cwd, requested, tmpRoot) {
  const out = requested ?? join(tmpRoot, DEFAULT_OUT_DIR_NAME);
  return assertSafeOutDir(cwd, out);
}

/**
 * 运行结果的退出码（纯函数 ⇒ 可单测）。
 *
 * <p><b>为什么必须有</b>：CLI 编排层此前对「采样未落齐」只打 `console.error`、**退出码仍是 0**——
 * 而「丢 4s 那份且静默 exit 0」正是第 1 轮 review 要修的缺陷。**只改文案不改退出码 = 缺陷未闭环**：
 * 调用方按 `$?` 判定仍拿到「成功」。退出码是这套判据里**唯一能被机器读到**的那一半，
 * 所以它必须落在一个可单测的纯函数里，而不是埋在 CLI 的分支中。
 *
 * <p>判定项与理由：
 * <ul>
 *   <li><b>未落齐</b> ⇒ 1：最完整的那份（4s 档）可能没到，产物集不完整；</li>
 *   <li><b>等待超时</b> ⇒ 1：同上（超时即未能确认落齐）；</li>
 *   <li><b>拉回失败</b> ⇒ 1：文件在设备上但没拿到，本地产物集不完整；</li>
 *   <li><b>JSON 不合法</b> ⇒ 1：产物不是引擎原始 JSON ⇒ 通道本身出问题。</li>
 * </ul>
 * 全部满足才 0。
 *
 * @param {{settled: boolean, timedOut?: boolean, pullFailures?: number, invalidJson?: number}} result
 * @returns {number} 进程退出码
 */
export function exitCodeFor(result) {
  if (!result.settled) return 1;
  if (result.timedOut) return 1;
  if ((result.pullFailures ?? 0) > 0) return 1;
  if ((result.invalidJson ?? 0) > 0) return 1;
  return 0;
}

/**
 * 统计一棵树。
 *
 * <p>除了基础计数，另给四项「诊断价值最高」的派生量：
 * <ul>
 *   <li><b>class 覆盖率</b>：Tailwind 类名挂在多少节点上（≈「这棵树有多可读」）；</li>
 *   <li><b>语义 id 清单</b>：非空 id 的节点（仓库已在用 {@code id="pictelio-..."} 约定）；</li>
 *   <li><b>a11y 标签清单</b>：{@code accessibility-label}（a11y 树不暴露给 uiautomator，
 *       但它在 UI 树里——这是本通道相对既有手段的增量）；</li>
 *   <li><b>事件名分布</b>：哪些节点可交互、绑的是哪种事件。</li>
 * </ul>
 */
export function summarize(tree) {
  let nodeCount = 0;
  let maxDepth = 0;
  let withClass = 0;
  const tagCounts = new Map();
  const fieldCounts = new Map();
  const topLevel = [];
  const ids = [];
  const a11yLabels = [];
  const eventNames = new Map();

  const walk = (node, depth) => {
    // 只把**对象**算作节点：null 与数组都不计。
    // ⚠️ 这条与宿主侧 `UiTreeDump.countNodes` 的口径逐项对齐（null 不计、数组不计）——
    //   两侧对退化输入若分叉，「两边数字可互校」就只是断言（ADR-0223 §3.2）。
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);
    for (const key of Object.keys(node)) {
      if (key === "children") continue;
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    }
    const tag = typeof node.tag === "string" ? node.tag : "(无 tag)";
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (depth === 0) topLevel.push(tag);

    const attrs = node.attributes ?? {};
    if (Array.isArray(attrs.class) && attrs.class.length > 0) withClass += 1;
    const id = node.id || attrs.id;
    if (id) ids.push(`${tag}#${id}`);
    if (attrs["accessibility-label"]) {
      a11yLabels.push(`${tag}:"${attrs["accessibility-label"]}"`);
    }
    if (Array.isArray(node.events)) {
      for (const ev of node.events) {
        const name = typeof ev === "object" ? ev.eventName : String(ev);
        eventNames.set(name, (eventNames.get(name) ?? 0) + 1);
      }
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c, depth + 1);
  };

  walk(tree, 0);
  return {
    nodeCount,
    maxDepth,
    topLevel,
    withClass,
    ids,
    a11yLabels,
    tagCounts: [...tagCounts.entries()].toSorted((a, b) => b[1] - a[1]),
    fieldCounts: [...fieldCounts.entries()].toSorted((a, b) => b[1] - a[1]),
    eventNames: [...eventNames.entries()].toSorted((a, b) => b[1] - a[1]),
  };
}
