
// ── Types ──

export interface ReaderSettings {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  fontColor: string;
  lineHeight: number;
  bgColor: string;
}

// ── Defaults ──

const STORAGE_PREFIX = "novel_reader_";

const DEFAULTS: ReaderSettings = {
  fontSize: 18,
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

// ── Storage ──

function loadSettings(): ReaderSettings {
  const [err, stored] = trySync(() => localStorage.getItem(STORAGE_PREFIX + "settings"));
  if (!err && stored) {
    const [parseErr, parsed] = trySync(() => JSON.parse(stored) as Partial<ReaderSettings>);
    if (!parseErr) return { ...DEFAULTS, ...parsed };
  }
  return { ...DEFAULTS };
}

function saveSettings(settings: ReaderSettings): void {
  trySync(() => localStorage.setItem(STORAGE_PREFIX + "settings", JSON.stringify(settings)));
}

// ── Signal-based store (module-level, shared by NovelDetail and ReaderSettingsSheet) ──

const initial = loadSettings();

export const [fontSize, setFontSize] = createSignal(initial.fontSize);
export const [fontWeight, setFontWeight] = createSignal(initial.fontWeight);
export const [fontFamily, setFontFamily] = createSignal(initial.fontFamily);
export const [fontColor, setFontColor] = createSignal(initial.fontColor);
export const [lineHeight, setLineHeight] = createSignal(initial.lineHeight);
export const [bgColor, setBgColor] = createSignal(initial.bgColor);

function persistAll(): void {
  saveSettings({
    fontSize: fontSize(),
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
    "--reader-font-size": `${fontSize()}px`,
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
