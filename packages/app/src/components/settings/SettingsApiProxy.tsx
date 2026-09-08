import type { Component } from "solid-js";
import { createSignal } from "solid-js";
import { apiProxyUrl, setApiProxyBase } from "@/stores/apiProxyStore";

/** 行容器（对齐 SettingsDirectAccess 的密度与 Fluent 令牌） */
const ROW_CLASS = "flex items-center justify-between min-h-[40px] gap-[var(--spacingHorizontalM)]";
const LABEL_CLASS = "text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]";
const ACTION_BUTTON_CLASS =
  "rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)] " +
  "text-[var(--colorNeutralForeground1)] bg-[var(--colorNeutralBackground3)] " +
  "hover:bg-[var(--colorNeutralBackground4)] active:bg-[var(--colorNeutralBackground5)] " +
  "[font-size:var(--fontSizeBase200)] cursor-pointer min-w-[40px] disabled:opacity-50";

/**
 * 设置卡「API 反代」（ADR-0146 D3）：用户自建 Cloudflare Worker 的基址输入。
 * 空 = 关闭（官方域名 + 直连兜底）；保存时 https 校验与尾斜杠归一化（store 侧）。
 */
const SettingsApiProxy: Component = () => {
  const [draft, setDraft] = createSignal(apiProxyUrl());
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  function save() {
    setNotice(null);
    const err = setApiProxyBase(draft());
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setNotice(
      apiProxyUrl() === ""
        ? "反代已关闭（走官方域名与直连兜底）"
        : "反代已保存（下一次请求即生效）",
    );
  }

  return (
    <div class="flex flex-col gap-[var(--spacingVerticalS)]">
      <div>
        <p class="m-0 [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)]">
          API 反代
        </p>
        <p class="mt-1 mb-0 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          自建 Cloudflare Worker 反代 API 与 OAuth（部署指引见仓库 worker/ 目录）。
          官方直连兜底保留：未填写时维持现状。
        </p>
      </div>

      <div class={ROW_CLASS}>
        <span class={LABEL_CLASS}>当前状态</span>
        <span class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)]">
          {apiProxyUrl() === "" ? "未启用" : apiProxyUrl()}
        </span>
      </div>

      <input
        type="url"
        placeholder="https://pictelio-api-proxy.<子域>.workers.dev"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        class="rounded-[var(--borderRadiusSmall)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] min-h-[40px] outline-none focus-visible:outline focus-visible:outline-[var(--colorBrandStroke1)]"
      />

      <Show when={error()}>
        <p
          role="alert"
          class="m-0 text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase200)]"
        >
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p
          role="status"
          class="m-0 text-[var(--colorStatusSuccessForeground1)] [font-size:var(--fontSizeBase200)]"
        >
          {notice()}
        </p>
      </Show>

      <div class="flex gap-[var(--spacingHorizontalS)]">
        <button type="button" class={ACTION_BUTTON_CLASS} onClick={save}>
          保存反代地址
        </button>
        <button
          type="button"
          class={ACTION_BUTTON_CLASS}
          onClick={() => {
            setDraft("");
            setApiProxyBase("");
            setNotice("反代已关闭（走官方域名与直连兜底）");
          }}
        >
          清除
        </button>
      </div>
    </div>
  );
};

export default SettingsApiProxy;
