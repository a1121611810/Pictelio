import { type Component, For, Show, createEffect, createSignal } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import FluentDialog from "../ui/FluentDialog";
import {
  setWebdavAutoBackup,
  setWebdavAutoBackupDays,
  setWebdavDir,
  setWebdavEnabled,
  setWebdavExcludedKeys,
  setWebdavLastBackup,
  setWebdavUrl,
  setWebdavUsername,
  webdavAutoBackup,
  webdavAutoBackupDays,
  webdavDir,
  webdavEnabled,
  webdavExcludedKeys,
  webdavLastBackup,
  webdavUrl,
  webdavUsername,
} from "../../stores/settingsStore";
import {
  createBackupDeps,
  createBackupWiring,
  clearPreRestoreSnapshot,
  loadPreRestoreSnapshot,
  undoLastRestore,
} from "../../services/backupWiring";
import {
  applyPreparedRestore,
  backupNow,
  listBackups,
  prepareRestore,
  testConnection,
  type BackupFileInfo,
  type PreparedRestore,
} from "../../utils/backupService";
import { BackupFormatError } from "../../utils/backupCore";
import {
  loadBackupPassword,
  loadWebdavPassword,
  saveBackupPassword,
  saveWebdavPassword,
} from "../../utils/webdavCredentials";
import { WebDavError, type WebDavErrorKind } from "../../native/WebDav";
import { isNativePlatform } from "../../utils/platform";
import { user } from "../../stores/authStore";
import { t, type I18nKey } from "../../i18n";

const FIELD_CLASS =
  "flex-1 min-w-0 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--colorStrokeFocus2)]";

const BUTTON_CLASS =
  "min-h-[40px] px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)] disabled:opacity-50";

const LABEL_CLASS =
  "[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]";

/** 恢复确认对话框的三段状态（spec §6：选档 → 摘要确认 → 执行） */
type RestoreStep = "list" | "confirm";

/**
 * 错误分类 → i18n key（spec §5；WebDavError 之外的类型走各自 message）。
 * zh 值与 backupCore.WEBDAV_ERROR_MESSAGES 逐字一致（备份契约测试钉原文）；
 * 渲染经 t()（i18n B2：存 key，不再模块加载时快照文案）。
 */
const WEBDAV_ERROR_KEYS: Record<WebDavErrorKind, I18nKey> = {
  AUTH_FAILED: "settings.webdav.error.AUTH_FAILED",
  FORBIDDEN: "settings.webdav.error.FORBIDDEN",
  NOT_FOUND: "settings.webdav.error.NOT_FOUND",
  QUOTA_EXCEEDED: "settings.webdav.error.QUOTA_EXCEEDED",
  CONFLICT: "settings.webdav.error.CONFLICT",
  NETWORK: "settings.webdav.error.NETWORK",
  SERVER: "settings.webdav.error.SERVER",
  CRYPTO: "settings.webdav.error.CRYPTO",
};

/**
 * 错误分类 → 用户文案（spec §5；WebDavError 之外的类型走各自 message）。
 * 未知错误不静默：message 原样展示（toWebDavError 已 warn）。
 */
function errorMessage(err: unknown): string {
  if (err instanceof WebDavError) {
    const base = t(WEBDAV_ERROR_KEYS[err.kind as WebDavErrorKind]) || err.message;
    // spec §5「其他（含原始状态码）」：SERVER 类附 HTTP 码，便于用户/排障定位
    return err.kind === "SERVER" && err.statusCode > 0
      ? t("settings.webdav.error.httpStatus", { base, code: err.statusCode })
      : base;
  }
  if (err instanceof BackupFormatError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 编排依赖：配置来自设置域单例（模块级，无组件闭包捕获） */
function buildDeps() {
  return createBackupDeps({
    url: webdavUrl(),
    username: webdavUsername(),
    dir: webdavDir(),
    excludedKeys: webdavExcludedKeys(),
  });
}

/**
 * 设置页「WebDAV 备份」卡片（spec docs/specs/webdav-backup.md §7）。
 *
 * 覆盖：连接配置、凭据（secure storage）、敏感项排除、自动备份、上次备份时间、
 * 立即备份、恢复（选档 → 摘要确认 → 执行）、连接测试、撤销上次恢复（T9）。
 * 所有 IO 经 services/backupWiring + utils/backupService（组件只做状态与渲染）。
 */
const SettingsWebdav: Component = () => {
  // busy 存 i18n key，渲染时 t(key)（i18n B2：模块存活状态不快照文案）
  const [busy, setBusy] = createSignal<I18nKey | null>(null);
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [loginPassword, setLoginPassword] = createSignal("");
  const [backupPassword, setBackupPassword] = createSignal("");
  const [sensitiveKeys, setSensitiveKeys] = createSignal<string[]>([]);
  const [showRestore, setShowRestore] = createSignal(false);
  const [restoreStep, setRestoreStep] = createSignal<RestoreStep>("list");
  const [files, setFiles] = createSignal<BackupFileInfo[]>([]);
  const [selected, setSelected] = createSignal<BackupFileInfo | null>(null);
  const [prepared, setPrepared] = createSignal<PreparedRestore | null>(null);
  const [promptPassword, setPromptPassword] = createSignal("");
  const [needsPassword, setNeedsPassword] = createSignal(false);
  const [restoreError, setRestoreError] = createSignal("");
  const [hasPreRestore, setHasPreRestore] = createSignal(false);

  /** 敏感项候选：当前账号级键（show_r18_* / show_r18g_* / ai_filter_mode_*） */
  async function refreshSensitiveKeys() {
    const wiring = createBackupWiring();
    const { raw } = await wiring.collect();
    setSensitiveKeys(
      Object.keys(raw).filter(
        (k) =>
          k.startsWith("show_r18_") ||
          k.startsWith("show_r18g_") ||
          k.startsWith("ai_filter_mode_"),
      ),
    );
  }

  // Solid 2.0 双参 createEffect（compute, effect）：开关打开时惰性加载凭据与敏感项
  createEffect(
    () => webdavEnabled(),
    (enabled) => {
      if (!enabled) return;
      void (async () => {
        setLoginPassword((await loadWebdavPassword()) ?? "");
        setBackupPassword((await loadBackupPassword()) ?? "");
        setHasPreRestore((await loadPreRestoreSnapshot()) !== null);
        await refreshSensitiveKeys();
      })().catch((e) => console.warn("[SettingsWebdav] 初始化失败", e));
    },
  );

  async function run(label: I18nKey, action: () => Promise<string>): Promise<void> {
    setBusy(label);
    setStatus("");
    setError("");
    try {
      // i18n: set 时快照（瞬态）
      setStatus(await action());
    } catch (e) {
      console.warn("[SettingsWebdav] " + label + " 失败", e);
      // i18n: set 时快照（瞬态）
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const saveCredentials = async () => {
    await saveWebdavPassword(loginPassword());
    await saveBackupPassword(backupPassword());
  };

  const onTest = () =>
    run("settings.webdav.action.test", async () => {
      await saveCredentials();
      const { fileCount } = await testConnection(buildDeps());
      return t("settings.webdav.status.testOk", { count: fileCount });
    });

  /** S4：任何可能产生/清除应急快照的操作后刷新撤销入口 */
  async function refreshPreRestoreFlag(): Promise<void> {
    setHasPreRestore((await loadPreRestoreSnapshot()) !== null);
  }

  const onBackup = () =>
    run("settings.webdav.action.backupNow", async () => {
      await saveCredentials();
      const r = await backupNow(buildDeps());
      await setWebdavLastBackup(new Date().toISOString());
      // spec §6：应急快照保留到下次成功备份为止
      await clearPreRestoreSnapshot();
      await refreshPreRestoreFlag();
      // i18n: set 时快照（瞬态）
      return r.encrypted
        ? t("settings.webdav.status.backupOkEncrypted", {
            name: r.fileName,
            bytes: r.bytes,
            count: r.deletedOld.length,
          })
        : t("settings.webdav.status.backupOk", {
            name: r.fileName,
            bytes: r.bytes,
            count: r.deletedOld.length,
          });
    });

  const onOpenRestore = () =>
    run("settings.webdav.action.loadList", async () => {
      await saveCredentials();
      const list = await listBackups(buildDeps());
      setFiles(list);
      setSelected(null);
      setPrepared(null);
      setRestoreError("");
      setRestoreStep("list");
      setShowRestore(true);
      return list.length === 0 ? t("settings.webdav.status.noBackups") : "";
    });

  /** S2/S7：选档后先「准备」（下载→解密→解析→摘要），确认前零写回 */
  function onSelectFile(file: BackupFileInfo): void {
    setSelected(file);
    setPrepared(null);
    setRestoreError("");
    if (file.encrypted && backupPassword() === "") {
      setNeedsPassword(true); // 加密档且无已保存备份密码 → 本次输入
      return;
    }
    setNeedsPassword(false);
    // 显式传档：Solid 2.0 批处理下 setSelected 后同 tick 读 selected() 仍是旧值
    void prepareSelected(file);
  }

  async function prepareSelected(fileArg?: BackupFileInfo): Promise<void> {
    const file = fileArg ?? selected();
    if (file === null) return;
    setBusy("settings.webdav.action.prepare");
    setError("");
    setRestoreError("");
    try {
      const result = await prepareRestore(
        buildDeps(),
        file,
        needsPassword() ? promptPassword() : undefined,
      );
      setPrepared(result);
      setRestoreStep("confirm");
    } catch (e) {
      console.warn("[SettingsWebdav] 读取备份摘要失败", e);
      // 错误渲染在对话框内（S4：外层错误被弹窗遮罩挡住不可见）
      // i18n: set 时快照（瞬态）
      setRestoreError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const onRestore = () => {
    const preparedRestore = prepared();
    if (preparedRestore === null) return;
    void run("settings.webdav.action.restore", async () => {
      try {
        const result = await applyPreparedRestore(buildDeps(), preparedRestore);
        setShowRestore(false);
        const { summary, plan } = preparedRestore;
        const uid = user()?.id ?? null;
        // i18n: set 时快照（瞬态）
        const skippedLabel =
          uid === null
            ? t("settings.webdav.status.skippedLoggedOut", { count: plan.skippedAccountKeys.length })
            : t("settings.webdav.status.skippedOtherAccount", {
                count: plan.skippedAccountKeys.length,
              });
        return t("settings.webdav.status.restoreOk", {
          time: summary.createdAt,
          applied: result.applied.length,
          skipped: result.skipped.length,
          device: summary.deviceKeyCount,
          account: summary.accountKeyCountForUid,
          sets: summary.setCount,
          skippedLabel,
        });
      } finally {
        // S4：写回中途失败也必须暴露可回滚入口
        await refreshPreRestoreFlag();
      }
    });
  };

  const onUndo = () =>
    run("settings.webdav.action.undo", async () => {
      const ok = await undoLastRestore(createBackupWiring());
      await refreshPreRestoreFlag();
      if (!ok) return t("settings.webdav.status.nothingToUndo");
      return t("settings.webdav.status.undoOk");
    });

  // spec §2/§7：仅 Android 原生暴露入口（web dev 不渲染本区块）；
  // 放在 hooks 之后保持 hook 调用无条件
  if (!isNativePlatform()) return null;

  return (
    <div class="py-3 flex flex-col gap-3">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase">
        {t("settings.webdav.sectionTitle")}
      </p>

      <div class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2">
          <FluentIcon name="server" size={20} />
          <span class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
            {t("settings.webdav.enable")}
          </span>
        </span>
        <fluent-switch
          checked={webdavEnabled()}
          onChange={(e: Event) =>
            void setWebdavEnabled((e.currentTarget as HTMLInputElement).checked)
          }
        />
      </div>

      <Show when={webdavEnabled()}>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <span class={LABEL_CLASS}>{t("settings.webdav.serverUrl")}</span>
            <input
              type="url"
              class={FIELD_CLASS}
              placeholder="https://dav.example.com/remote.php/dav/files/me/"
              value={webdavUrl()}
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => void setWebdavUrl(e.currentTarget.value)}
            />
            <Show when={webdavUrl() !== "" && !webdavUrl().startsWith("https://")}>
              <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusWarningForeground1)]">
                {t("settings.webdav.httpsWarning")}
              </span>
            </Show>
          </div>

          <div class="flex gap-2">
            <div class="flex-1 flex flex-col gap-1">
              <span class={LABEL_CLASS}>{t("settings.webdav.username")}</span>
              <input
                type="text"
                class={FIELD_CLASS}
                value={webdavUsername()}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => void setWebdavUsername(e.currentTarget.value)}
              />
            </div>
            <div class="flex-1 flex flex-col gap-1">
              <span class={LABEL_CLASS}>{t("settings.webdav.password")}</span>
              <input
                type="password"
                class={FIELD_CLASS}
                value={loginPassword()}
                autocomplete="off"
                onInput={(e) => setLoginPassword(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="flex gap-2">
            <div class="flex-1 flex flex-col gap-1">
              <span class={LABEL_CLASS}>{t("settings.webdav.dir")}</span>
              <input
                type="text"
                class={FIELD_CLASS}
                value={webdavDir()}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => void setWebdavDir(e.currentTarget.value)}
              />
            </div>
            <div class="flex-1 flex flex-col gap-1">
              <span class={LABEL_CLASS}>{t("settings.webdav.backupPassword")}</span>
              <input
                type="password"
                class={FIELD_CLASS}
                placeholder={t("settings.webdav.backupPasswordPlaceholder")}
                value={backupPassword()}
                autocomplete="off"
                onInput={(e) => setBackupPassword(e.currentTarget.value)}
              />
            </div>
          </div>

          <Show when={sensitiveKeys().length > 0}>
            <div class="flex flex-col gap-1">
              <span class={LABEL_CLASS}>{t("settings.webdav.sensitiveExclude")}</span>
              <div class="flex flex-wrap gap-2">
                <For each={sensitiveKeys()}>
                  {(key) => (
                    <label class="flex items-center gap-1 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
                      <input
                        type="checkbox"
                        checked={webdavExcludedKeys().includes(key)}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          const next = checked
                            ? [...webdavExcludedKeys(), key]
                            : webdavExcludedKeys().filter((k) => k !== key);
                          void setWebdavExcludedKeys(next);
                        }}
                      />
                      {key}
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2">
              <FluentIcon name="history" size={20} />
              <span class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]">
                {t("settings.webdav.autoBackup")}
              </span>
            </span>
            <div class="flex items-center gap-2">
              <select
                class={FIELD_CLASS}
                disabled={!webdavAutoBackup()}
                value={String(webdavAutoBackupDays())}
                onChange={(e) => void setWebdavAutoBackupDays(Number(e.currentTarget.value))}
              >
                <For each={[1, 3, 7, 30]}>
                  {(d) => <option value={String(d)}>{t("settings.webdav.autoBackupDays", { days: d })}</option>}
                </For>
              </select>
              <fluent-switch
                checked={webdavAutoBackup()}
                onChange={(e: Event) =>
                  void setWebdavAutoBackup((e.currentTarget as HTMLInputElement).checked)
                }
              />
            </div>
          </div>

          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            {t("settings.webdav.lastBackupLabel")}
            {webdavLastBackup() === ""
              ? t("settings.webdav.neverBackedUp")
              : new Date(webdavLastBackup()).toLocaleString()}
          </p>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onTest()}
            >
              {t("settings.webdav.action.test")}
            </button>
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onBackup()}
            >
              {t("settings.webdav.action.backupNow")}
            </button>
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onOpenRestore()}
            >
              {t("settings.webdav.action.restore")}
            </button>
            <Show when={hasPreRestore()}>
              <button
                type="button"
                class={BUTTON_CLASS}
                disabled={busy() !== null}
                onClick={() => void onUndo()}
              >
                {t("settings.webdav.action.undoLast")}
              </button>
            </Show>
          </div>

          <Show when={busy() !== null}>
            <p
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]"
              role="status"
            >
              {t(busy()!)}…
            </p>
          </Show>
          <Show when={status() !== ""}>
            <p
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]"
              role="status"
            >
              {status()}
            </p>
          </Show>
          <Show when={error() !== ""}>
            <p
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
              role="alert"
            >
              {error()}
            </p>
          </Show>
        </div>
      </Show>

      {/* 恢复：选档 → 摘要确认（spec §6） */}
      <FluentDialog
        open={showRestore()}
        onClose={() => setShowRestore(false)}
        aria-label={t("settings.webdav.restoreTitle")}
      >
        <h3 slot="title">{t("settings.webdav.restoreTitle")}</h3>
        <Show when={restoreStep() === "list"}>
          <Show when={files().length > 0} fallback={<p>{t("settings.webdav.restoreEmpty")}</p>}>
            <div class="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
              <For each={files()}>
                {(f) => (
                  <button
                    type="button"
                    class={BUTTON_CLASS + " text-left"}
                    disabled={busy() !== null}
                    onClick={() => onSelectFile(f)}
                  >
                    {f.name}
                    {f.encrypted ? t("settings.webdav.fileEncrypted") : ""}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
        {/* S7：加密档且无已保存备份密码 → 本次输入（解密后才能出摘要） */}
        <Show when={restoreStep() === "list" && needsPassword() && selected() !== null}>
          <div class="flex flex-col gap-2 mt-2">
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("settings.webdav.encryptedPrompt", { name: selected()!.name })}
            </p>
            <input
              type="password"
              class={FIELD_CLASS}
              value={promptPassword()}
              autocomplete="off"
              onInput={(e) => setPromptPassword(e.currentTarget.value)}
            />
            {/* M6：解密失败必须在密码块内可见（否则 needsPassword 挡住列表步错误块） */}
            <Show when={restoreError() !== ""}>
              <p
                class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
                role="alert"
              >
                {restoreError()}
              </p>
            </Show>
            <div class="flex gap-2">
              <button type="button" class={BUTTON_CLASS} onClick={() => setNeedsPassword(false)}>
                {t("settings.webdav.cancel")}
              </button>
              <button
                type="button"
                class={BUTTON_CLASS}
                disabled={busy() !== null || promptPassword() === ""}
                onClick={() => void prepareSelected(selected() ?? undefined)}
              >
                {t("settings.webdav.decryptAndPreview")}
              </button>
            </div>
          </div>
        </Show>
        {/* S2：摘要确认展示在写回之前（时间/来源引擎/版本/三类计数） */}
        <Show when={restoreStep() === "confirm" && prepared() !== null}>
          <div class="flex flex-col gap-2">
            <p>{t("settings.webdav.restoreWillApply", { name: selected()!.name })}</p>
            <ul class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
              <li>{t("settings.webdav.summaryCreatedAt", { value: prepared()!.summary.createdAt })}</li>
              <li>{t("settings.webdav.summaryEngine", { value: prepared()!.summary.engine })}</li>
              <li>{t("settings.webdav.summaryAppVersion", { value: prepared()!.summary.appVersion })}</li>
              <li>
                {t("settings.webdav.summaryCounts", {
                  device: prepared()!.summary.deviceKeyCount,
                  account: prepared()!.summary.accountKeyCountForUid,
                  sets: prepared()!.summary.setCount,
                })}
              </li>
              <li>
                {t("settings.webdav.summarySkipped", {
                  count: prepared()!.plan.skippedAccountKeys.length,
                })}
                {user()?.id == null
                  ? t("settings.webdav.summarySkippedLoggedOut")
                  : t("settings.webdav.summarySkippedOther")}
              </li>
            </ul>
            <Show when={prepared()!.wasEncrypted}>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("settings.webdav.restoredEncrypted")}
              </p>
            </Show>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusWarningForeground1)]">
              {t("settings.webdav.restoreWarning")}
            </p>
            <Show when={restoreError() !== ""}>
              <p
                class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
                role="alert"
              >
                {restoreError()}
              </p>
            </Show>
            <div class="flex gap-2">
              <button type="button" class={BUTTON_CLASS} onClick={() => setRestoreStep("list")}>
                {t("settings.webdav.back")}
              </button>
              <button
                type="button"
                class={BUTTON_CLASS}
                disabled={busy() !== null}
                onClick={() => void onRestore()}
              >
                {t("settings.webdav.confirmRestore")}
              </button>
            </div>
          </div>
        </Show>
        {/* 摘要读取失败（解密/解析）时在对话内提示，避免被遮罩挡住（S4） */}
        <Show when={restoreError() !== "" && restoreStep() === "list" && !needsPassword()}>
          <p
            class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)] mt-2"
            role="alert"
          >
            {restoreError()}
          </p>
        </Show>
      </FluentDialog>
    </div>
  );
};

export default SettingsWebdav;
