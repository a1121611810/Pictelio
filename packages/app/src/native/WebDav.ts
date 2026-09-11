// ─── WebDAV Capacitor 桥（webview 引擎薄桥，ADR-0156 D1 / spec webdav-backup §4）───
// 协议逻辑全在 Java WebDavClient / BackupCrypto（单一事实源）；本文件只做：
// 参数/回调形态转换、base64 字节过桥、reject code → WebDavError 分类映射。
// 与 app-lynx utils/webDavBridge.ts 同源同语义（双端差分对齐约定）。
import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/utils/platform";

/** 与 Java WebDavClient.Kind 逐字一致（+CRYPTO：BackupCrypto 密码错误或文件损坏） */
export type WebDavErrorKind =
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "CONFLICT"
  | "NETWORK"
  | "SERVER"
  | "CRYPTO";

export const WEBDAV_ERROR_KINDS: readonly WebDavErrorKind[] = [
  "AUTH_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "QUOTA_EXCEEDED",
  "CONFLICT",
  "NETWORK",
  "SERVER",
  "CRYPTO",
];

/** 分类后的 WebDAV 错误（spec §5 错误分类映射的用户文案由调用层按 kind 渲染） */
export class WebDavError extends Error {
  constructor(
    public readonly kind: WebDavErrorKind,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "WebDavError";
  }
}

/** 与 Java WebDavClient.DavEntry 同构（PROPFIND 返回的单个资源条目） */
export interface WebDavEntry {
  href: string;
  isCollection: boolean;
  contentLength: number | null;
}

export interface WebDavCreds {
  user: string;
  password: string;
}

/** Capacitor 插件方法集（字节经 base64 过桥；与 WebDavPlugin.java 逐字对应） */
export interface WebDavPluginInterface {
  ensureDir(options: { url: string } & WebDavCreds): Promise<void>;
  upload(options: { url: string; base64: string } & WebDavCreds): Promise<void>;
  uploadWithVerify(
    options: { url: string; base64: string; maxAttempts?: number } & WebDavCreds,
  ): Promise<void>;
  download(options: { url: string } & WebDavCreds): Promise<{ base64: string }>;
  list(options: { url: string } & WebDavCreds): Promise<{ entries: WebDavEntry[] }>;
  stat(options: { url: string } & WebDavCreds): Promise<{ entry: WebDavEntry }>;
  delete(options: { url: string } & WebDavCreds): Promise<void>;
  prune(
    options: { url: string; prefix: string; keep?: number } & WebDavCreds,
  ): Promise<{ deleted: string[] }>;
  encrypt(options: { base64: string; password: string }): Promise<{ base64: string }>;
  decrypt(options: { base64: string; password: string }): Promise<{ base64: string }>;
  isEncrypted(options: { base64: string }): Promise<{ encrypted: boolean }>;
}

export const WebDavPlugin = registerPlugin<WebDavPluginInterface>("WebDav");

// ── base64 助手（分块 btoa，避免大数组栈溢出；webview 环境恒有 btoa/atob）──

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── 错误映射 ──

/** Capacitor reject(message, code) → WebDavError（code 缺失/未知 → SERVER） */
function toWebDavError(err: unknown): WebDavError {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : String(err);
  const kind = WEBDAV_ERROR_KINDS.includes(code as WebDavErrorKind)
    ? (code as WebDavErrorKind)
    : "SERVER";
  return new WebDavError(kind, -1, message);
}

async function guardNative(): Promise<void> {
  // 功能仅 Android 原生暴露入口（spec §2）；Web dev 提前失败，错误分类一致
  if (!isNativePlatform()) {
    throw new WebDavError("SERVER", -1, "WebDAV 备份仅 Android 原生可用");
  }
}

// ── 类型化桥方法（T4 备份核心消费这些，而不是直接碰插件）──

export async function ensureDir(url: string, creds: WebDavCreds): Promise<void> {
  await guardNative();
  try {
    await WebDavPlugin.ensureDir({ url, ...creds });
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function upload(url: string, creds: WebDavCreds, data: Uint8Array): Promise<void> {
  await guardNative();
  try {
    await WebDavPlugin.upload({ url, ...creds, base64: bytesToBase64(data) });
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function uploadWithVerify(
  url: string,
  creds: WebDavCreds,
  data: Uint8Array,
  maxAttempts?: number,
): Promise<void> {
  await guardNative();
  try {
    await WebDavPlugin.uploadWithVerify({
      url,
      ...creds,
      base64: bytesToBase64(data),
      maxAttempts,
    });
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function download(url: string, creds: WebDavCreds): Promise<Uint8Array> {
  await guardNative();
  try {
    const res = await WebDavPlugin.download({ url, ...creds });
    return base64ToBytes(res.base64);
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function list(url: string, creds: WebDavCreds): Promise<WebDavEntry[]> {
  await guardNative();
  try {
    const res = await WebDavPlugin.list({ url, ...creds });
    return res.entries;
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function stat(url: string, creds: WebDavCreds): Promise<WebDavEntry> {
  await guardNative();
  try {
    const res = await WebDavPlugin.stat({ url, ...creds });
    return res.entry;
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function deleteResource(url: string, creds: WebDavCreds): Promise<void> {
  await guardNative();
  try {
    await WebDavPlugin.delete({ url, ...creds });
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function prune(
  dirUrl: string,
  creds: WebDavCreds,
  prefix: string,
  keep?: number,
): Promise<string[]> {
  await guardNative();
  try {
    const res = await WebDavPlugin.prune({ url: dirUrl, ...creds, prefix, keep });
    return res.deleted;
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function encrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  await guardNative();
  try {
    const res = await WebDavPlugin.encrypt({ base64: bytesToBase64(data), password });
    return base64ToBytes(res.base64);
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function decrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  await guardNative();
  try {
    const res = await WebDavPlugin.decrypt({ base64: bytesToBase64(data), password });
    return base64ToBytes(res.base64);
  } catch (e) {
    throw toWebDavError(e);
  }
}

export async function isEncrypted(data: Uint8Array): Promise<boolean> {
  await guardNative();
  try {
    const res = await WebDavPlugin.isEncrypted({ base64: bytesToBase64(data) });
    return res.encrypted;
  } catch (e) {
    throw toWebDavError(e);
  }
}
