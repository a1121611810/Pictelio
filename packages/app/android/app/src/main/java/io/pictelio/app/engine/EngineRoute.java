package io.pictelio.app.engine;

/**
 * 引擎路由决策结果值对象（ADR-0164 决策 3）。
 *
 * <p>{@link #effective} 为 null 表示无引擎可用（双失败，落升级页）；
 * {@link #fallbackEntry} = 「生效 Lynx ∧ WebView 不可用」（spec §4 派生规则），
 * 驱动 {@code EXTRA_ENGINE_FALLBACK} 与错误页「仅退出、无返回按钮」。
 */
public final class EngineRoute {

    /** 启动动作。 */
    public enum Action {
        BOOT_LYNX,
        BOOT_WEBVIEW,
        /** 双失败 / stay 且 WebView 不合格：显示升级提示页（?reason= 携带原因码）。 */
        UPGRADE_PAGE
    }

    /**
     * 降级原因码（spec §3.1：稳定 ASCII；持久层与 extra 只存 code，
     * UI 用 {@code Record<code, I18nKey>} 映射——code 集合与 TS 侧经一致性测试钉住）。
     */
    public enum Reason {
        PREFERRED("preferred"),
        LYNX_UNAVAILABLE("lynx_unavailable"),
        LYNX_KNOWN_BAD("lynx_known_bad"),
        LYNX_RETRY("lynx_retry"),
        WEBVIEW_UNAVAILABLE("webview_unavailable"),
        A11Y_WEBVIEW("a11y_webview"),
        A11Y_LYNX_LAST_RESORT("a11y_lynx_last_resort"),
        NO_ENGINE("no_engine"),
        FORCED_WEBVIEW("forced_webview"),
        RUNTIME_FAILURE("runtime_failure");

        /** 稳定 ASCII 码（跨进程/跨语言序列化形态，禁止改动字面量）。 */
        public final String code;

        Reason(String code) {
            this.code = code;
        }

        /**
         * 反序列化：code → 枚举。
         *
         * @return 匹配的枚举；null / 未知值返回 null（调用方决定缺省，禁止猜测）
         */
        public static Reason ofCode(String code) {
            if (code == null) return null;
            for (Reason r : values()) {
                if (r.code.equals(code)) return r;
            }
            return null;
        }
    }

    /** 首选引擎（恒非空）。 */
    public final Engine preferred;

    /** 本次生效引擎；null = 无引擎可用（双失败）。 */
    public final Engine effective;

    /** 启动动作。 */
    public final Action action;

    /** 本次决策原因码（快照与 extra 只存 {@link Reason#code}）。 */
    public final Reason reason;

    /** 生效 Lynx ∧ WebView 不可用（含 S1 且 W=false 的角落，吸收 ADR-0153 E7 弹跳）。 */
    public final boolean fallbackEntry;

    public EngineRoute(Engine preferred, Engine effective, Action action, Reason reason,
                       boolean fallbackEntry) {
        this.preferred = preferred;
        this.effective = effective;
        this.action = action;
        this.reason = reason;
        this.fallbackEntry = fallbackEntry;
    }

    /**
     * 生效状态快照行（{@code pictelio_engine_state} 键值格式，spec §3）：
     * {@code preferred=<kind|none> effective=<kind|none> reason=<code>}。
     * 由 TS 侧 {@code readEngineState()} 按此格式解析，字段顺序与分隔符即契约。
     */
    public String snapshotLine() {
        return "preferred=" + (preferred == null ? "none" : preferred.kind())
                + " effective=" + (effective == null ? "none" : effective.kind())
                + " reason=" + (reason == null ? "none" : reason.code);
    }
}
