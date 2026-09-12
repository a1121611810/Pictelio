/**
 * 筛选状态 ↔ webview URL query 编解码（spec §6.3 键表）。
 * webview 搜索是全页路由，URL 是「会话内保留」的实际载体（#476 Q5）。
 * 键：fp=期间预设 / fd=自定义起止（start_end，与 fp 互斥且优先）/ fb=收藏数带宽序号 /
 * fr=比例 / fw=最小边 px / fa=AI 覆盖（follow 为默认不落键）。
 */
import { BOOKMARK_BANDS, normalizeFilters, type SearchFilters } from "./filters";

export function encodeFiltersQuery(f: SearchFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.period.kind === "preset") q.fp = f.period.preset;
  else if (f.period.kind === "custom") q.fd = `${f.period.start}_${f.period.end}`;
  if (f.bookmark !== null) {
    const idx = BOOKMARK_BANDS.findIndex((b) => b.min === f.bookmark!.min && b.max === f.bookmark!.max);
    if (idx >= 0) q.fb = String(idx);
  }
  if (f.ratio !== null) q.fr = f.ratio;
  if (f.minPixels !== null) q.fw = String(f.minPixels);
  if (f.aiOverride !== "follow") q.fa = f.aiOverride;
  return q;
}

/** URL 参数形状（@solidjs/router useSearchParams 产物：string | undefined） */
export type RawQuery = Record<string, string | undefined>;

export function decodeFiltersQuery(params: RawQuery): SearchFilters {
  const period =
    params.fd !== undefined
      ? { kind: "custom", start: params.fd.split("_")[0] ?? "", end: params.fd.split("_")[1] ?? "" }
      : params.fp !== undefined
        ? { kind: "preset", preset: params.fp }
        : { kind: "any" };
  return normalizeFilters({
    period,
    bookmark: params.fb !== undefined ? Number(params.fb) : undefined,
    ratio: params.fr,
    minPixels: params.fw !== undefined ? Number(params.fw) : undefined,
    aiOverride: params.fa,
  });
}
