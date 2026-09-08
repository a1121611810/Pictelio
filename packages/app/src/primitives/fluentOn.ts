/**
 * fluent-* Web Components 自定义事件 ref 工厂（ADR-0144 D3-5）。
 *
 * SolidJS 2.0 移除了 `on:` 事件命名空间。fluent 组件的 `change`/`close` 等自定义事件
 * （以及 `fluent-slide-down`、`heart-burst` 等应用层自定义动画事件）不属于 Solid 的
 * 委托事件集合，统一经本工厂以 ref 回调挂 addEventListener；与既有 ref 以数组形式
 * 组合：`<fluent-dialog ref={[ref, fluentOn("close", onClose)]}>`。
 *
 * 本工厂是 ref 指令工厂的 apply 半段：闭包捕获 handler，unowned 回调只做元素捕获，
 * 监听器随元素被移除由 GC/元素生命周期兜底（fluent 元素与应用同生命周期，无独立卸载语义）。
 */
export function fluentOn(
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
): (el: Element) => void {
  return (el) => {
    el.addEventListener(type, handler, options);
  };
}
