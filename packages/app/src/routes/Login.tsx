import type { Component } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { loginWithToken, isLoggedIn } from "../stores/authStore";
import { type ApiError } from "../api/types";
import { toApiError } from "../api/client";
import ErrorDisplay from "../components/ErrorDisplay";
import OAuthWebView from "../components/OAuthWebView";
import { generatePKCE } from "../api/pkceAuth";
import { loginWithPKCE } from "../stores/authStore";
import { markContentReady } from "@/native/splashBridge";

const isNative = Capacitor.isNativePlatform();

const Login: Component = () => {
  const navigate = useNavigate();
  const [tokenInput, setTokenInput] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  const [showOAuth, setShowOAuth] = createSignal(false);
  const [codeVerifier, setCodeVerifier] = createSignal("");
  const [codeChallenge, setCodeChallenge] = createSignal("");

  onMount(() => {
    if (isLoggedIn()) {
      navigate("/home", { replace: true });
    }
    // 进入登录页时清除路由层的滚动缓存（避免 @solidjs/router 的
    // scrollRestoration 从 sessionStorage 恢复旧位置覆盖自定义恢复）
    try {
      sessionStorage.removeItem("solid-router:scroll");
    } catch {}
    // 登录页已渲染，通知原生关闭 Splash Screen
    markContentReady();
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const [loginErr] = await tryAsync(
      (async () => {
        await loginWithToken(tokenInput().trim());
        navigate("/home", { replace: true });
      })(),
    );
    setSubmitting(false);
    if (loginErr) {
      setError(toApiError(loginErr, "登录失败"));
    }
  };

  const handleOAuthStart = async () => {
    const [pkceErr] = await tryAsync(
      (async () => {
        const pkce = await generatePKCE();
        setCodeVerifier(pkce.codeVerifier);
        setCodeChallenge(pkce.codeChallenge);
        setShowOAuth(true);
      })(),
    );
    if (pkceErr) {
      setError(toApiError(pkceErr, "无法创建登录链接"));
    }
  };

  const handleOAuthSuccess = async (code: string) => {
    setSubmitting(true);
    setError(null);
    const [pkceLoginErr] = await tryAsync(
      (async () => {
        await loginWithPKCE(code, codeVerifier());
        navigate("/home", { replace: true });
      })(),
    );
    setSubmitting(false);
    setShowOAuth(false);
    if (pkceLoginErr) {
      setError(toApiError(pkceLoginErr, "PKCE 登录失败"));
    }
  };

  const handleOAuthCancel = () => setShowOAuth(false);
  const handleOAuthError = (err: ApiError) => {
    setError(err);
    setShowOAuth(false);
  };

  return (
    <div
      class="min-h-screen flex flex-col"
      style={{ "background-color": "var(--colorNeutralBackground3)" }}
    >
      {/* 全屏品牌光晕背景 */}
      <div
        class="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 75% 50% at 50% 30%, var(--colorBrandBackground2) 0%, transparent 70%)",
        }}
      />

      {/* 上部：品牌展示 */}
      <div class="flex-1 flex flex-col items-center justify-center px-8 relative z-10">
        <div
          class="flex flex-col items-center"
          style={{
            animation: "fluent-enter var(--durationGentle) var(--curveDecelerateMid) both",
          }}
        >
          <div
            class="w-24 h-24 rounded-[var(--borderRadius4XLarge)] flex items-center justify-center mb-6"
            style={{
              "background-color": "var(--colorNeutralBackground1)",
              "box-shadow": "var(--elevation8)",
            }}
          >
            <svg style="width:52px;height:52px;display:block" viewBox="0 0 64 64">
              <path
                d="M18 12 C18 12 16 28 19 52 C19 52 22 54 24 50 C26 47 24 39 26 33 C26 33 37 35 45 27 C51 21 47 13 38 11 C31 9 24 12 18 12 Z"
                fill="var(--colorBrandForeground1)"
              />
              <path
                d="M22 16 C22 16 21 28 23 46"
                fill="none"
                stroke="var(--colorBrandStroke1)"
                stroke-width="4"
                stroke-linecap="round"
              />
              <circle cx="42" cy="19" r="3" fill="var(--colorBrandBackgroundHover)" />
              <circle cx="46" cy="25" r="2" fill="var(--colorBrandBackgroundHover)" />
            </svg>
          </div>

          <h1
            style={{
              "font-size": "var(--fontSizeHero900)",
              "font-weight": 700,
              color: "var(--colorNeutralForeground1)",
              "line-height": 1.2,
              "letter-spacing": "-0.02em",
              margin: 0,
            }}
          >
            Pictelio
          </h1>
          <p
            style={{
              "font-size": "var(--fontSizeBase200)",
              color: "var(--colorNeutralForeground3)",
              margin: "6px 0 0",
            }}
          >
            第三方插画浏览器
          </p>
        </div>
      </div>

      {/* 下部：操作区 */}
      <div class="px-6 pb-10 relative z-10">
        <div
          class="flex flex-col gap-3"
          style={{
            animation: "fluent-enter var(--durationGentle) var(--curveDecelerateMid) both",
            "animation-delay": "var(--durationFast)",
          }}
        >
          <Show when={isNative}>
            <fluent-button
              appearance="primary"
              style="width:100%;--block-size:50px;font-size:var(--fontSizeBase300);font-weight:600"
              disabled={submitting()}
              onClick={handleOAuthStart}
            >
              通过 Pixiv 登录
            </fluent-button>

            <Show when={!showAdvanced}>
              <fluent-button
                appearance="subtle"
                style="width:100%;--block-size:50px;font-size:var(--fontSizeBase300)"
                onClick={() => setShowAdvanced(true)}
              >
                使用 refresh_token
              </fluent-button>
            </Show>
          </Show>

          <Show when={showAdvanced || !isNative}>
            <form onSubmit={handleSubmit} class="flex flex-col gap-3">
              <fluent-textarea
                style="--inline-size:100%;--min-block-size:80px"
                placeholder="粘贴 refresh_token..."
                value={tokenInput()}
                on:input={(e: Event) => setTokenInput((e.target as any).value)}
                required
                disabled={submitting()}
              />
              <Show when={error()}>
                <ErrorDisplay error={error()!} onRetry={() => setError(null)} />
              </Show>
              <fluent-button
                appearance="primary"
                style="width:100%;--block-size:50px;font-size:var(--fontSizeBase300);font-weight:600"
                disabled={submitting() || !tokenInput().trim()}
                onClick={handleSubmit}
              >
                {submitting() ? "登录中..." : "登录"}
              </fluent-button>
            </form>
          </Show>

          <Show when={!isNative && !showAdvanced}>
            <fluent-button
              appearance="primary"
              style="width:100%;--block-size:50px;font-size:var(--fontSizeBase300);font-weight:600"
              onClick={() => setShowAdvanced(true)}
            >
              使用 refresh_token 登录
            </fluent-button>
          </Show>
        </div>
      </div>

      <div class="h-[env(safe-area-inset-bottom,0px)]" />

      <OAuthWebView
        open={showOAuth()}
        loginUrl=""
        codeChallenge={codeChallenge()}
        onSuccess={handleOAuthSuccess}
        onCancel={handleOAuthCancel}
        onError={handleOAuthError}
      />
    </div>
  );
};

export default Login;
