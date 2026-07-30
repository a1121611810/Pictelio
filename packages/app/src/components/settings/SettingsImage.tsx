import { type Component } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import {
  listQuality,
  setListQuality,
  detailQuality,
  setDetailQuality,
  type ImageQuality,
} from "../../stores/settingsStore";
import { imageHostState, setMasterEnabled, modeLabel } from "../../stores/imageHostStore";

const SettingsImage: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        图片与网络
      </p>

      {/* List image quality */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="image" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            列表画质
          </p>
        </div>
        <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {(["medium", "large"] as ImageQuality[]).map((q) => (
            <button
              class="flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer"
              classList={{
                "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                  listQuality() === q,
                "bg-transparent text-[var(--colorNeutralForeground2)]": listQuality() !== q,
              }}
              onClick={() => setListQuality(q)}
            >
              {q === "medium" ? "默认" : "高清"}
            </button>
          ))}
        </div>
      </div>

      {/* Detail image quality */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="imageSearch" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            详情画质
          </p>
        </div>
        <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {(["medium", "large", "original"] as ImageQuality[]).map((q) => (
            <button
              class="flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer"
              classList={{
                "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                  detailQuality() === q,
                "bg-transparent text-[var(--colorNeutralForeground2)]": detailQuality() !== q,
              }}
              onClick={() => setDetailQuality(q)}
            >
              {q === "medium" ? "默认" : q === "large" ? "高清" : "原图"}
            </button>
          ))}
        </div>
      </div>

      {/* Image cache management entry */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={() => {
          void navigate("/image-cache");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void navigate("/image-cache");
          }
        }}
        role="button"
        tabindex="0"
        aria-label="图片缓存"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="server" size={24} />
          </div>
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            图片缓存
          </p>
        </div>
        <span class="text-[var(--colorNeutralForeground3)] ml-2">→</span>
      </div>

      {/* 图床代理入口 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={() => {
          void navigate("/image-host");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void navigate("/image-host");
          }
        }}
        role="button"
        tabindex="0"
        aria-label="图床代理"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="image" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              图床代理
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {imageHostState().masterEnabled
                ? `${modeLabel(imageHostState().mode)} · ${imageHostState().hosts.filter((h) => h.enabled).length} 个图床`
                : "使用默认代理"}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-3">
          <fluent-switch
            checked={imageHostState().masterEnabled}
            on:change={() => {
              if (!imageHostState().masterEnabled) {
                void navigate("/image-host");
              } else {
                setMasterEnabled(false);
              }
            }}
            aria-label="启用图床代理"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          />
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            class="text-[var(--colorNeutralForeground3)]"
          >
            <path
              d="M8.22 4.22a.75.75 0 0 1 1.06 0l7.25 7.25a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06-1.06L15.19 12 8.22 5.28a.75.75 0 0 1 0-1.06z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default SettingsImage;
