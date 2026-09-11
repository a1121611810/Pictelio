import { type Component, For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import {
  evaluate,
  formatReport,
  type DiagCheckView,
  type DiagInput,
  type DiagReport,
  type DiagStatus,
} from "@pictelio/net-diagnostics";
import PageTransition from "../components/PageTransition";
import { goBack } from "../services/backTransitionService";
import { collectNetDiagInput } from "../native/NetDiag";
import { user } from "../stores/authStore";

const STATUS_LABEL: Record<DiagStatus, string> = {
  ok: "通过",
  warn: "注意",
  fail: "失败",
  skipped: "跳过",
};
const STATUS_COLOR: Record<DiagStatus, string> = {
  ok: "var(--colorStatusSuccessForeground1)",
  warn: "var(--colorStatusWarningForeground1)",
  fail: "var(--colorStatusDangerForeground1)",
  skipped: "var(--colorNeutralForeground3)",
};

/**
 * 网络自检页（spec docs/specs/network-self-check.md）。
 * 一键运行 -> 逐项绿/黄/红 + 结论/归因 -> 复制脱敏报告。判定在 @pictelio/net-diagnostics。
 */
const NetworkCheck: Component = () => {
  const [input, setInput] = createSignal<DiagInput | null>(null);
  const [report, setReport] = createSignal<DiagReport | null>(null);
  const [running, setRunning] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  async function run() {
    if (running()) return;
    setRunning(true);
    setCopied(false);
    try {
      const uid = user()?.id;
      const inp = await collectNetDiagInput(
        APP_VERSION,
        uid === undefined ? undefined : String(uid),
      );
      if (!alive) return;
      setInput(inp);
      setReport(evaluate(inp));
    } catch (e) {
      console.warn("[network-check] 自检失败:", e);
      if (alive) {
        const fallback: DiagInput = {
          platform: "android",
          engine: "webview",
          appVersion: APP_VERSION,
          probes: [],
          degraded: true,
          capturedAt: new Date().toISOString(),
        };
        setInput(fallback);
        setReport(evaluate(fallback));
      }
    } finally {
      if (alive) setRunning(false);
    }
  }

  onSettled(() => {
    void run();
  });

  async function copyReport() {
    const inp = input();
    if (!inp) return;
    try {
      await navigator.clipboard.writeText(formatReport(inp));
      setCopied(true);
    } catch (e) {
      console.warn("[network-check] 复制报告失败:", e);
    }
  }

  return (
    <PageTransition>
      <div class="page">
        <div class="flex items-center gap-3 p-4 border-b border-[var(--colorNeutralStroke2)]">
          <button
            class="text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)] p-1 -ml-1 min-w-[40px] min-h-[40px] flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2"
            onClick={() => goBack()}
            aria-label="返回"
          >
            ←
          </button>
          <h1 class="text-[var(--fontSizeHero700)] font-semibold text-[var(--colorNeutralForeground1)]">
            网络自检
          </h1>
        </div>

        <div class="p-4 space-y-4">
          <Show
            when={report()}
            fallback={
              <div class="surface-flyout p-4 text-[var(--fontSizeBase300)] text-[var(--colorNeutralForeground3)]">
                正在自检…
              </div>
            }
          >
            {(rep) => (
              <>
                <div class="surface-flyout p-4">
                  <p
                    class="text-[var(--fontSizeBase400)] font-semibold"
                    style={{ color: STATUS_COLOR[rep().overall] }}
                  >
                    {rep().headline}
                  </p>
                  <Show when={rep().degraded}>
                    <p class="mt-1 text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                      开发态降级执行器：仅覆盖部分检查项，结论不代表真机完整能力。
                    </p>
                  </Show>
                  <Show when={rep().action}>
                    <p class="mt-1 text-[var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
                      建议：{rep().action}
                    </p>
                  </Show>
                </div>

                <div class="surface-flyout p-4">
                  <For each={rep().checks}>
                    {(c: DiagCheckView) => (
                      <div class="flex items-start gap-2 py-2 border-b border-[var(--colorNeutralStroke2)] last:border-b-0">
                        <span
                          class="shrink-0 text-[var(--fontSizeBase200)] font-semibold pt-0.5"
                          style={{ color: STATUS_COLOR[c.status] }}
                        >
                          [{STATUS_LABEL[c.status]}]
                        </span>
                        <div class="min-w-0">
                          <p class="text-[var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]">
                            {c.title}
                            {c.latencyMs !== undefined ? " · " + c.latencyMs + "ms" : ""}
                          </p>
                          <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                            {c.detail}
                          </p>
                          <Show when={c.hint}>
                            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] leading-snug">
                              {c.hint}
                            </p>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>

          <div class="flex gap-2">
            <button
              class="flex-1 min-h-[40px] rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase300)] font-semibold active:scale-[0.98] transition-transform duration-[var(--durationFast)] disabled:opacity-50"
              onClick={() => void run()}
              disabled={running()}
            >
              {running() ? "自检中…" : "重新自检"}
            </button>
            <button
              class="flex-1 min-h-[40px] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] font-semibold active:scale-[0.98] transition-transform duration-[var(--durationFast)] disabled:opacity-50"
              onClick={() => void copyReport()}
              disabled={!input()}
            >
              {copied() ? "已复制" : "复制报告"}
            </button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default NetworkCheck;
