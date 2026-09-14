// @vitest-environment happy-dom
// SettingsWebdav 组件测试（oracle = spec docs/specs/webdav-backup.md §7 字段/流程 + §5 错误文案）。
// 组件只做状态与渲染：IO 面（backupService / backupWiring / 凭据）在用例内 mock，
// 断言用户可见行为（字段渲染、按钮流程、状态/错误文案）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";

const h = vi.hoisted(() => ({
  enabled: null as null | (() => boolean),
  url: null as null | (() => string),
  setEnabled: vi.fn(),
  setUrl: vi.fn(),
  setUsername: vi.fn(),
  setDir: vi.fn(),
  setBackupDays: vi.fn(),
  setAutoBackup: vi.fn(),
  setExcluded: vi.fn(),
  setLastBackup: vi.fn(),
  backupNow: vi.fn(),
  listBackups: vi.fn(),
  prepareRestore: vi.fn(),
  applyPreparedRestore: vi.fn(),
  testConnection: vi.fn(),
  clearPreRestore: vi.fn(async () => {}),
  loadPreRestore: vi.fn(async () => null),
  undoLastRestore: vi.fn(async () => true),
  loadLoginPassword: vi.fn(async () => ""),
  loadBackupPassword: vi.fn(async () => ""),
  saveLoginPassword: vi.fn(async () => {}),
  saveBackupPassword: vi.fn(async () => {}),
  collect: vi.fn(async () => ({ raw: { show_r18_42: "true" }, sets: {} })),
}));

vi.mock("@/stores/settingsStore", () => ({
  webdavEnabled: () => h.enabled!(),
  webdavUrl: () => h.url!(),
  webdavUsername: () => "",
  webdavDir: () => "Pictelio/backup",
  webdavAutoBackup: () => false,
  webdavAutoBackupDays: () => 7,
  webdavLastBackup: () => "",
  webdavExcludedKeys: () => [],
  setWebdavEnabled: h.setEnabled,
  setWebdavUrl: h.setUrl,
  setWebdavUsername: h.setUsername,
  setWebdavDir: h.setDir,
  setWebdavAutoBackup: h.setAutoBackup,
  setWebdavAutoBackupDays: h.setBackupDays,
  setWebdavLastBackup: h.setLastBackup,
  setWebdavExcludedKeys: h.setExcluded,
}));

vi.mock("@/utils/backupService", () => ({
  backupNow: h.backupNow,
  listBackups: h.listBackups,
  prepareRestore: h.prepareRestore,
  applyPreparedRestore: h.applyPreparedRestore,
  testConnection: h.testConnection,
}));

vi.mock("@/stores/authStore", () => ({
  user: () => ({ id: 42 }),
}));

vi.mock("@/services/backupWiring", () => ({
  createBackupDeps: () => ({}),
  createBackupWiring: () => ({ collect: h.collect, apply: vi.fn() }),
  clearPreRestoreSnapshot: h.clearPreRestore,
  loadPreRestoreSnapshot: h.loadPreRestore,
  undoLastRestore: h.undoLastRestore,
}));

const platform = vi.hoisted(() => ({ native: true }));
vi.mock("@/utils/platform", () => ({
  isNativePlatform: () => platform.native,
}));

vi.mock("@/utils/webdavCredentials", () => ({
  loadWebdavPassword: h.loadLoginPassword,
  loadBackupPassword: h.loadBackupPassword,
  saveWebdavPassword: h.saveLoginPassword,
  saveBackupPassword: h.saveBackupPassword,
}));

import SettingsWebdav from "@/components/settings/SettingsWebdav";
import { WebDavError } from "@/native/WebDav";

const flush = () => Promise.resolve();
const flushAll = async (n = 5) => {
  for (let i = 0; i < n; i++) await flush();
};

async function renderOpen() {
  const [enabled] = createSignal(true);
  h.enabled = enabled;
  h.url = () => "https://dav.example.com/";
  const r = render(() => <SettingsWebdav />);
  await flushAll();
  return r;
}

describe("SettingsWebdav（spec §7）", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    platform.native = true;
    h.loadPreRestore.mockResolvedValue(null);
    h.undoLastRestore.mockResolvedValue(true);
  });

  it("Web 平台（非原生）不渲染区块（spec §2/§7）", async () => {
    platform.native = false;
    const [enabled] = createSignal(true);
    h.enabled = enabled;
    h.url = () => "https://dav/";
    render(() => <SettingsWebdav />);
    await flushAll();
    expect(screen.queryByText("启用 WebDAV 备份")).toBeNull();
    expect(screen.queryByText("立即备份")).toBeNull();
  });

  it("开关关闭时表单不渲染（仅主开关）", async () => {
    const [enabled] = createSignal(false);
    h.enabled = enabled;
    h.url = () => "";
    render(() => <SettingsWebdav />);
    await flush();
    expect(screen.getByText("启用 WebDAV 备份")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/dav\.example\.com/)).toBeNull();
  });

  it("开关开启渲染 spec §7 字段（服务器/用户名/密码/目录/备份密码/敏感项）", async () => {
    await renderOpen();
    expect(screen.getByPlaceholderText(/dav\.example\.com/)).toBeTruthy();
    expect(screen.getByText("用户名")).toBeTruthy();
    expect(screen.getByText("密码（加密存储）")).toBeTruthy();
    expect(screen.getByText("目录")).toBeTruthy();
    expect(screen.getByText("备份密码（可选，加密备份文件）")).toBeTruthy();
    // 敏感项候选来自 collect（show_r18_42）
    await vi.waitFor(() => expect(screen.getByText("show_r18_42")).toBeTruthy());
    expect(screen.getByText("立即备份")).toBeTruthy();
    expect(screen.getByText("恢复")).toBeTruthy();
  });

  it("立即备份：调用 backupNow + 记录时间 + 清除应急快照 + 展示结果", async () => {
    h.backupNow.mockResolvedValue({
      fileName: "pictelio-backup-20260911-173005.json",
      encrypted: false,
      bytes: 123,
      deletedOld: ["/old.json"],
    });
    await renderOpen();
    fireEvent.click(screen.getByText("立即备份"));
    await vi.waitFor(() => expect(h.backupNow).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.clearPreRestore).toHaveBeenCalled()); // 保留到下次成功备份为止
    expect(h.setLastBackup).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(screen.getByText(/pictelio-backup-20260911-173005\.json/)).toBeTruthy(),
    );
  });

  it("连接失败：按 spec §5 渲染分类文案", async () => {
    h.testConnection.mockRejectedValue(new WebDavError("AUTH_FAILED", 401, "401"));
    await renderOpen();
    fireEvent.click(screen.getByText("连接测试"));
    await vi.waitFor(() => expect(screen.getByText("认证失败，请检查用户名与密码")).toBeTruthy());
  });

  it("恢复流程：选档 → 摘要确认（前置）→ 确认后写回（两段式，S2/S3）", async () => {
    h.listBackups.mockResolvedValue([
      {
        name: "pictelio-backup-20260911-173005.json",
        href: "/dav/pictelio-backup-20260911-173005.json",
        encrypted: false,
        contentLength: 10,
        timestamp: "20260911-173005",
      },
    ]);
    const prepared = {
      snapshot: { format: "pictelio-backup", schemaVersion: 1 },
      plan: {
        apply: { a: "1" },
        sets: {},
        skippedAccountKeys: ["show_r18_99"],
        skippedExcludedKeys: [],
      },
      summary: {
        createdAt: "2026-09-11T17:30:05+08:00",
        engine: "webview",
        appVersion: "1.0.0",
        deviceKeyCount: 1,
        accountKeyCount: 1,
        accountKeyCountForUid: 1,
        setCount: 0,
      },
      wasEncrypted: false,
    };
    h.prepareRestore.mockResolvedValue(prepared);
    h.applyPreparedRestore.mockResolvedValue({ applied: ["a"], skipped: [] });
    await renderOpen();
    fireEvent.click(screen.getByText("恢复"));
    await vi.waitFor(() =>
      expect(screen.getByText(/pictelio-backup-20260911-173005\.json/)).toBeTruthy(),
    );
    // 等待列表按钮脱离 busy disabled 态（onOpenRestore 的 finally 尚未执行时点击会被忽略）
    await vi.waitFor(() => {
      const btn = screen.getByText(/pictelio-backup-20260911-173005\.json/).closest("button");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByText(/pictelio-backup-20260911-173005\.json/));
    await vi.waitFor(() => expect(h.prepareRestore).toHaveBeenCalled());
    // 摘要确认：展示来源引擎/版本/计数（spec §6.2）
    await vi.waitFor(() => expect(screen.getByText(/来源引擎/)).toBeTruthy());
    expect(screen.getByText(/应用版本/)).toBeTruthy();
    expect(h.applyPreparedRestore).not.toHaveBeenCalled(); // 确认前零写回
    fireEvent.click(screen.getByText("确认恢复"));
    await vi.waitFor(() => expect(h.applyPreparedRestore).toHaveBeenCalled());
    // 结果反馈实际写入/跳过计数（spec §6.8）
    await vi.waitFor(() => expect(screen.getByText(/写入 1 项，跳过 0 项/)).toBeTruthy());
  });
});
