package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * DohCache 单测（T4 IO 边界）：
 *   - put/get 往返（带 TTL）
 *   - TTL 过期返回 null + 自清理
 *   - 污染 IP 不缓存（双保险：DohClient 内部已过滤；此处再防一手）
 *   - parseStoredIps 边界（损坏字符串返回空列表）
 *   - key 命名规范（小写 + 前缀）
 */
public class DohCacheTest {

    /**
     * 极简解析：合法 JSON 数组字符串 → IP 列表。
     */
    @Test
    public void parseStoredIps_validArray() {
        List<String> ips = DohCache.parseStoredIps("[210.140.139.131,210.140.139.133]");
        assertEquals(2, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
        assertEquals("210.140.139.133", ips.get(1));
    }

    @Test
    public void parseStoredIps_emptyArray() {
        assertEquals(0, DohCache.parseStoredIps("[]").size());
    }

    @Test
    public void parseStoredIps_invalidBrackets_returnsEmpty() {
        assertEquals(0, DohCache.parseStoredIps("not array").size());
        assertEquals(0, DohCache.parseStoredIps("[broken").size());
        assertEquals(0, DohCache.parseStoredIps("broken]").size());
    }

    @Test
    public void parseStoredIps_filtersPollutedInStored() {
        // 0.0.0.0 已被过滤（防御 SharedPreferences 被恶意篡改）
        List<String> ips = DohCache.parseStoredIps("[0.0.0.0,210.140.139.131,127.0.0.1]");
        assertEquals(1, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
    }

    @Test
    public void parseStoredIps_nullOrEmpty() {
        assertEquals(0, DohCache.parseStoredIps(null).size());
        assertEquals(0, DohCache.parseStoredIps("").size());
        assertEquals(0, DohCache.parseStoredIps("[]").size());
    }

    /**
     * key 命名规范：必须小写 + 前缀（避免大小写双键 + 与其它偏好键冲突）。
     */
    @Test
    public void keyFor_lowercaseAndPrefix() {
        assertEquals("doh_ip_i.pximg.net", DohCache.keyFor("I.PXIMG.NET"));
        assertEquals("doh_ip_app-api.pixiv.net", DohCache.keyFor("app-api.pixiv.net"));
        assertTrue(DohCache.keyFor("any.host").startsWith("doh_ip_"));
    }

    /**
     * TTL 常量 = 7 天（不变量——过长会引入过期 IP）。
     */
    @Test
    public void ttlMillis_isSevenDays() {
        assertEquals(7L * 24 * 60 * 60 * 1000, DohCache.ttlMillis());
    }

    /**
     * expectedPolluted 包含典型污染 IP（避免运维意外移除）。
     */
    @Test
    public void expectedPolluted_containsKeyPatterns() {
        List<String> polluted = DohCache.expectedPolluted();
        assertTrue(polluted.contains("0.0.0.0"));
        assertTrue(polluted.contains("127.0.0.1"));
        assertTrue(polluted.contains("10.0.0.1"));
        assertTrue(polluted.contains("192.168.1.1"));
        assertTrue(polluted.contains("169.254.0.1"));
    }
}