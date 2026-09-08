import { type Component, createSignal, For, Show } from "solid-js";
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
import {
  networkMode,
  networkModeLabel,
  networkModeDescription,
  setNetworkMode,
  type NetworkMode,
} from "../../stores/networkModeStore";
import {
  directAccessCommand,
  dohResolve as dohResolveBridge,
  type DirectAccessPhase,
} from "../../native/DirectAccess";

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

  // ── DoH 刷新（T6）────────────────────────────────────────────
  const [dohExpanded, setDohExpanded] = createSignal(false);
  const [dohHost, setDohHost] = createSignal("i.pximg.net");
  const [dohBusy, setDohBusy] = createSignal(false);
  const [dohResult, setDohResult] = createSignal<{ ips: string[]; timestamp: number } | null>(null);

  function toggleDohSection(): void {
    setDohResult(null);
    setDohExpanded(!dohExpanded());
  }

  async function runDohResolve(): Promise<void> {
    const host = dohHost().trim();
    if (!host) return;
    setDohBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await dohResolveBridge(host);
      setDohResult(result);
    } catch (err) {
      // web/dev 环境 reject — 显示失败提示，禁静默
      console.warn("[SettingsDirectAccess] dohResolve 失败", err);
      setDohResult({ ips: [], timestamp: 0 });
      setError(err instanceof Error ? err.message : "DoH 解析失败");
    } finally {
      setDohBusy(false);
    }
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

      {/* 网络模式三档选择（T5，pictelio-pure-client-direct-access）：
          standard / direct / compat——用户按网络环境切换；compat = 走系统代理（用户个人配置） */}
      <div class="flex flex-col gap-[var(--spacingVerticalS)] mb-3">
        <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          网络模式
        </span>
        <For each={["standard", "direct", "compat"] as NetworkMode[]}>
          {(mode) => {
            const isSelected = () => networkMode() === mode;
            return (
              <div
                class={ROW_CLASS}
                onClick={() => setNetworkMode(mode)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setNetworkMode(mode);
                  }
                }}
                role="button"
                tabindex="0"
                aria-label={`切换网络模式到 ${networkModeLabel(mode)}`}
                aria-pressed={isSelected()}
              >
                <div class="flex items-center gap-3">
                  <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
                    <FluentIcon name="server" size={24} />
                  </div>
                  <div>
                    <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                      {networkModeLabel(mode)}
                    </p>
                    <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                      {networkModeDescription(mode)}
                    </p>
                  </div>
                </div>
                <fluent-radio checked={isSelected()} />
              </div>
            );
          }}
        </For>
      </div>

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

      {/* DoH 刷新（T6）：高级用户主动调 DoH 端点解析 host → 写缓存。
          默认折叠：普通用户不需要；调试/IP 漂移时手动触发。 */}
      <div
        class={ROW_CLASS}
        onClick={toggleDohSection}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleDohSection();
          }
        }}
        role="button"
        tabindex="0"
        aria-label="DoH 解析（高级）"
        aria-expanded={dohExpanded()}
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="search" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              DoH 解析（高级）
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              主动调 DoH 端点解析 host（Quad9 / Cloudflare 1.0.0.1）
            </p>
          </div>
        </div>
        <span class="text-[var(--colorNeutralForeground3)]">{dohExpanded() ? "收起" : "展开"}</span>
      </div>
      <Show when={dohExpanded()}>
        <div class="flex flex-col gap-[var(--spacingVerticalS)]">
          <input
            type="text"
            class="w-full rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] leading-snug p-[var(--spacingHorizontalM)] border border-[var(--colorNeutralStroke1)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
            placeholder="i.pximg.net"
            aria-label="DoH 解析 host"
            value={dohHost()}
            oninput={(e) => setDohHost(e.currentTarget.value)}
          />
          <button
            type="button"
            class={ACTION_BUTTON_CLASS}
            disabled={dohBusy() || !dohHost().trim()}
            onClick={() => void runDohResolve()}
          >
            {dohBusy() ? "解析中…" : "立即 DoH 解析"}
          </button>
          <Show when={dohResult()}>
            <div class="flex flex-col gap-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] p-[var(--spacingHorizontalM)]">
              <Show
                when={dohResult()!.ips.length > 0}
                fallback={
                  <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusWarningForeground1)] leading-snug">
                    解析失败或返回为空——DoH 端点不可达或结果被识别为污染 IP
                  </p>
                }
              >
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
                  解析结果：
                </p>
                <ul class="flex flex-col gap-1">
                  <For each={dohResult()!.ips}>
                    {(ip) => (
                      <li class="[font-size:var(--fontSizeBase300)] font-mono text-[var(--colorNeutralForeground1)]">
                        {ip}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={dohResult()!.timestamp > 0}>
                <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                  缓存时间：{new Date(dohResult()!.timestamp).toLocaleString()}
                </p>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

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
