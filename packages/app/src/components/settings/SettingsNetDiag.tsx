import { type Component } from "solid-js";
import { t } from "../../i18n";

/** 网络自检入口卡片（spec docs/specs/network-self-check.md / #445） */
const SettingsNetDiag: Component = () => {
  const navigate = useNavigate();
  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        {t("settings.netdiag.sectionTitle")}
      </p>
      <button
        class="flex items-center gap-3 w-full text-left py-2 min-h-[40px] rounded-[var(--borderRadiusMedium)] active:scale-[0.99] transition-transform duration-[var(--durationFast)] focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2"
        onClick={() => navigate("/network-check")}
      >
        <span class="flex-1 [font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
          {t("settings.netdiag.entry")}
        </span>
        <span class="text-[var(--colorNeutralForeground3)]">›</span>
      </button>
      <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
        {t("settings.netdiag.desc")}
      </p>
    </div>
  );
};

export default SettingsNetDiag;
