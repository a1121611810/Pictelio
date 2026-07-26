import { Preferences } from "@capacitor/preferences";

const PREF_KEY_REPORTED_IDS = "reported_ids";

/** 举报原因类型 */
export type ReportReason = "pornography" | "violence" | "infringement" | "spam" | "other";

/** 举报原因显示标签 */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  pornography: "色情",
  violence: "暴力",
  infringement: "侵权",
  spam: "垃圾广告",
  other: "其他",
};

/** 已举报作品记录 */
export interface ReportRecord {
  id: number;
  reason: ReportReason;
  reportedAt: number;
}

const [reportedIds, setReportedIds] = createSignal<Set<number>>(new Set());
const [reportRecords, setReportRecords] = createSignal<ReportRecord[]>([]);

export { reportedIds };

/** 从 Capacitor Preferences 加载已举报作品 ID */
export async function loadReportedIds(): Promise<void> {
  const [err, result] = await tryAsync(Preferences.get({ key: PREF_KEY_REPORTED_IDS }));
  if (err) {
    console.warn("[reportStore] Failed to load reported ids", err);
  } else {
    const { value } = result!;
    if (value) {
      const records: ReportRecord[] = JSON.parse(value);
      setReportRecords(records);
      setReportedIds(new Set(records.map((r) => r.id)));
    }
  }
}

/**
 * 举报作品并持久化。
 * 重复举报同一作品会被忽略。
 */
export async function reportIllust(id: number, reason: ReportReason): Promise<void> {
  if (reportedIds().has(id)) {
    return;
  }
  const nextRecords = [...reportRecords(), { id, reason, reportedAt: Date.now() }];
  setReportRecords(nextRecords);
  setReportedIds(new Set(nextRecords.map((r) => r.id)));
  const [err] = await tryAsync(Preferences.set({ key: PREF_KEY_REPORTED_IDS, value: JSON.stringify(nextRecords) }));
  if (err) {
    console.warn("[reportStore] Failed to persist reported ids", err);
  }
}

/** 判断作品是否已被举报 */
export function hasReported(id: number): boolean {
  return reportedIds().has(id);
}

/** 清空本地举报记录（不操作 Preferences，调用方负责清除）。 */
export function resetReportedIds(): void {
  setReportedIds(new Set<number>());
  setReportRecords([]);
}
