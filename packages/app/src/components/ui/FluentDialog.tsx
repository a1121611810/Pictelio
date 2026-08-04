import { type Component, createEffect, type JSX, onCleanup } from "solid-js";

interface FluentDialogProps {
  /** 是否打开（true → show()，false → hide()） */
  open: boolean;
  /** 原生 close 事件（Esc / 点击遮罩关闭时触发） */
  onClose?: () => void;
  "aria-label": string;
  children: JSX.Element;
}

/**
 * <fluent-dialog> 的正确封装。
 *
 * @fluentui/web-components 的 Dialog 没有 open 属性绑定，
 * 只有 show()/hide() 方法；直接用 open={...} 会把值写到宿主
 * 元素的 DOM property 上，组件内部从不读取，对话框永远不开。
 *
 * 这里通过 ref + createEffect 把 open prop 转成对组件
 * show()/hide() 的调用，并让调用方保持声明式写法。
 */
const FluentDialog: Component<FluentDialogProps> = (props) => {
  let ref: HTMLElement | undefined;

  /** 读取组件内部 <dialog> 的真实打开状态（宿主上没有 open property） */
  function isOpen(): boolean {
    const inner = ref?.shadowRoot?.querySelector("dialog");
    return inner?.open === true;
  }

  function callHost(method: "show" | "hide") {
    const host = ref as unknown as { show?: () => void; hide?: () => void } | undefined;
    host?.[method]?.();
  }

  createEffect(() => {
    const open = props.open;
    if (!ref) return;
    if (open) {
      if (!isOpen()) callHost("show");
    } else if (isOpen()) {
      callHost("hide");
    }
  });

  onCleanup(() => {
    // 组件卸载时若仍开着，确保关闭，避免遗留模态
    if (isOpen()) callHost("hide");
  });

  return (
    <fluent-dialog
      ref={ref}
      aria-label={props["aria-label"]}
      on:close={() => props.onClose?.()}
    >
      {props.children}
    </fluent-dialog>
  );
};

export default FluentDialog;
