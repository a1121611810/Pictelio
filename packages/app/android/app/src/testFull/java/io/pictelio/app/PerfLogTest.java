package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * {@link PerfLog#interceptLine} 精确格式单测（X1 telemetry）。
 *
 * <p>oracle 溯源（AGENTS.md 测试硬约束 6）：四行期望字面量逐字取自
 * docs/specs/webview-perf-round2.md §3 第 2 条的格式定义——
 * <pre>
 *   intercept url8=&lt;8字符&gt; phase=hit src=mem|disk durationMs=&lt;n&gt; bytes=&lt;n&gt;
 *   intercept url8=&lt;8字符&gt; phase=miss durationMs=&lt;n&gt; bytes=&lt;n&gt;
 *   intercept url8=&lt;8字符&gt; phase=err durationMs=&lt;n&gt; bytes=-1
 * </pre>
 * 非被测实现反推。url8 样例 {@code aHR0cHM6} 为真实数据 fixture：
 * {@code PixivImageLoader.keyToFilename("https://i.pximg.net/img.jpg")} 的前 8 字符
 * （Base64 URL-safe no-padding，已用 node Buffer 独立复算）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PerfLogTest {

    /** 真实 URL 的缓存 key 前 8 字符（Base64("https://i.pximg.net/img.jpg") URL-safe no-pad） */
    private static final String URL8 = "aHR0cHM6";

    @Test
    public void hit_mem_matchesSpecLiteral() {
        assertEquals(
                "intercept url8=aHR0cHM6 phase=hit src=mem durationMs=3 bytes=12345",
                PerfLog.interceptLine(URL8, "hit", "mem", 3L, 12345L));
    }

    @Test
    public void hit_disk_matchesSpecLiteral() {
        assertEquals(
                "intercept url8=aHR0cHM6 phase=hit src=disk durationMs=12 bytes=65536",
                PerfLog.interceptLine(URL8, "hit", "disk", 12L, 65536L));
    }

    @Test
    public void miss_matchesSpecLiteral() {
        assertEquals(
                "intercept url8=aHR0cHM6 phase=miss durationMs=842 bytes=98304",
                PerfLog.interceptLine(URL8, "miss", null, 842L, 98304L));
    }

    @Test
    public void err_matchesSpecLiteral_andPinsBytesToNegativeOne() {
        // spec 固定 err 恒为 bytes=-1（调用方误传其他值也不得产生 off-spec 行）
        assertEquals(
                "intercept url8=aHR0cHM6 phase=err durationMs=7 bytes=-1",
                PerfLog.interceptLine(URL8, "err", null, 7L, -1L));
        assertEquals(
                "intercept url8=aHR0cHM6 phase=err durationMs=7 bytes=-1",
                PerfLog.interceptLine(URL8, "err", null, 7L, 999L));
    }

    @Test
    public void url8_realUrl_prefixesBase64Key() {
        // 真实样例：Base64 URL-safe no-pad("https://i.pximg.net/img.jpg") = "aHR0cHM6Ly9pLnB4aW1nLm5ldC9pbWcuanBn"
        assertEquals(URL8, PerfLog.url8("https://i.pximg.net/img.jpg"));
    }

    @Test
    public void url8_shortKey_returnsFullKeyWithoutThrow() {
        // 防御分支：极短 URL 的 Base64 不足 8 字符（"ab" → "YWI"），原样返回不越界
        assertEquals("YWI", PerfLog.url8("ab"));
    }
}
