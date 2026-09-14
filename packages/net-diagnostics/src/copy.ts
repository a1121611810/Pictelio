// @pictelio/net-diagnostics — 中文文案单一事实源（两端共享，避免各写一份漂移）
export const HEADLINES: Record<string, string> = {
  ok: "网络连接正常",
  skipped: "自检未执行或能力有损",
  captive: "当前 Wi-Fi 需要先登录（强制门户）",
  device: "本机当前没有可用网络",
  network: "网络链路异常，问题在你的网络侧",
  proxy: "本地代理可能未运行",
  auth: "登录状态已失效，需要重新登录",
  service: "网络可达，但 Pixiv 服务端暂时不可用",
  none: "网络连接正常",
  unknown: "自检未能定位问题",
};
