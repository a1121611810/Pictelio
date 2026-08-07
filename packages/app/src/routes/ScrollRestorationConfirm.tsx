import { type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { setPersistScrollRestoration } from "@/stores/uiStore";

// 「持久化滚动恢复」开启二次确认页（变体 B：内容偏上 + 底部固定操作栏，拇指可达）。
// 进入方式：设置 → 外观 → 持久化滚动恢复（开启方向）。
// 确认：setPersistScrollRestoration(true) + 自动返回设置页；取消：直接返回。

/** 信息图标（regular 用于半透明底、filled 用于主体） */
const infoIcon = {
  regular:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zm0 6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm0-3.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z",
  filled:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1z",
};

/** 渐变装饰背景 */
const gradientBg = () => (
  <div
    class="absolute inset-0 pointer-events-none"
    style={{
      background:
        "radial-gradient(ellipse 80% 50% at 50% -20%, var(--colorBrandStroke2) 0%, transparent 70%)",
    }}
  />
);

const title = "开启持久化滚动恢复？";
const subtitle = "开启后，列表将不再固定从顶部开始";
const impacts = [
  "重新打开应用后，列表会停留在上次浏览的位置，不再从顶部开始",
  "浏览列表时，图片加载可能导致列表位置出现跳动",
];

/** 「持久化滚动恢复」开启二次确认页（底部操作栏） */
const ScrollRestorationConfirm: Component = () => {
  const navigate = useNavigate();

  function back() {
    void navigate(-1);
  }

  function confirmEnable() {
    setPersistScrollRestoration(true);
    void navigate(-1); // 开启后自动返回设置页
  }

  return (
    <div class="min-h-screen flex flex-col bg-[var(--colorNeutralBackground2)]">
      {gradientBg()}
      <div class="h-[env(safe-area-inset-top,0px)] relative z-10" />
      <div class="flex-1 flex flex-col px-6 pt-10 pb-4 relative z-10">
        <div class="w-12 h-12 text-[var(--colorBrandForeground1)] mb-5">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d={infoIcon.regular} fill="currentColor" opacity="0.12" />
            <path d={infoIcon.filled} fill="currentColor" opacity="1" />
          </svg>
        </div>
        <h1 class="text-[var(--fontSizeHero800)] font-semibold text-[var(--colorNeutralForeground1)] leading-tight mb-2">
          {title}
        </h1>
        <p class="text-[var(--fontSizeBase400)] text-[var(--colorNeutralForeground2)] leading-snug mb-5">
          {subtitle}
        </p>
        <div class="surface-card rounded-[var(--borderRadiusMedium)] p-5 flex flex-col gap-3">
          {impacts.map((t) => (
            <div class="flex items-start gap-3">
              <span class="w-1.5 h-1.5 mt-[0.55em] flex-shrink-0 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandStroke2)]" />
              <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                {t}
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* 底部固定操作栏 */}
      <div class="relative z-10 px-6 pb-[max(env(safe-area-inset-bottom,0px),1rem)] pt-3 bg-[var(--colorNeutralBackground2)] border-t border-[var(--colorNeutralStroke2)]">
        <div class="flex gap-3 w-full">
          <fluent-button appearance="secondary" style="flex:1" on:click={back}>
            取消
          </fluent-button>
          <fluent-button appearance="primary" style="flex:1" on:click={confirmEnable}>
            确认开启
          </fluent-button>
        </div>
      </div>
    </div>
  );
};

export default ScrollRestorationConfirm;
