import { registerPlugin } from "@capacitor/core";

/**
 * OTA web bundle 插件封装（#249，规格 docs/specs/ota-web-bundle.md；ADR-0122）。
 *
 * 语义：
 *  - install：下载 → Ed25519 验签 → minApkVersion 拒装 → checksum → 解压版本目录 → 写 pending
 *    （"下次启动生效"；门槛自愈路径由 applyNow 立即应用）。失败 reject 带机器可读原因
 *    （bad-signature / apk-too-old / checksum / size-mismatch / unzip-missing-index / error:*）。
 *  - notifyReady：健康上报（版本握手）——上报版本必须与当前 bundle 指针一致才计健康；
 *    由启动编排（#251）在路由首帧渲染完成后调用。
 *  - 方法面与 Java 侧 @PluginMethod 一致性由 tests/unit/native/bridge-contract.test.ts 锁定。
 */
export interface OtaStatus {
  /** 当前加载的 bundle："public" = APK 内置 / 版本目录名 */
  current: string;
  /** 最近一次通过健康握手的版本（回滚目标） */
  lastGood: string;
  /** 已安装待生效版本（下次启动 adopt）；null = 无 */
  pending: string | null;
  /** 内置公钥指纹（SHA-256 hex，供 About/Debug 页与发布记录肉眼比对） */
  publicKeyFingerprint: string;
}

interface OtaPlugin {
  status(): Promise<OtaStatus>;
  install(opts: { urlBase: string }): Promise<{ ok: true; version: string }>;
  notifyReady(opts: { version: string }): Promise<void>;
  applyNow(): Promise<void>;
}

export const Ota = registerPlugin<OtaPlugin>("Ota");
