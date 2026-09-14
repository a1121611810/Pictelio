import type { Component } from "solid-js";
import {
  imageHostState,
  setMasterEnabled,
  setMode,
  setSelectedHostId,
  updateHost,
  resetBuiltInHost,
  resetAllBuiltInHosts,
  type ImageHost,
} from "../stores/imageHostStore";
import { validateHostInput, hasDuplicateBaseUrl, probeHosts } from "../services/imageHostService";
import { goBack } from "../services/backTransitionService";
import { t } from "../i18n";
import PageTransition from "../components/PageTransition";
import FluentDialog from "../components/ui/FluentDialog";

const ImageHostSettings: Component = () => {
  const [showConfirmDialog, setShowConfirmDialog] = createSignal(false);

  const [editingHost, setEditingHost] = createSignal<ImageHost | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editBaseUrl, setEditBaseUrl] = createSignal("");
  const [editEnabled, setEditEnabled] = createSignal(false);
  const [editWeight, setEditWeight] = createSignal(100);
  const [editError, setEditError] = createSignal<string | null>(null);

  const [isProbing, setIsProbing] = createSignal(false);
  const [probeToast, setProbeToast] = createSignal<string | null>(null);

  // Solid 2.0：数组 ref 中的裸变量不被编译器回写赋值（与 FluentDialog 同款问题），
  // 必须经具名回调捕获元素。
  let masterSwitchEl: HTMLElement | undefined;
  let radioGroupEl: HTMLElement | undefined;
  const masterSwitchRef = (el: HTMLElement) => {
    masterSwitchEl = el;
  };
  const radioGroupRef = (el: HTMLElement) => {
    radioGroupEl = el;
  };

  // Solid 2.0 拆分效应：compute 读 store 的 mode（提取普通值），apply 段做 DOM 命令式设置。
  createEffect(
    () => imageHostState().mode,
    (mode) => {
      const group = radioGroupEl as unknown as { value?: string } | undefined;
      if (group) {
        // RequestAnimationFrame 确保所有子 fluent-radio 已在 DOM 中并升级完成
        requestAnimationFrame(() => {
          group.value = mode;
        });
      }
    },
  );

  function handleToggle(enabled: boolean) {
    if (enabled) {
      setShowConfirmDialog(true);
    } else {
      setMasterEnabled(false);
    }
  }

  function confirmEnable() {
    setMasterEnabled(true);
    setShowConfirmDialog(false);
  }

  function cancelEnable() {
    setShowConfirmDialog(false);
    // 同步 Fluent Switch 的视觉状态：用户点取消后，switch 不应保持开启的视觉状态
    if (masterSwitchEl) {
      (masterSwitchEl as unknown as { checked: boolean }).checked = false;
    }
  }

  function openEdit(host: ImageHost) {
    setEditingHost(host);
    setEditName(host.name);
    setEditBaseUrl(host.baseUrl);
    setEditEnabled(host.enabled);
    setEditWeight(host.weight);
    setEditError(null);
  }

  function closeEdit() {
    setEditingHost(null);
    setEditError(null);
  }

  function saveEdit() {
    const host = editingHost();
    if (!host) {
      return;
    }

    const error = validateHostInput({
      name: editName(),
      baseUrl: editBaseUrl(),
    });
    if (error) {
      setEditError(error);
      return;
    }

    if (hasDuplicateBaseUrl(editBaseUrl(), host.id)) {
      setEditError(t("imageHost.duplicateUrl")); // i18n: set 时快照（瞬态）
      return;
    }

    updateHost(host.id, {
      name: editName(),
      baseUrl: editBaseUrl(),
      enabled: editEnabled(),
      weight: editWeight(),
    });
    closeEdit();
  }

  async function handleProbe() {
    const enabled = imageHostState().hosts.filter((h) => h.enabled);
    if (enabled.length === 0) {
      setProbeToast(t("imageHost.enableFirst")); // i18n: set 时快照（瞬态）
      return;
    }

    setIsProbing(true);
    const [probeErr] = await tryAsync(
      (async () => {
        const results = await probeHosts();
        const reachable = results.filter((r) => r.reachable).length;
        // i18n: set 时快照（瞬态）
        setProbeToast(t("imageHost.probeDone", { ok: reachable, total: results.length }));
      })(),
    );
    setIsProbing(false);
    if (probeErr) {
      setProbeToast(t("imageHost.probeFailed")); // i18n: set 时快照（瞬态）
    }
  }

  function handleResetAll() {
    resetAllBuiltInHosts();
    setProbeToast(t("imageHost.resetDone")); // i18n: set 时快照（瞬态）
  }

  return (
    <PageTransition>
      <div class="min-h-screen bg-[var(--colorNeutralBackground2)]">
        {/* Header */}
        <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation4)]">
          <fluent-button
            appearance="subtle"
            aria-label={t("imageHost.back")}
            class="w-8 h-8 p-0 min-w-8"
            ref={fluentOn("click", () => goBack())}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15.53 4.22a.75.75 0 0 1 0 1.06L9.81 12l5.72 6.72a.75.75 0 1 1-1.06 1.06l-6.25-7.25a.75.75 0 0 1 0-1.06l6.25-7.25a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
          <h1 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
            {t("imageHost.title")}
          </h1>
        </div>

        {/* Content */}
        <div class="px-4 py-4 flex flex-col gap-4">
          <Show when={probeToast()}>
            <fluent-message-bar
              intent="success"
              class="mb-0"
              ref={fluentOn("close", () => setProbeToast(null))}
            >
              {probeToast()}
            </fluent-message-bar>
          </Show>

          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            {t("imageHost.intro")}
          </p>

          {/* Master switch */}
          <div class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                  {t("imageHost.enable")}
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                  {t("imageHost.enableDesc")}
                </p>
              </div>
              <fluent-switch
                ref={[
                  masterSwitchRef,
                  fluentOn("change", () => {
                    handleToggle(!imageHostState().masterEnabled);
                  }),
                ]}
                checked={imageHostState().masterEnabled}
                aria-label={t("imageHost.enable")}
              />
            </div>
          </div>

          {/* Warning banner */}
          <Show when={imageHostState().masterEnabled}>
            <fluent-message-bar intent="warning">{t("imageHost.warning")}</fluent-message-bar>
          </Show>

          {/* Mode selector */}
          <div class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] mb-3">
              {t("imageHost.modeTitle")}
            </p>
            <fluent-radio-group
              ref={[
                radioGroupRef,
                fluentOn("change", (e: Event) => {
                  // Solid 2.0：EventListener 形参须为 Event，fluent 自定义事件 detail 就地收窄
                  const detail = (e as CustomEvent).detail as { value?: string } | undefined;
                  if (detail?.value != null) {
                    // fluent-radio-group 的 value 是 string，收窄为 store 的 ImageHostMode 联合类型
                    setMode(detail.value as Parameters<typeof setMode>[0]);
                  }
                }),
              ]}
              value={imageHostState().mode}
              disabled={!imageHostState().masterEnabled}
              class="flex flex-col gap-3"
            >
              {[
                {
                  value: "race" as const,
                  label: t("imageHost.modeRace"),
                  desc: t("imageHost.modeRaceDesc"),
                },
                {
                  value: "weighted" as const,
                  label: t("imageHost.modeWeighted"),
                  desc: t("imageHost.modeWeightedDesc"),
                  recommended: true,
                },
                {
                  value: "fastest-ip" as const,
                  label: t("imageHost.modeFastestIp"),
                  desc: t("imageHost.modeFastestIpDesc"),
                },
                {
                  value: "single" as const,
                  label: t("imageHost.modeSingle"),
                  desc: t("imageHost.modeSingleDesc"),
                },
              ].map((option) => {
                const inputId = `mode-${option.value}`;
                return (
                  <div class="flex items-start gap-3">
                    <fluent-radio
                      id={inputId}
                      value={option.value}
                      checked={imageHostState().mode === option.value}
                      disabled={!imageHostState().masterEnabled}
                      ref={fluentOn("click", () => setMode(option.value))}
                    />
                    <label
                      for={inputId}
                      class={[
                        "flex-1 cursor-pointer [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]",
                        {
                          "opacity-60": !imageHostState().masterEnabled,
                        },
                      ]}
                    >
                      <span class="font-semibold">
                        {option.label}
                        {option.recommended && (
                          <span class="ml-2 px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold text-[var(--colorPaletteGreenForeground2)] bg-[var(--colorPaletteGreenBackground2)]">
                            {t("imageHost.recommended")}
                          </span>
                        )}
                      </span>
                      <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                        {option.desc}
                      </p>
                    </label>
                  </div>
                );
              })}
            </fluent-radio-group>

            {/* 单一图床模式：图床选择器 */}
            <Show when={imageHostState().mode === "single" && imageHostState().masterEnabled}>
              <div class="mt-3 flex flex-col gap-1.5">
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                  {t("imageHost.pickHost")}
                </p>
                <For each={imageHostState().hosts.filter((h) => h.enabled)}>
                  {(host) => (
                    <div
                      class={[
                        "flex items-center gap-3 p-3 rounded-[var(--borderRadiusMedium)] cursor-pointer transition-colors",
                        {
                          "bg-[var(--colorCompoundBrandBackground)] text-white":
                            imageHostState().selectedHostId === host.id,
                          "bg-[var(--colorNeutralBackground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                            imageHostState().selectedHostId !== host.id,
                        },
                      ]}

                      onClick={() => setSelectedHostId(host.id)}
                      role="button"
                      tabindex="0"
                      aria-label={t("imageHost.useHostAria", { name: host.name })}
                    >
                      <div class="flex-1 min-w-0">
                        <p class="[font-size:var(--fontSizeBase300)] font-semibold truncate">
                          {host.name}
                        </p>
                        <p class="[font-size:var(--fontSizeBase200)] truncate opacity-80">
                          {host.baseUrl}
                        </p>
                      </div>
                      <Show when={imageHostState().selectedHostId === host.id}>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M9 16.17L5.53 12.7a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.06 0l10-10a.75.75 0 0 0-1.06-1.06L9 16.17z"
                            fill="currentColor"
                          />
                        </svg>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Host list */}
          <div
            class={[
              "rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4",
              { "opacity-60": !imageHostState().masterEnabled },
            ]}
          >
            <div class="flex items-center justify-between mb-3">
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                {t("imageHost.hostList")}
              </p>
              <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("imageHost.enabledCount", {
                  count: imageHostState().hosts.filter((h) => h.enabled).length,
                })}
              </span>
            </div>

            <div class="flex flex-col gap-2">
              <For each={imageHostState().hosts}>
                {(host) => (
                  <div class="flex items-center gap-3 p-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
                    <fluent-checkbox
                      checked={host.enabled}
                      ref={fluentOn("change", () =>
                        updateHost(host.id, { enabled: !host.enabled }),
                      )}
                      disabled={!imageHostState().masterEnabled}
                      aria-label={t("imageHost.enableHostAria", { name: host.name })}
                    />
                    <div class="flex-1 min-w-0">
                      <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate">
                        {host.name}
                      </p>
                      <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] truncate">
                        {host.baseUrl}
                      </p>
                      {imageHostState().mode === "weighted" && host.enabled && (
                        <div class="flex items-center gap-2 mt-2">
                          <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                            {t("imageHost.weight")}
                          </span>
                          <input
                            type="range"
                            min="1"
                            max="100"
                            value={host.weight}
                            onInput={(e) =>
                              updateHost(host.id, { weight: Number(e.currentTarget.value) })
                            }
                            disabled={!imageHostState().masterEnabled}
                            class="flex-1 h-1 rounded-[var(--borderRadiusCircular)] cursor-pointer"
                            style={{ "accent-color": "var(--colorCompoundBrandBackground)" }}
                          />
                          <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] w-8 text-right">
                            {host.weight}
                          </span>
                        </div>
                      )}
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                      <fluent-button
                        appearance="subtle"
                        aria-label={t("imageHost.edit")}
                        class="w-8 h-8 p-0 min-w-8"
                        ref={fluentOn("click", () => openEdit(host))}
                        disabled={!imageHostState().masterEnabled}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M15.292 4.293a1 1 0 0 0-1.414 0l-7 7a1 1 0 0 0-.293.707V19a1 1 0 0 0 1 1h6.586a1 1 0 0 0 .707-.293l7-7a1 1 0 0 0 0-1.414l-6.293-6.293zm-1.414 2.121l5.172 5.172-6.293 6.293H8.586v-4.172l5.292-5.293z"
                            fill="currentColor"
                          />
                        </svg>
                      </fluent-button>
                      <Show when={host.isBuiltIn && host.edited}>
                        <fluent-button
                          appearance="subtle"
                          aria-label={t("imageHost.reset")}
                          class="w-8 h-8 p-0 min-w-8"
                          ref={fluentOn("click", () => resetBuiltInHost(host.id))}
                          disabled={!imageHostState().masterEnabled}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M12 4.5a7.5 7.5 0 1 1-7.09 5.06 1 1 0 0 0-1.89.66A9.5 9.5 0 1 0 12 2.5a9.44 9.44 0 0 0-6.65 2.74L3.5 4.38V9a1 1 0 0 0 2 0V5.21l1.56 1.56A1 1 0 0 0 8.2 5.13l-2.5-2.5a1 1 0 0 0-1.42 0l-2.5 2.5a1 1 0 0 0 1.42 1.42l.88-.88A9.44 9.44 0 0 0 12 4.5z"
                              fill="currentColor"
                            />
                          </svg>
                        </fluent-button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Actions */}
          <div class="flex gap-3">
            <fluent-button
              appearance="primary"
              ref={fluentOn("click", handleProbe)}
              disabled={isProbing() || !imageHostState().masterEnabled}
              class="flex-1"
            >
              <Show when={isProbing()}>
                <fluent-spinner size="tiny" slot="start" />
              </Show>
              {t("imageHost.probeNow")}
            </fluent-button>
            <fluent-button
              appearance="secondary"
              ref={fluentOn("click", handleResetAll)}
              disabled={!imageHostState().masterEnabled}
              class="flex-1"
            >
              {t("imageHost.resetAll")}
            </fluent-button>
          </div>
        </div>

        {/* Confirmation dialog */}
        <FluentDialog
          open={showConfirmDialog()}
          onClose={cancelEnable}
          aria-label={t("imageHost.confirmAria")}
        >
          <h3 slot="title">{t("imageHost.confirmTitle")}</h3>
          <div class="flex flex-col gap-2">
            <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
              {t("imageHost.confirmBody1")}
            </p>
            <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
              {t("imageHost.confirmBody2")}
            </p>
            <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
              {t("imageHost.confirmBody3")}
            </p>
          </div>
          <fluent-button
            slot="actions"
            appearance="secondary"
            ref={fluentOn("click", cancelEnable)}
          >
            {t("imageHost.cancel")}
          </fluent-button>
          <fluent-button slot="actions" appearance="primary" ref={fluentOn("click", confirmEnable)}>
            {t("imageHost.confirmEnable")}
          </fluent-button>
        </FluentDialog>

        {/* Edit dialog */}
        <FluentDialog
          open={editingHost() !== null}
          onClose={closeEdit}
          aria-label={t("imageHost.editAria")}
        >
          <h3 slot="title">{t("imageHost.editTitle")}</h3>
          <Show when={editError()}>
            <fluent-message-bar intent="error">{editError()}</fluent-message-bar>
          </Show>
          <div>
            <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
              {t("imageHost.nameLabel")}
            </label>
            <input
              type="text"
              value={editName()}
              onInput={(e) => setEditName(e.currentTarget.value)}
              placeholder={t("imageHost.namePlaceholder")}
              class="w-full px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] outline-none focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
            />
          </div>
          <div>
            <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
              {t("imageHost.urlLabel")}
            </label>
            <input
              type="text"
              value={editBaseUrl()}
              onInput={(e) => setEditBaseUrl(e.currentTarget.value)}
              placeholder={t("imageHost.urlPlaceholder")}
              class="w-full px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] outline-none focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
            />
          </div>
          <div class="flex items-center gap-2">
            <fluent-checkbox
              checked={editEnabled()}
              ref={fluentOn("change", () => setEditEnabled(!editEnabled()))}
            />
            <span class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]">
              {t("imageHost.enabledCheckbox")}
            </span>
          </div>
          <Show when={imageHostState().mode === "weighted"}>
            <div>
              <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
                {t("imageHost.weightValue", { weight: editWeight() })}
              </label>
              <input
                type="range"
                min="1"
                max="100"
                value={editWeight()}
                onInput={(e) => setEditWeight(Number(e.currentTarget.value))}
                class="w-full h-1 rounded-[var(--borderRadiusCircular)] cursor-pointer"
                style={{ "accent-color": "var(--colorCompoundBrandBackground)" }}
              />
            </div>
          </Show>
          <fluent-button slot="actions" appearance="secondary" ref={fluentOn("click", closeEdit)}>
            {t("imageHost.cancel")}
          </fluent-button>
          <fluent-button slot="actions" appearance="primary" ref={fluentOn("click", saveEdit)}>
            {t("imageHost.save")}
          </fluent-button>
        </FluentDialog>
      </div>
    </PageTransition>
  );
};

export default ImageHostSettings;
