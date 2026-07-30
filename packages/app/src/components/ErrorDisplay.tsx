import { type Component, type JSX } from "solid-js";
import { ApiErrorType, type ApiError } from "../api/types";
import { isLoggedIn } from "../stores/authStore";

interface ErrorDisplayProps {
  error: ApiError;
  onRetry?: () => void;
}

function isNavigationAction(type: ApiErrorType): boolean {
  return type === ApiErrorType.UNAUTHORIZED || type === ApiErrorType.FORBIDDEN;
}

function actionableLabel(type: ApiErrorType): string {
  switch (type) {
    case ApiErrorType.PROXY:
      return "检查代理设置";
    case ApiErrorType.UNAUTHORIZED:
      return "重新登录";
    case ApiErrorType.FORBIDDEN:
      return "返回首页";
    default:
      return "重试";
  }
}

function actionableHint(type: ApiErrorType): string | null {
  switch (type) {
    case ApiErrorType.PROXY:
      return "请确保本地代理 127.0.0.1:10808 已运行";
    case ApiErrorType.NETWORK:
      return "请检查网络连接是否正常";
    case ApiErrorType.UNAUTHORIZED:
      return "登录已过期，需要重新登录";
    case ApiErrorType.RATE_LIMIT:
      return "请求过于频繁，请稍后重试";
    case ApiErrorType.SERVER:
      return "Pixiv 服务器暂时不可用，请稍后重试";
    default:
      return null;
  }
}

const S: Record<string, string | JSX.CSSProperties> = {
  wrapper: {
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    "justify-content": "center",
    padding: "var(--spacingVerticalXXL) var(--spacingHorizontalXXL)",
    gap: "var(--spacingHorizontalL)",
    "text-align": "center",
    color: "var(--colorNeutralForeground1)",
  },
  iconBox: {
    width: "48px",
    height: "48px",
    "border-radius": "var(--borderRadiusCircular)",
    "background-color": "var(--colorStatusDangerBackground2)",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
  },
  iconSvg: {
    width: "24px",
    height: "24px",
    fill: "var(--colorStatusDangerForeground1)",
  },
  message: {
    "font-size": "var(--fontSizeBase300)",
    "line-height": "1.4286",
    color: "var(--colorNeutralForeground1)",
    "max-width": "320px",
    margin: "0",
  },
  hint: {
    "font-size": "var(--fontSizeBase200)",
    "line-height": "1.333",
    color: "var(--colorNeutralForeground2)",
    "max-width": "320px",
    margin: "0",
  },
  button: {
    padding: "var(--spacingVerticalS) var(--spacingHorizontalL)",
    "border-radius": "var(--borderRadiusMedium)",
    "font-size": "var(--fontSizeBase300)",
    "font-weight": "600",
    "background-color": "var(--colorBrandBackground)",
    color: "var(--colorNeutralForegroundOnBrand)",
    border: "none",
    cursor: "pointer",
    outline: "none",
  },
};

const ErrorDisplay: Component<ErrorDisplayProps> = (props) => {
  const navigate = useNavigate();
  const type = () => props.error.type;
  const hint = () => actionableHint(type());
  const isNav = () => isNavigationAction(type());

  const handleAction = () => {
    if (type() === ApiErrorType.UNAUTHORIZED) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (type() === ApiErrorType.FORBIDDEN) {
      void navigate({ to: "/home", replace: true });
      return;
    }
    props.onRetry?.();
  };

  // PROXY: show hint only when still logged in (OAuth proxy errors can happen during auth)
  const showHint = () => {
    if (type() === ApiErrorType.UNAUTHORIZED) {
      return hint();
    }
    if (type() === ApiErrorType.PROXY && !isLoggedIn()) {
      return null;
    }
    return hint();
  };

  return (
    <div style={S.wrapper}>
      <div style={S.iconBox}>
        <svg style={S.iconSvg} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
      </div>
      <p style={S.message}>{props.error.message}</p>
      {showHint() && <p style={S.hint}>{showHint()}</p>}
      {(props.onRetry || isNav()) && (
        <button
          style={S.button}
          onClick={handleAction}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "var(--colorBrandBackgroundHover)";
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "var(--colorBrandBackground)";
          }}
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "scale(0.98)";
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "";
          }}
        >
          {actionableLabel(type())}
        </button>
      )}
    </div>
  );
};

export default ErrorDisplay;
