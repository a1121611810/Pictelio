/**
 * Fluent Web Components 的 SolidJS JSX 类型声明
 *
 * @fluentui/web-components 提供了 Web Components 的实现和类型定义，
 * 但未声明 SolidJS 的 JSX.IntrinsicElements。本文件补充这些声明，
 * 使 <fluent-button> 等自定义元素在 SolidJS JSX 中通过类型检查。
 *
 * SolidJS 2.0：JSX 类型归属 @solidjs/web（模块化 namespace），模块扩充目标随之变更。
 */

import "@solidjs/web";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "fluent-badge": Record<string, unknown>;
      "fluent-button": Record<string, unknown> & {
        appearance?: "primary" | "secondary" | "subtle" | "transparent";
        slot?: string;
        disabled?: boolean;
      };
      "fluent-checkbox": Record<string, unknown>;
      "fluent-dialog": Record<string, unknown>;
      "fluent-dialog-body": Record<string, unknown>;
      "fluent-divider": Record<string, unknown>;
      "fluent-drawer": Record<string, unknown> & {
        show?: () => void;
        hide?: () => void;
      };
      "fluent-drawer-body": Record<string, unknown>;
      "fluent-message-bar": Record<string, unknown>;
      "fluent-radio": Record<string, unknown>;
      "fluent-radio-group": Record<string, unknown>;
      "fluent-spinner": Record<string, unknown>;
      "fluent-switch": Record<string, unknown>;
      "fluent-textarea": Record<string, unknown>;
    }
  }
}
