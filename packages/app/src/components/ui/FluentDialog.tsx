import { type Component, createEffect, type JSX, onCleanup, onMount } from "solid-js";

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
 * 两个职责：
 *
 * 1. open → show()/hide() 转换
 *    @fluentui/web-components 的 Dialog 没有 open 属性绑定，
 *    只有 show()/hide() 方法；直接用 open={...} 会把值写到宿主
 *    DOM property 上，组件内部从不读取，对话框永远不开。
 *    这里通过 ref + createEffect 把 open prop 转成对组件
 *    show()/hide() 的调用，并让调用方保持声明式写法。
 *
 * 2. slot 契约收敛（ADR-0062）
 *    @fluentui/web-components@3 的 <fluent-dialog> shadow 只有一个
 *    无名 <slot>；命名 slot（title / action 单数）全在内部的
 *    <fluent-dialog-body> 上。调用方历史上沿用错误契约
 *    （缺 body 包裹、slot="actions" 复数、slot="content"），
 *    导致标题/正文/按钮不投影，弹窗退化为无遮罩全宽横条。
 *    本封装统一把 children 包进 <fluent-dialog-body>，并按真实
 *    template 重映射 slot：
 *      - slot="title"           → 保留（title slot）
 *      - slot="actions"（复数） → 改写为 action（单数）
 *      - slot="content"（错误） → 剥除（落入 body 默认 slot = .content）
 *      - 其余无 slot 子元素      → body 默认 slot（正文）
 *    契约收敛在封装内，调用方零改动。
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

  /**
   * 把调用方传入的子元素按 fluent-dialog-body 真实 template 重映射 slot。
   * 直接操作挂载后的 DOM 节点（SolidJS 的 JSX.Element 在浏览器/happy-dom
   * 下是真实节点），仅改写 slot attribute，不移动节点位置。
   */
  function remapSlots(body: HTMLElement) {
    for (const el of [...body.children] as HTMLElement[]) {
      const slot = el.getAttribute?.("slot");
      if (slot === "actions") {
        // 复数 actions 不存在 → 单数 action
        el.setAttribute("slot", "action");
      } else if (slot === "content") {
        // content 不存在 → 剥除，落入 body 默认 slot（.content）
        el.removeAttribute("slot");
      }
      // slot="title" 与无 slot 子元素无需处理
    }
  }

  let bodyRef: HTMLElement | undefined;

  // ref 回调在元素创建时触发，此时 children 尚未插入；
  // onMount 在整棵子树（含 children）挂载完成后触发，此时重映射才可靠。
  onMount(() => {
    if (bodyRef) remapSlots(bodyRef);
  });

  return (
    <fluent-dialog ref={ref} aria-label={props["aria-label"]} on:close={() => props.onClose?.()}>
      <fluent-dialog-body ref={bodyRef}>{props.children}</fluent-dialog-body>
    </fluent-dialog>
  );
};

export default FluentDialog;
