package io.pictelio.app.engine;

/**
 * 客户端引擎标识（ADR-0164 决策 3）。
 *
 * <p>序列化形态 = {@link #kind()}（"lynx" / "webview"），与
 * {@code pictelio_client_kind} 键值、TS 侧 {@code ClientKind} 逐字一致（spec §3）。
 */
public enum Engine {
    LYNX,
    WEBVIEW;

    /** 持久层序列化值（稳定 ASCII）。 */
    public String kind() {
        return this == LYNX ? "lynx" : "webview";
    }

    /**
     * 反序列化：kind 值 → 枚举。
     *
     * @return 匹配的枚举；null / 未知值一律返回 null（由调用方决定归一化，禁止猜测）
     */
    public static Engine ofKind(String raw) {
        if (raw == null) return null;
        if ("lynx".equals(raw)) return LYNX;
        if ("webview".equals(raw)) return WEBVIEW;
        return null;
    }
}
