import type { Component } from "solid-js";

interface Props {
  onClearData: () => void;
  onDeleteAccount: () => void;
}

/** 账户卡：数据清理与账号操作（更新/关于条目已拆至 SettingsUpdate 卡）。 */
const SettingsAccount: Component<Props> = (props) => {
  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        账户
      </p>

      {/* 清除所有本地数据 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={props.onClearData}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onClearData();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="清除所有本地数据"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorStatusDangerForeground1)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.66 5.66a1 1 0 0 1 0 1.41L13.41 12l4.25 4.25a1 1 0 0 1-1.41 1.41L12 13.41l-4.25 4.25a1 1 0 0 1-1.41-1.41L10.59 12 6.34 7.75a1 1 0 0 1 1.41-1.41L12 10.59l4.25-4.25a1 1 0 0 1 1.41 0z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorStatusDangerForeground1)] leading-snug">
              清除所有本地数据
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              删除登录凭证、图片缓存、设置、屏蔽与举报记录
            </p>
          </div>
        </div>
      </div>

      {/* 删除 Pixiv 账号 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={props.onDeleteAccount}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onDeleteAccount();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="删除 Pixiv 账号"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.25 10.75a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06-1.06l5.5-5.5a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              删除 Pixiv 账号
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              打开 Pixiv 官方账号删除页面，按官方流程操作
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

export default SettingsAccount;
