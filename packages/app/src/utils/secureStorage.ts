import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const REFRESH_TOKEN_KEY = "refresh_token";

export async function getRefreshToken(): Promise<string | null> {
  const [err, value] = await tryAsync(SecureStorage.get(REFRESH_TOKEN_KEY));
  if (err) {
    console.error("[secureStorage] failed to get refresh_token", err);
    return null;
  }
  return typeof value === "string" ? value : null;
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStorage.set(REFRESH_TOKEN_KEY, token);
}

export async function removeRefreshToken(): Promise<void> {
  await SecureStorage.remove(REFRESH_TOKEN_KEY);
}

/** 备份完整性检查标记键 */
const BACKUP_MARKER_KEY = "__pictelio_backup_marker";

/**
 * 检查备份完整性。
 * - 首次启动：写入 backup_marker → 返回 true
 * - 正常启动：marker 存在 → 返回 true
 * - 备份还原后：SecureStorage 异常 → 清除 token → 返回 false
 */
export async function checkBackupIntegrity(): Promise<boolean> {
  const [err, marker] = await tryAsync(SecureStorage.get(BACKUP_MARKER_KEY));
  if (err) {
    // SecureStorage 访问失败（备份还原后 Keystore 不可用）
    // 清除 refresh_token 防止泄露
    await removeRefreshToken();
    return false;
  }
  if (marker === null || marker === undefined) {
    await SecureStorage.set(BACKUP_MARKER_KEY, "1");
  }
  return true;
}

/** 从旧的 Preferences 迁移 refresh_token 到 SecureStorage（一次性） */
export async function migrateRefreshTokenFromPreferences(): Promise<string | null> {
  const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
  if (value) {
    await SecureStorage.set(REFRESH_TOKEN_KEY, value);
    await Preferences.remove({ key: REFRESH_TOKEN_KEY });
  }
  return value ?? null;
}
