import { type Component } from "solid-js";
import { setAgeConfirmation } from "../stores/settingsStore";
import { initializeAuth, isLoggedIn, setIsLoading } from "../stores/authStore";

// ── Fluent UI System Icon: ShieldCheckmark (24px) ──
// Sourced from microsoft/fluentui-system-icons
const shieldIcon = {
  regular:
    "M12 2a1 1 0 0 1 .6.2l7 5.09c.25.18.4.47.4.78v5.65c0 2.33-.78 4.28-2.23 5.8C16.4 20.97 14.33 21.95 12 22c-2.33-.05-4.4-1.03-5.77-2.48C4.78 18 4 16.05 4 13.72V8.07c0-.31.15-.6.4-.78l7-5.09A1 1 0 0 1 12 2zm0 1.86L6 8.43v5.3c0 1.97.65 3.56 1.85 4.83C9 19.78 10.53 20.63 12 20.8c1.47-.17 3-1.02 4.15-2.24C17.35 17.28 18 15.7 18 13.72v-5.3l-6-4.57zm3.7 6.15a1 1 0 0 1 0 1.41l-4.24 4.25a1 1 0 0 1-1.42 0L8.3 13.7a1 1 0 0 1 1.41-1.42l1.05 1.05 3.53-3.53a1 1 0 0 1 1.42 0z",
  filled:
    "M12 2a1 1 0 0 1 .6.2l7 5.09c.25.18.4.47.4.78v5.65c0 2.33-.78 4.28-2.23 5.8C16.4 20.97 14.33 21.95 12 22c-2.33-.05-4.4-1.03-5.77-2.48C4.78 18 4 16.05 4 13.72V8.07c0-.31.15-.6.4-.78l7-5.09A1 1 0 0 1 12 2zm3.7 8.01a1 1 0 0 0-1.41-1.42l-3.53 3.53L9.7 11.08a1 1 0 1 0-1.41 1.42l2.12 2.12a1 1 0 0 0 1.42 0l4.24-4.24a1 1 0 0 0 .05-1.39l-.42.02z",
};

/**
 * 年龄确认页面（全屏页面，非弹窗）
 *
 * 应用启动时直接展示此页面，用户确认年龄后再进行登录相关判断。
 * 设置页的"重新确认"入口也会导航到此页面。
 */
const AgeConfirmation: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReconfirm = () => searchParams.reconfirm === "true";

  async function handleConfirm(isAdult: boolean) {
    await setAgeConfirmation(true, isAdult);

    if (isReconfirm()) {
      navigate("/home", { replace: true });
    } else {
      const [authErr] = await tryAsync(initializeAuth());
      setIsLoading(false);
      if (authErr) {
        console.error("[AgeConfirmation] Auth initialization failed", authErr);
      }
      navigate(isLoggedIn() ? "/home" : "/login", { replace: true });
    }
  }

  async function confirmAdult() {
    await handleConfirm(true);
  }

  async function confirmMinor() {
    await handleConfirm(false);
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
        {/* 卡片容器 */}
        <div
          class="w-full max-w-sm surface-dialog p-8 flex flex-col items-center gap-6"
          style={{
            animation: "fluent-scale-enter var(--durationNormal) var(--curveDecelerateMid) both",
          }}
        >
          {/* 图标 */}
          <div class="w-12 h-12 text-[var(--colorBrandForeground1)] flex-shrink-0">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d={shieldIcon.regular} fill="currentColor" opacity="0.12" />
              <path d={shieldIcon.filled} fill="currentColor" opacity="1" />
            </svg>
          </div>

          {/* 标题 */}
          <div class="flex flex-col items-center gap-2 text-center">
            <h1 class="text-[var(--fontSizeHero700)] font-semibold text-[var(--colorNeutralForeground1)] leading-tight">
              年龄确认
            </h1>
            <p class="text-[var(--fontSizeBase400)] text-[var(--colorNeutralForeground2)] leading-snug">
              你是否已满 18 周岁？
            </p>
            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug max-w-[260px]">
              本应用包含 R-18 / R-18G 内容，未成年人请在监护人指导下使用。
            </p>
          </div>

          {/* 按钮组 */}
          <div class="flex flex-col gap-3 w-full">
            <fluent-button appearance="primary" style="width:100%" on:click={confirmAdult}>
              已满 18 岁
            </fluent-button>
            <fluent-button appearance="secondary" style="width:100%" on:click={confirmMinor}>
              未满 18 岁
            </fluent-button>
          </div>
        </div>
      </div>

      {/* 底部安全区域 */}
      <div class="h-[env(safe-area-inset-bottom,0px)] relative z-10" />
    </div>
  );
};

export default AgeConfirmation;
