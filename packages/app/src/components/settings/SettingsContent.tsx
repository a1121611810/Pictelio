import type { Component } from "solid-js";
import {
  showR18,
  setShowR18,
  showR18G,
  setShowR18G,
  ageConfirmed,
  isAdult,
  setAgeConfirmation,
} from "../../stores/settingsStore";

interface SettingsContentProps {
  onOpenBlocklist: () => void;
  setAgeGateMessage: (msg: string | null) => void;
}

const SettingsContent: Component<SettingsContentProps> = (props) => {
  const navigate = useNavigate();

  function requireAdult(action: () => void) {
    if (!isAdult()) {
      props.setAgeGateMessage("请先确认已满 18 岁");
      return;
    }
    action();
  }

  function reconfirmAge() {
    setAgeConfirmation(false, false);
    void navigate("/age-confirmation?reconfirm=true");
  }

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        内容与过滤
      </p>

      {/* 显示 R18 内容开关行 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6.25 3A3.25 3.25 0 0 0 3 6.25v11.5A3.25 3.25 0 0 0 6.25 21h11.5A3.25 3.25 0 0 0 21 17.75V6.25A3.25 3.25 0 0 0 17.75 3H6.25zm0 1.5h11.5a1.75 1.75 0 0 1 1.75 1.75v11.5c0 .966-.784 1.75-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25c0-.966.784-1.75 1.75-1.75zM7 8.75A1.75 1.75 0 0 1 8.75 7h.084A1.75 1.75 0 0 1 10.5 8.84v.33a1.75 1.75 0 0 1-1.75 1.75l-.084-.001A1.75 1.75 0 0 1 7 9.08V8.75zm6.5 0A1.75 1.75 0 0 1 15.25 7h.084A1.75 1.75 0 0 1 17 8.84v.33a1.75 1.75 0 0 1-1.75 1.75l-.084-.001A1.75 1.75 0 0 1 13.5 9.08V8.75zM8.724 15.5a.75.75 0 0 0 0 1.5h6.552a.75.75 0 0 0 0-1.5H8.724z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              显示 R18 内容
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              关闭后列表中不展示敏感内容，需刷新列表生效
            </p>
          </div>
        </div>

        <fluent-switch
          checked={showR18()}
          on:change={() => requireAdult(() => setShowR18(!showR18()))}
          aria-label="显示 R18 内容"
        />
      </div>

      {/* 显示 R-18G 内容开关行 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M10.82 2.001a1.752 1.752 0 0 1 2.36 0c.53.47 6.07 5.42 8.587 11.508.168.405.233.815.233 1.211a4.751 4.751 0 0 1-4.755 4.752 4.4 4.4 0 0 1-1.77-.427L15.5 19c-3.428 0-5.26 0-7-.027a4.753 4.753 0 0 1-4.727-4.725c0-.397.065-.807.233-1.211C6.525 7.422 12.065 2.472 12.595 2l.005.005L10.82 2zm1.18 1.44c-.26.28-5.643 5.058-8.065 10.798a3.28 3.28 0 0 0-.185.796 3.253 3.253 0 0 0 3.24 3.222c1.678.026 3.412.027 6.76.027h.225c.236 0 .473.07.675.2l.022.014a2.9 2.9 0 0 0 1.163.277 3.251 3.251 0 0 0 3.188-2.538c.031-.22.049-.443.052-.667v-.048a3.25 3.25 0 0 0-.157-.813C16.846 8.498 11.463 3.72 11.2 3.44L12 2.64l-.8.8h.001zM12 8.001a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              显示 R-18G 内容
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              关闭后列表中不展示猎奇内容，需刷新列表生效
            </p>
          </div>
        </div>

        <fluent-switch
          checked={showR18G()}
          on:change={() => requireAdult(() => setShowR18G(!showR18G()))}
          aria-label="显示 R-18G 内容"
        />
      </div>

      {/* 重新确认年龄 */}
      <Show when={ageConfirmed()}>
        <div class="flex items-center justify-between py-2">
          <div class="flex items-center gap-3">
            <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 4.5a.75.75 0 0 1 .75.75v4.19l2.47 2.47a.75.75 0 0 1-1.06 1.06l-2.72-2.72a.75.75 0 0 1-.22-.53V8.75a.75.75 0 0 1 .75-.75z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div>
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                重新确认年龄
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                点击后重新进入年龄确认页面
              </p>
            </div>
          </div>

          <fluent-button appearance="secondary" on:click={reconfirmAge}>
            重新确认
          </fluent-button>
        </div>
      </Show>

      {/* 管理屏蔽列表 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={() => props.onOpenBlocklist()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onOpenBlocklist();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="管理屏蔽列表"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm4.25 6.25a.75.75 0 0 1 0 1.06l-8.5 8.5a.75.75 0 1 1-1.06-1.06l8.5-8.5a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              管理屏蔽列表
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              查看或解除已屏蔽的作者
            </p>
          </div>
        </div>
        {/* Chevron right */}
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
    </div>
  );
};

export default SettingsContent;
