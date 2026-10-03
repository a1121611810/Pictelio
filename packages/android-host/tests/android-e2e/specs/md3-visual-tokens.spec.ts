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
 * **不证**（B/C 类，本引擎做不到，**不是「暂时没做」而是「做不了」**）：
 *  - Lynx 4.0.1 **不暴露无障碍树节点**（全仓 199 处 `accessibility-element` 标注也
 *    不出节点，uiautomator dump 在 pictelio_ui 上必被 SIGKILL），`getCSSValue` 对非 DOM
 *    的 Lynx 同样无效 ⇒ **拿不到元素边界框**。触控目标尺寸、圆角、对比度、状态层 alpha
 *    全部只能靠像素测量，而这类度量在本仓**从未实测过、容差无依据** ⇒ 本票一律不塞。
 *  - 观感类（排版节奏、elevation 观感、图标观感、整体贴合度）机器判不了，
 *    仍须人眼兜底 —— 详见 `README.md` §机器断言覆盖面。
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
 * 内容占据，实测纯度掉到 0.363 / 0.368 ⇒ A1/A2 转红。详见 `SURFACE_WINDOWS` 的推导。
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
  readClientPrefs,
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
 * 页面底色采样窗 ×2（中央带内左右各一）。
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
 * 窗取中央两段（各 220×48），既避开系统元素，又保留「采两处」降低蒙对概率。
 *
 * 期望值仍直接取 `tokens.css` 的 `.theme-sky` / `.theme-sky.dark` 的 `--md-surface`，
 * **不是**从实现反推；变异验证（改令牌值必须让 A1/A2 转红）见该文件提交说明。
 */
const SURFACE_WINDOWS = [
  { x0: 380, y0: 0, x1: 600, y1: 48 },
  { x0: 620, y0: 0, x1: 840, y1: 48 },
] as const;

/**
 * 主 CTA（全局放射 FAB 主按钮）的扫描域：内容区右下 1/2 屏宽 × 底部 320px。
 *
 * 选「右下」而非写死一个点，是因为 Lynx 拿不到边界框（见文件头）——只能按
 * **颜色连通域**反推包围盒。`FAB_SIZE_VW = 14.933` → 14.933vw × 1080 = 161px，
 * 加上 `right/bottom = 4.267vw = 46px` 尾随边距，实测恒落在 x 872..1033 / y 1808..1969，
 * 完整含在本网内。扫描域下界用 `CONTENT_BOTTOM`（稳定区 2016）而非全屏 2160，
 * 避免把手势条的死像素算进包围盒（transition-matrix 2026-09-28 踩过同一坑）。
 */
const CTA_SCAN_H = 320;

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
 * 播种外观 → 重启 → 等渲染 → 连采 N 帧**已收敛**的帧返回。
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
 */
async function relaunchAndSample(label: string): Promise<{ pixels: Pixels[]; surface: Rgb }> {
  forceStopApp(serial);
  await SLEEP(500);
  runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
  startMainActivity(serial);
  await waitForTopActivity(LYNX_ACTIVITY);
  await waitForLynxRenderReady();
  await SLEEP(2_000);

  const frames: Pixels[] = [];
  const surfaceOf = (p: Pixels): Rgb => modalColor(p, SURFACE_WINDOWS[0]).rgb;
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
      return { pixels: recent, surface: surfaceOf(recent[0]) };
    }
    await SLEEP(FRAME_INTERVAL_MS);
  }
  console.warn(
    `[md3-visual-tokens] ${label} 采满 10 帧仍未收敛（底色一致但画面无内容，或一直不稳定），` +
      "返回最后 3 帧——后续断言会带着实测值转红",
  );
  const tail = frames.slice(-FRAMES_PER_SAMPLE);
  return { pixels: tail, surface: surfaceOf(tail[0]) };
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
      originalPrefsXml = readClientPrefs(serial).rawXml;
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
      const { pixels, surface } = await relaunchAndSample("a1-sky-light");

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
        for (const w of SURFACE_WINDOWS) {
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
      const { pixels, surface } = await relaunchAndSample("a2-sky-dark");

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
        for (const w of SURFACE_WINDOWS) {
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

      const scanRegion = (p: Pixels) => ({
        x0: Math.floor(p.w / 2),
        y0: CONTENT_BOTTOM - CTA_SCAN_H,
        x1: p.w,
        y1: CONTENT_BOTTOM,
      });
      /** 按给定令牌在扫描域里定位 CTA，并回读连通域内的实测众数色。 */
      const measureCta = (p: Pixels, token: Rgb): { box: Box | null; color: Rgb } => {
        const box = largestBoxOfColor(p, scanRegion(p), token, CTA_TOL);
        return { box, color: box ? modalColor(p, box).rgb : ([-1, -1, -1] as Rgb) };
      };

      // 前态按 sky 色板定位、后态按 violet 色板定位：颜色真变了。若还按旧色板去找
      // 就找不到 —— 找不到即转红（**不是**「找不到就跳过」，那是冒充通过）。
      const b0 = measureCta(before.pixels[0], skyCta);
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
        const a = measureCta(p, violetCta);
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
      const a0 = measureCta(after.pixels[0], violetCta);
      expect(
        near(a0.color, skyCta, COLOR_TOL),
        `A3 负向对照失效：切换后实测 ${fmt(a0.color)} 也命中了 sky ${fmt(skyCta)}`,
      ).toBe(false);
    }, 300_000);

    it("A4 主 CTA 可见包围盒 ≥ 48dp 且 ≤ 屏宽 80%", async () => {
      seedAppearance(serial, { themeColor: "sky", darkMode: "light" });
      const { pixels } = await relaunchAndSample("a4-sky-light");
      const cta = readToken(".theme-sky", "--md-primary-container");
      const minPx = Math.round(48 * densityScale);
      const maxWidthPx = Math.round(1080 * 0.8);

      for (const [i, p] of pixels.entries()) {
        const box = largestBoxOfColor(
          p,
          { x0: Math.floor(p.w / 2), y0: CONTENT_BOTTOM - CTA_SCAN_H, x1: p.w, y1: CONTENT_BOTTOM },
          cta,
          CTA_TOL,
        );
        expect(box, `A4 第 ${i} 帧：CTA 扫描域内找不到 ${fmt(cta)} 的连通域`).not.toBeNull();
        const b = box as Box;
        const w = b.x1 - b.x0 + 1;
        const h = b.y1 - b.y0 + 1;
        console.log(
          `[md3-visual-tokens] A4 第 ${i} 帧 CTA bbox = (${b.x0},${b.y0})-(${b.x1},${b.y1})` +
            ` → ${w}×${h}px（= ${(w / densityScale).toFixed(1)}×${(h / densityScale).toFixed(1)}dp）`,
        );
        expect(w, `A4 宽 ${w}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(minPx);
        expect(h, `A4 高 ${h}px < 48dp=${minPx}px`).toBeGreaterThanOrEqual(minPx);
        expect(
          w,
          `A4 宽 ${w}px > 屏宽 80%=${maxWidthPx}px（控件铺满全宽 = 布局异常）`,
        ).toBeLessThanOrEqual(maxWidthPx);
        expect(
          b.y0,
          `A4 包围盒上界 ${b.y0} 越出 CTA 扫描域上界 ${CONTENT_BOTTOM - CTA_SCAN_H}`,
        ).toBeGreaterThanOrEqual(CONTENT_BOTTOM - CTA_SCAN_H);
        expect(b.y1, `A4 包围盒下界 ${b.y1} 越过内容区底界 ${CONTENT_BOTTOM}`).toBeLessThanOrEqual(
          CONTENT_BOTTOM,
        );
      }

      // ── 负向对照：注入「只渲染了一半」的失败态，门限必须判红 ──
      // 做法：把扫描域下界裁到 CTA 自身的中线（人为制造半高），同一个测量 + 同一组门限。
      // 若这条仍判过，说明 48dp 门限形同虚设 / 测量根本没在看尺寸。
      const p = pixels[0];
      const full = largestBoxOfColor(
        p,
        { x0: Math.floor(p.w / 2), y0: CONTENT_BOTTOM - CTA_SCAN_H, x1: p.w, y1: CONTENT_BOTTOM },
        cta,
        CTA_TOL,
      ) as Box;
      const half = largestBoxOfColor(
        p,
        { x0: Math.floor(p.w / 2), y0: CONTENT_BOTTOM - CTA_SCAN_H, x1: p.w, y1: CONTENT_BOTTOM },
        cta,
        CTA_TOL,
        Math.floor((full.y0 + full.y1) / 2),
      ) as Box;
      const halfH = half.y1 - half.y0 + 1;
      expect(
        halfH,
        `A4 负向对照失效：裁半后的高度 ${halfH}px 仍 ≥ ${minPx}px，说明 48dp 门限不承重`,
      ).toBeLessThan(minPx);
    }, 180_000);
  },
);
