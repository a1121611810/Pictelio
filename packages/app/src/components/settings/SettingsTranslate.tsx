/**
 * 设置页「翻译设置」分组 —— S1 最小版：API Key（BYOK）填写 / 保存 / 清除 + 保管提示。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除翻译缓存入口。
 */
import { createSignal, onMount, Show, type Component } from "solid-js";
import { dsApiKey, loadDsApiKey, saveDsApiKey, clearDsApiKey } from "@/stores/translationStore";
import { tryAsync } from "@/utils/tryAsync";
import FluentIcon from "../ui/FluentIcon";

const SettingsTranslate: Component = () => {
  const [inputKey, setInputKey] = createSignal(dsApiKey() ?? "");
  const [showKey, setShowKey] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [feedback, setFeedback] = createSignal<string | null>(null);

  onMount(() => {
    void loadDsApiKey().then(() => setInputKey(dsApiKey() ?? ""));
  });

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    const [err] = await tryAsync(saveDsApiKey(inputKey()));
    setSaving(false);
    if (err) {
      setFeedback("保存失败，请重试");
      return;
    }
    setFeedback("已保存");
    setTimeout(() => setFeedback(null), 2000);
  }

  async function handleClear() {
    await clearDsApiKey();
    setInputKey("");
    setFeedback("已清除");
    setTimeout(() => setFeedback(null), 2000);
  }

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        翻译设置
      </p>

      <div class="py-2">
        <div class="flex items-center gap-2 mb-1">
          <FluentIcon name="server" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            DeepSeek API Key（BYOK）
          </p>
        </div>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mb-2">
          填写你自己的 API Key，加密存储于本机，仅用于直连 DeepSeek 翻译服务（按量自付）。
          请妥善保管，勿将 key 暴露给他人；泄露造成的损失由你自行承担。
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
            {showKey() ? "隐藏" : "显示"}
          </button>
        </div>
        <Show when={dsApiKey()}>
          <button
            type="button"
            class="mt-2 px-2 py-1 rounded-[var(--borderRadiusSmall)] text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase200)] hover:bg-[var(--colorStatusDangerBackground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
            onClick={() => void handleClear()}
          >
            清除已保存的 Key
          </button>
        </Show>
        <div class="flex items-center gap-2 mt-2">
          <button
            type="button"
            class="px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-white [font-size:var(--fontSizeBase200)] font-semibold hover:opacity-90 active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer disabled:opacity-60"
            disabled={saving()}
            onClick={() => void handleSave()}
          >
            {saving() ? "保存中…" : "保存"}
          </button>
          <Show when={feedback()}>
            {(msg) => (
              <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
                {msg()}
              </span>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
};

export default SettingsTranslate;
