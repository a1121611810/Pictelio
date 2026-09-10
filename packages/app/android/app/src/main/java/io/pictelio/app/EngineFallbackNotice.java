package io.pictelio.app;

/**
 * 引擎降级一次性通知的共享常量（ADR-0153）。
 *
 * <p>写入方：{@link LynxActivity}（full 包降级入口，渲染前写）；
 * 读取方：app-lynx（首帧读取并消费即清）。
 *
 * <p>跨语言契约锚点——本类的 {@link #KEY} 与
 * {@code packages/app-lynx/src/utils/engineFallbackNotice.ts} 的
 * {@code ENGINE_FALLBACK_NOTICE_KEY} 由契约测试比对，任一方漂移即红灯。
 */
public final class EngineFallbackNotice {

    private EngineFallbackNotice() {}

    /** SharedPreferences("CapacitorStorage") 中标记「本次运行由引擎降级进入」的键。 */
    public static final String KEY = "pictelio_engine_fallback_notice";

    /** 标记为真的值（app-lynx 消费后删除该键）。 */
    public static final String VALUE_TRUE = "true";
}
