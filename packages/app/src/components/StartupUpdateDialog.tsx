import { type Component, Show, createEffect } from "solid-js";
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
 * Startup update dialog.
 *
 * Shown automatically on app launch when the background update check detects
 * a version newer than the running build and the user has not already dismissed
 * this particular version.
 *
 * Interaction:
 * - "前往下载" opens the release URL in the system browser.
 * - "稍后再说" persists the current version as dismissed so it won't be
 *   shown again until an even newer version is available.
 */
const StartupUpdateDialog: Component = () => {
  let dialogRef: HTMLElement | undefined;

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

  // 当 fluent-dialog 挂载到 DOM 时，调用 showModal 使其可见。
  // Web 组件在动态创建时 open 属性不触发内部 showModal，
  // 必须通过 ref 回调直接调用。
  function onDialogMount(el: HTMLElement) {
    dialogRef = el;
  }

  // 当 showUpdateDialog 变为 true 且 fluent-dialog 挂载到 DOM 后，
  // 启用一个短轮询等待 Web 组件完全初始化后再调用 showModal。
  // Web 组件在动态创建时 open 属性不触发内部 showModal，
  // 必须通过 JS 手动调用。
  createEffect(() => {
    if (showUpdateDialog()) {
      const tryShow = () => {
        const host = document.querySelector('fluent-dialog');
        if (host && host.shadowRoot) {
          const d = host.shadowRoot.querySelector('dialog') as any;
          if (d && typeof d.showModal === 'function' && !d.open) {
            d.showModal();
            return;
          }
        }
        // 还没就绪，50ms 后重试
        setTimeout(tryShow, 50);
      };
      setTimeout(tryShow, 0);
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
      <fluent-dialog
        ref={onDialogMount}
        modal
        on:close={handleDismiss}
        aria-label="发现新版本"
      >
        <h3
          slot="title"
          class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase500)] font-semibold"
        >
          发现新版本 v{latestVersion()}
        </h3>

        <div class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] leading-relaxed max-w-[min(80vw,360px)]">
          <p class="mb-3">
            Pictelio {latestVersion()} 已发布，当前版本为 v{APP_VERSION}。
          </p>
          <Show when={latestChangelog()}>
            <div class="rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] p-3 [font-size:var(--fontSizeBase200)] whitespace-pre-wrap text-[var(--colorNeutralForeground2)] max-h-[30vh] overflow-y-auto">
              {latestChangelog()}
            </div>
          </Show>
        </div>

        <div slot="actions" class="flex gap-2 justify-end">
          <fluent-button appearance="secondary" on:click={handleDismiss} class="min-h-[40px]">
            稍后再说
          </fluent-button>
          <fluent-button appearance="primary" on:click={handleDownload} class="min-h-[40px]">
            前往下载
          </fluent-button>
        </div>
      </fluent-dialog>
    </Show>
  );
};

export default StartupUpdateDialog;
