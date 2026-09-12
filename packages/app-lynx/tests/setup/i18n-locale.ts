// i18n 测试确定性（抽取原型 #496）：语言默认跟随系统，Node ≥22 也暴露
// navigator.language（本机 = "en-US"），会把 locale 探测带偏成英文。测试钉源语言。
Object.defineProperty(navigator, "language", {
  value: "zh-CN",
  configurable: true,
});
