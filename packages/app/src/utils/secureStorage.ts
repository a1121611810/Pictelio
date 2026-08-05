import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { PixivApi } from "@/native/PixivApi";
import { tryAsync } from "./tryAsync";

const REFRESH_TOKEN_KEY = "refresh_token";
/** 备份完整性检查标记键 */
const BACKUP_MARKER_KEY = "__pictelio_backup_marker";

/**
 * token 持久化深模块 —— 对外唯一接口：restore / save / clear。
 *
 * 职责：加密存储（Android Keystore 密钥 + 密文落盘）、备份完整性检查、
 * 旧 Preferences 一次性迁移、Native 内存同步。所有 token 状态变化都必须
 * 经此三接口，保证「持久化与 Native 同步」不变量（登出/刷新不再遗漏同步）。
 *
 * 背景与实现核实：docs/research/android-token-storage.md
 */

/**
 * 兼容双端存储格式（T1 修复，对齐 lynx tokenStorage.ts 的 unquoteNativeString）。
 *
 * 双端共享同一加密存储（SharedPreferences key `capacitor-storage_refresh_token`），
 * 写入格式必须一致：lynx（SecureStorageCompat.setItem）与 webview（SecureStorage.setItem）
 * 均存原始字符串。历史版本 webview 用 SecureStorage.set（JSON.stringify 包裹）写入，
 * 读出的值形如 `"token"`；因此读取时对「形如 JSON 字符串（首尾双引号）」的值做一次
 * 条件去引号还原（token 为 base64 字符集不含引号，安全）；非法 JSON 保持原样，避免误删。
 */
function unquoteTokenValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      // 非 JSON 字符串（如损坏数据）→ 原样返回，交由上层判断
      return value;
    }
  }
  return value;
}

/**
 * 向 Native 同步当前 refresh_token（供 Java 401 静默刷新使用）。
 * Web/DEV 环境无 PixivApi 插件，调用 reject —— 静默跳过，不破坏持久化主流程。
 */
async function syncNativeToken(token: string | null): Promise<void> {
  const [err] = await tryAsync(PixivApi.syncToken({ token }));
  if (err) {
    console.warn("[secureStorage] syncToken 失败（Web 环境可忽略）", err);
  }
}

/**
 * 启动时恢复 refresh_token：完整性检查 → 读取（含旧 Preferences 一次性迁移）→ Native 注入。
 *
 * 三态语义（统一处理存储异常，不再区分吞错/分错）：
 * - 正常 / 首次启动 → 返回 token（首次写入 backup_marker）
 * - 任何存储异常（备份还原、Keystore 密钥失效、解密抛错 AEADBadTag → reject）
 *   → 清除 token 与 Native 内存 → 返回 null（强制重新登录）
 */
export async function restoreRefreshToken(): Promise<string | null> {
  // 层③：备份完整性检查 —— marker 读取异常视为备份还原（Keystore 密钥不可用），清除 token 防泄露
  const [markerErr, marker] = await tryAsync(SecureStorage.get(BACKUP_MARKER_KEY));
  if (markerErr) {
    await clearRefreshToken();
    return null;
  }
  if (marker === null || marker === undefined) {
    await tryAsync(SecureStorage.set(BACKUP_MARKER_KEY, "1"));
  }

  let token: string | null = null;
  const [tokenErr, value] = await tryAsync(SecureStorage.getItem(REFRESH_TOKEN_KEY));
  if (tokenErr) {
    // 解密抛错路径：密钥失效重建后旧密文解密失败（GCM 认证失败 → 插件 reject），同样清除
    console.warn(
      "[secureStorage] refresh_token 读取失败（存储损坏/密钥失效）→ 清除并强制重新登录",
      tokenErr,
    );
    await clearRefreshToken();
    return null;
  }
  token = typeof value === "string" ? unquoteTokenValue(value) : null;

  if (!token) {
    // 旧版 @capacitor/preferences 明文迁移（一次性）
    // 迁移源读取失败仅跳过迁移（主存储无 token，无需清除）；主存储写入失败按存储异常处理
    const [prefErr, prefResult] = await tryAsync(Preferences.get({ key: REFRESH_TOKEN_KEY }));
    if (!prefErr && prefResult?.value) {
      const legacy = prefResult.value;
      const [setErr] = await tryAsync(SecureStorage.setItem(REFRESH_TOKEN_KEY, legacy));
      if (setErr) {
        await clearRefreshToken();
        return null;
      }
      await tryAsync(Preferences.remove({ key: REFRESH_TOKEN_KEY }));
      token = legacy;
    }
  }

  if (token) {
    await syncNativeToken(token);
  }
  return token;
}

/** 保存 refresh_token（加密存储 + Native 内存同步；持久化失败不阻断 Native 注入） */
export async function saveRefreshToken(token: string): Promise<void> {
  // 用 setItem 写原始字符串（与 lynx SecureStorageCompat.setItem 存储格式一致，避免 JSON 包裹漂移）
  await tryAsync(SecureStorage.setItem(REFRESH_TOKEN_KEY, token));
  await syncNativeToken(token);
}

/** 清除 refresh_token（加密存储 + Native 内存与历史明文残留） */
export async function clearRefreshToken(): Promise<void> {
  await tryAsync(SecureStorage.remove(REFRESH_TOKEN_KEY));
  await syncNativeToken(null);
}
