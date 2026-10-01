/**
 * android-e2e 共享像素工具（issue #852 收敛）。
 *
 * ## 为什么收敛
 *
 * `transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags` 三个 spec
 * 各自持有一份**逐字同款**的私有副本：截屏、canvas 解码、单点取色、连通域、
 * 稳定帧等待、设备几何断言。副本散落的后果不是「多了几行代码」，而是
 * **同一个度量有 3 份实现**——修一处漏两处时，失败信息会指向另一份的旧阈值。
 * 本模块是这些工具的**唯一实现**；三个 spec 改为 import（需要绑定 serial /
 * 证据目录的只留一行参数绑定，见各 spec 内的 `screenshot` 包装）。
 *
 * ## 收敛时的纪律（重要）
 *
 * **只搬工具，不改断言**。本模块内每个函数体与收敛前的私有副本**逐字一致**
 * （含阈值、步长、容差），否则既有 e2e 的覆盖面会在一次「重构」里悄悄变窄
 * ——那是比重复代码严重得多的回退。调用点的签名差异用**一行参数绑定**吸收，
 * 断言体本身一个字符未动。
 *
 * ## 坐标系陷阱（#852 实测踩坑，务必先读）
 *
 * `adb exec-out screencap -p` 取回的 PNG 帧缓冲 = **物理像素 1080×2160**，
 * 而任何「看图工具」（含本仓库的 agent 会话里读图）返回的是**显示尺寸**（约
 * 1000×2000）并附一句 `Multiply coordinates by 1.08 to map to original image`。
 * ⇒ **凡是把看图得到的坐标喂回 `adb input tap` 的，必须先 ×1.08 还原到物理像素**，
 * 否则点空（父会话实测：按显示坐标点按钮没触发）。
 * 本模块内部一律使用**物理像素**（`screenshot` 的返回、`colorAt` 的入参、
 * `boxesOf` 的输出），不含任何显示尺寸换算。
 *
 * ## 采样窗必须避开（已知污染，#852）
 *
 * ① benchNav 调试 HUD 的 FPS 条（顶部，约 y<120，横跨全宽）——每次手势都变；
 * ② 触摸十字（跟随触点，adb `input tap/swipe` 会在触点留下标记）；
 * ③ 状态栏（y<72）与手势条（y>2016，稳定区底界）。
 * 采样窗的选取责任在 spec 侧，本模块只提供取色/量度原语。
 */
import { expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "canvas";
import { adbPath, runCapture } from "./env";

/** RGB 三元组（0..255，全整数） */
export type Rgb = [number, number, number];

/** 像素视图（canvas 解码后的 RGBA 原始缓冲） */
export interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** 连通域包围盒（`boxesOf` 输出；`n` = 分量内实心像素数） */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

/** `screenshot` 的证据落盘缓冲上限。Node spawnSync 默认 1MB，
 *  1080×2160 的 PNG 字节流会 ENOBUFS（pictelio_ui 实测）。 */
const SCREENSHOT_MAX_BUFFER = 20 * 1024 * 1024;

/**
 * 截屏（`adb exec-out screencap -p` 直取 PNG 字节流）。
 *
 * 同时给 `name` 与 `evidenceDir` 才落盘——收敛前 `fab-hit-testing-regression` 的
 * `label` 是可选的（不传就不写盘、只参与内存里的 `pngDiff`），另两个 spec 恒落盘；
 * 两种行为由「参数是否给全」自然表达，调用点无需改动。
 */
export function screenshot(serial: string, name?: string, evidenceDir?: string): Buffer {
  const buf = execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: SCREENSHOT_MAX_BUFFER,
  });
  if (name !== undefined && evidenceDir !== undefined) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, `${name}.png`), buf);
  }
  return buf;
}

/** 像素视图解码（canvas `loadImage` + `getImageData`）。 */
export async function toPixels(png: Buffer): Promise<Pixels> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const c2d = canvas.getContext("2d");
  c2d.drawImage(img, 0, 0);
  const { data } = c2d.getImageData(0, 0, img.width, img.height);
  return { w: img.width, h: img.height, data };
}

/** 单点取色（坐标为物理像素，内部取整）。 */
export function colorAt(p: Pixels, x: number, y: number): Rgb {
  const i = (Math.round(y) * p.w + Math.round(x)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}

/** sRGB 通道 → 线性化（WCAG 2.x 相对亮度口径的输入变换）。 */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.x **相对亮度**（0..1，无量纲）——`contrastRatio` 的输入。
 *
 * ⚠️ 它**不是** CIE L\*。两者都常被口语叫作「亮度」，但 L\* 是 0..100 的明度标量、
 * 对感知均匀，而相对亮度是亮度线性化后的加权求和。判「亮暗差 ≥40」这类**明度**
 * 判据须用 L\*（见 `cielabLightness`）；判「对比度是否够 WCAG AA」须用相对亮度。
 * 混用会得到量纲不对的阈值（本仓 #852 初稿就差点这么写）。
 */
export function luminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

/** WCAG 对比度 `(L1 + 0.05) / (L2 + 0.05)`，取 1..21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * CIE L\*（0..100 的明度）。用于「暗色态比亮色态暗 ≥40 L\*」这类**明度差**判据。
 *
 * 分界取 Y = 0.008856（WCAG / CIE 共同口径）：低于它走线性段 `903.3 * Y`，
 * 线上方走立方根段 `116 * Y^(1/3) - 16`。
 */
export function cielabLightness(rgb: Rgb): number {
  const y = luminance(rgb);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/**
 * 8 连通域 + 按 `cell` 像素分桶，返回每个分量的包围盒与实心像素数。
 *
 * 纯函数。收敛自 `lynx-bookmark-tags.findHeartGlyph` 的内联实现（该函数两段式判据
 * 需要复用两次，故先就地提成 `connectedBoxes`；本次收敛把它搬到本模块并改名
 * `boxesOf`，去掉了「只服务于心形定位」的隐含语义）。分桶后按 8 邻接做并查集遍历，
 * `cell` 越大越快、对细连接越不敏感（调用方按元素尺度选）。
 */
export function boxesOf(pts: [number, number][], cell: number): Box[] {
  const cells = new Map<string, [number, number][]>();
  for (const [x, y] of pts) {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push([x, y]);
    else cells.set(key, [[x, y]]);
  }
  const seen = new Set<string>();
  const out: Box[] = [];
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    seen.add(key);
    const comp: [number, number][] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(...(cells.get(cur) ?? []));
      const [cxi, cyi] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cxi + dx},${cyi + dy}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    out.push({
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      n: comp.length,
    });
  }
  return out;
}

/** `waitForStableFrame` 的参数（度量与阈值由调用方给，保持各 spec 原有口径） */
export interface StableFrameOptions {
  /** 证据标签（调用方的 `capture` 通常据此落盘 `stable-<label>.png`） */
  label: string;
  /** 取一帧 */
  capture: () => Promise<Buffer> | Buffer;
  /** 两帧差异度量（调用方自选：区域化 / 全屏 / 步长 / 阈值） */
  diff: (prev: Buffer, cur: Buffer) => Promise<number> | number;
  /** 稳定阈值：差异 ≤ 该值即认为画面已静止 */
  stableThreshold: number;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * 帧稳定等待：连拍两帧，差异 ≤ `stableThreshold` 即认为画面静止，返回后一帧。
 *
 * 用于「列表加载完成」「返回落地」「翻页触底」等无法条件等待的渲染收敛场景。
 * 差异度量与阈值**不内置**：`transition-matrix` 用区域化步长 2 采样 + 阈值 350，
 * 别的 spec 口径不同——内置默认值会让「收敛」顺带改掉既有 spec 的判定强度。
 */
export async function waitForStableFrame(opts: StableFrameOptions): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 1_200;
  const deadline = Date.now() + timeoutMs;
  let prev = await opts.capture();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const cur = await opts.capture();
    if ((await opts.diff(prev, cur)) <= opts.stableThreshold) return cur;
    prev = cur;
  }
  throw new Error(
    `等待画面稳定超时（${opts.label}，${timeoutMs}ms）——证据 stable-${opts.label}.png`,
  );
}

/** `assertDeviceGeometry` 的可选参数 */
export interface DeviceGeometryOptions {
  /**
   * 期望的**稳定区**高度（= Lynx `contentSize.h` 口径）。
   * 省略则**不校验**该项——`lynx-bookmark-tags` 收敛前就只校验分辨率/密度，
   * 补上会改变它在别的 ROM 上的通过/失败，属于「重构顺带改了断言」。
   */
  contentHeight?: number;
  /** 报错文案里的用途描述（原三份副本文案不同，此处参数化） */
  consumer?: string;
}

/**
 * 校验目标设备的分辨率 / 密度 /（可选）稳定区高度。
 *
 * ⚠️ 三项都验、缺一不可（原实现只验 `wm size` / `wm density`，漏掉系统栏高度）：
 * 坐标常量按「稳定区 2016px」推导（见 `transition-geometry.fabCenterPx`），
 * 而 `contentSize.h` 是**稳定区**高度而非全屏 2160。换 ROM 或切换导航模式
 * （gestural ↔ threebutton）会让稳定区高度变化，此时旧常量会**静默点到空处**
 * ——2026-09-28 实测：全屏口径 2033 vs 实际 1889，偏 144px，落在 FAB 盒外。
 * 像素级 UI 断言在坐标错位时表现为「功能坏了」，极易被误判为产品回归。
 */
export function assertDeviceGeometry(serial: string, opts: DeviceGeometryOptions = {}): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);

  if (opts.contentHeight === undefined) return;

  // 稳定区高度（= Lynx contentSize.h 口径，也是坐标常量的 H 基准）
  const displays = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "window",
    "displays",
  ]).stdout;
  const rng = /rng=\d+x\d+-\d+x(\d+)/u.exec(displays);
  expect(
    rng,
    `无法从 dumpsys window displays 解析稳定区高度（坐标常量依赖它）。原始输出片段：${displays
      .split("\n")
      .find((l) => l.includes("rng="))
      ?.trim()}`,
  ).not.toBeNull();
  const contentHeight = Number(rng?.[1]);
  const consumer = opts.consumer ?? "坐标常量";
  expect(
    contentHeight,
    `稳定区高度应为 ${opts.contentHeight}（状态栏 72 + 手势条 72 之外）；实测 ${contentHeight}。` +
      `${consumer}按 ${opts.contentHeight} 校准，换 ROM 或切换导航模式后需重新校准` +
      `（gestural ↔ threebutton 会改变底部系统条高度）。`,
  ).toBe(opts.contentHeight);
}
