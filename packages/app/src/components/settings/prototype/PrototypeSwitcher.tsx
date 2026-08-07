import type { Component } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";

interface PrototypeVariant {
  key: string;
  label: string;
}

interface PrototypeSwitcherProps {
  variants: PrototypeVariant[];
  /** search 参数名，默认 "variant" */
  param?: string;
}

/**
 * UI 原型浮动切换条（仅开发模式渲染）。
 *
 * - 通过 `?variant=` 在既有路由上切换变体，URL 可分享、刷新稳定；
 * - 底部居中高对比胶囊条：左/右箭头循环切换，中央显示当前变体；
 * - `←` / `→` 方向键循环切换（输入框 / 文本域 / 可编辑元素聚焦时不拦截）；
 * - 生产构建（`import.meta.env.DEV === false`）整体不渲染，不会泄漏到用户包。
 */
const PrototypeSwitcher: Component<PrototypeSwitcherProps> = (props) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const param = () => props.param ?? "variant";
  const variants = () => props.variants;

  const currentIndex = () => {
    const raw = (searchParams as Record<string, string | undefined>)[param()];
    const i = variants().findIndex((v) => v.key === raw);
    return i >= 0 ? i : 0;
  };

  function go(next: number) {
    const n = (next + variants().length) % variants().length;
    const params = new URLSearchParams(window.location.search);
    params.set(param(), variants()[n].key);
    void navigate(`${window.location.pathname}?${params.toString()}`, { replace: true });
  }

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(currentIndex() - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(currentIndex() + 1);
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // 生产构建不渲染（Vite 将 DEV 替换为 false 并消除死代码）
  if (!import.meta.env.DEV) return null;

  const current = () => variants()[currentIndex()];

  return (
    <div class="fixed bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        class="pointer-events-auto flex items-center gap-0.5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorCompoundBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] shadow-[var(--elevation16)] px-1 py-0.5 select-none"
        role="group"
        aria-label="原型变体切换"
      >
        <button
          type="button"
          class="min-w-10 min-h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] hover:bg-[var(--colorBrandBackgroundHover)] active:scale-95 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] cursor-pointer appearance-none border-none outline-none focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
          onClick={() => go(currentIndex() - 1)}
          aria-label="上一个变体"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14.7 4.22a.75.75 0 0 1 0 1.06L8.06 12l6.64 6.72a.75.75 0 1 1-1.06 1.06l-7.25-7.25a.75.75 0 0 1 0-1.06l7.25-7.25a.75.75 0 0 1 1.06 0z"
              fill="currentColor"
            />
          </svg>
        </button>
        <span class="[font-size:var(--fontSizeBase200)] font-semibold whitespace-nowrap px-1">
          {current().key} — {current().label}
        </span>
        <button
          type="button"
          class="min-w-10 min-h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] hover:bg-[var(--colorBrandBackgroundHover)] active:scale-95 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] cursor-pointer appearance-none border-none outline-none focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
          onClick={() => go(currentIndex() + 1)}
          aria-label="下一个变体"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M8.22 4.22a.75.75 0 0 1 1.06 0l7.25 7.25a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06-1.06L15.19 12 8.22 5.28a.75.75 0 0 1 0-1.06z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default PrototypeSwitcher;
