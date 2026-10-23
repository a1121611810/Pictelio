// @vitest-environment node
/**
 * android-e2e 共享「运行时 UI 树」工具（issue #1047 · ADR-0223）。
 *
 * ## 这份工具解决什么
 *
 * 宿主侧 ADR-0223 已落地一条**运行时 UI 树导出**通道：DEBUG 包收到 intent extra
 * `uiTreeDump=1` ⇒ `LynxView.getLynxElementRoot()` + `LynxElement.toJSONString()`
 * ⇒ 连拍三档（0 / 1500 / 4000ms）落盘到设备专属外部目录 `ui-tree/`。
 *
 * 通道落地前，`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags`
 * / `md3-visual-tokens` 四个 spec 因为「Lynx 不暴露无障碍树节点、`uiautomator dump` 被
 * SIGKILL」而整体退到「截图 + 像素分析」——像素判据能答「画面变了没有」，**答不了**
 * 「那个元素在不在、在哪、多大、能不能点」。本模块把那层观测面接回 e2e。
 *
 * ## 树与像素各答一个问题（分工，写死，别混用）
 *
 * | 量 | 树能给的 | 像素能给的 |
 * |---|---|---|
 * | 元素**在不在** | ✅ 节点存在性 | ❌ 只能猜 |
 * | 元素**在哪 / 多大** | ✅ **布局盒**（`position.frameInScreen`） | ⚠️ **可见区域**（会小于布局盒） |
 * | 元素**长什么样** | ❌ 属性级覆盖不足（见下） | ✅ 颜色 / 圆角 / alpha / 对比度 |
 * | 元素**有没有被盖住** | ❌ | ✅ |
 * | 元素**能不能点** | ✅ `events` 里有 `tap` 等绑定 | ❌ |
 *
 * ⚠️ **树给不出颜色**（2026-10-20 实测，140 节点样本）：`attributes.style` 只有 51/140
 * 节点有，且其键集为 `background / font-family / font-size / height / left /
 * margin-left / padding-bottom / padding-top / top / transform / transition / width /
 * z-index`——**没有** `border-radius` / `background-color` / `color` / `opacity`，
 * 且 `background` 的值是 `var(--md-…)` 引用**不是计算值**。⇒ **颜色 / 圆角 / alpha /
 * 对比度 / 遮挡 / 「画出来了吗」一律留像素**，树不参与。
 *
 * ## 坐标口径：只用 `frameInScreen`，禁用 `frameInRoot`（硬约束）
 *
 * 树里两套坐标系都有，但**只有 `frameInScreen` 能拿来跟像素对照**：
 *
 * - 同一个主 CTA（class 含 `absolute` + `z-30` + `bg-primary-container`），
 *   `frameInScreen` = (872, 1808, 162, 162)，`frameInRoot` = (953, 1889, 162, 162)
 *   —— **差 81px**（横向 swiper 的滚动偏移）。
 * - `frameInScreen` 与既有像素实测经验值（x 872..1033 / y 1808..1969）**逐字一致**；
 *   `frameInRoot` 不一致。
 *
 * ⇒ 本模块**只导出 `screenFrame()`** 这一个几何访问器，不导出 `frameInRoot`
 * —— 让「用错坐标系」这件事在**读代码时就能一眼看见**，而不是靠 review 抓。
 * ⚠️ **措辞要说准**（#1047 第 2 轮 Spec 轴订正）：`UiTreeNode` 类型**仍然导出**
 *   `position.frameInRoot`（那是对照用的原始字段）⇒ 消费方写 `node.position?.frameInRoot`
 *   **仍能编译**。真正的防线是「**只提供一个 accessor**」这条**约定** + 单测守卫
 *   （断言本模块的运行时导出键名里不含 `root`）。**不是**「编译期不可能」——别夸大。
 *
 * ## 触控目标门限用的 density（#1047 第 2 轮 Standards 轴 F8）
 *
 * pictelio_ui 固定 density 480（`assertDeviceGeometry` 逐台校验 `wm density` 匹配
 * `/480/`）⇒ **1dp = 3px**。三处 spec 的「≥48dp」判据同形，把 `3` 写死在三处
 * 就是三份可漂移的副本 ⇒ 收敛到下面这个常量（**硬编码只有这一份**；`md3` 另用
 * 设备实读的 density，初值取自它——见常量的注释）。
 *
 * ## 抓树不破坏被测状态（硬约束）
 *
 * `LynxActivity` 的 `android:launchMode="singleTask"` ⇒ 对已在跑的 App 再发一条
 * `am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity`，**intent 走 `onNewIntent` 投递**，
 * Activity **不重建**、页面不重载、被测状态保留。
 *
 * ⚠️ `onNewIntent` 里除抓树外还会调 `dispatchNotificationTarget(intent)`——它只认
 * `EXTRA_NOTIFICATION_TARGET`，本模块的 intent **不带**该 extra ⇒ 不会触发任何导航。
 *
 * 两种用法：
 * - **合并进既有 intent**（首选）：把 `uiTreeDump=1` 附到该 spec 已经在发的那条导航
 *   intent 上 ⇒ 抓到的树正好就是被断言的那个状态。
 * - **单独触发**（本模块默认）：App 在前台时另发一条 ⇒ 走 hot 采样点，状态不变。
 *
 * ## 门禁边界
 *
 * e2e **不进 CI**（ADR-0084）——它是发版前手动跑的那一组。本模块的**纯函数部分**
 * （树的查询与几何换算）另有单测（`tests/android-e2e/unit/ui-tree.test.ts`）随
 * `pnpm test:all` 进 CI；**设备侧 IO 边界**（触发 / 等落齐 / 拉回 / 解析）另有单测
 * （`tests/android-e2e/unit/ui-tree.io.test.ts`，adb 调用以 `vi.mock("../env")` 顶掉）
 * 随 `pnpm test:all` 进 CI ⇒ **失败/降级路径在 CI 里是红的**。
 * ⚠️ 真正跑设备的那一段（adb 真连、引擎真吐树）仍**没有** CI 防线。
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

import { adbPath, runCapture, runOrThrow } from "./env";
import {
  EXTRA_TRIGGER,
  LYNX_ACTIVITY,
  REMOTE_DIR,
  SAMPLE_DELAYS_MS,
  parseArtifactName,
  pickBestArtifact,
  planWait,
  summarize,
} from "../../scripts/lib/ui-tree-dump-core.mjs";

// ── 树的数据形状（与引擎吐出的 JSON 对齐）─────────────────────────────────

/** 布局盒（`position` 里的 `frameInScreen` / `frameInRoot` 的值形态）。 */
export interface UiTreeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 节点属性。⚠️ `style` 是**对象**（`{ "padding-top": "32px" }`），不是字符串。 */
export interface UiTreeAttributes {
  class?: string[];
  style?: Record<string, string>;
  id?: string;
  [key: string]: unknown;
}

/** 事件绑定（`bindEvent`）。 */
export interface UiTreeEvent {
  eventName?: string;
  [key: string]: unknown;
}

/** 一个 UI 树节点。 */
export interface UiTreeNode {
  id?: string;
  nodeId?: number;
  tag?: string;
  attributes?: UiTreeAttributes;
  position?: {
    frameInScreen?: UiTreeFrame;
    /**
     * 根页坐标系。**本模块不导出它的访问器**——见文件头「坐标口径」：
     * 与像素对照一律用 `frameInScreen`（两套坐标系实测差 81px）。
     */
    frameInRoot?: UiTreeFrame;
  };
  debugInfo?: { nodeIndex?: number };
  events?: UiTreeEvent[];
  children?: UiTreeNode[];
}

// ── 纯查询（不碰 adb ⇒ 可单测）─────────────────────────────────────────────

/** 深度优先遍历，产出全部节点（含根）。 */
export function walkNodes(tree: UiTreeNode): UiTreeNode[] {
  const out: UiTreeNode[] = [];
  const walk = (node: UiTreeNode): void => {
    if (!node || typeof node !== "object") return;
    out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

/** 节点的 class token 列表（缺失时返回空数组）。 */
export function classTokens(node: UiTreeNode): string[] {
  const cls = node.attributes?.class;
  return Array.isArray(cls) ? cls : [];
}

/**
 * 按 class token 定位节点：**全部 token 都命中**才算。
 *
 * 为什么是「全部命中」而不是「任一命中」：class 数组是 Tailwind 类名（如
 * `["absolute","z-30","flex","items-center","bg-primary-container"]`），单个 token
 * （如 `absolute`）在树里命中多处（实测样本 `recommend-page.sample.json`：`absolute`
 * **5** 处 / `z-30` **2** 处 / `flex` **34** 处）⇒ 「任一命中」返回的不是一个元素。
 *
 * @param tokens 必须**全部**出现在该节点 class 里的 token
 */
export function findByClass(tree: UiTreeNode, tokens: readonly string[]): UiTreeNode[] {
  return walkNodes(tree).filter((node) => {
    const own = classTokens(node);
    return tokens.every((t) => own.includes(t));
  });
}

/**
 * 按语义 id 定位节点。
 *
 * ⚠️ id 在树里有**两处**（顶层 `node.id` 与 `node.attributes.id`），二者都取
 * （`node.id || node.attributes.id`）——与 `summarize()` 的口径一致。
 * 实测 140 节点样本上两处**同时**非空的节点有 16 个。
 */
export function findBySemanticId(tree: UiTreeNode, id: string): UiTreeNode[] {
  return walkNodes(tree).filter((node) => (node.id || node.attributes?.id || "") === id);
}

/**
 * 全局放射 FAB **主按钮**的 class 定位口径（三个 token 必须**全部命中**）。
 *
 * ⚠️ 为什么三个 token 而不是一个：`absolute` 在树里命中多处（实测样本 `absolute` **5** 处）、
 * `z-30` 也一样（**2** 处）⇒「任一命中」返回的不是一个元素。
 * 三个合起来在实测样本上**唯一**命中 FAB 主按钮（140 节点样本上恰好 1 个）。
 *
 * 为什么放在共享模块而不是各 spec 各写一份：这是**定位口径**（跨三个 spec 的同一件事），
 * 抄三份就会漂——而漂了的代价是「点空 → 假绿/假红」，且失败信息会指向另一份旧口径。
 */
export const FAB_CLASS_TOKENS = ["absolute", "z-30", "bg-primary-container"] as const;

/**
 * 按 class 定位全局 FAB 主按钮。
 *
 * @throws 命中数 ≠ 1 时抛错（0 = 树里没有它；>1 = 口径漂了，该改 token 组合）
 */
export function findFab(tree: UiTreeNode): UiTreeNode {
  const hits = findByClass(tree, FAB_CLASS_TOKENS);
  if (hits.length !== 1) {
    throw new Error(
      `[android-e2e] 按 class [${FAB_CLASS_TOKENS.join(",")}] 在 UI 树里定位到 ${hits.length} 个节点（应为 1）——` +
        (hits.length === 0
          ? "树里没有全局 FAB：可能页面不是推荐页，或 FAB 尚未挂载"
          : "口径漂了：该 class 组合不再唯一，需重挑 token") +
        (hits.length > 1 ? `：${hits.map((n) => describeNode(n)).join(" | ")}` : ""),
    );
  }
  const frame = screenFrame(hits[0]!);
  if (!frame) {
    throw new Error(`[android-e2e] FAB 节点没有 frameInScreen：${describeNode(hits[0]!)}`);
  }
  return hits[0]!;
}

/**
 * 全局 FAB 主按钮的**圆心**（物理像素）。
 *
 * ⚠️ 这是**实测位置**，不是按 vw 常量推算的位置。推算口径（`transition-geometry.fabCenterPx`）
 *   仍在仓里，但它的输入是「设计常量 + 稳定区高度」⇒ 布局一改就偏（#819 / #920 两次
 *   因推算坐标失准而返工）。树给的是**当下这一帧**的真实盒子。
 */
export function fabCenter(tree: UiTreeNode): { x: number; y: number } {
  const frame = screenFrame(findFab(tree))!;
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

/**
 * 从运行时 UI 树推导「渗色带下界」——页面背景一直画到屏幕顶边的那条带的**下边界**，
 * 即「树里第一个有内容的行的起始 y」。
 *
 * 判据：**全宽**（x=0 且宽 ≥ 屏宽 90%）且 **y>0** 的节点的最小 y。
 * 全宽 ⇒ 它是「横贯整屏的一行内容」（二级 tab / feed 区），不是某个卡片里的小元素。
 *
 * ⚠️ 为什么树能推、像素推不了：像素只知道「这一块是不是底色」，不知道**下一行内容
 * 从哪开始**——那是结构信息。树给结构 ⇒ 采样窗的位置由布局事实决定，而不是靠「采出来
 * 不纯就重校准」这种事后补救。
 *
 * ⚠️ 推不出来时**抛错**，不静默退回任何常量（退回常量会把「布局变了」重新藏进
 * 「纯度不达标」这种含糊的失败信息里）。
 */
export function deriveBleedLowerBound(tree: UiTreeNode, screenWidth: number): number {
  const ys = walkNodes(tree)
    .map((n) => screenFrame(n))
    .filter((f): f is NonNullable<ReturnType<typeof screenFrame>> => f !== null)
    .filter((f) => f.x === 0 && f.width >= screenWidth * 0.9 && f.y > 0)
    .map((f) => f.y);
  if (ys.length === 0) {
    throw new Error(
      "[android-e2e] 运行时 UI 树里找不到「全宽且非零起始 y」的节点 ⇒ 推导不出渗色带下界。" +
        "（若树里只有根节点，多半是抓到了半成品树——先确认用的是 4000ms 那份）",
    );
  }
  return Math.min(...ys);
}

/**
 * 由树推导页面底色的采样窗：y 区间 = 渗色带 `[0, 渗色带下界)`，x 区间 = 人工校准的中央带。
 *
 * @param xRanges 采样窗的 x 区间（**树看不见系统状态栏元素**——状态栏时钟 / 系统图标
 *   不在 Lynx 树里 ⇒ x 区间只能人工校准；y 区间交给树）
 */
export function surfaceWindowsFromTree(
  tree: UiTreeNode,
  screenWidth: number,
  xRanges: readonly { x0: number; x1: number }[],
): { x0: number; y0: number; x1: number; y1: number }[] {
  const lower = deriveBleedLowerBound(tree, screenWidth);
  return xRanges.map((r) => ({ x0: r.x0, y0: 0, x1: r.x1, y1: lower }));
}

/**
 * 按**文本内容**定位节点。
 *
 * ⚠️ 文本在树里的位置是**节点的 `attributes.text`**（引擎把渲染文本挂在属性上），
 * 不是节点自身的 `text` 字段。
 *
 * 用途：把「按坐标常量点某个字」改成「按这个字的真实位置点」——坐标常量是**推算**
 * 的（#819 / #920 两次因推算失准而返工），文本是**事实**。
 */
export function findByText(tree: UiTreeNode, text: string): UiTreeNode[] {
  return walkNodes(tree).filter((node) => {
    const value = node.attributes?.["text"];
    return typeof value === "string" && value === text;
  });
}

/**
 * 节点的**屏幕坐标**布局盒。
 *
 * ⚠️ 只认 `frameInScreen`（见文件头「坐标口径」）。缺失时返回 `null`——
 * 不静默回退到 `frameInRoot`（那会让断言挂在一个偏了 81px 的盒上）。
 */
export function screenFrame(node: UiTreeNode): UiTreeFrame | null {
  return node.position?.frameInScreen ?? null;
}

/** 节点绑定的事件名（去重、保持出现顺序）。 */
export function nodeEventNames(node: UiTreeNode): string[] {
  const names: string[] = [];
  for (const ev of node.events ?? []) {
    const name = typeof ev?.eventName === "string" ? ev.eventName : null;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 节点是否绑定了某个事件名（如 `tap`）。 */
export function nodeHasEvent(node: UiTreeNode, eventName: string): boolean {
  return nodeEventNames(node).includes(eventName);
}

/** dp → 物理像素（`densityScale` = `wm density` / 160，pictelio_ui 上 = 3）。 */
export function dpToPx(dp: number, densityScale: number): number {
  return Math.round(dp * densityScale);
}

/**
 * pictelio_ui 的 density scale（`wm density` = 480 ⇒ 480/160 = **3**）。
 *
 * ⚠️ 为什么单独抽一个常量：三个 spec 的「触控目标 ≥48dp」判据同形，把 `3` 写死在
 *   三处就是**三份可漂移的副本**（`ui-tree.ts` 自己的注释写过这条：「这是定位口径，
 *   抄三份就会漂」）。密度本身由 `assertDeviceGeometry`（`pixel.ts`）逐台校验
 *   `wm density` 匹配 `/480/` ⇒ 写死 480 推出的 3 是**有依据的**，不是随手取的魔数。
 *
 * ⚠️ **三个 spec 用它的方式并不完全一样**（#1047 第 3 轮 Standards 轴 N3 订正）：
 *   `fab-hit-testing` / `transition-matrix` **直接**用本常量；
 *   `md3-visual-tokens` 用**设备实读**的 `wm density`（初值取自本常量）——
 *   那是个**更强**的口径（以设备为准），且因为 `assertDeviceGeometry` 钉死 480，
 *   两者今天**相等**。⇒ 「改这里 = 改三处」的准确说法是「**改这里 = 改三处硬编码
 *   里的那一份**」；**不是**「三处都只由它决定」。
 */
export const PINNED_DENSITY_SCALE = 3;

/**
 * 把失败信息里的**作品 id**脱敏。
 *
 * ⚠️ 为什么：语义 id 形如 `pictelio-hero-source-<illustId>`，**含真实作品 id**
 *   （生产侧见 `packages/app-lynx/src/composables/heroTransition.ts`）。e2e 的失败
 *   信息会被贴进 issue ⇒ 作品 id 会外发。仓库的既有立场一致：入库 fixture 把作品
 *   id 数字、标题/作者名文本全部脱敏（`tests/fixtures/ui-tree/recommend-page.sample.json`）。
 * ⇒ 只脱敏**连续 3 位以上的数字**（作品 id 是长数字串）；语义 id 的可读部分
 *   （`pictelio-hero-source`）保留 —— 「这是哪一类节点」的信息不丢。
 * ⚠️ `g` 标志承载「**每一段都脱敏**」这条契约，不是装饰（去掉 `g` ⇒ 多段 id 漏第二段；**机制可达、但泄漏的不是作品 id**，已登记为 ADR-0223 §3.4 失效面 ⑪）。
 * ⚠️ `nodeId`（引擎分配的内核序号）是**定位节点**的关键，**不脱敏**——它是序号，
 *   不是作品 id。
 */
function redactArtworkId(id: string): string {
  return id.replace(/\d{3,}/gu, "<n>");
}

/**
 * 取节点的语义 id 并**脱敏**。
 *
 * ⚠️ 为什么要有类型兜底（#1047 第 3 轮 Standards 轴 N6）：`id` 来自引擎吐出的 JSON，
 *   类型**不保证**是 string（今天实测是 string，但引擎某天改成数字型就会让
 *   `.replace` 抛 `TypeError` ⇒ 把一条可读的断言失败变成崩溃）。
 *   ⇒ 非字符串一律 `String(...)` 化（数字 id 转成字符串后再脱敏）。
 *
 * ⚠️ **返回值已经是脱敏后的**（#1047 第 4 轮 Standards 轴 S-N5）：调用方**直接用**，
 *   **不要**再套一层 `redactArtworkId(...)` —— 同一份 id 在同一文件里脱敏两次
 *   看着无害（`\d{3,}` → `<n>` 是幂等的），但那是两份同形逻辑，正是本文件
 *   自己反复强调要避免的「抄两份就会漂」。
 */
function redactedIdOf(node: UiTreeNode): string {
  const raw = node.id || node.attributes?.id;
  if (raw === undefined || raw === null) return "";
  return redactArtworkId(typeof raw === "string" ? raw : String(raw));
}

/** 节点的一行描述（进断言失败信息用）。 */
export function describeNode(node: UiTreeNode): string {
  const f = screenFrame(node);
  const frame = f ? `frame=(${f.x},${f.y},${f.width},${f.height})` : "frame=(缺失)";
  const id = redactedIdOf(node);
  const events = nodeEventNames(node);
  return [
    `tag=${node.tag ?? "?"}`,
    `nodeId=${node.nodeId ?? "?"}`,
    id ? `id=${id}` : null,
    frame,
    events.length ? `events=[${events.join(",")}]` : null,
    `class=[${classTokens(node).join(" ")}]`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ── 共享的树断言（跨 spec 的同一件事 ⇒ 只有一份）────────────────────────────

/**
 * FAB 的**树断言**——「在不在 / 能不能点 / 盒子多大 / 有没有越出内容区」四条判据。
 *
 * ## 为什么是共享函数而不是各 spec 各写一段
 *
 * 这组判据在 `fab-hit-testing-regression` 与 `transition-matrix` 里**完全同形**
 * （#1047 第 6 轮 Standards 轴实测：归一化后 32 行 vs 32 行，只差变量名与消息前缀）。
 * 而本文件自己反复强调「抄三份就会漂」（见 `FAB_CLASS_TOKENS` 的注释）⇒
 * **判据必须只有一份**，否则改了一处、另一处就静默留着旧口径。
 *
 * ## 判据清单（每条都有存在的理由）
 *
 * | 判据 | 挡住什么 |
 * |---|---|
 * | 按 class **唯一**命中 | 定位口径漂了（token 组合不再唯一） |
 * | 绑定了 `tap` 事件 | 「点得动」这条契约没了 |
 * | `frameInScreen` 存在 | 坐标口径用错（`frameInRoot` 与它差 81px） |
 * | 宽 / 高 ≥ 48dp | 触控目标尺寸不达标 |
 * | 盒右缘 ≤ 内容区右界 | **坐标系用错**（`frameInRoot` ⇒ 右缘 1115 > 1080 ⇒ 转红） |
 * | 盒下缘 ≤ 内容区下界 | 同上（纵向） |
 *
 * ⚠️ 最后两条**不是装饰**：「盒多大 / 有没有 tap 事件」那几条对坐标系替换
 *   **完全不敏感**（box 尺寸两套坐标系一样）⇒ 没有它们，坐标系用错时门禁是绿的。
 *
 * ⚠️ **刻意不含**「点击坐标 ∈ 屏幕盒」那类断言：点击坐标就是这个节点的盒中心
 *   （树值对树值）⇒ 结构上不可能失败 ⇒ 那是恒真断言（#1047 第 3 轮 Standards 轴 B1）。
 *   「点到的到底是不是那个元素」由**独立来源**回答。
 *
 * @param tree 抓回来的运行时 UI 树
 * @param opts `prefix` = 各 spec 的场景标识（如「R2：」，空串表示不加前缀）；
 *   `contentRight` / `contentBottom` = 内容区右界 / 下界（物理像素）；
 *   `densityScale` = 触控目标门限用的 dp→px 比例（默认 `PINNED_DENSITY_SCALE`）
 * @returns 树给的**布局盒**——调用方还要用它做像素侧对照（`expectVisibleWithinLayout`）
 */
export interface FabTreeAssertOptions {
  /** 失败信息前缀（各 spec 自带场景标识，如「R2：」）；空串表示不加前缀。 */
  prefix?: string;
  /** 内容区右界（物理像素）——树给的盒右缘不得越过。 */
  contentRight: number;
  /** 内容区下界（物理像素）——树给的盒下缘不得越过。 */
  contentBottom: number;
  /**
   * 触控目标门限用的 dp→px 比例。
   *
   * ⚠️ 默认 `PINNED_DENSITY_SCALE`（3）——密度由 `assertDeviceGeometry` 钉在 480。
   *   `md3-visual-tokens` 传**设备实读**的 density（那边同时要把 dp 值打印进证据），
   *   两者在 density=480 时**同值** ⇒ 口径不变，只是取值来源不同。
   */
  densityScale?: number;
}

/**
 * 见 {@link FabTreeAssertOptions}。
 *
 * ⚠️ **「判据只有一份」的准确范围**（#1047 第 7 轮 Standards 轴 S-N2 实测校准）：本函数覆盖
 *   **FAB 的几何与可点性判据**（7 条）。三个消费方里：
 *   - `fab-hit-testing-regression` / `transition-matrix` ⇒ **完全**用它；
 *   - `md3-visual-tokens` 的 **A4** ⇒ 用它 + 自己两条独有判据（宽 ≤ 屏宽 80% /
 *     盒上界仍在旧粗扫描域内）；
 *   - `md3-visual-tokens` 的 **A3** ⇒ **仍内联**它自己的三条（唯一命中 / 有 frame /
 *     绑了 `tap`）——那三条回答的是**另一个问题**（「主题切换不改布局与可点性」），
 *     且要对**两个主题态各跑一遍** ⇒ 已登记为 ADR §3.4 登记表的 `ui-tree.test.ts` + `ui-tree.io.test.ts` 那一行**失效面 ⑨**。
 */
export function assertFabTree(tree: UiTreeNode, opts: FabTreeAssertOptions): UiTreeFrame {
  const p = opts.prefix ?? "";
  const hits = findByClass(tree, FAB_CLASS_TOKENS);
  expect(hits, `${p}按 class 定位主 FAB 应唯一`).toHaveLength(1);
  const node = hits[0]!;
  expect(nodeHasEvent(node, "tap"), `${p}FAB 节点未绑定 tap 事件：${describeNode(node)}`).toBe(
    true,
  );
  const f = screenFrame(node);
  expect(f, `${p}FAB 节点缺 frameInScreen：${describeNode(node)}`).not.toBeNull();
  // 触控目标门限：density 由 assertDeviceGeometry 钉在 480 ⇒ 1dp = 3px
  // （`3` 只写在 `PINNED_DENSITY_SCALE` 一处；抄三份会漂）
  const minPx = dpToPx(48, opts.densityScale ?? PINNED_DENSITY_SCALE);
  expect(f!.width, `${p}FAB 布局盒宽 ${f!.width}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(
    minPx,
  );
  expect(f!.height, `${p}FAB 布局盒高 ${f!.height}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(
    minPx,
  );
  expect(
    f!.x + f!.width,
    `${p}FAB 盒右缘 ${f!.x + f!.width}px 越过内容区右界 ${opts.contentRight}px` +
      `（若这是 frameInRoot，坐标系用错了——两套坐标系实测差 81px）`,
  ).toBeLessThanOrEqual(opts.contentRight);
  expect(
    f!.y + f!.height,
    `${p}FAB 盒下缘 ${f!.y + f!.height}px 越过内容区下界 ${opts.contentBottom}px`,
  ).toBeLessThanOrEqual(opts.contentBottom);
  return f!;
}

// ── 设备侧：触发 → 等落齐 → pull → 解析 ──────────────────────────────────

/** 一份抓回来的树产物。 */
export interface UiTreeArtifact {
  /** 设备上的文件名（`ui-tree-<point>-<delayMs>ms-<seq>-<ts>.json`）。 */
  name: string;
  /** 采样点：`cold`（`onLoadSuccess`）/ `hot`（`onNewIntent`）。 */
  point: string;
  /** 采样档位（ms）：0 / 1500 / 4000。 */
  delayMs: number;
  /** 解析后的树。 */
  tree: UiTreeNode;
  /** 节点数（`summarize()` 口径：只数对象节点，null 与数组不计）。 */
  nodeCount: number;
  /** 产物的字节数。 */
  bytes: number;
  /** 本地落盘路径。 */
  localPath: string;
}

/** `captureUiTree` 的参数。 */
export interface CaptureUiTreeOptions {
  /** 本地产物落盘目录（缺省 `<tmp>/pictelio-ui-tree-e2e/<serial>`）。 */
  outDir?: string;
  /** 等落齐的最长时间（ms，缺省 20000）。 */
  waitMs?: number;
  /**
   * 落齐后的静默期（ms，缺省 2500）：把「另一轮迟到」的产物也捞回来。
   * 0 = 不等静默期。
   */
  quietPeriodMs?: number;
  /**
   * 附到同一条 intent 上的**额外** extra 参数（`adb shell am start` 的原样参数，
   * 如 `["--es", "benchNav", "scene-a"]`）。
   *
   * 用于「把抓树合并进该 spec 已经在发的那条导航 intent」——抓到的树正好是被断言
   * 的那个状态。见文件头「抓树不破坏被测状态」。
   */
  extraArgs?: readonly string[];
}

/** `captureUiTree` 的结果。 */
export interface CaptureUiTreeResult {
  /** 本次触发新增的全部产物（按文件名排序）。 */
  artifacts: UiTreeArtifact[];
  /** **最完整的那一份**（节点数多者胜；同数比档位，再同比字节）——断言用这份。 */
  best: UiTreeArtifact;
  /** 三档是否落齐（`planWait` 判据）。 */
  settled: boolean;
  /** 是否等超时。 */
  timedOut: boolean;
}

/** 轮询间隔（ms）。 */
const POLL_INTERVAL_MS = 300;
/** 落齐后的静默期（ms）。 */
const QUIET_PERIOD_MS = 2500;
/** 静默期里连续多少次轮询没有新增即认为静默。 */
const QUIET_STREAK_POLLS = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 触发一次抓树：向 `LynxActivity` 发一条带 `uiTreeDump=1` 的 intent。
 *
 * ⚠️ `am start` 在「Activity 已在跑」时会打印
 * `Activity not started, intent has been delivered to currently running top-most instance`
 * ——那是**成功**（intent 已投递 ⇒ 走 `onNewIntent`），不是失败。exit 0 即视为成功。
 *
 * @param extraArgs 附到同一条 intent 上的额外参数（见 `CaptureUiTreeOptions.extraArgs`）
 */
export function triggerUiTreeDump(serial: string, extraArgs: readonly string[] = []): void {
  const args = [
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-n",
    LYNX_ACTIVITY,
    "--es",
    EXTRA_TRIGGER,
    "1",
    ...extraArgs,
  ];
  const r = runCapture(adbPath(), args);
  if (r.code !== 0) {
    throw new Error(
      `[android-e2e] 触发 UI 树抓取失败（adb exit ${r.code}）: ${r.stderr || r.stdout || "(无输出)"}`,
    );
  }
}

/**
 * 列出设备上已有的本通道产物文件名（目录不存在 ⇒ 空数组）。
 *
 * ⚠️ 目录不存在是**正常状态**（首次触发前宿主侧还没建目录），不是降级 ⇒ 静默返回空数组。
 * 其它失败形态（adb 报错、设备掉线）会 `console.warn` ——**禁静默降级**。
 */
export function listRemoteArtifacts(serial: string): string[] {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "ls", "-1", REMOTE_DIR]);
  if (r.code !== 0) {
    if (!/No such file or directory/iu.test(r.stderr + r.stdout)) {
      console.warn(
        `[android-e2e] 列目录失败（adb exit ${r.code}）: ${r.stderr || r.stdout || "(无输出)"}`,
      );
    }
    return [];
  }
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".json"));
}

/**
 * 拍一张「设备上当前有哪些产物」的快照。
 *
 * 用途：识别「本次抓取新增的产物」。**合并进既有 intent** 的场景必须由调用方在
 * 发那条 intent **之前**取快照（本函数不会替你取，因为那一刻还没发生）。
 */
export function snapshotRemoteArtifacts(serial: string): Set<string> {
  return new Set(listRemoteArtifacts(serial));
}

/**
 * 等产物落齐并拉回（**不触发**抓取）。
 *
 * 用于「把 `uiTreeDump=1` 合并进该 spec 已经在发的那条 intent」的场景：那条 intent
 * 已经触发了采样点 ⇒ 这里只等产物落盘 + 拉回，**不再另发一条 intent**
 * （另发会覆盖 Activity 的 intent ⇒ 把 benchNav 深链之类的目标冲掉）。
 *
 * @param before 触发前的产物快照（用 `snapshotRemoteArtifacts` 取）
 */
export async function collectUiTree(
  serial: string,
  opts: { before: Set<string>; outDir?: string; waitMs?: number; quietPeriodMs?: number },
): Promise<CaptureUiTreeResult> {
  const waitMs = opts.waitMs ?? 20_000;
  const quietPeriodMs = opts.quietPeriodMs ?? QUIET_PERIOD_MS;
  const outDir = opts.outDir ?? join(tmpdir(), "pictelio-ui-tree-e2e", serial);
  const before = opts.before;

  const deadline = Date.now() + waitMs;
  let appeared: string[] = [];
  let settled = false;
  while (Date.now() < deadline) {
    appeared = listRemoteArtifacts(serial).filter((f) => !before.has(f));
    settled = planWait(appeared, SAMPLE_DELAYS_MS).settled;
    if (settled) break;
    await sleep(POLL_INTERVAL_MS);
  }
  const timedOut = !settled;
  if (timedOut) {
    console.warn(
      `[android-e2e] UI 树采样未落齐（${waitMs}ms 内只等到 ${appeared.length} 份）——` +
        `缺档位意味着「最完整的那一份」可能没到。已到的档位：${planWait(appeared, SAMPLE_DELAYS_MS).seenDelays.join(",") || "(无)"}`,
    );
  }

  // 静默期：把迟到的另一轮产物也捞回来（命中两个采样点时两轮的 4s 档几乎同时落盘）。
  if (settled && quietPeriodMs > 0) {
    const known = new Set(appeared);
    const quietDeadline = Math.min(Date.now() + quietPeriodMs, deadline);
    let quietStreak = 0;
    while (Date.now() < quietDeadline) {
      await sleep(POLL_INTERVAL_MS);
      const all = listRemoteArtifacts(serial).filter((f) => !before.has(f));
      const fresh = all.filter((f) => !known.has(f));
      if (fresh.length > 0) {
        for (const f of fresh) known.add(f);
        appeared = all;
        quietStreak = 0;
      } else {
        quietStreak += 1;
        if (quietStreak >= QUIET_STREAK_POLLS) break;
      }
    }
  }

  mkdirSync(outDir, { recursive: true });
  const artifacts: UiTreeArtifact[] = [];
  for (const name of appeared.toSorted()) {
    const pulled = pullArtifact(serial, name, outDir);
    if (pulled) artifacts.push(pulled);
  }
  if (artifacts.length === 0) {
    throw new Error(
      `[android-e2e] UI 树抓取未产出任何产物（${waitMs}ms 内）——` +
        "排查顺序：① App 是否为 DEBUG 包（release 无此能力）② logcat 里是否有" +
        "「UI 树抓取请求已受理」③ 设备上的 " +
        `${REMOTE_DIR} 是否可写`,
    );
  }

  const best = pickBest(artifacts);
  // 成功路径的观测出口：落齐与否只在异常时才有 warn ⇒ 正常运行时从日志查不到
  // 「这次抓树到底等齐没有」。这行把它与最完整那份的元数据一起打出来。
  console.log(
    `[android-e2e] UI 树抓取：${artifacts.length} 份产物，落齐=${settled ? "是" : "否"}` +
      `（超时=${timedOut ? "是" : "否"}）；最完整的一份 = ${best.name}` +
      `（${best.point} 采样点 / ${best.delayMs}ms 档 / ${best.nodeCount} 节点 / ${best.bytes} 字节）`,
  );
  return { artifacts, best, settled, timedOut };
}

/**
 * 抓一份运行时 UI 树（**自己发触发 intent**）。
 *
 * 流程：记录触发前的产物集合 → 触发 → 按**已知采样档位**等落齐（不是靠「计数不变」猜，
 * 那是诊断脚本踩过的坑：窗口 1.2s < 档位间隔 2.5s，必然丢 4s 那份完整树且静默）
 * → 静默期捞回迟到产物 → 逐份 `adb pull` → 解析 → 选出最完整的一份。
 *
 * ⚠️ 若要**合并进该 spec 已经在发的那条 intent**（推荐：不动 Activity 的 intent），
 *   改用 `snapshotRemoteArtifacts` + `collectUiTree` 两步。
 *
 * @throws 产物一份都没拿到时抛错（**不返回空树**——空树会让断言「找不到节点」时
 *   报出误导性的失败信息）。
 */
export async function captureUiTree(
  serial: string,
  opts: CaptureUiTreeOptions = {},
): Promise<CaptureUiTreeResult> {
  const before = snapshotRemoteArtifacts(serial);
  triggerUiTreeDump(serial, opts.extraArgs);
  return collectUiTree(serial, {
    before,
    outDir: opts.outDir,
    waitMs: opts.waitMs,
    quietPeriodMs: opts.quietPeriodMs,
  });
}

/**
 * 「采样是否落齐」这条判据的**共享入口**（#1047 第 9 轮 Standards 轴 S-N2 收口）。
 *
 * 落齐判据的**本体**在 lib 层（`planWait`），而「把没落齐这件事说清楚」此前由三个消费
 * spec **各写一份**同形的 `expect(captured.settled, "…").toBe(true)`——只有场景前缀不同。
 * ⇒ 判据本体与失败信息这两件事本该各只有一份，收口到此处。
 *
 * ⚠️ **为什么必须进断言**（#1047 第 1 轮 Spec 轴）：只在模块里 warn 是不够的——
 *   断言失败信息必须直接说清「没等齐」，否则下游「找不到节点」会报出**误导性**的失败信息
 *   （半成品树 ≠ 树里没有那个节点）。
 *
 * @param captured `captureUiTree` 的结果
 * @param prefix 场景前缀（**必填**，如「Me 页」「benchNav recommended」「主界面」）——⚠️ 「非空」目前只是
 *   文档化约束、**无机器防线**（传空串仍能编译 ⇒ 失败信息退化成「：UI 树采样未落齐…」，少了场景标识；
 *   见 ADR-0223 §3.4 登记表的 `ui-tree.test.ts` + `ui-tree.io.test.ts` 那一行**失效面 ⑦**）。必填是刻意的（#1047 第 11 轮 Standards 轴 S-R11-N1 / Spec 轴 F1）：
 *   那一行登记的契约是「失败信息带场景前缀」，而 prefix 一旦可选、就有调用点会漏传 ⇒ 交给编译期保证（漏传即 `tsc` 报错），不再靠自觉
 * @throws 采样未落齐 ⇒ 断言失败（信息里带 `prefix`）
 */
export function expectSettled(captured: CaptureUiTreeResult, prefix: string): void {
  expect(
    captured.settled,
    `${prefix}：UI 树采样未落齐（0/1500/4000 三档未齐）⇒ 最完整的那份可能没到`,
  ).toBe(true);
}

/**
 * 选「最完整的那一份」：节点数多者胜；同数比**档位**（4s 那份通常是完整树），
 * 再同比字节。
 *
 * ⚠️ 规则本体在 `scripts/lib/ui-tree-dump-core.mjs` 的 `pickBestArtifact`——
 * 诊断脚本 `dump-ui-tree.mjs` 与本模块**共用同一份**（两处各写一份排序规则时，
 * 一旦键序改了就会选出不同的产物，而「最完整的那份」正是断言要挂的那份 ⇒
 * 分叉的症状与「树抓坏了」无法区分）。
 */
export function pickBest(artifacts: readonly UiTreeArtifact[]): UiTreeArtifact {
  const best = pickBestArtifact(artifacts.map((a) => ({ ...a })));
  if (!best) {
    throw new Error("[android-e2e] pickBest：产物集合为空（没有可比的产物）");
  }
  return best;
}

/**
 * 拉回一份产物并解析。拉取失败 / 拉回后本地无文件 / JSON 非法 ⇒ `console.warn` 后返回
 * `null`（**不静默**：调用方会看到「这份产物没拿到」）。
 *
 * ⚠️ 拉取走 `env.runOrThrow`（与本模块其它 adb 调用同一个接缝）——不是直接
 * `execFileSync`：直接 spawn 就**没法在单测里顶掉**，IO 边界的失败路径将永远没有
 * 机器防线（测试硬约束 #1「IO 边界测试强制覆盖」）。先例：`unit/prefs.devLogin.test.ts`。
 */
function pullArtifact(serial: string, name: string, outDir: string): UiTreeArtifact | null {
  const local = join(outDir, name);
  try {
    runOrThrow(adbPath(), ["-s", serial, "pull", `${REMOTE_DIR}/${name}`, local]);
  } catch (e) {
    console.warn(
      `[android-e2e] UI 树产物拉回失败：${name} ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
  if (!existsSync(local)) {
    console.warn(`[android-e2e] UI 树产物拉回后不在本地：${name}`);
    return null;
  }
  const bytes = statSync(local).size;
  let tree: UiTreeNode;
  try {
    tree = JSON.parse(readFileSync(local, "utf8")) as UiTreeNode;
  } catch (e) {
    console.warn(
      `[android-e2e] UI 树产物不是合法 JSON：${name}（${e instanceof Error ? e.message : String(e)}）`,
    );
    return null;
  }
  const parsed = parseArtifactName(name);
  return {
    name,
    point: parsed?.point ?? "?",
    delayMs: parsed?.delayMs ?? -1,
    tree,
    nodeCount: summarize(tree).nodeCount,
    bytes,
    localPath: local,
  };
}
