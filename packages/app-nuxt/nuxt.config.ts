// PROTOTYPE — OTA 机制原型专用最小沙盒（#245；一次性实验代码）
// 历史实验（SW-SSR / 跑分 / Java-SSR / 秒开）结论见 docs/research/ota-*.md 与 GitHub #240-#245。
// 本沙盒只服务 OTA 原型：ssr:false 静态 SPA + OtaPlugin。
export default defineNuxtConfig({
  compatibilityDate: "2026-08-29",
  devtools: { enabled: false },
  ssr: false,
  runtimeConfig: {
    // OTA 原型：沙盒内置 bundle 版本号（构建期烤入），用于门槛比较与展示
    public: {
      otaVersion: process.env.PROTO_OTA_VERSION || "v1",
    },
  },
});
