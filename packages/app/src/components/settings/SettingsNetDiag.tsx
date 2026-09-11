import { type Component } from "solid-js";

/** 网络自检入口卡片（spec docs/specs/network-self-check.md / #445） */
const SettingsNetDiag: Component = () => {
  const navigate = useNavigate();
  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        诊断
      </p>
      <button
        class="flex items-center gap-3 w-full text-left py-2 min-h-[40px] rounded-[var(--borderRadiusMedium)] active:scale-[0.99] transition-transform duration-[var(--durationFast)] focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2"
        onClick={() => navigate("/network-check")}
      >
        <span class="flex-1 [font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
          网络自检
        </span>
        <span class="text-[var(--colorNeutralForeground3)]">›</span>
      </button>
      <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
        检测本机网络、DNS、连接、TLS 与 Pixiv 可达性，并生成可复制的脱敏诊断报告。
      </p>
    </div>
  );
};

export default SettingsNetDiag;
