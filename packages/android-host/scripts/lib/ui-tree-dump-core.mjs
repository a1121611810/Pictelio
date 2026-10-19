// ui-tree-dump-core.mjs —— 运行时 UI 树导出诊断脚本的**可测纯逻辑**
//
// 为什么要拆出纯模块：dump-ui-tree.mjs 是 CLI 编排脚本，顶层即调 adb + 跑 main()，
// import 即产生副作用，无法直接单测——先例：release-version-json.mjs（release.mjs 的
// plan/execute 分离）。
//
// 本模块承载四件事：
// ① **跨端协议常量**（与宿主侧 io.pictelio.app.UiTreeDump 逐字对应，由宿主侧
//    UiTreeDumpProtocolContractTest 做两侧比对——Java/Node 两套运行时无共享代码）；
// ② **产物名解析**（从文件名反解采样点 + 采样档位）；
// ③ **落齐判据**（planWait：按已知档位等齐，而不是靠「计数不变」猜）；
// ④ **树摘要**（summarize：节点数 / tag 分布 / 字段清单 / 事件名分布 / 语义 id / a11y 标签）。

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
 * <p>为什么产物名要带采样点与档位：① 冷启动会同时命中 cold 与 hot 两个采样点（各 3 份），
 * 没有标识就分不清哪份属于哪一轮；② 实测 4s 那份才是完整树（8KB → 9KB → 61KB），
 * 没有档位就只能靠体积猜。
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
 * @param {string[]} names 本轮新出现的产物文件名
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
 * 运行结果的退出码（纯函数 ⇒ 可单测）。
 *
 * <p><b>为什么必须有</b>：CLI 编排层此前对「采样未落齐」只打 `console.error`、**退出码仍是 0**——
 * 而「丢 4s 那份且静默 exit 0」正是本轮要修的缺陷。**只改文案不改退出码 = 缺陷未闭环**：
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
    if (!node || typeof node !== "object") return;
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
