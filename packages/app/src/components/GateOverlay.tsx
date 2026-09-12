import type { Component } from "solid-js";
import { Show } from "solid-js";
import LoadingSpinner from "@/components/LoadingSpinner";
import { gateActive, gateError, gateFloor, gateHealing, selfHeal } from "@/services/otaService";
import { latestReleaseUrl, latestVersion } from "@/stores/settingsStore";
import { t } from "@/i18n";

/**
 * OTA 强制门槛全屏过渡面（#253，D4 裁决：全屏面合并 T1/T2，单一表面三状态）。
 *
 * 门槛命中（当前 bundle 版本 < minWebVersion）即全屏接管：
 *  - 自愈中：「正在更新…」非错误样式（floor 是「此版本不能再用」的完整性语义，
 *    温和横幅与之冲突——该期间用户无需操作，成功自动 reload 进新版）；
 *  - 失败：同屏转阻断态，两出口 = 重试更新（再走前台直连自愈）/ 前往下载 APK；
 *  - T3（bundle 要求更高宿主 APK）：由 otaService 撤销门槛转 APK 弹窗通道，本面不渲染。
 *
 * 激活期间返回键 = 退出应用（backGestureService.shouldExitOnBack 注入，对齐 lynx
 * /update 语义：无返回、不可关闭）。视觉全程 Fluent 令牌，入场用允许的 enter 曲线。
 */
/** 前往下载 APK（系统浏览器开 release 页；unicorn consistent-function-scoping：无闭包捕获，提升到模块级） */
function handleDownload(): void {
  const url = latestReleaseUrl();
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// t() args 只接受 string | number：floor/error 快照在此收窄（accessor 二次调用不继承窄化）
const floorSuffix = () => {
  const floor = gateFloor();
  return floor ? t("gate.floorSuffix", { version: floor }) : "";
};
const errorSuffix = () => {
  const err = gateError();
  return err ? t("gate.errorSuffix", { detail: err }) : t("gate.period");
};

const GateOverlay: Component = () => {
  return (
    <Show when={gateActive()}>
      <div
        class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-8 text-center"
        style="background-color: var(--colorNeutralBackground1); animation: fluent-scale-enter 200ms cubic-bezier(0.33, 0, 0, 1) both;"
      >
        <Show
          when={gateHealing()}
          fallback={
            <>
              <h2 class="m-0 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase500)] font-semibold leading-tight">
                {t("gate.title")}
              </h2>
              <p class="m-0 text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase300)] leading-relaxed">
                {t("gate.updateRequiredBody", {
                  floor: floorSuffix(),
                  error: errorSuffix(),
                })}
              </p>
              <div class="mt-2 flex w-full max-w-[360px] flex-col gap-2">
                <fluent-button
                  appearance="primary"
                  class="min-h-[44px] text-[var(--fontSizeBase300)] font-semibold"
                  onClick={() => void selfHeal()}
                >
                  {t("gate.retryUpdate")}
                </fluent-button>
                <Show when={latestReleaseUrl()}>
                  <fluent-button
                    appearance="secondary"
                    class="min-h-[44px] text-[var(--fontSizeBase300)] font-semibold"
                    onClick={handleDownload}
                  >
                    {t("gate.downloadVersion", { version: latestVersion() })}
                  </fluent-button>
                </Show>
              </div>
            </>
          }
        >
          <LoadingSpinner size="lg" text={t("gate.updating")} />
          <p class="m-0 text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase300)] leading-relaxed">
            {t("gate.updatingHint")}
          </p>
        </Show>
      </div>
    </Show>
  );
};

export default GateOverlay;
