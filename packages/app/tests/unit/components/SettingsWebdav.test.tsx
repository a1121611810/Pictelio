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
  restoreFrom: vi.fn(),
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
  restoreFrom: h.restoreFrom,
  testConnection: h.testConnection,
}));

vi.mock("@/services/backupWiring", () => ({
  createBackupDeps: () => ({}),
  createBackupWiring: () => ({ collect: h.collect, apply: vi.fn() }),
  clearPreRestoreSnapshot: h.clearPreRestore,
  loadPreRestoreSnapshot: h.loadPreRestore,
  undoLastRestore: h.undoLastRestore,
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
    h.loadPreRestore.mockResolvedValue(null);
    h.undoLastRestore.mockResolvedValue(true);
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

  it("恢复流程：选档 → 摘要确认 → 调用 restoreFrom", async () => {
    h.listBackups.mockResolvedValue([
      {
        name: "pictelio-backup-20260911-173005.json",
        href: "/dav/pictelio-backup-20260911-173005.json",
        encrypted: false,
        contentLength: 10,
        timestamp: "20260911-173005",
      },
    ]);
    h.restoreFrom.mockResolvedValue({
      plan: { apply: {}, sets: {}, skippedAccountKeys: [], skippedExcludedKeys: [] },
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
    });
    await renderOpen();
    fireEvent.click(screen.getByText("恢复"));
    await vi.waitFor(() =>
      expect(screen.getByText(/pictelio-backup-20260911-173005\.json/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText(/pictelio-backup-20260911-173005\.json/));
    await vi.waitFor(() => expect(screen.getByText(/恢复会覆盖本机对应设置/)).toBeTruthy());
    fireEvent.click(screen.getByText("确认恢复"));
    await vi.waitFor(() => expect(h.restoreFrom).toHaveBeenCalled());
  });
});
