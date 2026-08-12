import { settings, jsonCodec, type Codec } from "@/settings";
import { viewportWidth } from "@/primitives/viewportWidth";

// ── Types ──

export interface ReaderSettings {
  fontSize: number;
  autoFontSize: boolean;
  fontWeight: number;
  fontFamily: string;
  fontColor: string;
  lineHeight: number;
  bgColor: string;
}

// ── Defaults ──

const DEFAULTS: ReaderSettings = {
  fontSize: 18,
  // 默认即「自动」：按视口宽度自动计算最适字号（用户需求：不分屏高低一律 18）
  autoFontSize: true,
  fontWeight: 400,
  fontFamily: "sans-serif",
  fontColor: "",
  lineHeight: 1.8,
  bgColor: "",
};

export const ALLOWED_FONT_FAMILIES = ["sans-serif", "serif", "system-ui", "monospace"] as const;

const FONT_FAMILIES = [
  { value: "sans-serif", label: "无衬线" },
  { value: "serif", label: "衬线" },
  { value: "system-ui", label: "系统" },
  { value: "monospace", label: "等宽" },
] as const;

const FONT_WEIGHTS = [
  { value: 300, label: "细" },
  { value: 400, label: "常规" },
  { value: 500, label: "中等" },
  { value: 600, label: "半粗" },
  { value: 700, label: "粗" },
] as const;

const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2.0, 2.2] as const;

const FONT_COLORS = ["#1a1a1a", "#5c3e24", "#3a3a3a", "#666666", "#999999"] as const;

const BG_COLORS = ["", "#f5e6c8", "#c7edcc", "#1a1a1a", "#f0f0f0", "#2b2b2b"] as const;

// ── Settings registry 集成 ──
//
// 旧数据格式：localStorage["novel_reader_settings"] = JSON.stringify(ReaderSettings)。
// 现改用统一 settings registry：localStorage 同步后端 + jsonCodec，default 为 DEFAULTS。

const readerSettings = settings.define<ReaderSettings>({
  key: "novel_reader_settings",
  storage: "localStorage",
  codec: jsonCodec as Codec<ReaderSettings>,
  default: DEFAULTS,
  syncInit: true,
});

// 模块加载时同步读（localStorage 同步后端），保证首屏 signal 初始值与持久化值一致。
readerSettings.syncInit();
// 打开 write gate（phase → warm），setter 的 handle.set 才会真正落盘。
void settings.hydrateAll();

// 旧数据可能是部分字段（缺省字段用 DEFAULTS 兜底）。
const initial: ReaderSettings = { ...DEFAULTS, ...readerSettings.value() };

// ── Signal-based store (module-level, shared by NovelDetail and ReaderSettingsSheet) ──

export const [fontSize, setFontSize] = createSignal(initial.fontSize);
export const [autoFontSize, setAutoFontSizeSignal] = createSignal(initial.autoFontSize);
export const [fontWeight, setFontWeight] = createSignal(initial.fontWeight);
export const [fontFamily, setFontFamily] = createSignal(initial.fontFamily);
export const [fontColor, setFontColor] = createSignal(initial.fontColor);
export const [lineHeight, setLineHeight] = createSignal(initial.lineHeight);
export const [bgColor, setBgColor] = createSignal(initial.bgColor);

// ── 自动字号 ──
//
// v3 方案（用户确认，基于酷设计屏幕尺寸库真实设备 dp 分布）：
//   computeAutoFontSize(vw) = round(clamp(14, 14 + (vw - 320) * 0.038, 23))
// - dp（= CSS px，160dpi 基准）即物理宽度代理，PPI/DPR 不参与（CSS px 已自动折算）
// - 系统字体缩放由 WebView textZoom 渲染级整体处理，本期不重复计算
// - 设备对照（注意 round 取整，个别值与直觉档位差 1px）：
//   320→14、360→16、390→17、412→17（14+92×0.038=17.496 四舍五入 17，非 18）、
//   414~428→18、480→20、600+→23（封顶）

export function computeAutoFontSize(viewportWidthPx: number): number {
  const vw = Number.isFinite(viewportWidthPx) ? viewportWidthPx : 0;
  const raw = 14 + (vw - 320) * 0.038;
  return Math.round(Math.min(Math.max(raw, 14), 23));
}

/** 实际生效字号：自动模式下用视口计算值，手动模式用档位值。
 * 纯函数而非 memo：computeAutoFontSize 为 O(1) 算术无缓存收益；在 JSX/effect 内
 * 调用时 Solid 按读取追踪依赖，响应式行为不变；同时避免模块级 createMemo 触发
 * Solid「computation outside createRoot」开发警告。视口宽度来自独立模块
 * @/primitives/viewportWidth（浏览器自动监听 resize，测试可注入）。 */
export function effectiveFontSize(): number {
  return autoFontSize() ? computeAutoFontSize(viewportWidth()) : fontSize();
}

function persistAll(): void {
  readerSettings.set({
    ...readerSettings.value(),
    fontSize: fontSize(),
    autoFontSize: autoFontSize(),
    fontWeight: fontWeight(),
    fontFamily: fontFamily(),
    fontColor: fontColor(),
    lineHeight: lineHeight(),
    bgColor: bgColor(),
  });
}

export function setReaderFontSize(v: number): void {
  setFontSize(v);
  persistAll();
}

export function setReaderAutoFontSize(v: boolean): void {
  setAutoFontSizeSignal(v);
  persistAll();
}

export function setReaderFontWeight(v: number): void {
  setFontWeight(v);
  persistAll();
}

export function setReaderFontFamily(v: string): void {
  setFontFamily(v);
  persistAll();
}

export function setReaderFontColor(v: string): void {
  setFontColor(v);
  persistAll();
}

export function setReaderLineHeight(v: number): void {
  setLineHeight(v);
  persistAll();
}

export function setReaderBgColor(v: string): void {
  setBgColor(v);
  persistAll();
}

// ── CSS variables string for the text container ──

export function readerStyle(): Record<string, string> {
  return {
    "--reader-font-size": `${effectiveFontSize()}px`,
    "--reader-font-weight": String(fontWeight()),
    "--reader-font-family": fontFamily(),
    "--reader-line-height": String(lineHeight()),
    ...(fontColor() ? { "--reader-font-color": fontColor() } : {}),
    ...(bgColor() ? { "--reader-bg-color": bgColor() } : {}),
  } as Record<string, string>;
}

// ── Exports for the Sheet component ──

export { FONT_FAMILIES, FONT_WEIGHTS, LINE_HEIGHTS, FONT_COLORS, BG_COLORS };
export const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 26, 28] as const;
