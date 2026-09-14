import App from "./App";
import "./styles/reset.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "virtual:uno.css";
import "./styles/novel-reader.css";
// ── Fluent Web Components 按需注册 + 主题同步 ──
import { setTheme } from "@fluentui/web-components";
import { webLightTheme, webDarkTheme } from "@fluentui/tokens";
import "@fluentui/web-components/badge.js";
import "@fluentui/web-components/button.js";
import "@fluentui/web-components/checkbox.js";
import "@fluentui/web-components/dialog.js";
import "@fluentui/web-components/dialog-body.js";
import "@fluentui/web-components/divider.js";
import "@fluentui/web-components/drawer.js";
import "@fluentui/web-components/message-bar.js";
import "@fluentui/web-components/radio.js";
import "@fluentui/web-components/radio-group.js";
import "@fluentui/web-components/spinner.js";
import "@fluentui/web-components/switch.js";
import "@fluentui/web-components/textarea.js";
import { initializeStartupPreferences } from "@/startup";
import { initializeAuth } from "@/stores/authStore";
import { restoreFeedCache } from "@/api/feedQueryPersist";
import { settings } from "@/settings";
// i18n 模块加载即注册语言设置键（settings_language），必须在 __root.tsx 渲染期
// settings.hydrateAll()（全量 hydrate 兜底）之前完成 define，否则存储值不会被加载。
// 本 import 兼具副作用注册与 refreshSystemLocaleFromBridge 引入两职（review P2-9：不再重复导入）
import { refreshSystemLocaleFromBridge } from "@/i18n";
// 下载队列执行器接线（webview 引擎，模块加载即注册）
import "@/native/downloadExecutor";
// 系统分享接线（webview 引擎，模块加载即注册）
import "@/native/downloadSharer";

function syncFluentTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  setTheme(isDark ? webDarkTheme : webLightTheme);
}

async function bootstrap() {
  // 确保 <html> .dark 在渲染前已应用（在 index.html 中通过内联脚本处理）
  await initializeStartupPreferences();

  // 首屏同步读 settings（theme），render 前应用防闪烁
  settings.syncInitAll();

  syncFluentTheme();
  const observer = new MutationObserver(syncFluentTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // 先渲染应用骨架屏，再在 Solid 组件树外并行初始化认证。
  // RootLayout.onSettled 中等待 auth 恢复结果后执行导航。
  const root = document.getElementById("root");
  if (root) {
    render(() => <App />, root);
  }

  // 认证初始化不阻塞渲染，让骨架屏立即可见
  void initializeAuth();
  // 跟随系统态经原生桥校正 locale（B10：WebView 异步重置 locale，navigator 不可信）
  void refreshSystemLocaleFromBridge();
  // Feed 缓存恢复与认证并行无竞态：query-core hydrate 以 dataUpdatedAt 守卫（仅持久化数据比内存新才落状态），
  // 即使 auth 链路先写入新 feed 数据也不会被旧缓存覆盖；缓存预热省一次 feed API RTT（spec T4）
  void restoreFeedCache();
}

const [_err] = await tryAsync(bootstrap());
if (_err) {
  console.error("[main] Bootstrap failed", _err);
}
