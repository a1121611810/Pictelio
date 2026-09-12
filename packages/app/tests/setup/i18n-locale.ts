// i18n 测试确定性（抽取原型 #496）：语言默认跟随系统，会让 locale 随环境
// navigator.language 漂移（happy-dom 默认 en-US → t() 组件渲染英文文案），
// 断言中文文案的单测必须钉住源语言。跟随系统路径本身由 i18n/index.test.ts 覆盖。
Object.defineProperty(navigator, "language", {
  value: "zh-CN",
  configurable: true,
});
