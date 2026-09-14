// ─── WebDAV 凭据持久化（spec docs/specs/webdav-backup.md §8 / ADR-0156 D4）───
// 两个密码都只存 secure storage（Android Keystore 加密），绝不进：
//   - 普通 Preferences / localStorage（settings_webdav_* 连接配置可以，密码不行）
//   - 备份文件（备份域明确排除凭证）
// 键与 app-lynx utils/webdavCredentials.ts 逐字一致（双端共享同一加密存储，
// 与 refresh_token 同一存储格式约定，见 utils/secureStorage.ts 头注释）。
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { isNativePlatform } from "@/utils/platform";
import { tryAsync } from "./tryAsync";

/** WebDAV 服务器登录密码（Basic Auth 用） */
const WEBDAV_PASSWORD_KEY = "webdav_password";
/** 备份文件加密密码（PICTELIO-ENC1 派生密钥用，与登录密码相互独立） */
const WEBDAV_BACKUP_PASSWORD_KEY = "webdav_backup_password";

/**
 * 历史格式兼容读取：早期 SecureStorage.set 会把值 JSON.stringify 包裹（形如 "pwd"）。
 * 条件去引号（与 secureStorage.ts unquoteTokenValue 同款约定）。
 */
function unquoteValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  }
  return value;
}

async function save(key: string, value: string): Promise<void> {
  // 功能仅 Android 原生暴露入口（spec §2）；Web dev 不落密码，warn 可见（禁静默降级）
  if (!isNativePlatform()) {
    console.warn("[webdavCredentials] Web 平台不持久化 WebDAV 密码（功能仅原生可用）");
    return;
  }
  const [err] = await tryAsync(SecureStorage.setItem(key, value));
  if (err) {
    console.warn("[webdavCredentials] 密码写入失败", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

async function load(key: string): Promise<string | null> {
  if (!isNativePlatform()) return null;
  const [err, value] = await tryAsync(SecureStorage.getItem(key));
  if (err) {
    // 存储异常（Keystore 失效等）按无密码处理并 warn——与 secureStorage 先例一致
    console.warn("[webdavCredentials] 密码读取失败（按未设置处理）", err);
    return null;
  }
  return typeof value === "string" ? unquoteValue(value) : null;
}

async function clear(key: string): Promise<void> {
  if (!isNativePlatform()) return;
  const [err] = await tryAsync(SecureStorage.removeItem(key));
  if (err) console.warn("[webdavCredentials] 密码清除失败", err);
}

// ── WebDAV 登录密码 ──
export function saveWebdavPassword(password: string): Promise<void> {
  return save(WEBDAV_PASSWORD_KEY, password);
}
export function loadWebdavPassword(): Promise<string | null> {
  return load(WEBDAV_PASSWORD_KEY);
}
export function clearWebdavPassword(): Promise<void> {
  return clear(WEBDAV_PASSWORD_KEY);
}

// ── 备份加密密码 ──
export function saveBackupPassword(password: string): Promise<void> {
  return save(WEBDAV_BACKUP_PASSWORD_KEY, password);
}
export function loadBackupPassword(): Promise<string | null> {
  return load(WEBDAV_BACKUP_PASSWORD_KEY);
}
export function clearBackupPassword(): Promise<void> {
  return clear(WEBDAV_BACKUP_PASSWORD_KEY);
}
