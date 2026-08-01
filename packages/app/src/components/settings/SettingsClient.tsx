import { type Component, createSignal, onMount } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import { readClientKind, type ClientKind } from "../../utils/clientSwitch";

interface SettingsClientProps {
  /** 用户点击"切换"行 → 请求打开确认对话框（状态由 Settings.tsx 管理） */
  onSwitchRequest: () => void;
}

/**
 * 客户端切换区块（webview ↔ lynx）。
 * 主应用默认 webview；切换后写入 SharedPreferences("CapacitorStorage").pictelio_client_kind
 * 并由原生重启分发（MainActivity 入口路由 → LynxActivity）。切回入口在 Lynx 客户端 Me 页。
 */
const SettingsClient: Component<SettingsClientProps> = (props) => {
  const [current, setCurrent] = createSignal<ClientKind>("webview");

  onMount(async () => {
    setCurrent(await readClientKind());
  });

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        客户端
      </p>

      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={props.onSwitchRequest}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onSwitchRequest();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="切换渲染引擎"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="wrench" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              切换渲染引擎
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {current() === "lynx"
                ? "当前：Lynx（实验性）· 点击切回 WebView"
                : "当前：WebView · 切换到 Lynx（实验性）"}
            </p>
          </div>
        </div>
        <span class="text-[var(--colorNeutralForeground3)] ml-2">→</span>
      </div>
    </div>
  );
};

export default SettingsClient;
