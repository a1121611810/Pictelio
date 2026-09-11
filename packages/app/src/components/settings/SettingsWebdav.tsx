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
  backupNow,
  listBackups,
  restoreFrom,
  testConnection,
  type BackupFileInfo,
} from "../../utils/backupService";
import { WEBDAV_ERROR_MESSAGES, BackupFormatError } from "../../utils/backupCore";
import {
  loadBackupPassword,
  loadWebdavPassword,
  saveBackupPassword,
  saveWebdavPassword,
} from "../../utils/webdavCredentials";
import { WebDavError, type WebDavErrorKind } from "../../native/WebDav";

const FIELD_CLASS =
  "flex-1 min-w-0 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] border border-[var(--colorNeutralStroke1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--colorStrokeFocus2)]";

const BUTTON_CLASS =
  "px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-transform duration-[var(--durationFast)] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)] disabled:opacity-50";

const LABEL_CLASS =
  "[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]";

/** 恢复确认对话框的三段状态（spec §6：选档 → 摘要确认 → 执行） */
type RestoreStep = "list" | "confirm";

/**
 * 错误分类 → 用户文案（spec §5；WebDavError 之外的类型走各自 message）。
 * 未知错误不静默：message 原样展示（toWebDavError 已 warn）。
 */
function errorMessage(err: unknown): string {
  if (err instanceof WebDavError) {
    return WEBDAV_ERROR_MESSAGES[err.kind as WebDavErrorKind] ?? err.message;
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
  const [busy, setBusy] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [loginPassword, setLoginPassword] = createSignal("");
  const [backupPassword, setBackupPassword] = createSignal("");
  const [pasteSensitive, setPasteSensitive] = createSignal<string[]>([]);
  const [showRestore, setShowRestore] = createSignal(false);
  const [restoreStep, setRestoreStep] = createSignal<RestoreStep>("list");
  const [files, setFiles] = createSignal<BackupFileInfo[]>([]);
  const [selected, setSelected] = createSignal<BackupFileInfo | null>(null);
  const [encryptedHint, setEncryptedHint] = createSignal(false);
  const [hasPreRestore, setHasPreRestore] = createSignal(false);

  /** 敏感项候选：当前账号级键（show_r18_* / show_r18g_* / ai_filter_mode_*） */
  async function refreshSensitiveKeys() {
    const wiring = createBackupWiring();
    const { raw } = await wiring.collect();
    setPasteSensitive(
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

  async function run(label: string, action: () => Promise<string>): Promise<void> {
    setBusy(label);
    setStatus("");
    setError("");
    try {
      setStatus(await action());
    } catch (e) {
      console.warn("[SettingsWebdav] " + label + " 失败", e);
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
    run("连接测试", async () => {
      await saveCredentials();
      const { fileCount } = await testConnection(buildDeps());
      return `连接成功，远端已有 ${fileCount} 份备份`;
    });

  const onBackup = () =>
    run("立即备份", async () => {
      await saveCredentials();
      const r = await backupNow(buildDeps());
      await setWebdavLastBackup(new Date().toISOString());
      // spec §6：应急快照保留到下次成功备份为止
      await clearPreRestoreSnapshot();
      setHasPreRestore(false);
      return `已备份 ${r.fileName}（${r.bytes} 字节${r.encrypted ? "，已加密" : ""}，清理旧档 ${r.deletedOld.length} 份）`;
    });

  const onOpenRestore = () =>
    run("读取备份列表", async () => {
      await saveCredentials();
      const list = await listBackups(buildDeps());
      setFiles(list);
      setSelected(null);
      setRestoreStep("list");
      setShowRestore(true);
      return list.length === 0 ? "远端暂无备份" : "";
    });

  const onRestore = () =>
    run("恢复", async () => {
      const file = selected();
      if (file === null) throw new Error("请先选择要恢复的备份");
      await saveCredentials();
      const result = await restoreFrom(buildDeps(), file);
      setHasPreRestore(true);
      setShowRestore(false);
      const { summary } = result;
      return `已恢复 ${summary.createdAt} 的备份（设备级 ${summary.deviceKeyCount} 项，账号级 ${summary.accountKeyCountForUid} 项，sets ${summary.setCount} 组；跳过异账号键 ${result.plan.skippedAccountKeys.length} 项）`;
    });

  const onUndo = () =>
    run("撤销恢复", async () => {
      const ok = await undoLastRestore(createBackupWiring());
      if (!ok) return "没有可撤销的应急快照";
      return "已回滚到恢复前的本地状态";
    });

  return (
    <div class="py-3 flex flex-col gap-3">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide">
        WebDAV 备份
      </p>

      <div class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2">
          <FluentIcon name="server" size={20} />
          <span class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
            启用 WebDAV 备份
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
            <span class={LABEL_CLASS}>服务器地址</span>
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
                非 HTTPS 连接存在泄露风险（spec §7）
              </span>
            </Show>
          </div>

          <div class="flex gap-2">
            <div class="flex-1 flex flex-col gap-1">
              <span class={LABEL_CLASS}>用户名</span>
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
              <span class={LABEL_CLASS}>密码（加密存储）</span>
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
              <span class={LABEL_CLASS}>目录</span>
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
              <span class={LABEL_CLASS}>备份密码（可选，加密备份文件）</span>
              <input
                type="password"
                class={FIELD_CLASS}
                placeholder="留空则不加密"
                value={backupPassword()}
                autocomplete="off"
                onInput={(e) => setBackupPassword(e.currentTarget.value)}
              />
            </div>
          </div>

          <Show when={pasteSensitive().length > 0}>
            <div class="flex flex-col gap-1">
              <span class={LABEL_CLASS}>敏感项排除（勾选后不进入备份文件）</span>
              <div class="flex flex-wrap gap-2">
                <For each={pasteSensitive()}>
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
                启动时自动备份
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
                  {(d) => <option value={String(d)}>每 {d} 天</option>}
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
            上次备份：
            {webdavLastBackup() === "" ? "从未备份" : new Date(webdavLastBackup()).toLocaleString()}
          </p>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onTest()}
            >
              连接测试
            </button>
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onBackup()}
            >
              立即备份
            </button>
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={busy() !== null}
              onClick={() => void onOpenRestore()}
            >
              恢复
            </button>
            <Show when={hasPreRestore()}>
              <button
                type="button"
                class={BUTTON_CLASS}
                disabled={busy() !== null}
                onClick={() => void onUndo()}
              >
                撤销上次恢复
              </button>
            </Show>
          </div>

          <Show when={busy() !== null}>
            <p
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]"
              role="status"
            >
              {busy()}…
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
        aria-label="恢复 WebDAV 备份"
      >
        <h3 slot="title">恢复 WebDAV 备份</h3>
        <Show when={restoreStep() === "list"}>
          <Show when={files().length > 0} fallback={<p>远端暂无备份文件</p>}>
            <div class="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
              <For each={files()}>
                {(f) => (
                  <button
                    type="button"
                    class={BUTTON_CLASS + " text-left"}
                    onClick={() => {
                      setSelected(f);
                      setEncryptedHint(f.encrypted);
                      setRestoreStep("confirm");
                    }}
                  >
                    {f.name}
                    {f.encrypted ? "（加密）" : ""}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
        <Show when={restoreStep() === "confirm" && selected() !== null}>
          <div class="flex flex-col gap-2">
            <p>将恢复：{selected()!.name}</p>
            <Show when={encryptedHint()}>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                该备份已加密，将使用上方「备份密码」解密。
              </p>
            </Show>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusWarningForeground1)]">
              恢复会覆盖本机对应设置（仅覆盖备份中存在的键）；恢复前会自动保存应急快照，可撤销。
            </p>
            <div class="flex gap-2">
              <button type="button" class={BUTTON_CLASS} onClick={() => setRestoreStep("list")}>
                返回
              </button>
              <button
                type="button"
                class={BUTTON_CLASS}
                disabled={busy() !== null}
                onClick={() => void onRestore()}
              >
                确认恢复
              </button>
            </div>
          </div>
        </Show>
      </FluentDialog>
    </div>
  );
};

export default SettingsWebdav;
