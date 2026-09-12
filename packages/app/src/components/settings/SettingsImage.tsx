import { type Component, createSignal } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import FluentDialog from "../ui/FluentDialog";
import {
  listQuality,
  setListQuality,
  detailQuality,
  setDetailQuality,
  ugoiraMode,
  setUgoiraMode,
  type ImageQuality,
} from "../../stores/settingsStore";
import type { UgoiraExtractMode } from "../../api/illust";
import { imageHostState, setMasterEnabled, modeLabel } from "../../stores/imageHostStore";
import { clearImageCache } from "../../utils/imageLoader";
import { t } from "../../i18n";

interface SettingsImageProps {
  onActionToast: (msg: string) => void;
}

const SettingsImage: Component<SettingsImageProps> = (props) => {
  const navigate = useNavigate();
  // T3：动图播放方案——range 需二次确认（告知原生端限制）
  const [showUgoiraConfirm, setShowUgoiraConfirm] = createSignal(false);

  function handleClearImageCache() {
    const [err] = trySync(() => clearImageCache());
    // i18n: set 时快照（瞬态）
    props.onActionToast(
      err ? t("settings.image.clearCacheFailed") : t("settings.image.cacheCleared"),
    );
  }

  function onPickUgoiraMode(mode: UgoiraExtractMode) {
    if (mode === "fflate") {
      void setUgoiraMode("fflate");
    } else {
      setShowUgoiraConfirm(true); // 二次确认后 setUgoiraMode("range")
    }
  }

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        {t("settings.image.sectionTitle")}
      </p>

      {/* List image quality */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="image" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.image.listQuality")}
          </p>
        </div>
        <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {(["medium", "large"] as ImageQuality[]).map((q) => (
            <button
              class={[
                "flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer",
                {
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    listQuality() === q,
                  "bg-transparent text-[var(--colorNeutralForeground2)]": listQuality() !== q,
                },
              ]}

              onClick={() => setListQuality(q)}
            >
              {q === "medium" ? t("settings.image.qualityMedium") : t("settings.image.qualityHigh")}
            </button>
          ))}
        </div>
      </div>

      {/* Detail image quality */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="imageSearch" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.image.detailQuality")}
          </p>
        </div>
        <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {(["medium", "large", "original"] as ImageQuality[]).map((q) => (
            <button
              class={[
                "flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer",
                {
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    detailQuality() === q,
                  "bg-transparent text-[var(--colorNeutralForeground2)]": detailQuality() !== q,
                },
              ]}

              onClick={() => setDetailQuality(q)}
            >
              {q === "medium"
                ? t("settings.image.qualityMedium")
                : q === "large"
                  ? t("settings.image.qualityHigh")
                  : t("settings.image.qualityOriginal")}
            </button>
          ))}
        </div>
      </div>

      {/* 动图播放方案（T3）：默认 fflate，可切 Range 流式（二次确认） */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="image" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.image.ugoiraModeTitle")}
          </p>
        </div>
        <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {(["fflate", "range"] as UgoiraExtractMode[]).map((m) => (
            <button
              class={[
                "flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer",
                {
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    ugoiraMode() === m,
                  "bg-transparent text-[var(--colorNeutralForeground2)]": ugoiraMode() !== m,
                },
              ]}

              onClick={() => onPickUgoiraMode(m)}
            >
              {m === "fflate"
                ? t("settings.image.ugoiraFflate")
                : t("settings.image.ugoiraRange")}
            </button>
          ))}
        </div>
        <p class="mt-1 text-[var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] leading-snug">
          {t("settings.image.ugoiraModeDesc")}
        </p>
      </div>

      {/* 二次确认弹窗（选择 Range 时） */}
      <FluentDialog
        open={showUgoiraConfirm()}
        onClose={() => setShowUgoiraConfirm(false)}
        aria-label={t("settings.image.ugoiraDialogAria")}
      >
        <div slot="title">{t("settings.image.ugoiraDialogTitle")}</div>
        <div slot="content" class="flex flex-col gap-2">
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.image.ugoiraDialogBody1")}
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            {t("settings.image.ugoiraDialogBody2")}
          </p>
        </div>
        <fluent-button
          slot="actions"
          appearance="secondary"
          ref={fluentOn("click", () => setShowUgoiraConfirm(false))}
        >
          {t("settings.image.cancel")}
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          ref={fluentOn("click", () => {
            void setUgoiraMode("range");
            setShowUgoiraConfirm(false);
          })}
        >
          {t("settings.image.ugoiraDialogConfirm")}
        </fluent-button>
      </FluentDialog>

      {/* 图片缓存管理入口 */}
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
        aria-label={t("settings.image.cache")}
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="server" size={24} />
          </div>
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.image.cache")}
          </p>
        </div>
        <span class="text-[var(--colorNeutralForeground3)] ml-2">→</span>
      </div>

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
        aria-label={t("settings.image.clearCache")}
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
              {t("settings.image.clearCache")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.image.clearCacheDesc")}
            </p>
          </div>
        </div>
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
        aria-label={t("settings.image.hostProxy")}
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="image" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.image.hostProxy")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {imageHostState().masterEnabled
                ? t("settings.image.hostProxySummary", {
                    label: modeLabel(imageHostState().mode),
                    count: imageHostState().hosts.filter((h) => h.enabled).length,
                  })
                : t("settings.image.hostProxyDefault")}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-3">
          <fluent-switch
            checked={imageHostState().masterEnabled}
            ref={fluentOn("change", () => {
              if (!imageHostState().masterEnabled) {
                void navigate("/image-host");
              } else {
                setMasterEnabled(false);
              }
            })}
            aria-label={t("settings.image.hostProxyEnable")}
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
