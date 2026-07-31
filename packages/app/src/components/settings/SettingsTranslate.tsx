/**
 * 设置页「翻译设置」分组 —— S1 最小版：API Key（BYOK）填写 / 保存 / 清除 + 保管提示。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除翻译缓存入口。
 */
import { createSignal, onMount, Show, type Component } from "solid-js";
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
} from "@/stores/translationStore";
import { clearTranslationCache } from "@/utils/translationCache";
import { tryAsync } from "@/utils/tryAsync";
import FluentIcon from "../ui/FluentIcon";

const SettingsTranslate: Component = () => {
  const [inputKey, setInputKey] = createSignal(dsApiKey() ?? "");
  const [showKey, setShowKey] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [feedback, setFeedback] = createSignal<string | null>(null);

  onMount(() => {
    void loadDsApiKey().then(() => setInputKey(dsApiKey() ?? ""));
    void loadTranslateRestrictSettings();
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

  async function handleClearCache() {
    await clearTranslationCache();
    setFeedback("已清除翻译缓存");
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

        {/* 敏感内容翻译（S5）：R18/R18G 双开关，默认关（决策 #23） */}
        <div class="py-2 mt-2">
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-1">
            敏感内容翻译
          </p>

          <div class="flex items-center justify-between py-2">
            <div>
              <p class="[font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
                翻译 R18 内容
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                默认关。开启需确认风险，正文将发送至 AI 服务商
              </p>
            </div>
            <fluent-switch
              checked={translateR18()}
              on:change={() => onToggleR18()}
              aria-label="翻译 R18 内容"
            />
          </div>

          <div class="flex items-center justify-between py-2">
            <div>
              <p class="[font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
                翻译 R18G 内容
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                默认关。法律红线，需更强警告与二次确认
              </p>
            </div>
            <fluent-switch
              checked={translateR18G()}
              on:change={() => onToggleR18G()}
              aria-label="翻译 R18G 内容"
            />
          </div>
        </div>

        {/* 译文缓存（S3）：LRU 200 章 / ~8MB + 手动清除（决策 #24） */}
        <div class="py-2 mt-2">
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-1">
            译文缓存
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mb-2">
            LRU 200 章 / ~8MB 上限，作者修改正文后自动失效重翻。清除不影响已保存的 API Key。
          </p>
          <button
            type="button"
            class="px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
            onClick={() => void handleClearCache()}
          >
            清除翻译缓存
          </button>
        </div>
      </div>
    </div>

    {/* R18 开启确认（决策 #23：封号/训练风险） */}
    <fluent-dialog
      open={restrictDialog() === "r18"}
      on:close={() => setRestrictDialog(null)}
      aria-label="开启 R18 翻译？"
    >
      <h3 slot="title">开启「翻译 R18 内容」？</h3>
      <p>
        该作品包含 R18 内容。翻译需将正文发送至你选择的 AI 服务商，可能：① 被内容审核拒绝（失败段落保留原文）；②
        违反服务商使用条款，导致你的 API 账号被警告、暂停或封禁；③ 内容可能被去标识化后用于模型训练。所有风险由你自行承担。
      </p>
      <fluent-button slot="actions" appearance="secondary" on:click={() => setRestrictDialog(null)}>
        取消
      </fluent-button>
      <fluent-button slot="actions" appearance="primary" on:click={confirmRestrictDialog}>
        我已了解并开启
      </fluent-button>
    </fluent-dialog>

    {/* R18G 开启确认（更强警告：法律红线 + 上报执法机构） */}
    <fluent-dialog
      open={restrictDialog() === "r18g"}
      on:close={() => setRestrictDialog(null)}
      aria-label="开启 R18G 翻译？"
    >
      <h3 slot="title">开启「翻译 R18G 内容」？（法律红线）</h3>
      <p>
        该作品包含 R18G（极端）内容。除上述风险外，此类内容违反法律法规红线，可能导致你的 API 账号被关闭，服务商可能向主管部门/执法机构报告。App
        提供方不承担由此产生的任何责任。
      </p>
      <fluent-button slot="actions" appearance="secondary" on:click={() => setRestrictDialog(null)}>
        取消
      </fluent-button>
      <fluent-button slot="actions" appearance="primary" on:click={confirmRestrictDialog}>
        我已了解并承担全部风险
      </fluent-button>
    </fluent-dialog>
    </>
  );
};

export default SettingsTranslate;
