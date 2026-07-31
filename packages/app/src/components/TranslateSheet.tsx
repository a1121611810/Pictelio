/**
 * 详情页翻译面板（底部 sheet）。
 * 状态：未配 key 引导 / 待翻译（开始按钮）/ 翻译中（进度条）/ 失败（「未翻译」段 + 补翻按钮）。
 * S2 进度条；S4 失败信息 + 断点续翻；档位/思考开关在设置页（S6），详情页临时切换为 S7。
 */
import { type Component, Show } from "solid-js";
import {
  dsApiKey,
  translating,
  translationError,
  translationProgress,
  failedParagraphs,
} from "@/stores/translationStore";

interface TranslateSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 开始翻译 / 补翻失败块（由 NovelDetail 提供，持有 blocks；retryFailed = 仅补翻失败段） */
  onStartTranslate: (retryFailed?: boolean) => void;
}

/** 主按钮文案（模块级：仅依赖 store 信号，避免组件内重复创建） */
function primaryLabel(): string {
  if (!dsApiKey()) {
    return "前往设置填写 Key";
  }
  if (translating()) {
    return "翻译中…";
  }
  if (failedParagraphs().size > 0) {
    return `补翻失败块（${failedParagraphs().size} 段）`;
  }
  return "开始翻译";
}

const TranslateSheet: Component<TranslateSheetProps> = (props) => {
  function handlePrimary() {
    // 有失败段且非翻译中 → 补翻；否则首次翻译
    props.onStartTranslate(failedParagraphs().size > 0 && !translating());
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-40"
        role="dialog"
        aria-modal="true"
        aria-label="AI 翻译"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            props.onClose();
          }
        }}
      >
        <div class="absolute inset-0 bg-[var(--colorOverlayLight)]" />
        <div class="absolute bottom-0 left-0 right-0 max-w-2xl mx-auto bg-[var(--colorNeutralBackground1)] rounded-t-[var(--borderRadiusXLarge)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[var(--elevation8)]">
          <div class="mx-auto w-9 h-1 rounded-full bg-[var(--colorNeutralStroke2)] mb-3" />
          <div class="flex items-center justify-between mb-3">
            <h3 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              AI 翻译
            </h3>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={() => props.onClose()}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <Show when={!dsApiKey()}>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] leading-relaxed mb-3">
              尚未配置 DeepSeek API Key。请前往「设置 → 翻译设置」填写你自己的 API Key
              （BYOK，密钥仅存本机、直连服务商）。
            </p>
          </Show>

          <Show when={Boolean(dsApiKey())}>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] leading-relaxed mb-3">
              将小说正文翻译为简体中文。内容将发送至 DeepSeek（你选择的模型），按量计费。
            </p>
          </Show>

          <Show when={translationError()}>
            {(err) => (
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)] bg-[var(--colorStatusDangerBackground1)] rounded-[var(--borderRadiusMedium)] px-3 py-2 mb-3">
                {err().message}
              </p>
            )}
          </Show>

          {/* 分块翻译进度（S2） */}
          <Show when={translating()}>
            <Show when={translationProgress()}>
              {(p) => (
                <div class="mb-3">
                  <div class="h-1.5 rounded-full bg-[var(--colorNeutralBackground2)] overflow-hidden">
                    <div
                      class="h-full bg-[var(--colorBrandBackground)] transition-all duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
                      style={{
                        width: `${p().total > 0 ? Math.round((p().done / p().total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] mt-2">
                    已翻译 {p().done} / {p().total} 块
                    {p().done > 0 && p().done < p().total ? "，首屏内容已出，其余后台续翻中…" : ""}
                  </p>
                </div>
              )}
            </Show>
          </Show>

          {/* 失败信息 + 补翻（S4）：翻译完成后有失败段 → 提示可补翻 */}
          <Show when={!translating() && failedParagraphs().size > 0}>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)] bg-[var(--colorStatusDangerBackground1)] rounded-[var(--borderRadiusMedium)] px-3 py-2 mb-3">
              {failedParagraphs().size} 段翻译失败（正文中已标记「未翻译」）。可补翻失败块，成功段落不会重复计费。
            </p>
          </Show>

          <button
            type="button"
            class="w-full py-3 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase300)] font-semibold transition-all active:scale-[0.98] appearance-none border-none outline-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            classList={{
              "bg-[var(--colorBrandBackground)] text-white hover:opacity-90":
                !dsApiKey() || !translating(),
              "bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)]":
                Boolean(dsApiKey()) && translating(),
            }}
            disabled={translating()}
            onClick={handlePrimary}
          >
            {primaryLabel()}
          </button>
        </div>
      </div>
    </Show>
  );
};

export default TranslateSheet;
