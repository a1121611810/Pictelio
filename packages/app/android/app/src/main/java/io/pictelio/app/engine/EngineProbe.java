package io.pictelio.app.engine;

/**
 * 引擎探针接口——引擎决策模块的唯一外缝（spec §5：禁止引用任何 flavor 类，探针全部注入）。
 *
 * <p><strong>契约：四个方法必须全函数（total）、永不抛异常。</strong>
 * fail-open / fail-closed 的口径属于适配器职责（如 WebView 版本不可解析 → 放行、
 * 无障碍查询失败 → false），本接口不重试、不兜底。
 *
 * <p>探针由 {@code EngineRouting.decide} 惰性求值：每探针每次决策至多调用 1 次，
 * 故实现方可保留昂贵探测（如 {@code lynxAvailable} 可能触发 Lynx 初始化，幂等）。
 */
public interface EngineProbe {

    /** 本包支持的 client 引擎列表（BuildConfig.CLIENT_KINDS，如 {"lynx","webview"}；顺序 = 缺省优先级）。 */
    String[] clientKinds();

    /** Lynx 引擎可用性（初始化不抛 ∧ native 已加载 ∧ CLIENT_KINDS 含 lynx；可能触发初始化，幂等）。 */
    boolean lynxAvailable();

    /** WebView 引擎可用性（framework 版本 >= 85；版本不可解析 fail-open = true）。 */
    boolean webviewOk();

    /** 系统无障碍服务是否启用（TalkBack 等；查询失败 → false）。 */
    boolean a11yActive();
}
