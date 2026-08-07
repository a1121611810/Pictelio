import { type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { setPersistScrollRestoration } from "@/stores/uiStore";

/** 信息图标（regular 用于半透明底、filled 用于主体） */
const infoIcon = {
  regular:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zm0 6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm0-3.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z",
  filled:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1z",
};

/**
 * 「持久化滚动恢复」开启确认页：说明开启后的行为变化，
 * 点击「确认开启」才真正启用并自动返回设置页；取消则直接返回。
 */
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
      {/* 装饰性背景渐变 */}
      <div
        class="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, var(--colorBrandStroke2) 0%, transparent 70%)",
        }}
      />

      {/* 顶部安全区域 */}
      <div class="h-[env(safe-area-inset-top,0px)] relative z-10" />

      {/* 主内容 —— 垂直居中 */}
      <div class="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        <div
          class="w-full max-w-sm surface-dialog p-8 flex flex-col items-center gap-6"
          style={{
            animation: "fluent-scale-enter var(--durationNormal) var(--curveDecelerateMid) both",
          }}
        >
          {/* 图标 */}
          <div class="w-12 h-12 text-[var(--colorBrandForeground1)] flex-shrink-0">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d={infoIcon.regular} fill="currentColor" opacity="0.12" />
              <path d={infoIcon.filled} fill="currentColor" opacity="1" />
            </svg>
          </div>

          {/* 标题与说明 */}
          <div class="flex flex-col items-center gap-2 text-center">
            <h1 class="text-[var(--fontSizeHero700)] font-semibold text-[var(--colorNeutralForeground1)] leading-tight">
              开启持久化滚动恢复？
            </h1>
            <p class="text-[var(--fontSizeBase400)] text-[var(--colorNeutralForeground2)] leading-snug">
              开启后，列表将不再固定从顶部开始
            </p>
            <ul class="text-left text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug max-w-[280px] flex flex-col gap-1">
              <li>• 重新打开应用后，列表会停留在上次浏览的位置，不再从顶部开始</li>
              <li>• 浏览列表时，图片加载可能导致列表位置出现跳动</li>
            </ul>
          </div>

          {/* 按钮组 */}
          <div class="flex flex-col gap-3 w-full">
            <fluent-button appearance="primary" style="width:100%" on:click={confirmEnable}>
              确认开启
            </fluent-button>
            <fluent-button appearance="secondary" style="width:100%" on:click={back}>
              取消
            </fluent-button>
          </div>
        </div>
      </div>

      {/* 底部安全区域 */}
      <div class="h-[env(safe-area-inset-bottom,0px)] relative z-10" />
    </div>
  );
};

export default ScrollRestorationConfirm;
