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

  let masterSwitchRef: HTMLElement | undefined;
  let radioGroupRef: HTMLElement | undefined;

  createEffect(() => {
    const group = radioGroupRef as unknown as { value?: string } | undefined;
    const mode = imageHostState().mode;
    if (group) {
      // RequestAnimationFrame 确保所有子 fluent-radio 已在 DOM 中并升级完成
      requestAnimationFrame(() => {
        group.value = mode;
      });
    }
  });

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
    if (masterSwitchRef) {
      (masterSwitchRef as unknown as { checked: boolean }).checked = false;
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
      setEditError("已存在相同 URL 的图床");
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
      setProbeToast("请先启用至少一个图床");
      return;
    }

    setIsProbing(true);
    const [probeErr] = await tryAsync(
      (async () => {
        const results = await probeHosts();
        const reachable = results.filter((r) => r.reachable).length;
        setProbeToast(`测速完成：${reachable}/${results.length} 个可用`);
      })(),
    );
    setIsProbing(false);
    if (probeErr) {
      setProbeToast("测速失败");
    }
  }

  function handleResetAll() {
    resetAllBuiltInHosts();
    setProbeToast("已恢复默认图床配置");
  }

  return (
    <div class="min-h-screen bg-[var(--colorNeutralBackground2)]">
      {/* Header */}
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation4)]">
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          class="w-8 h-8 p-0 min-w-8"
          on:click={() => goBack()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15.53 4.22a.75.75 0 0 1 0 1.06L9.81 12l5.72 6.72a.75.75 0 1 1-1.06 1.06l-6.25-7.25a.75.75 0 0 1 0-1.06l6.25-7.25a.75.75 0 0 1 1.06 0z"
              fill="currentColor"
            />
          </svg>
        </fluent-button>
        <h1 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
          图床代理
        </h1>
      </div>

      {/* Content */}
      <div class="px-4 py-4 flex flex-col gap-4">
        <Show when={probeToast()}>
          <fluent-message-bar intent="success" class="mb-0" on:close={() => setProbeToast(null)}>
            {probeToast()}
          </fluent-message-bar>
        </Show>

        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          配置第三方 Pixiv 图片代理源。
        </p>

        {/* Master switch */}
        <div class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                启用图床代理
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                开启后，图片将通过下方配置的第三方服务器加载
              </p>
            </div>
            <fluent-switch
              ref={masterSwitchRef}
              checked={imageHostState().masterEnabled}
              on:change={() => {
                handleToggle(!imageHostState().masterEnabled);
              }}
              aria-label="启用图床代理"
            />
          </div>
        </div>

        {/* Warning banner */}
        <Show when={imageHostState().masterEnabled}>
          <fluent-message-bar intent="warning">
            图片流量将不经过 Pixiv 官方服务器。第三方图床的可用性、速度和隐私策略不受 Pictelio
            控制。
          </fluent-message-bar>
        </Show>

        {/* Mode selector */}
        <div class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4">
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] mb-3">
            运行模式
          </p>
          <fluent-radio-group
            ref={radioGroupRef}
            value={imageHostState().mode}
            on:change={(e: CustomEvent) => {
              if (e.detail?.value != null) {
                setMode(e.detail.value);
              }
            }}
            disabled={!imageHostState().masterEnabled}
            class="flex flex-col gap-3"
          >
            {[
              {
                value: "race" as const,
                label: "并发请求",
                desc: "同时向所有启用图床发请求，取最快响应",
              },
              {
                value: "weighted" as const,
                label: "负载均衡",
                desc: "按权重随机选择图床",
                recommended: true,
              },
              {
                value: "fastest-ip" as const,
                label: "最快 IP 地址",
                desc: "探测后固定使用延迟最低的图床，30 秒刷新",
              },
              {
                value: "single" as const,
                label: "单一图床",
                desc: "指定使用某一个图床，不轮询",
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
                    on:click={() => setMode(option.value)}
                  />
                  <label
                    for={inputId}
                    class="flex-1 cursor-pointer [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]"
                    classList={{
                      "opacity-60": !imageHostState().masterEnabled,
                    }}
                  >
                    <span class="font-semibold">
                      {option.label}
                      {option.recommended && (
                        <span class="ml-2 px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold text-[var(--colorPaletteGreenForeground2)] bg-[var(--colorPaletteGreenBackground2)]">
                          推荐
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
                选择要使用的图床
              </p>
              <For each={imageHostState().hosts.filter((h) => h.enabled)}>
                {(host) => (
                  <div
                    class="flex items-center gap-3 p-3 rounded-[var(--borderRadiusMedium)] cursor-pointer transition-colors"
                    classList={{
                      "bg-[var(--colorCompoundBrandBackground)] text-white":
                        imageHostState().selectedHostId === host.id,
                      "bg-[var(--colorNeutralBackground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                        imageHostState().selectedHostId !== host.id,
                    }}
                    onClick={() => setSelectedHostId(host.id)}
                    role="button"
                    tabindex="0"
                    aria-label={`使用 ${host.name}`}
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
          class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-4"
          classList={{ "opacity-60": !imageHostState().masterEnabled }}
        >
          <div class="flex items-center justify-between mb-3">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              图床列表
            </p>
            <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {imageHostState().hosts.filter((h) => h.enabled).length} 个启用
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <For each={imageHostState().hosts}>
              {(host) => (
                <div class="flex items-center gap-3 p-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
                  <fluent-checkbox
                    checked={host.enabled}
                    on:change={() => updateHost(host.id, { enabled: !host.enabled })}
                    disabled={!imageHostState().masterEnabled}
                    aria-label={`启用 ${host.name}`}
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
                          权重
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
                      aria-label="编辑"
                      class="w-8 h-8 p-0 min-w-8"
                      on:click={() => openEdit(host)}
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
                        aria-label="重置"
                        class="w-8 h-8 p-0 min-w-8"
                        on:click={() => resetBuiltInHost(host.id)}
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
            on:click={handleProbe}
            disabled={isProbing() || !imageHostState().masterEnabled}
            class="flex-1"
          >
            <Show when={isProbing()}>
              <fluent-spinner size="tiny" slot="start" />
            </Show>
            立即测速
          </fluent-button>
          <fluent-button
            appearance="secondary"
            on:click={handleResetAll}
            disabled={!imageHostState().masterEnabled}
            class="flex-1"
          >
            全部重置
          </fluent-button>
        </div>
      </div>

      {/* Confirmation dialog */}
      <FluentDialog open={showConfirmDialog()} onClose={cancelEnable} aria-label="开启图床代理？">
        <h3 slot="title">开启图床代理？</h3>
        <div class="flex flex-col gap-2">
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
            图片将通过你配置的第三方服务器加载。
          </p>
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
            这些服务器不受 Pictelio 控制，可用性、速度或隐私风险由对应服务承担。
          </p>
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
            部分图床在部分地区可能无法访问，失败时会自动回退到默认代理。
          </p>
        </div>
        <fluent-button slot="actions" appearance="secondary" on:click={cancelEnable}>
          取消
        </fluent-button>
        <fluent-button slot="actions" appearance="primary" on:click={confirmEnable}>
          确认开启
        </fluent-button>
      </FluentDialog>

      {/* Edit dialog */}
      <FluentDialog open={editingHost() !== null} onClose={closeEdit} aria-label="编辑图床">
        <h3 slot="title">编辑图床</h3>
        <Show when={editError()}>
          <fluent-message-bar intent="error">{editError()}</fluent-message-bar>
        </Show>
        <div>
          <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
            名称
          </label>
          <input
            type="text"
            value={editName()}
            onInput={(e) => setEditName(e.currentTarget.value)}
            placeholder="例如 PixivCat"
            class="w-full px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] outline-none focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
          />
        </div>
        <div>
          <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
            代理 URL
          </label>
          <input
            type="text"
            value={editBaseUrl()}
            onInput={(e) => setEditBaseUrl(e.currentTarget.value)}
            placeholder="https://i.pixiv.re 或 https://example.com/image/{path}"
            class="w-full px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] outline-none focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
          />
        </div>
        <div class="flex items-center gap-2">
          <fluent-checkbox
            checked={editEnabled()}
            on:change={() => setEditEnabled(!editEnabled())}
          />
          <span class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]">
            启用
          </span>
        </div>
        <Show when={imageHostState().mode === "weighted"}>
          <div>
            <label class="block [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mb-1">
              权重 {editWeight()}
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
        <fluent-button slot="actions" appearance="secondary" on:click={closeEdit}>
          取消
        </fluent-button>
        <fluent-button slot="actions" appearance="primary" on:click={saveEdit}>
          保存
        </fluent-button>
      </FluentDialog>
    </div>
  );
};

export default ImageHostSettings;
