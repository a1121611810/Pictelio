import { type Component, Show, createSignal, onSettled } from "solid-js";
import { useNavigate } from "@solidjs/router";
import FluentIcon from "../ui/FluentIcon";
import {
  readClientKind,
  readAutoFallbackSwitch,
  writeAutoFallbackSwitch,
  readEngineState,
  reasonKey,
  supportsClientSwitch,
  type ClientKind,
  type EngineSnapshot,
} from "../../utils/clientSwitch";
import { ClientInfo } from "../../native/ClientInfo";
import { t, type I18nKey } from "../../i18n";

/** 引擎显示名 i18n 键（品牌名两语言同文案，键化保证插值完备） */
const kindLabelKey = (kind: ClientKind): I18nKey =>
  kind === "lynx" ? "settings.client.kindLynx" : "settings.client.kindWebview";

/**
 * 客户端切换区块（webview ↔ lynx）。
 * 缺省引擎 = lynx（ADR-0164）；本应用自身是 webview 客户端。切换写入
 * SharedPreferences("CapacitorStorage").pictelio_client_kind
 * 并由原生重启分发（MainActivity 入口路由 → LynxActivity）。切回入口在 Lynx 客户端 Me 页。
 *
 * ADR-0062：仅当当前包同时支持 webview 与 lynx（full 包）时渲染切换入口；
 * webview-only 包隐藏（无 Lynx 运行时，切换是死功能）。
 *
 * T2：点击入口行不再弹确认对话框，而是直接导航到独立说明页 /client-switch
 *（routes/ClientSwitch.tsx），确认切换与 E2E 钩子均在该页。
 */
const SettingsClient: Component = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = createSignal<ClientKind>("webview");
  /** 当前包支持的 client 引擎列表；空数组 = 尚未查询到（保守渲染） */
  const [clientKinds, setClientKinds] = createSignal<string[] | null>(null);
  /** 自动回退开关（缺省开；读取失败也按开，与 readAutoFallbackSwitch 口径一致） */
  const [autoFallback, setAutoFallback] = createSignal(true);
  /** 生效状态快照；null = 无记录/畸形（按无降级渲染） */
  const [engineState, setEngineState] = createSignal<EngineSnapshot | null>(null);

  // onSettled 不接受 async 函数：异步分支内部消化 Promise
  onSettled(() => {
    void readClientKind().then((kind) => setCurrent(kind));
    void tryAsync(ClientInfo.getClientKinds()).then(([err, result]) => {
      if (err) {
        // 原生插件不可用（web 开发环境）→ 保持 null，按 full 能力渲染
        setClientKinds(null);
        return;
      }
      setClientKinds(result.kinds);
    });
    void readAutoFallbackSwitch().then(setAutoFallback);
    void readEngineState().then(setEngineState);
  });

  // ADR-0062：仅 full 包（含 webview+lynx）渲染切换入口
  const supportsSwitch = () => supportsClientSwitch(clientKinds());

  /** 降级双态：快照缺失或 effective === preferred（按首选运行）→ 不渲染 */
  const degradedState = (): EngineSnapshot | null => {
    const s = engineState();
    if (s === null || s.effective === s.preferred) return null;
    return s;
  };

  const effectiveLabel = (s: EngineSnapshot): string =>
    s.effective === null ? t("settings.client.engineNone") : t(kindLabelKey(s.effective));

  /** 乐观切换：先更 UI 再落盘；写入失败仅 warn（writeAutoFallbackSwitch 不抛），重启后回落实际值 */
  const toggleAutoFallback = () => {
    const next = !autoFallback();
    setAutoFallback(next);
    void writeAutoFallbackSwitch(next);
  };

  return (
    <Show when={supportsSwitch()}>
      <div class="py-3 flex flex-col">
        <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
          {t("settings.client.sectionTitle")}
        </p>

        <div
          class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
          onClick={() => navigate("/client-switch")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate("/client-switch");
            }
          }}
          role="button"
          tabindex="0"
          aria-label={t("settings.client.switchEngine")}
        >
          <div class="flex items-center gap-3">
            <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
              <FluentIcon name="wrench" size={24} />
            </div>
            <div>
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                {t("settings.client.switchEngine")}
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                {current() === "lynx"
                  ? t("settings.client.currentLynx")
                  : t("settings.client.currentWebview")}
              </p>
            </div>
          </div>
          <span class="text-[var(--colorNeutralForeground3)] ml-2">→</span>
        </div>

        {/* 自动回退 WebView 开关行（ADR-0164 决策 5：只管运行时硬错误是否自动跳，
            不影响启动预检降级）；行式样照 SettingsContent 开关行范式 */}
        <div class="flex items-center justify-between py-3">
          <div class="flex items-center gap-3">
            <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
              <FluentIcon name="history" size={24} />
            </div>
            <div>
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                {t("settings.client.autoFallback")}
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                {t("settings.client.autoFallbackDesc")}
              </p>
            </div>
          </div>

          <fluent-switch
            checked={autoFallback()}
            ref={fluentOn("change", toggleAutoFallback)}
            aria-label={t("settings.client.autoFallback")}
          />
        </div>

        {/* 本次生效双态行（spec §7.2）：读生效状态快照，降级（effective ≠ preferred）时
            显示「首选 X · 本次生效 Y」+ 原因文案；无快照/按首选运行则不渲染。纯文本行。 */}
        <Show when={degradedState()}>
          <div class="flex items-start gap-3 py-3" role="status">
            <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
              <FluentIcon name="info" size={24} />
            </div>
            <div>
              <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                {t("settings.client.effectiveState", {
                  preferred: t(kindLabelKey(degradedState()!.preferred)),
                  effective: effectiveLabel(degradedState()!),
                })}
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                {t(reasonKey(degradedState()!.reason))}
              </p>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default SettingsClient;
