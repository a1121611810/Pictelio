package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import com.getcapacitor.JSObject;

import org.json.JSONException;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

import io.pictelio.app.directaccess.ChannelCircuitBreaker;
import io.pictelio.app.directaccess.DirectAccessConfig;
import io.pictelio.app.directaccess.DirectIpTableDefaults;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * PixivApiPlugin 预取核心单测（#379 T3）——{@code prefetchCore} 单口进出（脱离 PluginCall 壳）。
 *
 * <p>覆盖 ADR-0143 T3 的两条行为轴：
 * <ol>
 *   <li><b>下载源委托</b>：图床开启时预取经 {@link PixivImageLoader#download} 走镜像
 *      （resolve + 镜像失败官方回退均在下载核心内）；</li>
 *   <li><b>缓存键恒官方</b>（D2 源无关命中不变量）：无论字节来自镜像还是官方，
 *       磁盘文件名 = {@code keyToFilename(官方入参 url)}、内存 LRU 键 = 官方入参 url。</li>
 * </ol>
 *
 * <p><b>Oracle 溯源（测试硬约束 #6）</b>：
 * <ul>
 *   <li>fixture JSON 形状 = {@code imageHostStore.ts} ImageHostState 持久化形态
 *       （与 ImageHostConfigTest 同款 helper）；生产读取路径 = SharedPreferences
 *       {@code "CapacitorStorage"} 的 {@code image_host_settings}（ImageHostConfig 生产
 *       RawProvider 接线，先例 ImageIntercept 读 image_cache_disk）；</li>
 *   <li>镜像 URL 形态（host 改写 + path 逐字节保留）= ImageHostConfigTest 的
 *       transformUrl 语义断言 + JS {@code imageHostService.ts}；</li>
 *   <li>回退语义（镜像失败 → 官方重试一次）= ADR-0143 D4；</li>
 *   <li>缓存文件名/目录 = PixivImageLoader 既有契约（PixivImageLoaderTest 已断言
 *       pictelio-images 目录 + keyToFilename 命名）；</li>
 *   <li>已缓存短路 / 非 2xx 抛 IOException = 原内联实现的现状语义（T3 要求行为等价）。</li>
 * </ul>
 *
 * <p>双 MockWebServer 拓扑：mirrorServer 扮演镜像 host（fixture baseUrl 指向它），
 * officialServer 承载官方入参 URL——resolve 对入参域不限（仅镜像 host 过滤官方域），
 * localhost 官方 URL 使「官方回退 / 图床关直连」可在单测内真实可达（i.pximg.net
 * 会在单测里打真实网络，不可用）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PixivApiPluginTest {

    private MockWebServer mirrorServer;
    private MockWebServer officialServer;
    private Context ctx;

    @Before
    public void setUp() throws IOException {
        mirrorServer = new MockWebServer();
        officialServer = new MockWebServer();
        mirrorServer.start();
        officialServer.start();
        ctx = ApplicationProvider.getApplicationContext();
    }

    @After
    public void tearDown() throws IOException {
        mirrorServer.shutdown();
        officialServer.shutdown();
    }

    // ── fixture（oracle = imageHostStore.ts ImageHostState 持久化形态，与 ImageHostConfigTest 同款） ──

    private static String hostJson(String id, String baseUrl, boolean enabled, int weight) {
        return "{\"id\":\"" + id + "\",\"name\":\"" + id + "-name\",\"baseUrl\":\"" + baseUrl
                + "\",\"enabled\":" + enabled + ",\"weight\":" + weight
                + ",\"isBuiltIn\":true,\"edited\":false}";
    }

    private static String configJson(boolean masterEnabled, String mode, String selectedHostId,
                                     String hostsJson) {
        return "{\"masterEnabled\":" + masterEnabled
                + ",\"mode\":\"" + mode + "\""
                + ",\"selectedHostId\":" + (selectedHostId == null ? "null" : "\"" + selectedHostId + "\"")
                + ",\"hosts\":[" + hostsJson + "]"
                + ",\"probeResults\":[]"
                + ",\"fastestHostId\":null"
                + ",\"fastestHostExpiresAt\":null"
                + "}";
    }

    /** 生产写入路径：SharedPreferences "CapacitorStorage" 的 image_host_settings（ImageHostConfig 生产 RawProvider 同名） */
    private void writeImageHostSettings(String json) {
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit()
                .putString("image_host_settings", json)
                .apply();
    }

    /** 确定性 body（seed 移相，可区分镜像/官方来源） */
    private static byte[] body(int sizeBytes, int seed) {
        byte[] b = new byte[sizeBytes];
        for (int i = 0; i < sizeBytes; i++) {
            b[i] = (byte) ((i + seed) % 251);
        }
        return b;
    }

    private static void enqueue200(MockWebServer server, byte[] bodyBytes) {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(bodyBytes)));
    }

    /** 预取磁盘缓存文件（目录名 pictelio-images 为 PixivImageLoader 既有契约） */
    private static File cacheFileOf(Context ctx, String url) {
        File f = new File(new File(ctx.getCacheDir(), "pictelio-images"),
                PixivImageLoader.keyToFilename(url));
        return f.exists() && f.length() > 0 ? f : null;
    }

    // ── 图床开启（single 模式）：预取下载源走镜像，缓存键恒官方 ──

    @Test
    public void prefetchCore_imageHostOn_downloadsFromMirror_writesOfficialKey() throws Exception {
        writeImageHostSettings(configJson(true, "single", "mirror",
                hostJson("mirror", mirrorServer.url("/").toString(), true, 1)));
        byte[] mirrorBody = body(128, 1);
        enqueue200(mirrorServer, mirrorBody);

        String officialUrl = officialServer.url("/img-master/img/2021/03/15/00/00/00/87905934_p0.jpg")
                .toString();
        PixivApiPlugin.PrefetchResult r = PixivApiPlugin.prefetchCore(ctx, officialUrl);

        assertFalse("未命中磁盘应为非 cached 结果", r.cached);
        assertEquals(mirrorBody.length, r.size);

        // 请求打到镜像 URL（host 改写 + path 逐字节保留）；官方服务器零请求
        assertEquals("预取应打镜像", 1, mirrorServer.getRequestCount());
        assertEquals("镜像可用时不得回退官方", 0, officialServer.getRequestCount());
        RecordedRequest req = mirrorServer.takeRequest();
        assertEquals("/img-master/img/2021/03/15/00/00/00/87905934_p0.jpg", req.getPath());

        // 磁盘文件名 = keyToFilename(官方 url)——键不随下载源（ADR-0143 D2）
        File cacheFile = new File(r.path);
        assertTrue(cacheFile.exists());
        assertEquals(PixivImageLoader.keyToFilename(officialUrl), cacheFile.getName());
        assertArrayEquals(mirrorBody, Files.readAllBytes(cacheFile.toPath()));

        // 内存 LRU 以官方 url 键命中（X1 预取填充点）
        assertArrayEquals(mirrorBody, ImageBytesMemoryCache.getInstance().get(officialUrl));
    }

    // ── 镜像 500 → 官方回退一次，缓存键仍官方 ──

    @Test
    public void prefetchCore_mirror500_fallsBackToOfficial_officialKeyWritten() throws Exception {
        writeImageHostSettings(configJson(true, "single", "mirror",
                hostJson("mirror", mirrorServer.url("/").toString(), true, 1)));
        mirrorServer.enqueue(new MockResponse().setResponseCode(500));
        byte[] officialBody = body(96, 2);
        enqueue200(officialServer, officialBody);

        String officialUrl = officialServer.url("/c/360x360_70/img-master/img/fallback.jpg").toString();
        PixivApiPlugin.PrefetchResult r = PixivApiPlugin.prefetchCore(ctx, officialUrl);

        assertFalse(r.cached);
        assertEquals("镜像失败应恰好请求一次", 1, mirrorServer.getRequestCount());
        assertEquals("镜像失败 → 官方重试一次（ADR-0143 D4）", 1, officialServer.getRequestCount());

        // 回退成功后落盘/内存键仍为官方 url
        File cacheFile = new File(r.path);
        assertEquals(PixivImageLoader.keyToFilename(officialUrl), cacheFile.getName());
        assertArrayEquals(officialBody, Files.readAllBytes(cacheFile.toPath()));
        assertArrayEquals(officialBody, ImageBytesMemoryCache.getInstance().get(officialUrl));
    }

    // ── 图床关：行为与现状一致（下载源 = 官方入参 URL，键官方） ──

    @Test
    public void prefetchCore_imageHostOff_downloadsFromOfficialUrl_unchanged() throws Exception {
        writeImageHostSettings(configJson(false, "single", "mirror",
                hostJson("mirror", mirrorServer.url("/").toString(), true, 1)));
        byte[] officialBody = body(64, 3);
        enqueue200(officialServer, officialBody);

        String officialUrl = officialServer.url("/img-master/img/off.jpg").toString();
        PixivApiPlugin.PrefetchResult r = PixivApiPlugin.prefetchCore(ctx, officialUrl);

        assertFalse(r.cached);
        assertEquals(officialBody.length, r.size);
        assertEquals("图床关不得请求镜像", 0, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());

        File cacheFile = new File(r.path);
        assertEquals(PixivImageLoader.keyToFilename(officialUrl), cacheFile.getName());
        assertArrayEquals(officialBody, Files.readAllBytes(cacheFile.toPath()));
        assertArrayEquals(officialBody, ImageBytesMemoryCache.getInstance().get(officialUrl));
    }

    // ── 已缓存短路：零网络、不回填内存（与现状一致） ──

    @Test
    public void prefetchCore_alreadyCached_shortCircuitsWithoutNetwork() throws Exception {
        String officialUrl = officialServer.url("/img-master/img/cached.jpg").toString();
        File dir = new File(ctx.getCacheDir(), "pictelio-images");
        assertTrue(dir.mkdirs() || dir.isDirectory());
        byte[] existing = body(32, 4);
        Files.write(new File(dir, PixivImageLoader.keyToFilename(officialUrl)).toPath(), existing);

        PixivApiPlugin.PrefetchResult r = PixivApiPlugin.prefetchCore(ctx, officialUrl);

        assertTrue(r.cached);
        assertEquals("短路路径应返回已缓存文件", r.path,
                new File(dir, PixivImageLoader.keyToFilename(officialUrl)).getAbsolutePath());
        assertEquals(0, mirrorServer.getRequestCount());
        assertEquals(0, officialServer.getRequestCount());
        // 短路路径不回填内存 LRU（现状语义：仅下载路径填充）
        assertNull(ImageBytesMemoryCache.getInstance().get(officialUrl));
    }

    // ── 图床关 + 官方非 2xx：IOException 上抛（壳映射 reject，现状语义） ──

    @Test
    public void prefetchCore_officialNon2xx_throwsIOException_noFileWritten() throws Exception {
        writeImageHostSettings(configJson(false, "single", "mirror",
                hostJson("mirror", mirrorServer.url("/").toString(), true, 1)));
        officialServer.enqueue(new MockResponse().setResponseCode(403));

        String officialUrl = officialServer.url("/img-master/img/forbidden.jpg").toString();
        IOException ex = assertThrows(IOException.class,
                () -> PixivApiPlugin.prefetchCore(ctx, officialUrl));
        assertTrue(ex.getMessage().contains("403"));
        assertNull("失败响应不得写缓存", cacheFileOf(ctx, officialUrl));
        assertNull("失败路径不得回填内存 LRU", ImageBytesMemoryCache.getInstance().get(officialUrl));
    }

    // ── 直连状态/命令面（#391 T6，先例 prefetchCore：包可见核心脱离 PluginCall 壳） ──
    //
    // Oracle 溯源（测试硬约束 #6）：
    //  - fixture JSON 形态 = DirectAccessConfig 存储契约 javadoc（{"enabled":bool,
    //    "manual":[{"host","ip"}]}），经生产读取路径 SharedPreferences "CapacitorStorage"
    //    键 direct_access_settings 写入（真实样例硬约束 #2，非内存 mock）；
    //  - 开关映射（false→OFF / key 缺失→UNSET）= DirectAccessConfigTest 开关注释 + SwitchState 三态语义；
    //  - 条目数覆盖语义（manual 逐条覆盖内置，非新增）= spec #385「三层合并 逐条覆盖」；
    //  - 熔断相位（3 连败→OPEN / reset→CLOSED 清零）= ChannelCircuitBreaker 状态机 javadoc；
    //  - refresh 命令 started=true = refreshIpTableNow 单飞契约（DirectAccessConfigTest 已覆盖
    //    拉取语义；此处只断言壳层委托透传。生产接线拉取器直连 raw.githubusercontent.com，
    //    后台 daemon 线程 fire-and-forget：失败仅 warn，不影响本用例同步断言）。

    /** 生产写入路径：SharedPreferences "CapacitorStorage" 的 direct_access_settings（Java 解析契约同名键） */
    private void writeDirectAccessSettings(String json) {
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit()
                .putString("direct_access_settings", json)
                .apply();
    }

    @Test
    public void directAccessStatus_reflectsStoredSwitchAndManualTable_noNetworkWhenOff()
            throws JSONException {
        writeDirectAccessSettings(
                "{\"enabled\":false,\"manual\":[{\"host\":\"i.pximg.net\",\"ip\":\"192.0.2.1\"}]}");

        JSObject status = PixivApiPlugin.directAccessStatusCore(ctx);

        assertEquals("OFF", status.getString("switchState"));
        assertEquals("CLOSED", status.getString("imageChannel"));
        assertEquals("CLOSED", status.getString("apiChannel"));
        // 手动层逐条覆盖内置（spec #385）：i.pximg.net 是覆盖非新增 → 条目数 = 内置表大小
        assertEquals("手动覆盖不新增条目", DirectIpTableDefaults.builtIn().size(),
                status.getInteger("tableEntries").intValue());
        assertEquals("manual+builtin", status.getString("tableSource"));
        assertEquals("从未成功拉取应为 0", 0L, status.getLong("lastFetchAtMillis"));
    }

    @Test
    public void directAccessStatus_missingKey_safeUnsetDefaults() throws JSONException {
        JSObject status = PixivApiPlugin.directAccessStatusCore(ctx);

        assertEquals("key 缺失 = UNSET（缺省状态）", "UNSET", status.getString("switchState"));
        assertEquals("CLOSED", status.getString("imageChannel"));
        assertEquals("CLOSED", status.getString("apiChannel"));
        assertEquals("内置兜底层仍参与合并", DirectIpTableDefaults.builtIn().size(),
                status.getInteger("tableEntries").intValue());
        assertEquals("builtin", status.getString("tableSource"));
    }

    @Test
    public void directAccessCommand_reset_reopensOpenCircuits() throws Exception {
        DirectAccessConfig config = DirectAccessConfig.get(ctx);
        for (int i = 0; i < ChannelCircuitBreaker.FAILURE_THRESHOLD; i++) {
            config.breaker().recordFailure(ChannelCircuitBreaker.Channel.IMAGE);
            config.breaker().recordFailure(ChannelCircuitBreaker.Channel.API_REFRESH);
        }
        assertEquals(ChannelCircuitBreaker.Phase.OPEN,
                config.breaker().phase(ChannelCircuitBreaker.Channel.IMAGE));
        assertEquals(ChannelCircuitBreaker.Phase.OPEN,
                config.breaker().phase(ChannelCircuitBreaker.Channel.API_REFRESH));

        JSObject result = PixivApiPlugin.directAccessCommandCore(ctx, "reset");

        assertTrue("reset 命令应 resolve ok=true", result.getBoolean("ok"));
        assertEquals("双通道熔断全重置回 CLOSED",
                ChannelCircuitBreaker.Phase.CLOSED,
                config.breaker().phase(ChannelCircuitBreaker.Channel.IMAGE));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED,
                config.breaker().phase(ChannelCircuitBreaker.Channel.API_REFRESH));
    }

    @Test
    public void directAccessCommand_refreshReturnsStarted_andUnknownActionRejected()
            throws Exception {
        JSObject result = PixivApiPlugin.directAccessCommandCore(ctx, "refresh");

        assertTrue(result.getBoolean("ok"));
        assertTrue("空闲单例首次 refresh 必然发起（started=true）", result.getBoolean("started"));

        IllegalArgumentException err = assertThrows(IllegalArgumentException.class,
                () -> PixivApiPlugin.directAccessCommandCore(ctx, "bogus"));
        assertTrue("未知 action 的报错应说明合法取值",
                err.getMessage() != null && err.getMessage().contains("reset"));
    }
}
