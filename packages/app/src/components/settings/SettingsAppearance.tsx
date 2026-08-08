import { type Component } from "solid-js";
import ThemeSelector from "../ThemeSelector";
import {
  autoHideNavBar,
  setAutoHideNavBar,
  showDetailStairs,
  setShowDetailStairs,
} from "../../stores/settingsStore";
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

      {/* 详情页楼梯导航开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 6.25A3.25 3.25 0 0 1 6.25 3h11.5A3.25 3.25 0 0 1 21 6.25v11.5A3.25 3.25 0 0 1 17.75 21H6.25A3.25 3.25 0 0 1 3 17.75V6.25zM6.25 4.5A1.75 1.75 0 0 0 4.5 6.25V9h2.25V5.25A1.72 1.72 0 0 0 6.25 4.5z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              详情页楼梯导航
              <span class="inline-flex items-center ml-1 px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold text-[var(--colorPaletteGreenForeground2)] bg-[var(--colorPaletteGreenBackground2)] align-middle">
                Beta
              </span>
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              在多页作品中显示右侧页码导航条，方便快速跳转
            </p>
          </div>
        </div>
        <fluent-switch
          checked={showDetailStairs()}
          on:change={() => setShowDetailStairs(!showDetailStairs())}
          aria-label="详情页楼梯导航"
        />
      </div>

      {/* 自动隐藏导航栏开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3.75 5.25a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75zm0 4.5a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75zm0 4.5a.75.75 0 0 0 0 1.5h11.5a.75.75 0 0 0 0-1.5H3.75z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              自动隐藏导航栏
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              在个人页与关注列表等页面向下滚动时收起导航栏，上滑时重新显示
            </p>
          </div>
        </div>
        <fluent-switch
          checked={autoHideNavBar()}
          on:change={() => setAutoHideNavBar(!autoHideNavBar())}
          aria-label="自动隐藏导航栏"
        />
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
          on:change={(e: Event) => {
            const turningOn = (e.target as HTMLInputElement)?.checked;
            if (turningOn) {
              // 开启需要二次确认（说明影响）：跳确认页，确认后才真正开启并自动返回
              void navigate("/scroll-restoration-confirm");
            } else {
              // 关闭直接生效（默认行为，无需确认）
              setPersistScrollRestoration(false);
            }
          }}
          aria-label="持久化滚动恢复"
        />
      </div>
    </div>
  );
};

export default SettingsAppearance;
