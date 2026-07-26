import { render } from "solid-js/web";
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

function syncFluentTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  setTheme(isDark ? webDarkTheme : webLightTheme);
}

async function bootstrap() {
  // 确保 <html> .dark 在渲染前已应用（在 index.html 中通过内联脚本处理）
  await initializeStartupPreferences();

  syncFluentTheme();
  const observer = new MutationObserver(syncFluentTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // 在渲染前初始化认证并设置 refreshPromise，让路由 loaders 在
  // executeRequest 中 await refreshPromise 等待 token 就绪后再发送请求
  await initializeAuth();

  const root = document.getElementById("root");
  if (root) {
    render(() => <App />, root);
  }
}

const [_err] = await tryAsync(bootstrap());
if (_err) {
  console.error("[main] Bootstrap failed", _err);
}
