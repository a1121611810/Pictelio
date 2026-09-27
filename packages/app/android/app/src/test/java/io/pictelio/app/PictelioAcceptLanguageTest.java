package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.IOException;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * Accept-Language 语言头契约测试（ADR-0200，ticket #783 T1）。
 *
 * <p><b>Oracle 溯源（测试硬约束 #6）</b>：头值映射表 = ADR-0200 D1 解析表——
 * <ul>
 *   <li>{@code "en"} → {@code en}（用户显式选英文）</li>
 *   <li>{@code "zh-CN"} → {@code zh-CN}（用户显式选中文）</li>
 *   <li>{@code ""}（跟随系统）/ null / 任意非法值 → {@code zh-CN}
 *       （真机 LynxView 无 {@code navigator}，detectSystemLocale 实际落 zh-CN——
 *       头值与真机 UI 实际生效语言一致，与 TS 侧口径相同，ADR-0200 R1）</li>
 * </ul>
 *
 * <p>测试姿态（ADR-0200 D6）：解析函数为包私有静态纯函数 JVM 直测；
 * {@link PixivApiCore} 6 参重载的头附加经 Robolectric + MockWebServer 录得请求断言
 * （延续 PictelioApiModuleTest / PixivApiPluginTest 的 MockWebServer 先例）。
 * 401 刷新重试路径同样透传头值（spec E4），由实现保证（重试递归传同一 acceptLanguage）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioAcceptLanguageTest {

    private MockWebServer server;
    private String savedAccessToken;
    private String savedRefreshToken;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        // PixivApiCore token 为 Java 堆静态字段：保存/恢复，防污染同 JVM 内其他测试类；
        // 设固定值使 Authorization 基线断言可校验（OkHttp 会修剪空值头尾随空格，不适用）
        savedAccessToken = PixivApiCore.accessToken;
        savedRefreshToken = PixivApiCore.refreshToken;
        PixivApiCore.accessToken = "test-access-token";
        PixivApiCore.refreshToken = null;
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
        PixivApiCore.accessToken = savedAccessToken;
        PixivApiCore.refreshToken = savedRefreshToken;
    }

    // ── ADR-0200 D1：resolveAcceptLanguage 解析表（五分支） ──

    @Test
    public void resolve_en_returnsEn() {
        assertEquals("en", PictelioApiModule.resolveAcceptLanguage("en"));
    }

    @Test
    public void resolve_zhCN_returnsZhCN() {
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage("zh-CN"));
    }

    @Test
    public void resolve_empty_followSystemFallsToZhCN() {
        // 「跟随系统」：真机 LynxView 无 navigator，实际落 zh-CN（ADR-0200 D1 / R1）
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage(""));
    }

    @Test
    public void resolve_null_fallsToZhCN() {
        // prefs 读失败 / Context 不可用 → 调用方回落路径传 null（E1 头值仍 zh-CN）
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage(null));
    }

    @Test
    public void resolve_illegalValues_fallToZhCN() {
        // 任意非法值 → zh-CN（精确匹配语义："EN" 大小写不同即非法）
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage("fr"));
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage("EN"));
        assertEquals("zh-CN", PictelioApiModule.resolveAcceptLanguage("ja-JP"));
    }

    // ── ADR-0200 变更③：PixivApiCore 6 参重载头附加（MockWebServer 录得请求断言） ──

    @Test
    public void executeRequest_acceptLanguageAttachedToRequest() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        String url = server.url("/v1/illust/detail").toString();

        PixivApiCore.executeRequest("GET", url, null, "zh-CN", false, null);

        RecordedRequest req = server.takeRequest();
        assertEquals("zh-CN", req.getHeader("Accept-Language"));
        // 既有头不因新增语言头而缺失（基线行为保留）
        assertEquals("Bearer test-access-token", req.getHeader("Authorization"));
        assertEquals(io.pictelio.app.config.OAuthConfig.REFERER, req.getHeader("Referer"));
        assertEquals(io.pictelio.app.config.OAuthConfig.USER_AGENT, req.getHeader("User-Agent"));
    }

    @Test
    public void executeRequest_enValueAttachedVerbatim() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        String url = server.url("/v1/illust/detail").toString();

        PixivApiCore.executeRequest("GET", url, null, "en", false, null);

        RecordedRequest req = server.takeRequest();
        assertEquals("en", req.getHeader("Accept-Language"));
    }

    @Test
    public void executeRequest_nullAcceptLanguage_noHeader() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        String url = server.url("/v1/illust/detail").toString();

        PixivApiCore.executeRequest("GET", url, null, null, false, null);

        RecordedRequest req = server.takeRequest();
        assertNull("null 头值 = 不加头（webview 旧签名委托路径，ADR-0200 E6）",
                req.getHeader("Accept-Language"));
    }

    @Test
    public void executeRequest_emptyAcceptLanguage_noHeader() throws Exception {
        // 空串同为「不加头」防御分支（解析层已保证不会传空串，核心层兜底）
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        String url = server.url("/v1/illust/detail").toString();

        PixivApiCore.executeRequest("GET", url, null, "", false, null);

        RecordedRequest req = server.takeRequest();
        assertNull(req.getHeader("Accept-Language"));
    }

    @Test
    public void legacyFiveParamSignature_delegatesWithoutHeader() throws Exception {
        // webview PixivApiPlugin / OAuth 调用点维持旧 5 参签名 → 行为零变化（ADR-0200 D2 / E6）
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        String url = server.url("/v1/illust/detail").toString();

        PixivApiCore.executeRequest("GET", url, null, false, null);

        RecordedRequest req = server.takeRequest();
        assertNull("旧 5 参签名委托新重载时传 null → 不加 Accept-Language",
                req.getHeader("Accept-Language"));
    }
}
