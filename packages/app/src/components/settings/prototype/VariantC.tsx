import type { Component } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import SettingsAppearance from "../SettingsAppearance";
import SettingsContent from "../SettingsContent";
import SettingsImage from "../SettingsImage";
import SettingsTranslate from "../SettingsTranslate";
import SettingsClient from "../SettingsClient";
import SettingsAccount from "../SettingsAccount";
import { LogoutRow, type SettingsVariantProps } from "./shared";

interface SectionDef {
  id: string;
  label: string;
  keywords: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: "appearance",
    label: "显示与交互",
    keywords: "主题 外观 布局 滚动 持久化 风格 显示 交互",
  },
  {
    id: "content",
    label: "内容与过滤",
    keywords: "内容 过滤 R18 R18G 屏蔽 年龄 成人 举报",
  },
  {
    id: "image",
    label: "图片与网络",
    keywords: "图片 画质 动图 ugoira 缓存 图床 网络 代理",
  },
  {
    id: "translate",
    label: "翻译设置",
    keywords: "翻译 DeepSeek API Key 缓存 质量 思考 敏感",
  },
  {
    id: "client",
    label: "客户端",
    keywords: "客户端 引擎 webview lynx 切换 渲染",
  },
  {
    id: "account",
    label: "账户与数据",
    keywords: "账户 数据 缓存 清除 删除 更新 检查 关于 版本",
  },
];

function scrollToSection(id: string) {
  document
    .getElementById(`variant-c-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 设置页 UI 原型 — 变体 C：搜索索引（Searchable Index）
 *
 * 主交互：输入过滤定位。信息层级：设置项优先。
 * 顶部 sticky 搜索框按区块标题/关键词过滤；区块 chip 导航点击平滑滚动定位；
 * 无输入时全部区块紧凑堆叠。
 */
const VariantC: Component<SettingsVariantProps> = (props) => {
  const [query, setQuery] = createSignal("");

  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keywords.toLowerCase().includes(q),
    );
  });

  const hasQuery = () => query().trim() !== "";

  return (
    <div>
      {/* Sticky 搜索框（贴在 header 下方） */}
      <div class="sticky top-12 z-10 -mx-5 px-5 py-2 bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)]">
        <div class="flex items-center gap-2 bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusMedium)] border border-[var(--colorNeutralStroke1)] px-[var(--spacingHorizontalMNudge)] py-[var(--spacingVerticalSNudge)]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            class="flex-shrink-0 text-[var(--colorNeutralForeground3)]"
          >
            <path
              d="M10 2a8 8 0 1 0 4.906 14.32l4.387 4.387a1 1 0 0 0 1.414-1.414l-4.387-4.387A8 8 0 0 0 10 2zm-6 8a6 6 0 1 1 12 0 6 6 0 0 1-12 0z"
              fill="currentColor"
            />
          </svg>
          <input
            type="search"
            value={query()}
            placeholder="搜索设置（如：翻译 / 缓存 / R18）"
            autocomplete="off"
            spellcheck={false}
            class="flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] placeholder:text-[var(--colorNeutralForegroundDisabled)]"
            onInput={(e) => setQuery(e.currentTarget.value)}
            aria-label="搜索设置"
          />
          <Show when={hasQuery()}>
            <button
              type="button"
              class="min-w-8 min-h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground3)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-90 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] cursor-pointer appearance-none border-none outline-none focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.53 6.47a.75.75 0 0 1 0 1.06L13.06 12l2.47 2.47a.75.75 0 1 1-1.06 1.06L12 13.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L10.94 12 8.47 9.53a.75.75 0 0 1 1.06-1.06L12 10.94l2.47-2.47a.75.75 0 0 1 1.06 0z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* 区块导航 chips */}
      <div class="flex flex-wrap gap-2 py-3" role="navigation" aria-label="设置分类快捷跳转">
        <For each={visible()}>
          {(s) => (
            <button
              type="button"
              class="px-3 py-1.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] cursor-pointer appearance-none border-none outline-none focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
              onClick={() => scrollToSection(s.id)}
            >
              {s.label}
            </button>
          )}
        </For>
      </div>

      {/* 区块列表（无匹配时提示） */}
      <Show
        when={visible().length > 0}
        fallback={
          <p class="py-10 text-center [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            没有匹配的设置项
          </p>
        }
      >
        <div class="flex flex-col">
          <For each={visible()}>
            {(s) => (
              <section id={`variant-c-${s.id}`} class="scroll-mt-32">
                <Show when={s.id === "appearance"}>
                  <SettingsAppearance />
                </Show>
                <Show when={s.id === "content"}>
                  <SettingsContent
                    onOpenBlocklist={props.onOpenBlocklist}
                    setAgeGateMessage={props.setAgeGateMessage}
                  />
                </Show>
                <Show when={s.id === "image"}>
                  <SettingsImage />
                </Show>
                <Show when={s.id === "translate"}>
                  <SettingsTranslate />
                </Show>
                <Show when={s.id === "client"}>
                  <SettingsClient />
                </Show>
                <Show when={s.id === "account"}>
                  <div class="flex flex-col gap-1">
                    <SettingsAccount
                      onClearData={props.onClearData}
                      onDeleteAccount={props.onDeleteAccount}
                      onActionToast={props.onActionToast}
                    />
                    <LogoutRow isLoggedIn={props.isLoggedIn} onLogout={props.onLogout} />
                  </div>
                </Show>
              </section>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default VariantC;
