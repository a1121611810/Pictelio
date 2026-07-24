import { type Component, Show, createEffect } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { toApiError } from "../api/client";
import type { ApiError } from "../api/types";

/**
 * OAuthWebView 组件的属性。
 */
export interface OAuthWebViewProps {
  /** 是否显示 OAuth 登录弹窗。 */
  open: boolean;
  /** Pixiv OAuth 登录 URL（Android Native 使用）。传入空字符串时使用 codeChallenge */
  loginUrl: string;
  /** PKCE code_challenge。Native 层自动构建完整 OAuth URL。 */
  codeChallenge?: string;
  /** 成功获取 authorization_code 后的回调。 */
  onSuccess: (code: string) => void;
  /** 用户取消登录时的回调。 */
  onCancel: () => void;
  /** 发生错误时的回调。 */
  onError: (error: ApiError) => void;
}

const isNative = Capacitor.isNativePlatform();

/**
 * OAuth 登录弹窗组件（仅 Android Native）。
 *
 * 调用 OAuthPlugin.startOAuth() 打开内嵌 WebView，拦截回调 URL 提取 code。
 * 在 Web 开发模式下不渲染任何内容。
 */
const OAuthWebView: Component<OAuthWebViewProps> = (props) => {
  // ── Android Native: 通过 Capacitor 插件打开 WebView ──
  const startNativeOAuth = async () => {
    try {
      const { OAuthPlugin } = await import("@/native/OAuthPlugin");
      const result = props.loginUrl
        ? await OAuthPlugin.startOAuth({ loginUrl: props.loginUrl })
        : await OAuthPlugin.startOAuth({ codeChallenge: props.codeChallenge });
      props.onSuccess(result.code);
    } catch (e: any) {
      if (e?.message === "cancelled") {
        props.onCancel();
      } else {
        props.onError(toApiError(e, "OAuth 登录失败"));
      }
    }
  };

  // ── 生命周期 ──
  createEffect(() => {
    if (!props.open || !isNative) return;
    void startNativeOAuth();
  });

  // Web 模式下不渲染
  if (!isNative) return null;

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-9999 flex flex-col"
        style={{
          "background-color": "var(--colorNeutralBackgroundOverlay)",
          animation: "fluent-enter var(--durationNormal) var(--curveDecelerateMid) both",
        }}
      >
        {/* 顶部栏 */}
        <div
          class="flex items-center justify-between px-4 py-3"
          style={{
            "background-color": "var(--colorNeutralBackground1)",
            "border-bottom": "var(--strokeWidthThin) solid var(--colorNeutralStroke2)",
          }}
        >
          <span
            style={{
              "font-size": "var(--fontSizeBase300)",
              "font-weight": 600,
              color: "var(--colorNeutralForeground1)",
            }}
          >
            Pixiv 登录
          </span>
          <fluent-button appearance="subtle" onClick={props.onCancel}>
            取消
          </fluent-button>
        </div>

        {/* 内容区域 */}
        <div class="flex-1 flex" />
      </div>
    </Show>
  );
};

export default OAuthWebView;
