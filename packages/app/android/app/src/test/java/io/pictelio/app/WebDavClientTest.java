package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.List;
import java.util.concurrent.TimeUnit;

import io.pictelio.app.WebDavClient.DavEntry;
import io.pictelio.app.WebDavClient.DavException;
import io.pictelio.app.WebDavClient.Kind;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;

/**
 * WebDavClient 协议级单测（MockWebServer，spec docs/specs/webdav-backup.md §4/§5）。
 * 期望值来源：RFC 4918 状态码语义 + multistatus 真实响应样例（Nextcloud 风格），
 * 非从实现反推。
 */
public class WebDavClientTest {

    private MockWebServer server;
    private WebDavClient client;
    private String base;

    private static final String MULTISTATUS_LIST =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<D:multistatus xmlns:D=\"DAV:\">"
            + "  <D:response>"
            + "    <D:href>/dav/backup/</D:href>"
            + "    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>"
            + "    <D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            + "  </D:response>"
            + "  <D:response>"
            + "    <D:href>/dav/backup/pictelio-backup-20260901-120000.json</D:href>"
            + "    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>1234</D:getcontentlength></D:prop>"
            + "    <D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            + "  </D:response>"
            + "  <D:response>"
            + "    <D:href>/dav/backup/pictelio-backup-20260902-120000.json</D:href>"
            + "    <D:propstat><D:prop><D:resourcetype/></D:prop>"
            + "    <D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            + "  </D:response>"
            + "</D:multistatus>";

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        base = server.url("/dav/").toString();
        client = new WebDavClient("user", "pass", 5_000);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    // ── MKCOL ──

    @Test
    public void ensureDir_201_success() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(201));
        client.ensureDir(base + "backup/");
        RecordedRequest req = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("MKCOL", req.getMethod());
        assertEquals("/dav/backup/", req.getPath());
    }

    @Test
    public void ensureDir_409_treatedAsSuccess() throws Exception {
        // 目录已存在 → 幂等成功（spec §4）
        server.enqueue(new MockResponse().setResponseCode(409));
        client.ensureDir(base + "backup/");
    }

    @Test
    public void ensureDir_401_authFailed() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(401));
        try {
            client.ensureDir(base + "backup/");
            fail("应抛 DavException");
        } catch (DavException e) {
            assertEquals(Kind.AUTH_FAILED, e.kind);
            assertEquals(401, e.statusCode);
        }
    }

    // ── PUT / 写后校验 ──

    @Test
    public void upload_success_sendsBodyAndAuth() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(201));
        byte[] body = "{\"a\":1}".getBytes("UTF-8");
        client.upload(base + "f.json", body);
        RecordedRequest req = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("PUT", req.getMethod());
        assertArrayEquals(body, req.getBody().readByteArray());
        assertTrue(req.getHeader("Authorization").startsWith("Basic "));
    }

    @Test
    public void uploadWithVerify_success() throws Exception {
        byte[] body = "hello".getBytes("UTF-8");
        server.enqueue(new MockResponse().setResponseCode(201)); // PUT
        server.enqueue(multistatusStat(body.length));            // PROPFIND
        client.uploadWithVerify(base + "f.json", body, 3);
        RecordedRequest stat = server.takeRequest(1, TimeUnit.SECONDS); // PUT
        assertEquals("PUT", stat.getMethod());
        RecordedRequest propfind = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("PROPFIND", propfind.getMethod());
        assertEquals("0", propfind.getHeader("Depth"));
    }

    @Test
    public void uploadWithVerify_retryUntilSizeMatches() throws Exception {
        // 第 1 次写后校验大小不符 → 重试；第 2 次相符 → 成功（spec §5 重试 ×3）
        byte[] body = "hello".getBytes("UTF-8");
        server.enqueue(new MockResponse().setResponseCode(201));
        server.enqueue(multistatusStat(999));
        server.enqueue(new MockResponse().setResponseCode(201));
        server.enqueue(multistatusStat(body.length));
        client.uploadWithVerify(base + "f.json", body, 3);
        assertEquals(4, server.getRequestCount());
    }

    @Test
    public void uploadWithVerify_exhaustsAttempts() throws Exception {
        byte[] body = "hello".getBytes("UTF-8");
        for (int i = 0; i < 3; i++) {
            server.enqueue(new MockResponse().setResponseCode(201));
            server.enqueue(multistatusStat(999));
        }
        try {
            client.uploadWithVerify(base + "f.json", body, 3);
            fail("应抛 DavException");
        } catch (DavException e) {
            assertEquals(Kind.SERVER, e.kind);
        }
        assertEquals(6, server.getRequestCount()); // 3 轮 PUT+PROPFIND
    }

    // ── GET ──

    @Test
    public void download_success() throws Exception {
        server.enqueue(new MockResponse().setBody("snapshot-bytes"));
        assertArrayEquals("snapshot-bytes".getBytes("UTF-8"), client.download(base + "f.json"));
    }

    @Test
    public void download_404_notFound() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(404));
        try {
            client.download(base + "f.json");
            fail("应抛 DavException");
        } catch (DavException e) {
            assertEquals(Kind.NOT_FOUND, e.kind);
        }
    }

    // ── PROPFIND ──

    @Test
    public void list_depth1_parsesEntries() throws Exception {
        server.enqueue(new MockResponse().setBody(MULTISTATUS_LIST));
        List<DavEntry> entries = client.list(base + "backup/");
        RecordedRequest req = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("PROPFIND", req.getMethod());
        assertEquals("1", req.getHeader("Depth"));
        assertEquals(3, entries.size());
        assertTrue(entries.get(0).isCollection);
        assertFalse(entries.get(1).isCollection);
        assertEquals(Long.valueOf(1234), entries.get(1).contentLength);
        // 第 3 条无 getcontentlength（服务器差异容忍）→ null
        assertNull(entries.get(2).contentLength);
    }

    @Test
    public void stat_depth0_returnsSingle() throws Exception {
        server.enqueue(new MockResponse().setBody(MULTISTATUS_LIST));
        DavEntry stat = client.stat(base + "backup/");
        RecordedRequest req = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("0", req.getHeader("Depth"));
        assertTrue(stat.isCollection);
    }

    @Test
    public void parseMultistatus_toleratesOtherPrefixes() {
        // 不同命名空间前缀（自托管服务器差异，Joplin 兼容先例）
        String xml = "<x:multistatus xmlns:x=\"DAV:\"><x:response><x:href>/a/f.json</x:href>"
                + "<x:propstat><x:prop><x:resourcetype/><x:getcontentlength>7</x:getcontentlength>"
                + "</x:prop></x:propstat></x:response></x:multistatus>";
        List<DavEntry> entries = WebDavClient.parseMultistatus(xml);
        assertEquals(1, entries.size());
        assertEquals("/a/f.json", entries.get(0).href);
        assertEquals(Long.valueOf(7), entries.get(0).contentLength);
    }

    // ── DELETE / 旋转 ──

    @Test
    public void delete_404_treatedAsDeleted() throws Exception {
        // 旋转幂等：远端已不存在视为成功
        server.enqueue(new MockResponse().setResponseCode(404));
        client.delete(base + "f.json");
    }

    @Test
    public void prune_keepsLatestN() throws Exception {
        // 4 份备份 → 保留最近 2 份，删最旧 2 份（固定 10 份不可配的参数化形式）
        server.enqueue(new MockResponse().setBody(multistatusFiles(
                "pictelio-backup-20260901-120000.json",
                "pictelio-backup-20260902-120000.json",
                "pictelio-backup-20260903-120000.json",
                "pictelio-backup-20260904-120000.json",
                "unrelated-other-file.json")));
        server.enqueue(new MockResponse().setResponseCode(204)); // DELETE 旧档 1
        server.enqueue(new MockResponse().setResponseCode(204)); // DELETE 旧档 2
        List<String> deleted = client.prune(base + "backup/", "pictelio-backup-", 2);
        assertEquals(2, deleted.size());
        assertTrue(deleted.get(0).contains("20260901"));
        assertTrue(deleted.get(1).contains("20260902"));
        // 两个 DELETE 请求打到正确 URL，且不误删无关文件
        RecordedRequest d1 = server.takeRequest(1, TimeUnit.SECONDS); // PROPFIND
        assertEquals("PROPFIND", d1.getMethod());
        RecordedRequest d2 = server.takeRequest(1, TimeUnit.SECONDS);
        RecordedRequest d3 = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("DELETE", d2.getMethod());
        assertEquals("DELETE", d3.getMethod());
        assertTrue(d2.getPath().contains("20260901") || d3.getPath().contains("20260901"));
        assertFalse(d2.getPath().contains("unrelated"));
        assertFalse(d3.getPath().contains("unrelated"));
    }

    @Test
    public void prune_deleteFailureDoesNotBlock() throws Exception {
        server.enqueue(new MockResponse().setBody(multistatusFiles(
                "pictelio-backup-20260901-120000.json",
                "pictelio-backup-20260902-120000.json",
                "pictelio-backup-20260903-120000.json")));
        server.enqueue(new MockResponse().setResponseCode(500)); // 第一个删除失败
        server.enqueue(new MockResponse().setResponseCode(204)); // 第二个成功
        List<String> deleted = client.prune(base + "backup/", "pictelio-backup-", 1);
        assertEquals(1, deleted.size()); // 失败的不计入，继续旋转
        assertEquals(3, server.getRequestCount());
    }

    // ── 错误分类 ──

    @Test
    public void quota_507_mapped() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(507));
        try {
            client.upload(base + "f.json", "x".getBytes("UTF-8"));
            fail("应抛 DavException");
        } catch (DavException e) {
            assertEquals(Kind.QUOTA_EXCEEDED, e.kind);
        }
    }

    @Test
    public void networkFailure_classified() throws Exception {
        server.shutdown(); // 连接即失败
        try {
            client.download(base + "f.json");
            fail("应抛 DavException");
        } catch (DavException e) {
            assertEquals(Kind.NETWORK, e.kind);
        }
    }

    // ── 纯函数 ──

    @Test
    public void absolute_resolvesRelativeHref() {
        assertEquals("https://h/d/backup/f.json",
                WebDavClient.absolute("https://h/d/backup/", "f.json"));
        assertEquals("https://h/d/backup/f.json",
                WebDavClient.absolute("https://h/d/backup", "f.json"));
        assertEquals("https://other.host/f.json",
                WebDavClient.absolute("https://h/d/", "https://other.host/f.json"));
        // 绝对路径 href（Nextcloud 风格）：继承 scheme+host，不重复拼目录
        assertEquals("https://h/dav/backup/f.json",
                WebDavClient.absolute("https://h/d/backup/", "/dav/backup/f.json"));
    }

    // ── 夹具 ──

    private static MockResponse multistatusStat(long length) {
        return new MockResponse().setBody(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<D:multistatus xmlns:D=\"DAV:\"><D:response>"
                + "<D:href>/dav/f.json</D:href>"
                + "<D:propstat><D:prop><D:resourcetype/><D:getcontentlength>" + length
                + "</D:getcontentlength></D:prop></D:propstat>"
                + "</D:response></D:multistatus>");
    }

    private static String multistatusFiles(String... names) {
        StringBuilder sb = new StringBuilder(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        sb.append("<D:multistatus xmlns:D=\"DAV:\">");
        for (String name : names) {
            sb.append("<D:response><D:href>/dav/backup/").append(name).append("</D:href>")
              .append("<D:propstat><D:prop><D:resourcetype/><D:getcontentlength>10</D:getcontentlength>")
              .append("</D:prop></D:propstat></D:response>");
        }
        sb.append("</D:multistatus>");
        return sb.toString();
    }
}
