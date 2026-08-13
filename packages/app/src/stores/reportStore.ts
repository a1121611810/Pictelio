import { createPersistedSetSetting } from "./shared/createPersistedSet";

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
interface ReportRecord {
  id: number;
  reason: ReportReason;
  reportedAt: number;
}

const records = createPersistedSetSetting<ReportRecord>({
  key: PREF_KEY_REPORTED_IDS,
  default: [],
  validate: (v): v is ReportRecord[] =>
    Array.isArray(v) &&
    v.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as ReportRecord).id === "number" &&
        typeof (r as ReportRecord).reportedAt === "number" &&
        typeof (r as ReportRecord).reason === "string",
    ),
});

/** 已举报作品 ID 集合（响应式 accessor） */
export const reportedIds = (): Set<number> => new Set([...records.values()].map((r) => r.id));

/** 从存储加载已举报作品 ID */
export const loadReportedIds = records.load;

/**
 * 举报作品并持久化。
 * 重复举报同一作品会被忽略。
 */
export async function reportIllust(id: number, reason: ReportReason): Promise<void> {
  if (reportedIds().has(id)) {
    return;
  }
  await records.add({ id, reason, reportedAt: Date.now() });
}

/** 判断作品是否已被举报 */
export function hasReported(id: number): boolean {
  return reportedIds().has(id);
}

/** 清空本地举报记录（并持久化空数组） */
export function resetReportedIds(): void {
  records.reset();
}
