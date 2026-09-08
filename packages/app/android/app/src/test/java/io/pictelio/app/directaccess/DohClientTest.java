package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * DohClient 单测（T4 IO 边界覆盖）：
 *   - 极简 JSON 解析（含污染 IP 过滤）
 *   - IPv4 字面量识别 + 污染识别
 *   - 双端点 fallback（主端点失败 → 备端点）
 *   - 主端点成功 → 不打 fallback
 *   - 全失败 → 抛 IOException + warn 必打
 *   - IP 字面量短路（不发起请求）
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class DohClientTest {

    private MockWebServer primaryServer;
    private MockWebServer fallbackServer;

    @Before
    public void setUp() throws IOException {
        primaryServer = new MockWebServer();
        fallbackServer = new MockWebServer();
        primaryServer.start();
        fallbackServer.start();
    }

    @After
    public void tearDown() throws IOException {
        primaryServer.shutdown();
        fallbackServer.shutdown();
    }

    /**
     * 极简 JSON 解析：含 A 记录应返回 IP 列表；空 Answer 返回 null；非 JSON 返回 null。
     */
    @Test
    public void parseDnsJson_validResponse_returnsIps() {
        String body = "{\"Status\":0,\"Answer\":[{\"name\":\"i.pximg.net.\",\"type\":1,\"TTL\":300,\"data\":\"210.140.139.131\"},{\"name\":\"i.pximg.net.\",\"type\":1,\"TTL\":300,\"data\":\"210.140.139.133\"}]}";
        List<String> ips = DohClient.parseDnsJson(body);
        assertNotNull(ips);
        assertEquals(2, ips.size());
        assertTrue(ips.contains("210.140.139.131"));
        assertTrue(ips.contains("210.140.139.133"));
    }

    @Test
    public void parseDnsJson_emptyAnswer_returnsNull() {
        String body = "{\"Status\":0,\"Answer\":[]}";
        assertNull(DohClient.parseDnsJson(body));
    }

    @Test
    public void parseDnsJson_noAnswerField_returnsNull() {
        String body = "{\"Status\":3}";
        assertNull(DohClient.parseDnsJson(body));
    }

    @Test
    public void parseDnsJson_filtersPollutedIps() {
        // 0.0.0.0 / 127.0.0.1 是典型污染 IP，必须过滤
        String body = "{\"Answer\":[{\"data\":\"0.0.0.0\"},{\"data\":\"127.0.0.1\"},{\"data\":\"210.140.139.131\"}]}";
        List<String> ips = DohClient.parseDnsJson(body);
        assertNotNull(ips);
        assertEquals(1, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
    }

    @Test
    public void parseDnsJson_emptyOrNull_returnsNull() {
        assertNull(DohClient.parseDnsJson(null));
        assertNull(DohClient.parseDnsJson(""));
        assertNull(DohClient.parseDnsJson("not json"));
    }

    /**
     * IPv4 字面量识别：合法 / 非法 / 空。
     */
    @Test
    public void isIpv4Literal_validAndInvalid() {
        assertTrue(DohClient.isIpv4Literal("210.140.139.131"));
        assertTrue(DohClient.isIpv4Literal("0.0.0.0"));
        assertTrue(DohClient.isIpv4Literal("255.255.255.255"));
        assertFalse(DohClient.isIpv4Literal("256.0.0.1"));
        assertFalse(DohClient.isIpv4Literal("1.2.3"));
        assertFalse(DohClient.isIpv4Literal("1.2.3.4.5"));
        assertFalse(DohClient.isIpv4Literal(""));
        assertFalse(DohClient.isIpv4Literal(null));
        assertFalse(DohClient.isIpv4Literal("a.b.c.d"));
    }

    /**
     * 污染 IP 识别：覆盖 RFC1918 / 127.0.0.0/8 / 169.254.0.0/16。
     */
    @Test
    public void isPolluted_recognizesKnownPatterns() {
        assertTrue(DohClient.isPolluted("0.0.0.0"));
        assertTrue(DohClient.isPolluted("127.0.0.1"));
        assertTrue(DohClient.isPolluted("127.255.255.255"));
        assertTrue(DohClient.isPolluted("10.0.0.1"));
        assertTrue(DohClient.isPolluted("192.168.1.1"));
        assertTrue(DohClient.isPolluted("172.16.0.1"));
        assertTrue(DohClient.isPolluted("172.31.0.1"));
        assertTrue(DohClient.isPolluted("169.254.0.1"));
        // 合法公网 IP 不应识别为污染
        assertFalse(DohClient.isPolluted("210.140.139.131"));
        assertFalse(DohClient.isPolluted("1.1.1.1"));
        assertFalse(DohClient.isPolluted("8.8.8.8"));
    }

    /**
     * IP 字面量短路：已是 IP 时不发起请求（不会触碰 MockWebServer）。
     */
    @Test
    public void resolve_ipLiteral_shortCircuits() throws IOException {
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client, Arrays.asList(primaryServer.url("/dns-query").toString()));
        List<String> ips = doh.resolve("210.140.139.131");
        assertEquals(1, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
        assertEquals(0, primaryServer.getRequestCount());
    }

    /**
     * 主端点成功：返回结果，不打 fallback。
     */
    @Test
    public void resolve_primarySucceeds_skipsFallback() throws IOException {
        primaryServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"Answer\":[{\"type\":1,\"data\":\"210.140.139.131\"}]}"));
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client,
                Arrays.asList(primaryServer.url("/dns-query").toString(),
                        fallbackServer.url("/dns-query").toString()));

        List<String> ips = doh.resolve("i.pximg.net");
        assertEquals(1, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
        assertEquals(1, primaryServer.getRequestCount());
        assertEquals("fallback 不应被打", 0, fallbackServer.getRequestCount());
    }

    /**
     * 主端点失败（HTTP 500） → fallback 命中。
     */
    @Test
    public void resolve_primaryFails_fallbackSucceeds() throws IOException {
        primaryServer.enqueue(new MockResponse().setResponseCode(500));
        fallbackServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"Answer\":[{\"type\":1,\"data\":\"210.140.139.155\"}]}"));
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client,
                Arrays.asList(primaryServer.url("/dns-query").toString(),
                        fallbackServer.url("/dns-query").toString()));

        List<String> ips = doh.resolve("app-api.pixiv.net");
        assertEquals(1, ips.size());
        assertEquals("210.140.139.155", ips.get(0));
        assertEquals(1, primaryServer.getRequestCount());
        assertEquals(1, fallbackServer.getRequestCount());
    }

    /**
     * 主端点返回污染 IP（0.0.0.0） → 视为失败，继续 fallback。
     */
    @Test
    public void resolve_primaryReturnsPolluted_fallbackUsed() throws IOException {
        primaryServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"Answer\":[{\"type\":1,\"data\":\"0.0.0.0\"}]}"));
        fallbackServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"Answer\":[{\"type\":1,\"data\":\"210.140.139.131\"}]}"));
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client,
                Arrays.asList(primaryServer.url("/dns-query").toString(),
                        fallbackServer.url("/dns-query").toString()));

        List<String> ips = doh.resolve("i.pximg.net");
        assertEquals(1, ips.size());
        assertEquals("210.140.139.131", ips.get(0));
    }

    /**
     * 双端点全失败 → 抛 IOException。
     */
    @Test
    public void resolve_allEndpointsFail_throwsIOException() throws IOException {
        primaryServer.enqueue(new MockResponse().setResponseCode(500));
        fallbackServer.enqueue(new MockResponse().setResponseCode(503));
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client,
                Arrays.asList(primaryServer.url("/dns-query").toString(),
                        fallbackServer.url("/dns-query").toString()));

        try {
            doh.resolve("i.pximg.net");
            fail("预期抛 IOException");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("所有 DoH 端点失败"));
        }
    }

    /**
     * 空 hostname → 抛 IOException。
     */
    @Test
    public void resolve_emptyHostname_throws() {
        OkHttpClient client = new OkHttpClient.Builder().build();
        DohClient doh = new DohClient(client, Arrays.asList(primaryServer.url("/dns-query").toString()));
        try {
            doh.resolve(null);
            fail("预期抛 IOException");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("hostname 不能为空"));
        }
        try {
            doh.resolve("");
            fail("预期抛 IOException");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("hostname 不能为空"));
        }
    }
}