/**
 * 设置页「翻译设置」分组 —— S1 最小版：API Key（BYOK）填写 / 保存 / 清除 + 保管提示。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除翻译缓存入口。
 */
import { createSignal, onSettled, Show, type Component } from "solid-js";
import {
  dsApiKey,
  loadDsApiKey,
  saveDsApiKey,
  clearDsApiKey,
  translateR18,
  translateR18G,
  loadTranslateRestrictSettings,
  setTranslateR18,
  setTranslateR18G,
  defaultTier,
  thinkingEnabled,
  setDefaultTier,
  setThinkingEnabled,
  loadTierAndThinking,
} from "@/stores/translationStore";
import { clearTranslationCache } from "@/utils/translationCache";
import { tryAsync } from "@/utils/tryAsync";
import { t } from "@/i18n";
import FluentIcon from "../ui/FluentIcon";
import FluentDialog from "../ui/FluentDialog";

const SettingsTranslate: Component = () => {
  // untrack 显式快照：输入框初值取挂载瞬间的 dsApiKey，不建立订阅——onSettled 加载
  // 完成后会显式 setInputKey 同步最新值（见下），Solid 2 STRICT_READ_UNTRACKED 处方
  const [inputKey, setInputKey] = createSignal(untrack(() => dsApiKey() ?? ""));
  const [showKey, setShowKey] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [feedback, setFeedback] = createSignal<string | null>(null);

  onSettled(() => {
    // loadDsApiKey 内部 setDsApiKey 后 promise 立即 resolve：2.0 批量更新下
    // .then 回调同步读 dsApiKey() 可能拿到旧值，先 flush() 落地批量写入再读
    void loadDsApiKey().then(() => {
      flush();
      setInputKey(dsApiKey() ?? "");
    });
    void loadTranslateRestrictSettings();
    void loadTierAndThinking();
  });

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    const [err] = await tryAsync(saveDsApiKey(inputKey()));
    setSaving(false);
    if (err) {
      setFeedback(t("settings.translate.saveFailed")); // i18n: set 时快照（瞬态）
      return;
    }
    setFeedback(t("settings.translate.saved")); // i18n: set 时快照（瞬态）
    setTimeout(() => setFeedback(null), 2000);
  }

  async function handleClear() {
    await clearDsApiKey();
    setInputKey("");
    setFeedback(t("settings.translate.cleared")); // i18n: set 时快照（瞬态）
    setTimeout(() => setFeedback(null), 2000);
  }

  async function handleClearCache() {
    await clearTranslationCache();
    setFeedback(t("settings.translate.cacheCleared")); // i18n: set 时快照（瞬态）
    setTimeout(() => setFeedback(null), 2000);
  }

  // ── R18/R18G 开关：开启前二次确认（决策 #23 两级告知）──
  const [restrictDialog, setRestrictDialog] = createSignal<"r18" | "r18g" | null>(null);

  function onToggleR18() {
    if (translateR18()) {
      void setTranslateR18(false);
      return;
    }
    setRestrictDialog("r18");
  }

  function onToggleR18G() {
    if (translateR18G()) {
      void setTranslateR18G(false);
      return;
    }
    setRestrictDialog("r18g");
  }

  function confirmRestrictDialog() {
    if (restrictDialog() === "r18") {
      void setTranslateR18(true);
    } else if (restrictDialog() === "r18g") {
      void setTranslateR18G(true);
    }
    setRestrictDialog(null);
  }

  return (
    <>
      <div class="py-3 flex flex-col">
        <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
          {t("settings.translate.sectionTitle")}
        </p>

        <div class="py-2">
          <div class="flex items-center gap-2 mb-1">
            <FluentIcon name="server" size={20} />
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              DeepSeek API Key（BYOK）
            </p>
          </div>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mb-2">
            {t("settings.translate.byokDesc")}
          </p>
          <div class="flex gap-2">
            <input
              type={showKey() ? "text" : "password"}
              value={inputKey()}
              placeholder="sk-..."
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              class="flex-1 min-w-0 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              onInput={(e) => setInputKey(e.currentTarget.value)}
            />
            <button
              type="button"
              class="flex-shrink-0 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey() ? t("settings.translate.hide") : t("settings.translate.show")}
            </button>
          </div>
          <Show when={dsApiKey()}>
            <button
              type="button"
              class="mt-2 px-2 py-1 rounded-[var(--borderRadiusSmall)] text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase200)] hover:bg-[var(--colorStatusDangerBackground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={() => void handleClear()}
            >
              {t("settings.translate.clearKey")}
            </button>
          </Show>
          <div class="flex items-center gap-2 mt-2">
            <button
              type="button"
              class="px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-white [font-size:var(--fontSizeBase200)] font-semibold hover:opacity-90 active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer disabled:opacity-60"
              disabled={saving()}
              onClick={() => void handleSave()}
            >
              {saving() ? t("settings.translate.saving") : t("settings.translate.save")}
            </button>
            <Show when={feedback()}>
              {(msg) => (
                <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
                  {msg()}
                </span>
              )}
            </Show>
          </div>

          {/* 翻译质量与思考（S6，决策 #22）：默认档位 + 思考开关 */}
          <div class="py-2 mt-2">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-2">
              {t("settings.translate.qualityTitle")}
            </p>

            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mb-1">
              {t("settings.translate.defaultTierLabel")}
            </p>
            <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
              <button
                type="button"
                class={[
                  "flex-1 py-2 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-[0.98] appearance-none border-none outline-none cursor-pointer",
                  {
                    "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                      defaultTier() === "flash",
                    "bg-transparent text-[var(--colorNeutralForeground2)]":
                      defaultTier() !== "flash",
                  },
                ]}

                onClick={() => void setDefaultTier("flash")}
              >
                {t("settings.translate.tierStandard")}
                <small class="block font-normal [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                  {t("settings.translate.tierStandardPrice")}
                </small>
              </button>
              <button
                type="button"
                class={[
                  "flex-1 py-2 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-[0.98] appearance-none border-none outline-none cursor-pointer",
                  {
                    "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                      defaultTier() === "pro",
                    "bg-transparent text-[var(--colorNeutralForeground2)]": defaultTier() !== "pro",
                  },
                ]}

                onClick={() => void setDefaultTier("pro")}
              >
                {t("settings.translate.tierPro")}
                <small class="block font-normal [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                  {t("settings.translate.tierProPrice")}
                </small>
              </button>
            </div>

            <div class="flex items-center justify-between py-2 mt-1">
              <div>
                <p class="[font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
                  {t("settings.translate.thinking")}
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("settings.translate.thinkingDesc")}
                </p>
              </div>
              <fluent-switch
                checked={thinkingEnabled()}
                ref={fluentOn("change", () => void setThinkingEnabled(!thinkingEnabled()))}
                aria-label={t("settings.translate.thinking")}
              />
            </div>
          </div>

          {/* 敏感内容翻译（S5）：R18/R18G 双开关，默认关（决策 #23） */}
          <div class="py-2 mt-2">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-1">
              {t("settings.translate.sensitiveTitle")}
            </p>

            <div class="flex items-center justify-between py-2">
              <div>
                <p class="[font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
                  {t("settings.translate.r18")}
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("settings.translate.r18Desc")}
                </p>
              </div>
              <fluent-switch
                checked={translateR18()}
                ref={fluentOn("change", () => onToggleR18())}
                aria-label={t("settings.translate.r18")}
              />
            </div>

            <div class="flex items-center justify-between py-2">
              <div>
                <p class="[font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
                  {t("settings.translate.r18g")}
                </p>
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {t("settings.translate.r18gDesc")}
                </p>
              </div>
              <fluent-switch
                checked={translateR18G()}
                ref={fluentOn("change", () => onToggleR18G())}
                aria-label={t("settings.translate.r18g")}
              />
            </div>
          </div>

          {/* 译文缓存（S3）：LRU 200 章 / ~8MB + 手动清除（决策 #24） */}
          <div class="py-2 mt-2">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-1">
              {t("settings.translate.cacheTitle")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mb-2">
              {t("settings.translate.cacheDesc")}
            </p>
            <button
              type="button"
              class="px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={() => void handleClearCache()}
            >
              {t("settings.translate.clearCache")}
            </button>
          </div>
        </div>
      </div>

      {/* R18 开启确认（决策 #23：封号/训练风险） */}
      <FluentDialog
        open={restrictDialog() === "r18"}
        onClose={() => setRestrictDialog(null)}
        aria-label={t("settings.translate.r18DialogAria")}
      >
        <h3 slot="title">{t("settings.translate.r18DialogTitle")}</h3>
        <p>{t("settings.translate.r18DialogBody")}</p>
        <fluent-button
          slot="actions"
          appearance="secondary"
          ref={fluentOn("click", () => setRestrictDialog(null))}
        >
          {t("settings.translate.cancel")}
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          ref={fluentOn("click", confirmRestrictDialog)}
        >
          {t("settings.translate.r18DialogConfirm")}
        </fluent-button>
      </FluentDialog>

      {/* R18G 开启确认（更强警告：法律红线 + 上报执法机构） */}
      <FluentDialog
        open={restrictDialog() === "r18g"}
        onClose={() => setRestrictDialog(null)}
        aria-label={t("settings.translate.r18gDialogAria")}
      >
        <h3 slot="title">{t("settings.translate.r18gDialogTitle")}</h3>
        <p>{t("settings.translate.r18gDialogBody")}</p>
        <fluent-button
          slot="actions"
          appearance="secondary"
          ref={fluentOn("click", () => setRestrictDialog(null))}
        >
          {t("settings.translate.cancel")}
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          ref={fluentOn("click", confirmRestrictDialog)}
        >
          {t("settings.translate.r18gDialogConfirm")}
        </fluent-button>
      </FluentDialog>
    </>
  );
};

export default SettingsTranslate;
