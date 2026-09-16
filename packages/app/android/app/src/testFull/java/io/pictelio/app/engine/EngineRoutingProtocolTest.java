package io.pictelio.app.engine;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * 漏斗线上协议字符串钉子（纯 JUnit，无 Robolectric；先例 io.pictelio.app.LynxRuntimeInitializerTest）。
 *
 * <p>oracle: docs/specs/engine-default-lynx-bidirectional-fallback.md §3（Intent extras
 * 字面量）与 §3.1（降级原因码 {@code runtime_failure}）。extra 名与 stay 原因码是
 * LynxActivity（{@code hopToWebview} 写入）→ MainActivity（T2 读取）的跨 Activity
 * 线上契约，任一字面量漂移 = 契约破坏，必须在此可见而非被 resolveStayReason 静默
 * 归一为 forced_webview。
 */
public class EngineRoutingProtocolTest {

    @Test
    public void forcedWebviewExtras_literalNamesMatchSpec() {
        assertEquals("pictelio_engine_forced_webview", EngineRouting.EXTRA_FORCED_WEBVIEW);
        assertEquals("pictelio_engine_stay_reason", EngineRouting.EXTRA_STAY_REASON);
    }

    @Test
    public void stayReasonRuntimeFailure_matchesSpecCode() {
        // spec §3.1：稳定 ASCII 原因码。extra 常量与 Reason 枚举序列化形态必须同源
        //（stay 落地反序列化经 Reason.ofCode 透传，字面量不一致会被归一为 forced_webview）。
        assertEquals("runtime_failure", EngineRouting.STAY_REASON_RUNTIME_FAILURE);
        assertEquals(EngineRouting.STAY_REASON_RUNTIME_FAILURE,
                EngineRoute.Reason.RUNTIME_FAILURE.code);
    }
}
