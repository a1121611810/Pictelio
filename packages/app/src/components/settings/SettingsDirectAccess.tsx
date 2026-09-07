import { type Component, createSignal, Show } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import {
  directAccessState,
  directAccessRuntime,
  refreshDirectAccessRuntime,
  setDirectAccessEnabled,
  setManualEntries,
  validateManualEntry,
  type DirectAccessManualEntry,
} from "../../stores/directAccessStore";
import { directAccessCommand, type DirectAccessPhase } from "../../native/DirectAccess";

/** 命令/保存按钮共享样式（Fluent 三态 + 40px 触控目标 + focus-visible，全令牌化） */
const ACTION_BUTTON_CLASS =
  "min-h-[40px] px-[var(--spacingHorizontalL)] rounded-[var(--borderRadiusMedium)] " +
  "[font-size:var(--fontSizeBase300)] font-semibold appearance-none border-none cursor-pointer " +
  "bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground1)] " +
  "hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] " +
  "transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] " +
  "disabled:cursor-default disabled:bg-[var(--colorNeutralBackground3)] " +
  "disabled:text-[var(--colorNeutralForegroundDisabled)] " +
  "focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] " +
  "focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]";

/** 可点击行共享样式（对齐 SettingsImage/SettingsContent 行交互三态先例） */
const ROW_CLASS =
  "flex items-center justify-between py-3 cursor-pointer " +
  "hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] " +
  "transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] " +
  "focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] " +
  "focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] " +
  "rounded-[var(--borderRadiusMedium)] -mx-2 px-2";

/** 熔断相位徽标配色（CLOSED 正常 / OPEN 警示 / HALF_OPEN 半开，Fluent 状态令牌） */
function phaseBadgeClass(phase: DirectAccessPhase): string {
  switch (phase) {
    case "CLOSED":
      return "bg-[var(--colorStatusSuccessBackground2)] text-[var(--colorStatusSuccessForeground1)]";
    case "OPEN":
      return "bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)]";
    default:
      return "bg-[var(--colorStatusWarningBackground2)] text-[var(--colorStatusWarningForeground1)]";
  }
}

/** 熔断相位中文标签 */
function phaseLabel(phase: DirectAccessPhase): string {
  switch (phase) {
    case "CLOSED":
      return "正常";
    case "OPEN":
      return "已熔断";
    default:
      return "半开探测";
  }
}

/** 当前路线文案（switchState 三态 → 展示语义；读模块级 signal，JSX 内调用保持响应性） */
function routeLabel(): string {
  switch (directAccessRuntime().switchState) {
    case "ON":
      return "直连中";
    case "OFF":
      return "系统路线";
    default:
      return "未配置";
  }
}

/** 开关切换（写持久化设置 + 立即同步运行时状态展示） */
function handleToggle(): void {
  setDirectAccessEnabled(!directAccessState().enabled);
  // 开关切换后 Java 侧下一次请求即感知
  void refreshDirectAccessRuntime();
}

/**
 * 设置页「网络直连」卡（ticket #391 T6）：
 * 开关（写 CapacitorStorage 契约键 direct_access_settings，Java 下一次请求即感知）+
 * 运行时状态展示（当前路线 / 双通道熔断相位 / IP 表条目）+ 命令行（重置熔断、
 * 立即更新 IP 表）+ 手动 IP 表编辑（折叠区，非法 JSON/条目拒绝保存）。
 *
 * 运行时状态在组件挂载即拉取（不阻塞渲染，遵循「先渲染后加载」硬约束）。
 */
const SettingsDirectAccess: Component = () => {
  const [busy, setBusy] = createSignal<"reset" | "refresh" | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  // 状态面数据源：挂载即刷新（异步，不阻塞渲染；web/dev 返回安全默认）
  void refreshDirectAccessRuntime();

  async function runCommand(action: "reset" | "refresh"): Promise<void> {
    if (busy()) {
      return; // 命令在飞，防重复触发
    }
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await directAccessCommand(action);
      setNotice(
        action === "refresh"
          ? result.started
            ? "IP 表更新已发起，稍后自动生效"
            : "IP 表更新已在进行中"
          : "熔断已重置（双通道恢复正常）",
      );
    } catch (err) {
      // 命令失败必须可见（含 web/dev 无命令通道的 reject）
      console.warn("[SettingsDirectAccess] directAccessCommand 失败", err);
      setError(action === "refresh" ? "IP 表更新命令失败" : "熔断重置命令失败");
    } finally {
      setBusy(null);
      void refreshDirectAccessRuntime();
    }
  }

  /** 展开/收起手动 IP 表编辑器（展开时以当前手动表 JSON 预填草稿） */
  function toggleEditor(): void {
    if (!expanded()) {
      setDraft(JSON.stringify(directAccessState().manual, null, 2));
    }
    setError(null);
    setNotice(null);
    setExpanded(!expanded());
  }

  /** 保存手动 IP 表：非法 JSON / 非法条目一律拒绝并给出可见提示（禁静默降级） */
  function handleSaveManual(): void {
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft());
    } catch {
      setError("JSON 解析失败：请检查格式（应为条目数组）");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("手动 IP 表必须是数组");
      return;
    }
    for (const entry of parsed) {
      const entryErr = validateManualEntry(entry);
      if (entryErr) {
        setError(entryErr);
        return;
      }
    }
    const saveErr = setManualEntries(parsed as DirectAccessManualEntry[]);
    if (saveErr) {
      setError(saveErr);
      return;
    }
    setError(null);
    setNotice("手动 IP 表已保存");
  }

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        网络直连
      </p>

      {/* 开关行（行点击与开关均切换；开关 stopPropagation 防双触发，先例 SettingsImage 图床行） */}
      <div
        class={ROW_CLASS}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="启用网络直连"
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="server" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              直连模式
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              免代理直连 Pixiv 边缘（当前：{routeLabel()} · IP 表{" "}
              {directAccessRuntime().tableEntries} 条）
            </p>
          </div>
        </div>
        <fluent-switch
          checked={directAccessState().enabled}
          on:change={handleToggle}
          onClick={(e: MouseEvent) => e.stopPropagation()}
          aria-label="启用网络直连"
        />
      </div>

      {/* 运行时状态展示区 */}
      <div class="flex flex-col gap-[var(--spacingVerticalS)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] p-[var(--spacingHorizontalM)]">
        <div class="flex items-center justify-between">
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
            当前路线
          </span>
          <span
            class="rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalS)] [font-size:var(--fontSizeBase100)] font-semibold"
            classList={{
              "bg-[var(--colorStatusSuccessBackground2)] text-[var(--colorStatusSuccessForeground1)]":
                directAccessRuntime().switchState === "ON",
              "bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground2)]":
                directAccessRuntime().switchState !== "ON",
            }}
          >
            {routeLabel()}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
            图片通道
          </span>
          <span
            class={`rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalS)] [font-size:var(--fontSizeBase100)] font-semibold ${phaseBadgeClass(directAccessRuntime().imageChannel)}`}
          >
            {phaseLabel(directAccessRuntime().imageChannel)}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
            API 通道
          </span>
          <span
            class={`rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalS)] [font-size:var(--fontSizeBase100)] font-semibold ${phaseBadgeClass(directAccessRuntime().apiChannel)}`}
          >
            {phaseLabel(directAccessRuntime().apiChannel)}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
            IP 表条目
          </span>
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)]">
            {directAccessRuntime().tableEntries} 条（{directAccessRuntime().tableSource}）
          </span>
        </div>
        <Show when={directAccessRuntime().lastFetchAtMillis > 0}>
          <div class="flex items-center justify-between">
            <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
              最近拉取
            </span>
            <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)]">
              {new Date(directAccessRuntime().lastFetchAtMillis).toLocaleString()}
            </span>
          </div>
        </Show>
        {/* #398：远端表从未成功拉取（新装 / 无代理环境 GitHub 直连不可达）→
            明示内置表兜底与更新途径，避免「条目 0/内置"被误读为直连未配置 */}
        <Show when={directAccessRuntime().lastFetchAtMillis === 0}>
          <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
            当前由内置表兜底；远端 IP 表未拉取（GitHub 需代理），建议在代理环境点击「立即更新 IP
            表」
          </span>
        </Show>
      </div>

      {/* 命令行 */}
      <div class="flex gap-[var(--spacingHorizontalS)] py-2">
        <button
          type="button"
          class={ACTION_BUTTON_CLASS}
          disabled={busy() !== null}
          onClick={() => void runCommand("reset")}
        >
          {busy() === "reset" ? "重置中…" : "重置熔断"}
        </button>
        <button
          type="button"
          class={ACTION_BUTTON_CLASS}
          disabled={busy() !== null}
          onClick={() => void runCommand("refresh")}
        >
          {busy() === "refresh" ? "更新中…" : "立即更新 IP 表"}
        </button>
      </div>

      {/* 反馈提示（错误/成功，禁静默降级） */}
      <Show when={error()}>
        <p
          role="alert"
          class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)] leading-snug py-1"
        >
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusSuccessForeground1)] leading-snug py-1">
          {notice()}
        </p>
      </Show>

      {/* 手动 IP 表编辑（折叠区） */}
      <div
        class={ROW_CLASS}
        onClick={toggleEditor}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleEditor();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="手动 IP 表编辑"
        aria-expanded={expanded()}
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="wrench" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              手动 IP 表编辑
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              覆盖远端与内置表（{directAccessState().manual.length} 条）
            </p>
          </div>
        </div>
        <span class="text-[var(--colorNeutralForeground3)]">{expanded() ? "收起" : "展开"}</span>
      </div>
      <Show when={expanded()}>
        <div class="flex flex-col gap-[var(--spacingVerticalS)]">
          <textarea
            class="w-full rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] leading-snug p-[var(--spacingHorizontalM)] border border-[var(--colorNeutralStroke1)] resize-y focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
            rows={6}
            spellcheck={false}
            aria-label="手动 IP 表 JSON"
            value={draft()}
            oninput={(e) => setDraft(e.currentTarget.value)}
          />
          <button type="button" class={ACTION_BUTTON_CLASS} onClick={handleSaveManual}>
            保存手动 IP 表
          </button>
        </div>
      </Show>
    </div>
  );
};

export default SettingsDirectAccess;
