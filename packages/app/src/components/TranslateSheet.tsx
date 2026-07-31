/**
 * 详情页翻译面板（底部 sheet）—— S1 最小版。
 * 状态：未配 key 引导 / 待翻译（开始按钮）/ 翻译中 / 错误。
 * S6 扩展：档位选择 / 思考开关；S2 扩展：进度条。
 */
import { type Component, Show } from "solid-js";
import { dsApiKey, translating, translationError } from "@/stores/translationStore";

interface TranslateSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 开始翻译（由 NovelDetail 提供，持有 blocks） */
  onStartTranslate: () => void;
}

const TranslateSheet: Component<TranslateSheetProps> = (props) => {
  function handlePrimary() {
    // 统一由父组件处理：未配 key → 跳设置页；已配 key → 执行翻译
    props.onStartTranslate();
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
            {!dsApiKey() ? "前往设置填写 Key" : translating() ? "翻译中…" : "开始翻译"}
          </button>
        </div>
      </div>
    </Show>
  );
};

export default TranslateSheet;
