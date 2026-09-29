package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.util.Base64;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.tasm.image.ImageContent;
import com.lynx.tasm.image.model.ImageInfo;
import com.lynx.tasm.image.model.ImageLoadListener;
import com.lynx.tasm.image.model.ImageRequestInfo;
import com.lynx.tasm.image.model.ImageRequestInfoBuilder;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * PictelioImageService（自研 ILynxImageService）IO 边界测试（#59）。
 *
 * <p>覆盖：fetchImage 成功（Bitmap 回调）/ 失败（onFailure）/ URL 重写透传、
 * canParseUrl、动画 4 件套返回 false。下载走 MockWebServer（绝对 URL 原样透传；
 * /pixiv-img/ 重写逻辑已由 PixivImageLoaderTest 覆盖）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioImageServiceTest {

    /** 1x1 透明 PNG */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    private MockWebServer server;
    private PictelioImageService service;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        Context ctx = ApplicationProvider.getApplicationContext();
        service = PictelioImageService.getInstance();
        service.onInitialize(ctx);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    private static ImageRequestInfo request(String url) {
        return new ImageRequestInfoBuilder().setUrl(url).build();
    }

    private static final class RecordingListener implements ImageLoadListener {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<ImageContent> success = new AtomicReference<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        @Override
        public void onRequestSubmit(ImageRequestInfo requestInfo) {
        }

        @Override
        public void onSuccess(ImageContent content, ImageRequestInfo requestInfo, ImageInfo info) {
            success.set(content);
            done.countDown();
        }

        @Override
        public void onFailure(int code, Throwable throwable) {
            failure.set(throwable);
            done.countDown();
        }

        @Override
        public void onImageMonitorInfo(org.json.JSONObject monitorInfo) {
        }
    }

    @Test
    public void fetchImage_success_deliversBitmap() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(PNG_1PX)));
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/ok.png").toString()), listener, null,
                ApplicationProvider.getApplicationContext());

        assertTrue("onSuccess 应在超时内回调", listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败", listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent", content);
        assertEquals(1, content.getIntrinsicWidth());
        assertEquals(1, content.getIntrinsicHeight());
        assertEquals(1, server.getRequestCount());
    }

    @Test
    public void fetchImage_httpError_deliversFailure() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403));
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/forbidden.png").toString()), listener, null,
                ApplicationProvider.getApplicationContext());

        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应成功", listener.success.get());
        assertNotNull("应收到失败", listener.failure.get());
    }

    @Test
    public void fetchImage_nullUrl_deliversFailureImmediately() throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(null), listener, null,
                ApplicationProvider.getApplicationContext());
        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNotNull(listener.failure.get());
        assertEquals(0, server.getRequestCount());
    }

    @Test
    public void fetchImage_cachesAcrossCalls() throws Exception {
        // 第一次下载写盘；第二次命中缓存（MockWebServer 无新请求）
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(PNG_1PX)));
        String url = server.url("/img/cached.png").toString();
        RecordingListener first = new RecordingListener();
        service.fetchImage(request(url), first, null, ApplicationProvider.getApplicationContext());
        assertTrue(first.done.await(5, TimeUnit.SECONDS));
        assertNotNull(first.success.get());

        RecordingListener second = new RecordingListener();
        service.fetchImage(request(url), second, null, ApplicationProvider.getApplicationContext());
        assertTrue(second.done.await(5, TimeUnit.SECONDS));
        assertNotNull(second.success.get());
        assertEquals("第二次应命中缓存，不再请求网络", 1, server.getRequestCount());
    }

    @Test
    public void animationMethods_returnFalse() {
        assertFalse(service.startAnimation(null));
        assertFalse(service.resumeAnimation(null));
        assertFalse(service.pauseAnimation(null));
        assertFalse(service.stopAnimation(null));
    }

    @Test
    public void fetchImage_emptyBody_deliversFailure() throws Exception {
        // 200 但空 body → PixivImageLoader 拒绝（空 body 不缓存）→ onFailure
        // 注：Bitmap 解码失败路径（decode 返回 null）在 Robolectric 下 shadow 过于宽容不可靠，归真机验证点
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer()));
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/empty.bin").toString()), listener, null,
                ApplicationProvider.getApplicationContext());

        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应成功", listener.success.get());
        assertNotNull("应收到失败", listener.failure.get());
    }

    @Test
    public void canParseUrl_returnsTrue() {
        assertTrue(service.canParseUrl("/pixiv-img/x.jpg"));
        assertTrue(service.canParseUrl("https://i.pximg.net/x.jpg"));
    }
}
