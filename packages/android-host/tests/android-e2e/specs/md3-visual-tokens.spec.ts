// @vitest-environment node
/**
 * MD3 视觉令牌 · A 类断言（issue #852；决策来源 ADR-0205/0206/0207、术语 `docs/adr/glossary-md3-alignment.md`）。
 *
 * ## 这个 spec 证什么 / 不证什么（先读这一段再看代码）
 *
 * **证**（A 类，机器可判、判据是具体数值）：
 *  1. 令牌色值真的渲染到屏上：页面底色命中 `surface` 令牌的**具体 RGB 邻域**（±6/通道）；
 *  2. 明暗切换真的换了色板：暗色底色命中暗色 `surface`，且 L\* 差 ≥ 40；
 *  3. 主题色真的可切：`settings_theme_color=violet` 后主 CTA 色带命中 violet 色板；
 *  4. 主 CTA 的**可见包围盒** ≥ 48dp 且 ≤ 屏宽 80%。
 *
 * **不证**（B/C 类，**树与像素都答不了**，不是「暂时没做」而是「做不了」）：
 *  - **颜色 / 圆角 / 状态层 alpha / 对比度**：运行时 UI 树给的是**布局盒**与**结构**，
 *    **给不出颜色**——实测 140 节点样本上 `attributes.style` 只覆盖 51/140，其键集里
 *    **没有** `border-radius` / `background-color` / `color` / `opacity`，且 `background`
 *    的值是 `var(--md-…)` **引用**而非计算值 ⇒ 这几类量一律留像素。
 *  - 观感类（排版节奏、elevation 观感、图标观感、整体贴合度）机器判不了，
 *    仍须人眼兜底 —— 详见 `README.md` §机器断言覆盖面。
 *
 * ## 树与像素的分工（#1047 引入 · ADR-0223 运行时 UI 树通道）
 *
 * ⚠️ 本文件头此前写的是「Lynx 拿不到元素边界框 ⇒ B 类只能靠像素」——**该前提已因
 *   ADR-0223 的 UI 树通道落地而失效**（树的 `position.frameInScreen` 140/140 节点可读）。
 *   现在按「各答各的问」分工：
 *
 * | 量 | 树（`../ui-tree`） | 像素 |
 * |---|---|---|
 * | 元素**在不在 / 在哪 / 多大** | ✅ 布局盒 `frameInScreen` | — |
 * | 元素**能不能点** | ✅ `events` 里有 `tap` | — |
 * | 元素**长什么样**（颜色 / 圆角 / alpha） | ❌ | ✅ |
 * | 元素**有没有被盖住 / 真的画出来了吗** | ❌ | ✅ |
 *
 * ⇒ **能用树定位的一律用树定位**（A1/A2 的采样窗位置、A3/A4 的 CTA 位置）；
 *   **树答不了的留像素**（色值、纯度、可见包围盒）。两边**叠加**而非互相替代。
 *
 * ⚠️ **坐标只用 `frameInScreen`**（禁 `frameInRoot`）：两套坐标系实测差 81px
 *   （横向 swiper 滚动偏移），且 `frameInScreen` 与既有像素实测经验值**逐字一致**。
 *   详见 `../ui-tree` 文件头「坐标口径」。
 *
 * ## 不进 CI、不挂发布门
 *
 * 无 `@release-gate` 标记（ADR-0084：发布门是发版前手动跑的那一组），CI 只跑
 * `check:all` / `lint:all` / `test:all`（不含模拟器 E2E）。本 spec 需真机预验证条件：
 * 模拟器可用 + 截图通道稳定。
 *
 * ## 不做登录
 *
 * 只做「启动 + 渲染 + 取样」。**不调 `loginViaDevIntent`、不启 Appium session**：
 * 登录会引入凭据与网络代理两个阻塞（DNS 污染环境下 pixiv API 可达性依赖宿主代理），
 * 与本票要证的视觉令牌无关。代价是**依赖设备上已有登录态**（推荐页才有真实内容可取样），
 * 因此 beforeAll **不做 `pm clear`**（那会清掉 SecureStorage 里的 refresh_token）。
 * 未登录时取到的是登录页底色 —— 判据会转红并在错误信息里指出「没登录」。
 *
 * ## 采样窗（物理像素 1080×2160 口径）
 *
 * ⚠️ **2026-10-03 随 ADR-0216（根页去实体顶栏）整体重校准**。旧窗 `y=[150,290]` 落在
 * 旧的顶栏带上，唯一非底色内容是居中的页面标题；顶栏撤掉后该带被二级 tab 与首屏
 * 内容占据，实测纯度掉到 0.363 / 0.368 ⇒ A1/A2 转红。详见「采样窗」区块的推导。
 *
 * 现窗落回 Root 的 `padding-top = safeTop` 渗色带（y<72），并避开状态栏系统元素：
 *  - 状态栏时钟占 x≈60..300、系统图标占 x≈840..1020（实测该两段纯度 0.72~0.94）→
 *    窗只取中央 x∈[360,840)；
 *  - 触摸十字（跟随触点，adb `input tap/swipe` 会留标记）→ 本 spec **不发任何触摸事件**；
 *  - 手势条（y>2016）与内容区（y≥72 为二级 tab / feed）→ 窗取 y∈[0,48)；
 *  - 详情页图片加载失败区 → 本 spec 只停留在推荐页，不进详情页。
 * - ~~benchNav 调试 HUD 的 FPS 条~~：**该 HUD 已不复存在**。2026-10-03 带
 *   `BENCH_NAV=1` 的帧实测 y=0..40 全宽均为纯 surface（无任何叠加条），
 *   旧注释「顶部约 y<120，横跨全宽」是失效描述。保留删除线以免下一个人照它避让。
 *
 * ⚠️ **坐标系陷阱（父会话 2026-09-30 实测踩坑）**：看图工具返回的是**显示尺寸**
 * （约 1000×2000）并附「×1.08 还原」的提示，而 `adb exec-out screencap` 的帧缓冲是
 * **物理 1080×2160**。本 spec 全部坐标取自设备侧与令牌推导，不经看图工具；任何把看图
 * 坐标喂回 `input tap` 的操作必须先 ×1.08。见 `pixel.ts` 文件头与 README。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureEmulator } from "../avd";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, LYNX_ACTIVITY, REPO_ROOT, runCapture, runOrThrow } from "../env";
import { CONTENT_BOTTOM } from "../transition-geometry";
import {
  assertDebugApkInstalled,
  currentTopActivity,
  forceStopApp,
  loginViaDevIntent,
  readAppLogcat,
  readPrefs,
  seedAppearance,
  startMainActivity,
} from "../prefs";
import {
  assertDeviceGeometry,
  boxesOf,
  cielabLightness,
  colorAt,
  contrastRatio,
  screenshot,
  toPixels,
  type Box,
  type Pixels,
  type Rgb,
} from "../pixel";
import {
  FAB_CLASS_TOKENS,
  captureUiTree,
  describeNode,
  dpToPx,
  findByClass,
  findFab,
  nodeHasEvent,
  screenFrame,
  surfaceWindowsFromTree,
  type UiTreeNode,
} from "../ui-tree";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── AVD pin（仿 transition-matrix / fab 回归 / lynx-bookmark-tags）──────────
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui";
const SKIP_REASON = `采样窗与包围盒常量绑定 pictelio_ui（物理 1080×2160 / density 480），当前 ANDROID_E2E_AVD=${TARGET_AVD}`;
if (SKIPPED) {
  console.log(`[md3-visual-tokens] SKIP: ${SKIP_REASON}`);
}

/** 证据落盘目录（gitignore，仅本地取证） */
const EVIDENCE_DIR = resolve(
  REPO_ROOT,
  "packages/android-host/test-results/android-e2e/md3-visual-tokens",
);
mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── 采样窗（物理像素；推导依据写在各自注释里，见文件头「采样窗」）──────────
/**
 * 屏幕物理宽度（px）。`assertDeviceGeometry` 已断言设备就是 1080×2160 / density 480
 * ⇒ 这里取常量而不是再问一次设备：窗口推导的基准必须是**确定值**，否则同一份树
 * 在两次运行里推出不同的窗。
 */
const SCREEN_W = 1080;

/**
 * 页面底色采样窗的 **x 区间** ×2（中央带内左右各一）。
 *
 * **落在 Root 的 `padding-top = safeTop` 渗色带上**：根页 `topInset: 'bleed'`
 * （ADR-0216）⇒ 页面背景一直画到屏幕顶边，故 y<72 在**任何主题/明暗**下都是纯
 * `--md-surface`，既不压在插画上、也不受 feed 加载进度影响。
 *
 * **2026-10-03 重校准（ADR-0216 撤掉根页实体顶栏的直接后果）**
 * 旧窗 `{40,150,300,290} / {800,150,1040,290}` 落在旧顶栏带，其非底色内容只有
 * 居中页面标题（故注释写「标题占 x≈450..640，分左右两窗避开」）。顶栏撤掉后：
 *   - y=80..200 是二级 tab 的 `--md-surface-container-lowest`（#ffffff），
 *   - y≥220 是 feed 内容（实测浅色帧 0.363 / 暗色帧 0.368 纯度），
 *   ⇒ 旧窗必然压到内容。另实测**底部同样不可用**：y=1600..1720 在浅色帧是深色插画
 *     （纯度 0.6~0.85）、在暗色帧恰是纯 surface —— 同位置两帧结论相反，说明该带是
 *     **内容相关**的，不能作采样区。
 *
 * **为什么落在中央而不是两侧**：实测（带 `BENCH_NAV=1` 的真实帧）y∈[0,50) 内
 * 逐 60px 分段的纯度：x=0..60 与 x=1020..1080 为 1.00；x=360..780 **连续七段均 1.00**；
 * x=60..300（状态栏时钟）与 x=840..1020（系统图标）为 0.72~0.94。旧设计分左右两窗正是
 * 为躲开居中标题，而该标题已随顶栏撤除 ⇒ **中央反而是全宽最干净的一段**。
 * 窗取中央两段（各宽 220px；**高由树推导**，见下），既避开系统元素，
 * 又保留「采两处」降低蒙对概率。
 *
 * **x 区间仍靠人工校准、y 区间改由树推导**（#1047）：
 *   · **y 下界** ⇒ 树推导（`deriveBleedLowerBound`）：树里第一个「全宽且非零起始 y」
 *     的节点就是「渗色带」的下边界（实测 72，与 `safeTop` 吻合）⇒ 布局变了（内容上移）
 *     窗会**跟着走**，不再需要「实测纯度掉到 0.363 ⇒ 手工重校准」。
 *   · **x 区间** ⇒ 树**看不见**：状态栏时钟 / 系统图标是**系统 UI**，不在 Lynx 树里
 *     ⇒ 仍靠上面那段人工校准的实测值。
 *
 * 期望值仍直接取 `tokens.css` 的 `.theme-sky` / `.theme-sky.dark` 的 `--md-surface`，
 * **不是**从实现反推；变异验证（改令牌值必须让 A1/A2 转红）见该文件提交说明。
 */
const SURFACE_WINDOW_X_RANGES = [
  { x0: 380, x1: 600 },
  { x0: 620, x1: 840 },
] as const;

/** 采样窗（物理像素矩形）。 */
interface SurfaceWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 主 CTA（全局放射 FAB 主按钮）的**树定位**口径 = 共享模块的 `FAB_CLASS_TOKENS`
 * （三个 token 全部命中才唯一；口径本体在 `../ui-tree`，三个 spec 共用一份）。
 */

/**
 * 主 CTA（全局放射 FAB 主按钮）的**像素扫描域**下界高度：内容区右下 320px。
 *
 * ⚠️ **#1047 起，扫描域本身改由树给出**（见 `ctaScanRegionFromTree`）：树的
 * `frameInScreen` 精确到像素（实测 CTA 盒 = (872,1808,162,162)），比「右下 1/2 屏宽 ×
 * 底部 320px」这种粗域精确得多，且**不依赖 FAB 尺寸常量**。
 *
 * 本常量保留作**对照**：它同时是「树推导的扫描域必须落在旧粗域内」这条断言的基准
 * （扫描域越界 ⇒ 布局变了，树推导与旧口径打架 ⇒ 转红而不是各自说了算）。
 */
const CTA_SCAN_H = 320;

/**
 * 由一个**布局盒**推出像素扫描域（外扩 `margin` 像素）。
 */
function scanRegionOf(
  frame: { x: number; y: number; width: number; height: number },
  margin: number,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: frame.x - margin,
    y0: frame.y - margin,
    x1: frame.x + frame.width + margin,
    y1: frame.y + frame.height + margin,
  };
}

/**
 * 由树给出 CTA 的像素扫描域 = **树的布局盒**（可外扩 `margin` 像素）。
 *
 * 为什么可以直接用布局盒当扫描域：布局盒是 CTA **应该**被画的位置；在这块里找
 * 「与 `--md-primary-container` 相近的连通域」，量到的就是**实际画出来的可见区域**。
 * ⇒ 树负责「它应该在哪」，像素负责「它真的画出来没有、画全了没」，两者一交一答。
 *
 * ⚠️ **`margin` 不是装饰，是判据的前提**（#1047 review 第 1 轮 Standards 轴抓出、
 *   第 2 轮实测复现）：扫描域**恰好等于**布局盒时，`boxesOf` 产出的包围盒**必然**
 *   是扫描域的子集 ⇒「可见盒 ⊆ 布局盒」那几条断言**结构上恒真**，永远转不了红
 *   （它守的恰恰是「画到盒外」这个被裁掉的方向）。
 * ⚠️ **但外扩量必须严格大于断言容差**（第 2 轮实测抓出：外扩量 == 容差时，
 *   量到的像素域与断言允许域**逐字相同** ⇒ 仍然恒真）。⇒ 见 `SCAN_MARGIN`。
 *
 * 旧口径（右下 1/2 屏宽 × 底部 320px）会把插画里的大片近似色扫进来 ⇒ 只能取
 * 「最大连通域」来抗干扰；树给出精确盒后，连通域选择不再是唯一的抗干扰手段。
 */
function ctaScanRegionFromTree(
  tree: UiTreeNode,
  margin = 0,
): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  return scanRegionOf(screenFrame(findFab(tree))!, margin);
}

/** 颜色命中容差（每通道）。实测三个态的令牌色都**逐位精确**渲染（偏差 0），
 *  ±6 是给 PNG 解码 / 色彩管理引入的亚像素抖动的余量，不是「差不多就行」。 */
const COLOR_TOL = 6;
/** 连通域匹配容差（每通道），比 COLOR_TOL 略宽：扫描域里可能有插画里的大片近似色。 */
const CTA_TOL = 3;
/** 采样窗纯度下限：窗内众数色占比低于此值说明窗压到了内容/叠层，取样口径失效 → 转红。 */
const PURITY_MIN = 0.95;

/**
 * 「屏不是空白」判据：整帧中**明显偏离 surface** 的像素占比下限。
 *
 * ⚠️ 为什么必须有这条（2026-10-03 实测教训）：采样窗落在 Root 的渗色带，那条带在
 *   **任何页面**上都是纯 `--md-surface` —— 包括登录页、加载中的空白页。于是
 *   「屏上什么都没有」也会让 A1/A2 满足「纯度 ≥0.95 + 色值命中令牌」而**空洞转绿**
 *   （实测：32KB 纯色帧，4 条全过）。登录（beforeAll）能挡掉「未登录」，但挡不住
 *   「已登录但内容还没渲染出来」—— 那正是骨架/空屏。
 * ⇒ 采样窗只能证明「底色被画对了」，**证明不了「页面有内容」**；这条补上后半句。
 *
 * 阈值 0.05 取自实测：发现页有 feed 插画时远超此值（>0.2），
 * 纯色空白屏为 0。留足余量以免正常渲染的波动误伤。
 */
const NON_BLANK_MIN_RATIO = 0.05;

/** 帧内「明显偏离 surface」的像素占比（逐 8px 采样，控制开销） */
function nonSurfaceRatio(p: Pixels, surface: Rgb): number {
  let n = 0;
  let total = 0;
  for (let y = 0; y < p.h; y += 8) {
    for (let x = 0; x < p.w; x += 8) {
      const [r, g, b] = colorAt(p, x, y);
      total++;
      // 用色差而非「不等于」：压缩/色彩管理会带来几个色阶的抖动
      if (
        Math.max(Math.abs(r - surface[0]), Math.abs(g - surface[1]), Math.abs(b - surface[2])) > 24
      )
        n++;
    }
  }
  return total === 0 ? 0 : n / total;
}
/** 每条断言连采的帧数（多帧采样兜底：单帧可能是骨架屏或半渲染中间态）。 */
const FRAMES_PER_SAMPLE = 3;
/** 连采间隔（ms）。要大于一次「首屏 + 懒加载首图」的可见抖动周期。 */
const FRAME_INTERVAL_MS = 800;
/** 明暗 L\* 差下限（票面要求 ≥40）。实测 92.1（98.25 vs 6.11），留一倍余量。 */
const LSTAR_GAP_MIN = 40;
/**
 * 主题切换后主 CTA 色带与**原**色板的最大通道差下限。
 *
 * ⚠️ 票面写的是「≥30/通道」，但真实令牌值不支持逐通道 ≥30：
 * `--md-primary-container` sky `#cfe5ff` → violet `#e9ddff` 的逐通道差是
 * **+26 / −8 / 0**（蓝通道两色同为 `#ff`）。写成逐通道 ≥30 等于写一条**恒假的断言**。
 * 真实可判的形态见 A3：命中 violet 令牌本身（±6）是强判据，本条只作「确实变了」的
 * 下限，取 20（实测 26，余量 6）。
 */
const THEME_DELTA_MIN = 20;

// ── 令牌读取（单一事实源 = packages/app-lynx/src/styles/tokens.css）────────
const TOKENS_CSS = resolve(REPO_ROOT, "packages/app-lynx/src/styles/tokens.css");
/** 顶层规则块（`选择器 { … }`）。tokens.css 的值里不含花括号（渐变是 `linear-gradient(...)`），正则切块安全。 */
const CSS_BLOCKS = [...readFileSync(TOKENS_CSS, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)];

/**
 * 从 tokens.css 读某个色板块里的十六进制颜色令牌。
 *
 * **为什么动态读、而不是把 hex 写死在测试里**：色板由
 * `scripts/generate-theme-palettes.mjs` 生成、随 M3 基线调整而变；测试里写死 hex
 * 等于在测试里维护第二份色板，改令牌时测试会「莫名其妙地红」或者更糟——默默放过。
 * 这里是纯函数 + 单一事实源，令牌改了断言自动跟着走。
 *
 * @param selector 精确选择器 token，如 `.theme-sky` / `.theme-sky.dark` / `.theme-violet`
 * @param name 令牌名，如 `--md-surface`
 */
function readToken(selector: string, name: string): Rgb {
  for (const [, head, body] of CSS_BLOCKS) {
    const selectors = head
      .split(/[,\s]+/u)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;
    // ⚠️ 不要给 `-` 加 `\-` 转义：带 `u` 标志的 `new RegExp` 里 `\-` 是**非法转义**（SyntaxError）。
    // 令牌名里唯一有正则含义的字符就是 `-`，而它在正则里本来就无需转义。
    const m = new RegExp(`^\\s*${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "mu").exec(body);
    if (m?.[1]) return hexToRgb(m[1]);
  }
  throw new Error(
    `[md3-visual-tokens] 在 ${TOKENS_CSS} 的 \`${selector}\` 块里读不到 ${name}——` +
      "色板块的选择器或令牌名变了，先核对 tokens.css（测试不内置兜底色：兜底色 = 假绿）",
  );
}

function hexToRgb(hex: string): Rgb {
  const h =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function fmt(rgb: Rgb): string {
  return `rgb(${rgb.join(",")})`;
}

/** 逐通道差是否 ≤ `tol` */
function near(a: Rgb, b: Rgb, tol: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
  );
}

/** 逐通道差的向量（用于把实测差值打进失败信息） */
function delta(a: Rgb, b: Rgb): Rgb {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
const maxAbs = (v: Rgb): number => Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));

// ── 帧内取样原语 ──────────────────────────────────────────────────────────
/**
 * 窗口内出现最多的颜色 + 其占比（纯度）。
 *
 * 用**众数**而不是均值/中心点：均值会被任何一块非底色像素拉偏（隐式要求「窗里
 * 只有一个东西」），中心点则赌位置。众数的纯度同时暴露了「窗压到内容了」这种失效。
 */
function modalColor(
  p: Pixels,
  r: { x0: number; y0: number; x1: number; y1: number },
): {
  rgb: Rgb;
  purity: number;
} {
  const counts = new Map<string, { rgb: Rgb; n: number }>();
  for (let y = r.y0; y < r.y1; y += 4) {
    for (let x = r.x0; x < r.x1; x += 4) {
      const rgb = colorAt(p, x, y);
      const key = rgb.join(",");
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { rgb, n: 1 });
    }
  }
  let best: { rgb: Rgb; n: number } | null = null;
  let total = 0;
  for (const v of counts.values()) {
    total += v.n;
    if (!best || v.n > best.n) best = v;
  }
  return { rgb: best?.rgb ?? [0, 0, 0], purity: total === 0 ? 0 : best!.n / total };
}

/**
 * 可见盒必须落在**布局盒**内（容差 `tol` px）。
 *
 * ⚠️ 抽成函数的原因（#1047 review 第 2 轮）：负向对照要拿**同一个判据**跑
 * 「把布局盒缩小 ⇒ 必红」——判据内联在 `it` 里就没法被复用，两份拷贝又会长歪。
 *
 * @param box 实测可见包围盒（像素）
 * @param layout 布局盒（**树给的** `frameInScreen`）
 * @param tol 允许的越界量（圆角与抗锯齿的边缘像素）
 */
function expectVisibleWithinLayout(
  box: Box,
  layout: { x: number; y: number; width: number; height: number },
  tol: number,
): void {
  expect(
    box.x0,
    `可见盒左界 ${box.x0} 越出布局盒左界 ${layout.x}（容差 ${tol}px）`,
  ).toBeGreaterThanOrEqual(layout.x - tol);
  expect(
    box.y0,
    `可见盒上界 ${box.y0} 越出布局盒上界 ${layout.y}（容差 ${tol}px）`,
  ).toBeGreaterThanOrEqual(layout.y - tol);
  expect(
    box.x1,
    `可见盒右界 ${box.x1} 越出布局盒右界 ${layout.x + layout.width - 1}（容差 ${tol}px）`,
  ).toBeLessThanOrEqual(layout.x + layout.width - 1 + tol);
  expect(
    box.y1,
    `可见盒下界 ${box.y1} 越出布局盒下界 ${layout.y + layout.height - 1}（容差 ${tol}px）`,
  ).toBeLessThanOrEqual(layout.y + layout.height - 1 + tol);
}

/**
 * 扫描域内与目标色最近的**最大连通域**的包围盒。
 *
 * 为什么取「最大连通域」而不是「所有命中像素的 min/max 包围盒」：推荐页是一整幅
 * 插画，画面上完全可能存在与 `--md-primary-container` 相差 ≤3 的浅蓝色块；用全局
 * min/max 会把它并进包围盒，量出来的就不是按钮了。取最大连通域则天然抗这种干扰。
 *
 * @param yLimit 扫描域下界（负向对照用它把域裁半，模拟「只渲染了一半」）
 */
function largestBoxOfColor(
  p: Pixels,
  r: { x0: number; y0: number; x1: number; y1: number },
  target: Rgb,
  tol: number,
  yLimit = r.y1,
): Box | null {
  const pts: [number, number][] = [];
  for (let y = r.y0; y < yLimit; y += 1) {
    for (let x = r.x0; x < r.x1; x += 1) {
      if (near(colorAt(p, x, y), target, tol)) pts.push([x, y]);
    }
  }
  if (pts.length === 0) return null;
  return boxesOf(pts, 8).toSorted((a, b) => b.n - a.n)[0] ?? null;
}

// ── 设备编排 ──────────────────────────────────────────────────────────────
let serial = "";
/** 设备原始 `CapacitorStorage.xml` 原文：afterAll 原样写回，别把别人的设备改脏。 */
let originalPrefsXml = "";
let densityScale = 3;

async function waitForTopActivity(activity: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = currentTopActivity(serial);
    if (last === activity) return;
    await SLEEP(1_000);
  }
  throw new Error(
    `等待前台 Activity ${activity} 超时（${timeoutMs / 1000}s），当前: ${last ?? "未知"}`,
  );
}

/** 等待 Lynx 渲染就绪（logcat `onPageChanged|OnPatchFinishForFiber`，与另三个 spec 同口径）。 */
async function waitForLynxRenderReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/onPageChanged|OnPatchFinishForFiber/u.test(readAppLogcat(serial))) return;
    await SLEEP(1_000);
  }
  throw new Error(`等待 Lynx 渲染就绪超时（${timeoutMs / 1000}s）`);
}

/**
 * 播种外观 → 重启 → 等渲染 → **抓 UI 树** → 连采 N 帧**已收敛**的帧返回。
 *
 * 收敛判据 = 连续 3 帧同时满足：①底色众数**完全相同**（不是「彼此接近」——完全相同才说明
 * 画面真的停住了，接近会把缓慢渐变当成已收敛）；②**画面已有内容**（非底色像素占比
 * 达 NON_BLANK_MIN_RATIO）。
 *
 * ⚠️ 条件②是 2026-10-03 补的，且**是改采样窗的连带后果**：采样窗移到 Root 渗色带后，
 *   那条带是**静态**的 —— 只看①的话，第一批帧（内容尚未渲染完）就会「收敛」，
 *   于是采到骨架/空屏帧。旧窗压在内容上时①隐含了②，收敛才真的代表画面稳定。
 *   实测：A1/A2 因此采到 0.018 非底色占比的近纯色帧。
 *   ②同时充当票面要求的「多帧采样兜底」：单帧可能是骨架屏/半渲染中间态。
 *
 * ⚠️ **抓树排在采像素帧之前**（#1047）：采样窗的位置由树推导 ⇒ 必须先有树。
 *   抓树走 hot 采样点（`am start` + `uiTreeDump=1`）⇒ `singleTask` 下 Activity
 *   **不重建**、页面不重载 ⇒ 不影响随后的像素采样（页面仍是同一屏）。
 */
async function relaunchAndSample(
  label: string,
): Promise<{ pixels: Pixels[]; surface: Rgb; tree: UiTreeNode; windows: SurfaceWindow[] }> {
  forceStopApp(serial);
  await SLEEP(500);
  runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
  startMainActivity(serial);
  await waitForTopActivity(LYNX_ACTIVITY);
  await waitForLynxRenderReady();
  await SLEEP(2_000);

  // ① 树：hot 采样点抓一份（`am start` + `uiTreeDump=1`，不重建 Activity）
  const captured = await captureUiTree(serial, {
    outDir: resolve(EVIDENCE_DIR, "ui-tree", label),
  });
  // 落齐判据**进断言**（#1047 review 第 1 轮 Spec 轴）：采样未落齐 ⇒「最完整的那份」
  // 可能没到（缺 4s 档）⇒ 半成品树会让下游「找不到节点」报出**误导性**的失败信息。
  // 只在模块里 warn 是不够的：断言失败信息必须直接说清「没等齐」。
  expect(
    captured.settled,
    `${label}：UI 树采样未落齐（0/1500/4000 三档未齐）⇒ 最完整的那份可能没到`,
  ).toBe(true);
  const tree = captured.best.tree;
  // ② 采样窗：由树推导（布局变了窗跟着走，不再靠「纯度不达标 ⇒ 手工重校准」）
  const windows = surfaceWindowsFromTree(tree, SCREEN_W, SURFACE_WINDOW_X_RANGES);
  console.log(
    `[md3-visual-tokens] ${label} 树：${captured.best.name}（${captured.best.point} 采样点 / ` +
      `${captured.best.delayMs}ms 档 / ${captured.best.nodeCount} 节点 / ${captured.best.bytes}B）` +
      ` ⇒ 渗色带下界 ${windows[0]?.y1}px，采样窗 ${JSON.stringify(windows)}`,
  );

  const frames: Pixels[] = [];
  const surfaceOf = (p: Pixels): Rgb => modalColor(p, windows[0]!).rgb;
  // 最多采 10 帧拿到 3 帧一致；拿不到就返回最后 3 帧（后续断言会带着实测值转红）
  for (let i = 0; i < 10 && frames.length < FRAMES_PER_SAMPLE * 3; i++) {
    frames.push(await toPixels(screenshot(serial, `${label}-f${i}`, EVIDENCE_DIR)));
    const recent = frames.slice(-FRAMES_PER_SAMPLE);
    if (
      recent.length === FRAMES_PER_SAMPLE &&
      recent.every(
        (p) =>
          surfaceOf(p).join() === surfaceOf(recent[0]).join() &&
          nonSurfaceRatio(p, surfaceOf(recent[0])) >= NON_BLANK_MIN_RATIO,
      )
    ) {
      console.log(
        `[md3-visual-tokens] ${label} 在第 ${i + 1} 帧收敛` +
          `（连采 3 帧底色一致 = ${fmt(surfaceOf(recent[0]))}，且画面已有内容 ` +
          `非底色占比 ${nonSurfaceRatio(recent[0], surfaceOf(recent[0])).toFixed(3)}）`,
      );
      return { pixels: recent, surface: surfaceOf(recent[0]), tree, windows };
    }
    await SLEEP(FRAME_INTERVAL_MS);
  }
  console.warn(
    `[md3-visual-tokens] ${label} 采满 10 帧仍未收敛（底色一致但画面无内容，或一直不稳定），` +
      "返回最后 3 帧——后续断言会带着实测值转红",
  );
  const tail = frames.slice(-FRAMES_PER_SAMPLE);
  return { pixels: tail, surface: surfaceOf(tail[0]), tree, windows };
}

describe.skipIf(SKIPPED)(
  `MD3 视觉令牌 A 类断言（issue #852，pictelio_ui）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    beforeAll(async () => {
      const r = await ensureEmulator(TARGET_AVD);
      serial = r.serial;
      // 坐标 / 采样窗按 pictelio_ui 校准，几何漂移必须快速失败（否则静默取错窗）
      assertDeviceGeometry(serial, {
        contentHeight: CONTENT_BOTTOM,
        consumer: "本 spec 的采样窗与 CTA 扫描域",
      });
      const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
      densityScale = Number(/\d+/u.exec(density)?.[0] ?? 0) / 160;
      if (!(densityScale > 0)) throw new Error(`无法解析设备密度：${density}`);

      assertDebugApkInstalled(serial);
      await buildDebugApk(); // ANDROID_E2E_SKIP_BUILD=1 时跳过
      await installApk(serial);
      // ⚠️ 2026-10-03 改为**主动登录**，此前依赖「设备上已有登录态」。
      //   依赖环境状态的做法已被实测证伪：同批的 `settings-sync-contract` 会
      //   `pm clear` 模拟升级前设备，若它排在本 spec 之前，本 spec 就对着
      //   **未登录 / 空白屏**取样 —— 而登录页与空白屏同样是 `--md-surface`，
      //   ⇒ A1/A2 会**空洞地转绿**（实测：帧仅 32KB 纯色，却 4 条全过）。
      //   主动登录让本 spec 不再依赖同批 spec 的执行顺序与设备残留状态。
      await loginViaDevIntent(serial);
      originalPrefsXml = readPrefs(serial).rawXml;
    }, 1_500_000);

    afterAll(() => {
      // 恢复设备原始外观：直接把备份的 XML 写回去，避免把别人的设备留在 violet/dark
      try {
        if (originalPrefsXml) {
          const b64 = Buffer.from(originalPrefsXml, "utf8").toString("base64");
          runCapture(adbPath(), [
            "-s",
            serial,
            "shell",
            `run-as io.pictelio.app sh -c 'echo ${b64} | base64 -d > shared_prefs/CapacitorStorage.xml'`,
          ]);
        }
      } catch (e) {
        console.warn(
          `[md3-visual-tokens] 恢复原始 prefs 失败（不影响判定结果）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });

    it("A1 浅色：页面底色命中 surface 令牌的具体 RGB 邻域（非「非黑即非白」）", async () => {
      const want = readToken(".theme-sky", "--md-surface");
      const darkWant = readToken(".theme-sky.dark", "--md-surface");
      seedAppearance(serial, { themeColor: "sky", darkMode: "light" });
      const { pixels, surface, windows } = await relaunchAndSample("a1-sky-light");

      // 前置：屏上必须有内容。采样窗在渗色带上，**任何**页面（含登录页/空屏）都满足
      // 「纯度达标 + 色值命中」⇒ 缺这条时空屏会空洞转绿（见 NON_BLANK_MIN_RATIO 注释）。
      for (const [i, p] of pixels.entries()) {
        const ratio = nonSurfaceRatio(p, surface);
        expect(
          ratio,
          `A1 第 ${i} 帧非底色像素占比 ${ratio.toFixed(3)} < ${NON_BLANK_MIN_RATIO}` +
            " —— 屏幕近乎纯色，说明页面**没有内容**（未登录 / 白屏 / 骨架未渲染）。" +
            "此时底色断言即使通过也不说明问题：登录页与空屏同样是 --md-surface",
        ).toBeGreaterThanOrEqual(NON_BLANK_MIN_RATIO);
      }

      for (const [i, p] of pixels.entries()) {
        for (const w of windows) {
          const { rgb, purity } = modalColor(p, w);
          expect(
            purity,
            `A1 第 ${i} 帧采样窗 ${JSON.stringify(w)} 纯度 ${purity.toFixed(3)} < ${PURITY_MIN}` +
              " —— 窗压到了内容/叠层，取样口径失效（布局变了或采样窗该重校准）",
          ).toBeGreaterThanOrEqual(PURITY_MIN);
          expect(
            near(rgb, want, COLOR_TOL),
            `A1 第 ${i} 帧窗 ${JSON.stringify(w)} 实测 ${fmt(rgb)}，期望 ${fmt(want)} ±${COLOR_TOL}/通道` +
              `（逐通道差 ${delta(rgb, want).join(",")}）。令牌值取自 tokens.css .theme-sky --md-surface。`,
          ).toBe(true);
        }
      }
      console.log(
        `[md3-visual-tokens] A1 底色实测 ${fmt(surface)} / 期望 ${fmt(want)} ±${COLOR_TOL}`,
      );

      // ── 负向对照：判据不是「什么非黑即非白的颜色都能过」 ──
      // 拿**暗色**色板的 surface 当期望值去判同一份实测值，必须判否。
      // 若这条能判是，说明 COLOR_TOL 大到足以吞掉两种色板之差 → A1 恒绿 = 假绿。
      expect(
        near(surface, darkWant, COLOR_TOL),
        `A1 负向对照失效：实测 ${fmt(surface)} 同时命中了暗色 surface ${fmt(darkWant)}，` +
          "容差过宽，正向断言失去区分力",
      ).toBe(false);
      // 对照用的对比度只作诊断打印，**不作门限**（本仓从未实测过对比度容差，见文件头）
      console.log(
        `[md3-visual-tokens] A1 诊断（不判定）：底色 vs on-surface 对比度 = ` +
          `${contrastRatio(surface, readToken(".theme-sky", "--md-on-surface")).toFixed(2)}:1`,
      );
    }, 180_000);

    it("A2 暗色：底色命中暗色 surface 令牌，且 L* 比浅色低 ≥40", async () => {
      const lightWant = readToken(".theme-sky", "--md-surface");
      const darkWant = readToken(".theme-sky.dark", "--md-surface");
      seedAppearance(serial, { themeColor: "sky", darkMode: "dark" });
      const { pixels, surface, windows } = await relaunchAndSample("a2-sky-dark");

      // 与 A1 同一条前置：暗色空屏同样是纯 --md-surface，会让底色断言空洞转绿
      for (const [i, p] of pixels.entries()) {
        const ratio = nonSurfaceRatio(p, surface);
        expect(
          ratio,
          `A2 第 ${i} 帧非底色像素占比 ${ratio.toFixed(3)} < ${NON_BLANK_MIN_RATIO}` +
            " —— 屏幕近乎纯色，说明页面**没有内容**（未登录 / 白屏 / 骨架未渲染）",
        ).toBeGreaterThanOrEqual(NON_BLANK_MIN_RATIO);
      }

      for (const [i, p] of pixels.entries()) {
        for (const w of windows) {
          const { rgb, purity } = modalColor(p, w);
          expect(
            purity,
            `A2 第 ${i} 帧采样窗 ${JSON.stringify(w)} 纯度 ${purity.toFixed(3)} < ${PURITY_MIN}`,
          ).toBeGreaterThanOrEqual(PURITY_MIN);
          expect(
            near(rgb, darkWant, COLOR_TOL),
            `A2 第 ${i} 帧窗 ${JSON.stringify(w)} 实测 ${fmt(rgb)}，期望暗色 surface ${fmt(darkWant)} ±${COLOR_TOL}/通道` +
              `（逐通道差 ${delta(rgb, darkWant).join(",")}）`,
          ).toBe(true);
        }
      }
      const gap = cielabLightness(lightWant) - cielabLightness(darkWant);
      expect(
        gap,
        `A2 明暗 L* 差 ${gap.toFixed(2)} < ${LSTAR_GAP_MIN}` +
          `（浅色 ${cielabLightness(lightWant).toFixed(2)} / 暗色 ${cielabLightness(darkWant).toFixed(2)}）`,
      ).toBeGreaterThanOrEqual(LSTAR_GAP_MIN);
      console.log(
        `[md3-visual-tokens] A2 底色实测 ${fmt(surface)} / 期望 ${fmt(darkWant)} ±${COLOR_TOL}；` +
          `L* 差 ${gap.toFixed(2)}（门限 ${LSTAR_GAP_MIN}）`,
      );

      // ── 负向对照：把「暗色态」这份**真实失败态**喂给 A1 的亮色判据，必须判否 ──
      // 这是 A1 最有价值的对照：若 A1 换成暗色帧也判过，说明 A1 从没真的在验明暗。
      expect(
        near(surface, lightWant, COLOR_TOL),
        `A2 负向对照失效：暗色帧实测 ${fmt(surface)} 竟然命中了亮色 surface ${fmt(lightWant)}`,
      ).toBe(false);
    }, 180_000);

    it("A3 主题色：settings_theme_color=violet 后主 CTA 色带命中 violet 色板", async () => {
      const skyCta = readToken(".theme-sky", "--md-primary-container");
      const violetCta = readToken(".theme-violet", "--md-primary-container");
      seedAppearance(serial, { themeColor: "sky", darkMode: "light" });
      const before = await relaunchAndSample("a3-before-sky");
      seedAppearance(serial, { themeColor: "violet", darkMode: "light" });
      const after = await relaunchAndSample("a3-after-violet");

      // 扫描域改由**树**给出（#1047）：CTA 的布局盒，而不是「右下 1/2 屏宽 × 底部 320px」
      // 那种粗域 ⇒ 定位精度从「右下角一大片」变成「按钮自己那一块」。
      const scanRegion = (tree: UiTreeNode) => ctaScanRegionFromTree(tree);
      /** 按给定令牌在扫描域里定位 CTA，并回读连通域内的实测众数色。 */
      const measureCta = (
        p: Pixels,
        tree: UiTreeNode,
        token: Rgb,
      ): { box: Box | null; color: Rgb } => {
        const box = largestBoxOfColor(p, scanRegion(tree), token, CTA_TOL);
        return { box, color: box ? modalColor(p, box).rgb : ([-1, -1, -1] as Rgb) };
      };

      // ── 树断言：两个主题态下 CTA 都在树上、都在同一位置、且可点 ──
      // 这是像素答不了的那一问（「元素在不在」）：色板切换只改颜色，不该改位置。
      for (const [tag, s] of [
        ["前态(sky)", before],
        ["后态(violet)", after],
      ] as const) {
        const ctas = findByClass(s.tree, FAB_CLASS_TOKENS);
        expect(ctas, `A3 ${tag}：按 class 定位主 CTA 应唯一`).toHaveLength(1);
        const f = screenFrame(ctas[0]!);
        expect(
          f,
          `A3 ${tag}：CTA 节点缺 frameInScreen（${describeNode(ctas[0]!)}）`,
        ).not.toBeNull();
        expect(
          nodeHasEvent(ctas[0]!, "tap"),
          `A3 ${tag}：CTA 节点没有 tap 事件绑定 —— 全局 FAB 应当可点（${describeNode(ctas[0]!)}）`,
        ).toBe(true);
      }
      const beforeFrame = screenFrame(findByClass(before.tree, FAB_CLASS_TOKENS)[0]!)!;
      const afterFrame = screenFrame(findByClass(after.tree, FAB_CLASS_TOKENS)[0]!)!;
      expect(
        [afterFrame.x, afterFrame.y, afterFrame.width, afterFrame.height],
        `A3 主题切换后 CTA 的位置/尺寸变了：${JSON.stringify(beforeFrame)} → ${JSON.stringify(afterFrame)}` +
          " —— 主题只该改颜色，不该改布局",
      ).toEqual([beforeFrame.x, beforeFrame.y, beforeFrame.width, beforeFrame.height]);

      // 前态按 sky 色板定位、后态按 violet 色板定位：颜色真变了。若还按旧色板去找
      // 就找不到 —— 找不到即转红（**不是**「找不到就跳过」，那是冒充通过）。
      const b0 = measureCta(before.pixels[0], before.tree, skyCta);
      expect(
        b0.box,
        "A3 前态：按 sky 的 --md-primary-container 在 CTA 扫描域里找不到连通域——" +
          "推荐页的全局 FAB 应当恒在；找不到说明色板名取错或 FAB 已不在屏上",
      ).not.toBeNull();
      expect(
        near(b0.color, skyCta, COLOR_TOL),
        `A3 前态实测 ${fmt(b0.color)}，期望 sky ${fmt(skyCta)} ±${COLOR_TOL}`,
      ).toBe(true);

      for (const [i, p] of after.pixels.entries()) {
        const a = measureCta(p, after.tree, violetCta);
        expect(
          a.box,
          `A3 第 ${i} 帧：按 violet 的 --md-primary-container ${fmt(violetCta)} 在 CTA 扫描域里` +
            "找不到连通域——主题类很可能没生效（色板回退成 sky）",
        ).not.toBeNull();
        expect(
          near(a.color, violetCta, COLOR_TOL),
          `A3 第 ${i} 帧实测 ${fmt(a.color)}，期望 violet ${fmt(violetCta)} ±${COLOR_TOL}` +
            `（逐通道差 ${delta(a.color, violetCta).join(",")}）`,
        ).toBe(true);
      }
      const measured = delta(violetCta, skyCta);
      console.log(
        `[md3-visual-tokens] A3 primary-container sky ${fmt(skyCta)}（实测 ${fmt(b0.color)}）→ ` +
          `violet ${fmt(violetCta)}，逐通道差 ${measured.join(",")}，` +
          `最大 ${maxAbs(measured)}（门限 ${THEME_DELTA_MIN}）`,
      );
      expect(
        maxAbs(measured),
        `A3 令牌差 ${maxAbs(measured)} < ${THEME_DELTA_MIN}——` +
          "两个色板的 primary-container 几乎同色，断言区分力不足，先换一组对比更强的色板",
      ).toBeGreaterThanOrEqual(THEME_DELTA_MIN);

      // ── 负向对照 ①：切换前那一帧（真·sky 色板）喂给 violet 判据，必须判否 ──
      // 证明「颜色真的变了」，而不是「本来就长这样」。
      expect(
        near(b0.color, violetCta, COLOR_TOL),
        `A3 负向对照失效：切换前实测 ${fmt(b0.color)} 也命中了 violet ${fmt(violetCta)}`,
      ).toBe(false);
      // ── 负向对照 ②：切换后那一帧（真·violet 色板）喂给 sky 判据，必须判否 ──
      const a0 = measureCta(after.pixels[0], after.tree, violetCta);
      expect(
        near(a0.color, skyCta, COLOR_TOL),
        `A3 负向对照失效：切换后实测 ${fmt(a0.color)} 也命中了 sky ${fmt(skyCta)}`,
      ).toBe(false);
    }, 300_000);

    it("A4 主 CTA：树给布局盒（≥48dp 且 ≤屏宽 80%），像素证它真被画出来", async () => {
      seedAppearance(serial, { themeColor: "sky", darkMode: "light" });
      const { pixels, tree } = await relaunchAndSample("a4-sky-light");
      const cta = readToken(".theme-sky", "--md-primary-container");
      const minPx = dpToPx(48, densityScale);
      const maxWidthPx = Math.round(SCREEN_W * 0.8);

      // ── 树：布局盒（元素「在哪、多大」）──
      // 这一问像素答不了：像素只能反推「长得像按钮的那团颜色」，说不出「这个元素
      // 声明的盒子有多大」——而触控目标尺寸（48dp）是**布局契约**。
      const ctas = findByClass(tree, FAB_CLASS_TOKENS);
      expect(ctas, "A4：按 class 定位主 CTA 应唯一").toHaveLength(1);
      const node = ctas[0]!;
      const frame = screenFrame(node);
      expect(frame, `A4：CTA 节点缺 frameInScreen（${describeNode(node)}）`).not.toBeNull();
      const f = frame!;
      console.log(
        `[md3-visual-tokens] A4 树布局盒 = (${f.x},${f.y},${f.width},${f.height})` +
          ` → ${f.width}×${f.height}px（= ${(f.width / densityScale).toFixed(1)}×${(f.height / densityScale).toFixed(1)}dp）` +
          ` / ${describeNode(node)}`,
      );
      expect(f.width, `A4 树布局盒宽 ${f.width}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(minPx);
      expect(f.height, `A4 树布局盒高 ${f.height}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(
        minPx,
      );
      expect(
        f.width,
        `A4 树布局盒宽 ${f.width}px > 屏宽 80%=${maxWidthPx}px（控件铺满全宽 = 布局异常）`,
      ).toBeLessThanOrEqual(maxWidthPx);
      expect(
        f.x + f.width,
        `A4 树布局盒右界 ${f.x + f.width} 越过屏宽 ${SCREEN_W}`,
      ).toBeLessThanOrEqual(SCREEN_W);
      expect(
        f.y + f.height,
        `A4 树布局盒下界 ${f.y + f.height} 越过内容区底界 ${CONTENT_BOTTOM}`,
      ).toBeLessThanOrEqual(CONTENT_BOTTOM);
      // 树推导的位置必须仍落在旧粗扫描域内 —— 两条口径打架 = 布局变了，转红而不是各说各的
      expect(
        f.y,
        `A4 树布局盒上界 ${f.y} 越出旧粗扫描域上界 ${CONTENT_BOTTOM - CTA_SCAN_H} —— 布局已变`,
      ).toBeGreaterThanOrEqual(CONTENT_BOTTOM - CTA_SCAN_H);

      // ── 像素：可见区域（元素「真被画出来没有」）──
      // 扫描域 = 树给的布局盒**外扩 SCAN_MARGIN** ⇒ 画到盒外的像素会进扫描域，
      // 下面「可见盒 ⊆ 布局盒」那几条才是**真判据**（扫描域恰等于布局盒、或外扩量
      // 等于容差时，量到的盒必然落在允许域内 ⇒ 恒真、转不了红）。
      // 画全了 ⇒ 可见盒 ≈ 布局盒；被裁 / 没画 ⇒ 可见盒小于布局盒 ⇒ 下面 ≥48dp 判红。
      /** 可见盒允许比布局盒大 2px（圆角与抗锯齿的边缘像素），超出这个量就是画到了盒外。 */
      const EDGE_TOL = 2;
      /**
       * 像素扫描域的外扩量（px）——**必须严格大于 `EDGE_TOL`**。
       *
       * ⚠️ 为什么不等于容差就够（第 2 轮 Standards 轴实测：外扩量 = 容差 = 2 时，
       *   扫描域是 `[f.x-2, f.x+w+2)`（上界排他）⇒ 可量到的像素恰在
       *   `[f.x-2, f.x+w+1]`，而断言允许的域是 `[f.x-2, f.x+w-1+2]` = **同一个区间**
       *   ⇒ 四条断言**结构上恒真**（实测：把 CTA 画到盒外 10px 仍全绿）。
       *   严格大于 ⇒ 画到盒外超过容差时可见盒会越界 ⇒ 断言才能转红。
       *
       * ⚠️ 代价（如实登记）：外扩越大 ⇒ 扫描域里相邻近似色被并入的风险越高
       *   ⇒ 仍靠「最大连通域」抗干扰；`SCAN_MARGIN` 远大于 `EDGE_TOL` 是为此留的余量。
       */
      const SCAN_MARGIN = 8;
      const region = ctaScanRegionFromTree(tree, SCAN_MARGIN);
      for (const [i, p] of pixels.entries()) {
        const box = largestBoxOfColor(p, region, cta, CTA_TOL);
        expect(box, `A4 第 ${i} 帧：CTA 扫描域内找不到 ${fmt(cta)} 的连通域`).not.toBeNull();
        const b = box as Box;
        const w = b.x1 - b.x0 + 1;
        const h = b.y1 - b.y0 + 1;
        console.log(
          `[md3-visual-tokens] A4 第 ${i} 帧 CTA 可见 bbox = (${b.x0},${b.y0})-(${b.x1},${b.y1})` +
            ` → ${w}×${h}px（= ${(w / densityScale).toFixed(1)}×${(h / densityScale).toFixed(1)}dp）`,
        );
        expect(w, `A4 可见宽 ${w}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(minPx);
        expect(h, `A4 可见高 ${h}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(minPx);
        // 可见区域不得明显超出树给的布局盒（画到盒外 = 布局与绘制不一致）
        expectVisibleWithinLayout(b, f, EDGE_TOL);
      }

      // ── 负向对照 ①：把「布局盒」假设为比实测小 4px（= 模拟画到了盒外 4px）──
      // 同一张图、同一扫描逻辑、同一个判据 ⇒ 可见盒必然越出该（缩小的）布局盒
      // 超过容差 ⇒ 判据必红。**若这条不红，说明包含关系判据是恒真的**
      // （结构上不可能失败 ⇒ 它守的其实什么都没守）。
      const shrunk = { x: f.x + 4, y: f.y + 4, width: f.width - 8, height: f.height - 8 };
      const shrunkBox = largestBoxOfColor(
        pixels[0]!,
        scanRegionOf(shrunk, SCAN_MARGIN),
        cta,
        CTA_TOL,
      );
      expect(shrunkBox, "A4 负向对照：缩小布局盒后扫描域里仍应找得到 CTA 连通域").not.toBeNull();
      expect(
        () => expectVisibleWithinLayout(shrunkBox as Box, shrunk, EDGE_TOL),
        "A4 负向对照失效：布局盒缩小 4px 后可见盒仍未越出 ⇒ 「可见盒 ⊆ 布局盒」是恒真断言",
      ).toThrow();

      // ── 负向对照 ②：同一组像素、同一个门限，只把「画了一半」喂进去 ⇒ 必须判红 ──
      // 做法：把扫描域下界裁到 CTA 自身的中线（人为制造半高），同一测量 + 同一门限。
      // ⚠️ 这条证明的是「**门限是所测高度的函数**」：同一张图上，完整测量过门限、
      //   裁半后不过 ⇒ 若实现改成「不看高度、恒判过」，这一条会转红。
      //   它**不**证明「48dp 这个具体数值选得对」——那件事由上面的 `minPx` 断言负责。
      const p = pixels[0]!;
      const full = largestBoxOfColor(p, region, cta, CTA_TOL) as Box;
      const fullH = full.y1 - full.y0 + 1;
      const half = largestBoxOfColor(
        p,
        region,
        cta,
        CTA_TOL,
        Math.floor((full.y0 + full.y1) / 2),
      ) as Box;
      const halfH = half.y1 - half.y0 + 1;
      expect(
        fullH,
        `A4 负向对照失效：完整测量的高度 ${fullH}px 竟不满足 ${minPx}px 门限（对照前提不成立）`,
      ).toBeGreaterThanOrEqual(minPx);
      expect(
        halfH,
        `A4 负向对照失效：裁半后的高度 ${halfH}px 仍 ≥ ${minPx}px，说明 48dp 门限不承重`,
      ).toBeLessThan(minPx);
    }, 180_000);
  },
);
