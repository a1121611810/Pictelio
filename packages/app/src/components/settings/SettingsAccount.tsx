import type { Component } from "solid-js";
import {
  autoCheckUpdate,
  setAutoCheckUpdate,
  hasUpdate,
  isCheckingUpdate,
  latestVersion,
  checkCompleted,
  setIsCheckingUpdate,
  setHasUpdate,
  setLatestVersion,
  setLatestReleaseUrl,
  setCheckCompleted,
} from "../../stores/settingsStore";
import { clearImageCache } from "../../utils/imageLoader";
import PictelioIcon from "../PictelioIcon";
import { checkForUpdate } from "../../services/updateService";

interface Props {
  onClearData: () => void;
  onDeleteAccount: () => void;
  onActionToast: (msg: string) => void;
}

async function handleCheckUpdate() {
  if (isCheckingUpdate()) {
    return;
  }
  setIsCheckingUpdate(true);
  const result = await checkForUpdate(APP_VERSION);
  setHasUpdate(result.hasUpdate);
  setLatestVersion(result.latestVersion);
  setLatestReleaseUrl(result.latestReleaseUrl);
  setIsCheckingUpdate(false);
  setCheckCompleted(true);
  if (result.hasUpdate && result.latestReleaseUrl) {
    window.open(result.latestReleaseUrl, "_blank", "noopener,noreferrer");
  }
}

const SettingsAccount: Component<Props> = (props) => {
  const navigate = useNavigate();

  function handleClearImageCache() {
    const [err] = trySync(() => clearImageCache());
    props.onActionToast(err ? "清除图片缓存失败" : "图片缓存已清除");
  }

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        账户与数据
      </p>

      {/* 清除图片缓存 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={handleClearImageCache}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClearImageCache();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="清除图片缓存"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.66 5.66a1 1 0 0 1 0 1.41L13.41 12l4.25 4.25a1 1 0 0 1-1.41 1.41L12 13.41l-4.25 4.25a1 1 0 0 1-1.41-1.41L10.59 12 6.34 7.75a1 1 0 0 1 1.41-1.41L12 10.59l4.25-4.25a1 1 0 0 1 1.41 0z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              清除图片缓存
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              清理已下载的插画和小说封面缓存
            </p>
          </div>
        </div>
      </div>

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

      <fluent-divider></fluent-divider>

      {/* 启动时检查更新 — toggle row */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 4.5a7.5 7.5 0 0 0-5.303 12.803.75.75 0 0 0 1.06-1.06A6 6 0 1 1 18 12h-3.75a.75.75 0 0 0-.53 1.28l3.25 3.247a.75.75 0 0 0 1.06 0l3.25-3.247A.75.75 0 0 0 20.28 12H16.5A7.5 7.5 0 0 0 12 4.5z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              启动时检查更新
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              每次打开 App 时后台检测新版本
            </p>
          </div>
        </div>
        <fluent-switch
          checked={autoCheckUpdate()}
          on:change={() => setAutoCheckUpdate(!autoCheckUpdate())}
          aria-label="启动时检查更新"
        />
      </div>

      {/* 检查更新 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={handleCheckUpdate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCheckUpdate();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="检查更新"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.25 14.66l-4-4a.75.75 0 0 1 1.06-1.06l2.97 2.97 5.22-5.97a.75.75 0 1 1 1.14 1l-5.75 6.5a.75.75 0 0 1-.56.25.75.75 0 0 1-.55-.23l-.53-.52V16.66z"
                fill="currentColor"
              />
            </svg>
          </div>
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            检查更新
          </p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-3">
          {/* Loading spinner */}
          <Show when={isCheckingUpdate()}>
            <fluent-spinner size="tiny"></fluent-spinner>
          </Show>
          {/* Latest version tag — visible after check completes */}
          <Show when={checkCompleted() && !isCheckingUpdate()}>
            <span
              class="[font-size:var(--fontSizeBase200)] font-semibold leading-snug"
              classList={{
                "text-[var(--colorStatusSuccessForeground1)]":
                  !hasUpdate() && latestVersion() !== "",
                "text-[var(--colorBrandForeground1)]": hasUpdate(),
                "text-[var(--colorNeutralForeground3)]": latestVersion() === "",
              }}
            >
              {latestVersion() !== ""
                ? hasUpdate()
                  ? `v${latestVersion()} ✨`
                  : `v${APP_VERSION} ✅`
                : `v${APP_VERSION} 🔄`}
            </span>
          </Show>
        </div>
      </div>

      {/* About entry — clickable row */}
      <div
        class="flex items-center justify-between mx-0 mt-2 mb-4 px-1 py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)]"
        onClick={() => {
          void navigate("/about");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void navigate("/about");
          }
        }}
        role="button"
        tabindex="0"
        aria-label="关于"
      >
        <div class="flex items-center gap-3 min-w-0">
          <PictelioIcon size="32" class="flex-shrink-0" />
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              Pictelio
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              关于 · v{APP_VERSION}
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
