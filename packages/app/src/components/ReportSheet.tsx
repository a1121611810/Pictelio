import type { Component } from "solid-js";
import {
  reportIllust,
  hasReported,
  type ReportReason,
  REPORT_REASON_LABELS,
} from "../stores/reportStore";

interface ReportSheetProps {
  illustId: number;
  isOpen: boolean;
  onClose: () => void;
}

const REASONS: ReportReason[] = ["pornography", "violence", "infringement", "spam", "other"];

const REPORT_EMAIL = "a1121611810@outlook.com";

function openReportEmail(illustId: number, reason: ReportReason) {
  const subject = encodeURIComponent(`[Pictelio 举报] 作品 ID: ${illustId}`);
  const body = encodeURIComponent(
    `举报作品 ID: ${illustId}\n举报原因: ${REPORT_REASON_LABELS[reason]}\n\n补充说明：\n`,
  );
  window.location.href = `mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`;
}

const ReportSheet: Component<ReportSheetProps> = (props) => {
  const [selectedReason, setSelectedReason] = createSignal<ReportReason | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const alreadyReported = () => hasReported(props.illustId);

  function close() {
    props.onClose();
  }

  async function handleSubmit() {
    const reason = selectedReason();
    if (!reason || alreadyReported()) {
      return;
    }
    setSubmitting(true);
    await reportIllust(props.illustId, reason);
    openReportEmail(props.illustId, reason);
    setSubmitting(false);
    close();
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        <div class="absolute inset-0" style="background-color:var(--colorScrim)" onClick={close} />
        <div
          class="absolute bottom-0 left-0 right-0 surface-appbar rounded-t-[var(--borderRadius4XLarge)] shadow-[var(--elevation28)]"
          style="max-height:70vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          {/* Header */}
          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              举报作品
            </h2>
            <fluent-button
              appearance="subtle"
              aria-label="关闭"
              on:click={close}
              class="w-8 h-8 p-0 min-w-8"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                  fill="currentColor"
                />
              </svg>
            </fluent-button>
          </div>

          {/* Divider */}
          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)"></fluent-divider>

          {/* Reason list */}
          <p class="px-5 pt-3 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            请选择举报原因：
          </p>
          <fluent-radio-group
            value={selectedReason()}
            on:change={(e: CustomEvent) => setSelectedReason(e.detail.value)}
          >
            {REASONS.map((reason) => (
              <fluent-radio value={reason} disabled={alreadyReported()}>
                {REPORT_REASON_LABELS[reason]}
              </fluent-radio>
            ))}
          </fluent-radio-group>

          {/* Submit button */}
          <div class="px-5 pb-6 pt-2">
            <fluent-button
              appearance="primary"
              style="width:100%"
              disabled={!selectedReason() || submitting() || alreadyReported()}
              on:click={handleSubmit}
            >
              {alreadyReported() ? "已举报" : submitting() ? "提交中…" : "提交举报"}
            </fluent-button>
            <p class="mt-3 text-center [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              提交后将打开邮件客户端发送举报详情
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ReportSheet;
