import { type Component } from "solid-js";
import ThemeSelector from "../ThemeSelector";
import { persistScrollRestoration, setPersistScrollRestoration } from "../../stores/uiStore";

const SettingsAppearance: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        显示与交互
      </p>

      {/* 主题与风格选择器 */}
      <div class="py-3">
        <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-2">
          主题与风格
        </p>
        <ThemeSelector />
        <p class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
          卡片风格提供更大的圆角和白色卡片容器；明暗主题在所有风格下均可用
        </p>
      </div>

      {/* 布局设置入口 — 点击进入独立页面 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={() => {
          void navigate("/layout-settings");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void navigate("/layout-settings");
          }
        }}
        role="button"
        tabindex="0"
        aria-label="布局设置"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 6.25A3.25 3.25 0 0 1 6.25 3h11.5A3.25 3.25 0 0 1 21 6.25v11.5A3.25 3.25 0 0 1 17.75 21H6.25A3.25 3.25 0 0 1 3 17.75V6.25zM6.25 4.5A1.75 1.75 0 0 0 4.5 6.25V9h2.25V5.25A1.72 1.72 0 0 0 6.25 4.5zM4.5 10.5v3h3v-3h-3zm4.5 0v3h3.75v-3H9zm5.25 0v3h3.75v-3h-3zm3.75-1.5h-3.75V5.25c.455 0 .873.173 1.188.48l.012.012.018.018c.315.315.506.735.532 1.19V9zm-5.25 0H9V5.25h3.75V9zm-8.25 6v2.75c0 .966.784 1.75 1.75 1.75h.5V15H4.5zm3.75 0v4.5H9V15H8.25zm5.25 0v4.5h.75V15h-.75zm5.25 0v4.5h.5a1.75 1.75 0 0 0 1.75-1.75V15h-2.25z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              布局设置
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              插画/小说布局模式、楼梯导航、自动隐藏导航栏
            </p>
          </div>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          class="flex-shrink-0 text-[var(--colorNeutralForeground3)] ml-2"
        >
          <path
            d="M8.22 4.22a.75.75 0 0 1 1.06 0l7.25 7.25a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06-1.06L15.19 12 8.22 5.28a.75.75 0 0 1 0-1.06z"
            fill="currentColor"
          />
        </svg>
      </div>

      {/* 持久化滚动恢复开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 7a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2H7zM6 12a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1zm1 3a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7zM2 5.75A3.75 3.75 0 0 1 5.75 2h12.5A3.75 3.75 0 0 1 22 5.75v12.5A3.75 3.75 0 0 1 18.25 22H5.75A3.75 3.75 0 0 1 2 18.25V5.75zM5.75 3.5c-.46 0-.84.166-1.16.516-.335.367-.59.902-.59 1.734v12.5c0 .832.255 1.367.59 1.734.32.35.7.516 1.16.516h12.5c.46 0 .84-.166 1.16-.516.335-.367.59-.902.59-1.734V5.75c0-.832-.255-1.367-.59-1.734-.32-.35-.7-.516-1.16-.516H5.75z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              持久化滚动恢复
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              关闭时重新打开应用始终从列表顶部开始（默认）；开启后恢复上次浏览位置
            </p>
          </div>
        </div>
        <fluent-switch
          checked={persistScrollRestoration()}
          on:change={() => setPersistScrollRestoration(!persistScrollRestoration())}
          aria-label="持久化滚动恢复"
        />
      </div>
    </div>
  );
};

export default SettingsAppearance;
