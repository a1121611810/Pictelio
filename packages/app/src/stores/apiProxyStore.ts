/**
 * API 反代地址设置 store（ADR-0146 D3）——设置卡「API 反代」状态源。
 *
 * <b>跨端契约</b>：键 {@code api_proxy_base}（CapacitorStorage 原始字符串，
 * stringCodec 落盘无引号；Java {@code ApiEndpoints.PREF_KEY} 同名读取，契约硬约束）。
 *
 * <b>语义</b>（ADR-0146 D2/D3）：空 = 关闭（官方域名 + 直连兜底）；非空 = https 基址
 * （无尾斜杠），Java 侧映射 {@code <base>/api → app-api.pixiv.net}、
 * {@code <base>/oauth/auth/token → oauth.secure.pixiv.net}（用户自建 Worker 前缀路由）。
 */
import { settings } from "@/settings";

/** CapacitorStorage 键（Java ApiEndpoints.PREF_KEY 同名，契约硬约束） */
export const API_PROXY_PREF_KEY = "api_proxy_base";

const apiProxySetting = settings.define<string>({
  key: API_PROXY_PREF_KEY,
  default: "",
});

/** 当前反代基址（空串 = 关闭） */
export const apiProxyUrl = apiProxySetting.value;

/**
 * 保存入口：校验 + 归一化（去尾斜杠）。
 * @return null = 已保存；string = 错误文案（拒绝写盘，禁静默由调用方呈现）
 */
export function setApiProxyBase(raw: string): string | null {
  const v = raw.trim();
  if (v === "") {
    apiProxySetting.set(""); // 关闭
    return null;
  }
  if (!v.startsWith("https://")) {
    return "反代地址必须以 https:// 开头";
  }
  if (v === "https://") {
    return "反代地址缺少主机名";
  }
  apiProxySetting.set(v.replace(/\/+$/, ""));
  return null;
}
