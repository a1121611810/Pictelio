import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import {
  readEngineState,
  readEngineFallbackOptout,
  writeEngineFallbackOptout,
  reasonKey,
} from "@/utils/clientSwitch";
import { t } from "@/i18n";

/**
 * 引擎降级提示条（ADR-0164 决策 6 / spec §7.2）：首选 Lynx 但本次生效 WebView 时，
 * 在内容层之上给出「为什么降级」说明 + 两个动作。
 *
 * 手写 pill（非 fluent-message-bar / fluent-button）：Fluent Web Components 是 shadow DOM，
 * E2E（android-e2e / agent-browser）无法触达其内部按钮，而本条需要两个可点动作
 * （先例：StartupUpdateDialog 因 fluent-dialog 同类问题改手写覆盖层）。
 *
 * 显示条件（快照驱动，只读不写——降级绝不落盘首选，ADR-0164 决策 4）：
 *   effective=webview ∧ preferred=lynx ∧ reason≠preferred ∧ 未 optout。
 * 「知道了」仅关闭本次（local signal）；「不再提示」写 pictelio_engine_fallback_optout
 *（镜像 Java EnginePrefs.KEY_FALLBACK_OPTOUT）后关闭。
 * 定位：胶囊居中（exitHint pill 同款 z-50 层级），pointer-events 仅在 pill 自身生效、
 * 无全宽遮罩——不吞页面点击。
 */
const EngineFallbackBanner: Component = () => {
  const [visible, setVisible] = createSignal(false);
  const [reason, setReason] = createSignal("preferred");

  // 挂载后异步读快照 + optout（无响应式依赖，仅运行一次）；
  // 任一读取失败由 utils 层 warn + 安全缺省（快照 null / optout false，禁静默）。
  void (async () => {
    const [state, optedOut] = await Promise.all([readEngineState(), readEngineFallbackOptout()]);
    if (
      state &&
      state.effective === "webview" &&
      state.preferred === "lynx" &&
      state.reason !== "preferred" &&
      !optedOut
    ) {
      setReason(state.reason);
      setVisible(true);
    }
  })();

  const dismiss = () => setVisible(false);
  const suppress = () => {
    void writeEngineFallbackOptout();
    dismiss();
  };

  return (
    <Show when={visible()}>
      <div
        role="status"
        aria-live="polite"
        aria-label={t("engineFallback.banner.aria")}
        class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-max max-w-[85vw] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusXLarge)] shadow-[var(--elevation8)] px-4 py-3 text-[var(--colorNeutralForeground1)]"
      >
        <p class="m-0 [font-size:var(--fontSizeBase200)] leading-snug">{t(reasonKey(reason()))}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            aria-label={t("engineFallback.banner.suppress")}
            onClick={suppress}
            class="min-h-10 px-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase200)] font-medium border-none cursor-pointer select-none appearance-none outline-none hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
          >
            {t("engineFallback.banner.suppress")}
          </button>
          <button
            type="button"
            aria-label={t("engineFallback.banner.ack")}
            onClick={dismiss}
            class="min-h-10 px-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase200)] font-semibold border-none cursor-pointer select-none appearance-none outline-none hover:bg-[var(--colorBrandBackgroundHover)] active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
          >
            {t("engineFallback.banner.ack")}
          </button>
        </div>
      </div>
    </Show>
  );
};

export default EngineFallbackBanner;
