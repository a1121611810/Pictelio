import type { Component } from "solid-js";
import {
  showUpdateDialog,
  setShowUpdateDialog,
  latestVersion,
  latestReleaseUrl,
  latestChangelog,
  setLastDismissedVersion,
  hasUpdate,
  checkCompleted,
  lastDismissedVersion,
} from "../stores/settingsStore";

/**
 * Dismiss the current update version and hide the dialog.
 */
function handleDismiss() {
  void setLastDismissedVersion(latestVersion());
  setShowUpdateDialog(false);
}

/**
 * Startup update dialog — 自定义模态覆盖层。
 *
 * 不使用 <fluent-dialog> 的原因是其在动态创建时 open 属性不
 * 触发内部 showModal，且 slot 系统会导致按钮不可见。
 * 改为纯 CSS fixed 覆盖层，完全控制布局。
 *
 * Fluent 2 设计令牌通过 tokens.css 的 CSS 变量使用，自动跟随主题。
 */
const StartupUpdateDialog: Component = () => {
  // 二次保障：监控 store 状态变化，在条件满足时自动弹窗。
  createEffect(() => {
    if (
      hasUpdate() &&
      checkCompleted() &&
      latestVersion() &&
      latestVersion() !== lastDismissedVersion() &&
      !showUpdateDialog()
    ) {
      setShowUpdateDialog(true);
    }
  });

  // Escape 键关闭弹窗（无障碍支持）
  createEffect(() => {
    if (showUpdateDialog()) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          handleDismiss();
        }
      };
      document.addEventListener("keydown", onKeyDown);
      onCleanup(() => document.removeEventListener("keydown", onKeyDown));
    }
  });

  function handleDownload() {
    const url = latestReleaseUrl();
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    handleDismiss();
  }

  return (
    <Show when={showUpdateDialog()}>
      {/* 半透明背景遮罩 — 不可点击关闭，用户只能通过按钮操作 */}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        style="background-color: var(--colorOverlayBackground);"
      >
        {/* 弹窗卡片 */}
        <div
          class="flex flex-col w-[min(85vw,360px)] rounded-[var(--borderRadius2XLarge)] shadow-[var(--elevation16)] overflow-hidden"
          style="background-color: var(--colorNeutralBackground1); animation: fluent-scale-enter 200ms cubic-bezier(0.33, 0, 0, 1) both;"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部标题 */}
          <div class="px-5 pt-5 pb-2">
            <h2 class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase500)] font-semibold leading-tight m-0">
              发现新版本
            </h2>
            <p class="mt-0.5 text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase300)] font-semibold leading-snug">
              v{latestVersion()}
            </p>
          </div>

          {/* 正文内容 */}
          <div class="px-5 py-2 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] leading-relaxed">
            <p class="m-0">
              Pictelio <span class="font-semibold">v{latestVersion()}</span> 已发布，当前版本为{" "}
              <span class="font-semibold">v{APP_VERSION}</span>。
            </p>
          </div>

          {/* 更新日志 */}
          <Show when={latestChangelog()}>
            <div class="px-5 pb-1">
              <div
                class="rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] px-3 py-2.5 [font-size:var(--fontSizeBase200)] whitespace-pre-wrap text-[var(--colorNeutralForeground2)] leading-relaxed max-h-[25vh] overflow-y-auto"
                style="scrollbar-width: thin;"
              >
                {latestChangelog()}
              </div>
            </div>
          </Show>

          {/* 操作按钮 */}
          <div class="flex gap-2 px-5 pb-5 pt-3">
            <fluent-button
              appearance="secondary"
              onClick={handleDismiss}
              class="flex-1 min-h-[44px] text-[var(--fontSizeBase300)] font-semibold"
            >
              稍后再说
            </fluent-button>
            <fluent-button
              appearance="primary"
              onClick={handleDownload}
              class="flex-1 min-h-[44px] text-[var(--fontSizeBase300)] font-semibold"
            >
              前往下载
            </fluent-button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default StartupUpdateDialog;
