package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Map;

/**
 * {@link ImageIntercept#cacheHeaders(boolean)} 单测（S1，F1 响应头翻转的机器防线）。
 *
 * <p>纯 JVM 测试（不需 Robolectric）：cacheHeaders 是无 Android 依赖的静态纯函数。
 *
 * <p>oracle 溯源（AGENTS.md 测试硬约束 6）：
 * <ul>
 *   <li>enabled → {@code "public, max-age=31536000, immutable"} = F1 修复的原始字面量
 *       （原 bytesResponse/diskResponse 内联构造，spec X1/F1 列明）；</li>
 *   <li>disabled → 空 Map = ADR-0090 用户关浏览器缓存语义：此时 {@code OtaPlugin.ensureNoStore}
 *       会给空头注入 {@code Cache-Control: no-store}（OtaPlugin.java:438-451），
 *       与用户「响应不进浏览器缓存」的意图一致，因此必须为空而非 immutable。</li>
 * </ul>
 */
public class ImageInterceptTest {

    @Test
    public void enabled_containsImmutableCacheControl() {
        Map<String, String> headers = ImageIntercept.cacheHeaders(true);
        assertNotNull(headers);
        String cacheControl = headers.get("Cache-Control");
        assertNotNull(cacheControl);
        // F1 关键标记：immutable 让磁盘/内存命中进 Chromium 缓存，避免同 URL 每次渲染重进拦截器
        assertTrue(cacheControl.contains("immutable"));
        assertEquals("public, max-age=31536000, immutable", cacheControl);
    }

    @Test
    public void disabled_returnsEmptyMap() {
        // 空 Map → OtaPlugin.ensureNoStore 注入 no-store → 不进浏览器缓存（用户关闭开关的意图）
        Map<String, String> headers = ImageIntercept.cacheHeaders(false);
        assertNotNull(headers);
        assertTrue("disabled 必须返回空 Map", headers.isEmpty());
        assertFalse(headers.containsKey("Cache-Control"));
    }
}
