import type { Component } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import { setUgoiraDownloadFormat, ugoiraDownloadFormat } from "../../stores/settingsStore";
import { UGOIRA_FORMATS, type UgoiraFormat } from "../../utils/downloadQueueCore";

const FORMAT_LABELS: Record<UgoiraFormat, string> = {
  gif: "GIF",
  mp4: "MP4",
  webp: "WebP",
  apng: "APNG",
  zip: "ZIP",
  tar: "TAR",
};

/**
 * 设置页「下载」卡片（spec docs/specs/download-manager.md §5/§7.1）：
 * 下载管理入口 + 全局动图下载格式选择（键 settings_ugoira_download_format，默认 zip）。
 */
const SettingsDownload: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        下载
      </p>

      {/* 下载管理入口 */}
      <button
        type="button"
        class="w-full flex items-center justify-between py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalS)] rounded-[var(--borderRadiusMedium)] bg-transparent border-none outline-none cursor-pointer text-left transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.98] hover:bg-[var(--colorSubtleBackgroundHover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
        onClick={() => void navigate("/downloads")}
      >
        <span class="flex items-center gap-2">
          <FluentIcon name="list" size={20} />
          <span class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
            下载管理
          </span>
        </span>
        <FluentIcon name="chevronRight" size={16} />
      </button>

      {/* ugoira 下载格式（全局统一） */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="play" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            动图下载格式
          </p>
        </div>
        <div class="flex flex-wrap bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {UGOIRA_FORMATS.map((fmt) => (
            <button
              type="button"
              class={[
                "flex-1 min-w-[3.5rem] py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]",
                {
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    ugoiraDownloadFormat() === fmt,
                  "bg-transparent text-[var(--colorNeutralForeground2)]":
                    ugoiraDownloadFormat() !== fmt,
                },
              ]}
              onClick={() => void setUgoiraDownloadFormat(fmt)}
            >
              {FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mt-2 leading-snug">
          所有动图统一使用该格式导出，不可逐图设置。修改设置只影响之后加入队列的任务。
        </p>
      </div>
    </div>
  );
};

export default SettingsDownload;
