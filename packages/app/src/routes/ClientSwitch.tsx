import type { Component } from "solid-js";
import PageTransition from "../components/PageTransition";
import FluentIcon from "../components/ui/FluentIcon";
import { ClientInfo } from "../native/ClientInfo";
import { readClientKind, switchClient, type ClientKind } from "../utils/clientSwitch";
import { goBack } from "../services/backTransitionService";
import { t } from "../i18n";

/**
 * 切换渲染引擎说明页（T2）：由设置页「切换渲染引擎」入口行跳转进入。
 *
 * 替代原确认弹窗：入口行点击 → 直接导航本页，展示当前引擎、当前包支持的
 * 引擎能力、两引擎差异、实验性警告与切回路径，"确认切换"按钮接通现有
 * switchClient 深模块（行为与迁移前一致），返回操作 goBack()（带返回过渡，#364）。
 */
const kindLabel = (kind: string) => (kind === "lynx" ? "Lynx" : "WebView");
const kindDesc = (kind: string) =>
  kind === "lynx" ? t("clientSwitch.kindDescLynx") : t("clientSwitch.kindDescWebview");

const ClientSwitch: Component = () => {
  const [current, setCurrent] = createSignal<ClientKind>("webview");
  /** 当前包支持的 client 引擎列表；null = 无法读取（Web 环境无原生插件，保守渲染） */
  const [clientKinds, setClientKinds] = createSignal<string[] | null>(null);
  const [switching, setSwitching] = createSignal(false);
  const [actionToast, setActionToast] = createSignal<string | null>(null);

  // Auto-hide action toast
  // Solid 2.0 拆分效应：compute 读 actionToast，apply 段起定时器并以返回值注册清理。
  createEffect(
    () => actionToast(),
    (toast) => {
      if (!toast) {
        return;
      }
      const timer = setTimeout(() => setActionToast(null), 2500);
      return () => clearTimeout(timer);
    },
  );

  // Solid 2.0：onSettled 回调必须同步，async 主体移入 IIFE（写入发生在 await 之后，合法）。
  onSettled(() => {
    void (async () => {
      setCurrent(await readClientKind());
      try {
        const { kinds } = await ClientInfo.getClientKinds();
        setClientKinds(kinds);
      } catch {
        // 原生插件不可用（web 开发环境）→ 保持 null，按"未知"保守渲染
        setClientKinds(null);
      }
    })();
  });

  const currentLabel = () => (current() === "lynx" ? "Lynx" : "WebView");

  /** 确认切换：深模块 switchClient 完成写开关 + 原生重启编排（行为与迁移前弹窗一致） */
  async function handleConfirmSwitch() {
    setSwitching(true);
    try {
      const result = await switchClient("lynx");
      if (!result.ok) {
        console.warn("[client-switch] 切换失败", result.reason);
        // busy：已有切换在途，静默忽略（防连点）
        if (result.reason !== "busy") {
          // i18n: set 时快照（瞬态）
          setActionToast(
            result.reason === "timeout"
              ? t("clientSwitch.timeoutToast")
              : t("clientSwitch.failToast"),
          );
        }
        return;
      }
      setActionToast(t("clientSwitch.switchedToast")); // i18n: set 时快照（瞬态）
    } finally {
      // 成功路径下 Activity 立即重建销毁本页，此处幂等无副作用；
      // finally 保证任何异常路径都不会让遮罩锁死页面（防御性，深模块当前不抛）
      setSwitching(false);
    }
  }

  // ── E2E 测试钩子（仅 --mode e2e 构建）──
  // 迁移自 Settings.tsx：shadow DOM 内的按钮无法被 WebDriver/脚本点击
  //（浏览器级限制，真实用户触摸正常）。模拟器 E2E（tests/android-e2e）
  // 通过此全局钩子触发确认逻辑，绕过对话框交互限制。
  // __E2E__ 由 vite.config define 控制：仅 --mode e2e 构建为 true，
  // 生产构建被替换为 false 并整体消除，无生产泄漏。
  if (__E2E__) {
    const e2eWindow = window as unknown as Record<string, unknown>;
    e2eWindow.pictelioE2e = {
      ...(e2eWindow.pictelioE2e as Record<string, unknown> | undefined),
      confirmSwitchClient: () => {
        void handleConfirmSwitch();
      },
    };
  }

  return (
    <PageTransition>
      <div class="min-h-screen bg-[var(--colorNeutralBackground2)]">
        {/* T3：切换中全屏遮罩（ADR-0064 决策 2）——同步渲染，先于任何 await */}
        <Show when={switching()}>
          <div
            class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
            style={{
              "background-color": "var(--colorOverlayBackground)",
              "backdrop-filter": "blur(2px)",
            }}
            role="status"
            aria-live="polite"
          >
            <fluent-spinner size="medium" />
            <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorOverlayForeground)]">
              {t("clientSwitch.switching")}
            </p>
          </div>
        </Show>

        {/* Action toast */}
        <Show when={actionToast()}>
          <fluent-message-bar
            intent="success"
            style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none"
          >
            {actionToast()}
          </fluent-message-bar>
        </Show>

        {/* Sticky header */}
        <header class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3">
          <fluent-button
            appearance="subtle"
            aria-label={t("clientSwitch.back")}
            ref={fluentOn("click", () => goBack())}
            class="w-8 h-8 p-0 min-w-8"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15.53 4.22a.75.75 0 0 1 0 1.06L8.81 12l6.72 6.72a.75.75 0 1 1-1.06 1.06l-7.25-7.25a.75.75 0 0 1 0-1.06l7.25-7.25a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
          <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] flex-1">
            {t("clientSwitch.title")}
          </h1>
        </header>

        {/* Scrollable content */}
        <div class="px-5 py-4 flex flex-col gap-4">
          {/* 当前引擎 */}
          <section class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
              {t("clientSwitch.currentEngine")}
            </p>
            <p class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorCompoundBrandForeground1)] leading-snug">
              {currentLabel()}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {current() === "lynx"
                ? t("clientSwitch.runningLynx")
                : t("clientSwitch.runningWebview")}
            </p>
          </section>

          {/* 当前包支持的引擎能力列表 */}
          <section class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-2">
              {t("clientSwitch.supportedEngines")}
            </p>
            <Show
              when={clientKinds() !== null}
              fallback={
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("clientSwitch.unknownKinds")}
                </p>
              }
            >
              <ul class="flex flex-col gap-2">
                <For each={clientKinds()}>
                  {(kind) => (
                    <li class="flex items-center gap-3 p-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
                      <div class="w-6 h-6 flex-shrink-0 text-[var(--colorCompoundBrandForeground1)]">
                        <FluentIcon name={kind === "lynx" ? "wrench" : "open"} size={24} />
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                          {kindLabel(kind)}
                        </p>
                        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                          {kindDesc(kind)}
                        </p>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>

          {/* 两引擎差异说明 */}
          <section class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-2">
              {t("clientSwitch.differences")}
            </p>
            <div class="flex flex-col gap-3">
              <div>
                <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                  WebView
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("clientSwitch.webviewDesc")}
                </p>
              </div>
              <div>
                <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                  Lynx
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("clientSwitch.lynxDesc")}
                </p>
              </div>
            </div>
          </section>

          {/* 实验性警告 */}
          <fluent-message-bar intent="warning">
            {t("clientSwitch.warning")}
          </fluent-message-bar>

          {/* 切回路径指引 */}
          <section class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
              {t("clientSwitch.switchBackTitle")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("clientSwitch.switchBackDesc")}
            </p>
          </section>

          {/* Actions */}
          <div class="flex gap-3">
            <fluent-button
              appearance="secondary"
              ref={fluentOn("click", () => goBack())}
              class="flex-1"
              aria-label={t("clientSwitch.backToSettings")}
            >
              {t("clientSwitch.back")}
            </fluent-button>
            <fluent-button
              appearance="primary"
              ref={fluentOn("click", () => void handleConfirmSwitch())}
              disabled={switching()}
              class="flex-1"
            >
              <Show when={switching()}>
                <fluent-spinner size="tiny" slot="start" />
              </Show>
              {t("clientSwitch.confirm")}
            </fluent-button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default ClientSwitch;
