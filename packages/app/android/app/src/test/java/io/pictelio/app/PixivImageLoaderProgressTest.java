package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * PixivImageLoader 流式加载（下载队列底座）单测：进度上报、缓存命中、取消中止。
 * spec docs/specs/download-manager.md §4.3 / ADR-0146 D1。网络用 MockWebServer（对齐 PixivImageLoaderTest）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PixivImageLoaderProgressTest {

    private MockWebServer server;
    private PixivImageLoader loader;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        Context ctx = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(ctx, new OkHttpClient.Builder().build(), 10_000_000L);
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    private String enqueue(int size) {
        byte[] body = new byte[size];
        for (int i = 0; i < size; i++) {
            body[i] = (byte) (i % 251);
        }
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        return server.url("/pixiv-img/progress-" + size + ".jpg").toString();
    }

    @Test
    public void loadFileWithProgress_reportsProgressAndWritesCache() throws IOException {
        String url = enqueue(200_000);
        List<long[]> reports = new ArrayList<>();
        File file = loader.loadFileWithProgress(url,
                (done, total) -> reports.add(new long[]{done, total}), null);

        assertTrue(file.exists());
        assertEquals(200_000, file.length());
        assertFalse(reports.isEmpty());
        assertEquals(200_000, reports.get(reports.size() - 1)[0]);
        for (int i = 1; i < reports.size(); i++) {
            assertTrue("进度必须单调不减", reports.get(i)[0] >= reports.get(i - 1)[0]);
        }

        // 二次加载命中缓存：立即报告 done == total == 文件长度，且不重复下载
        List<long[]> cachedReports = new ArrayList<>();
        File again = loader.loadFileWithProgress(url,
                (done, total) -> cachedReports.add(new long[]{done, total}), null);
        assertEquals(file.getAbsolutePath(), again.getAbsolutePath());
        assertEquals(1, cachedReports.size());
        assertEquals(file.length(), cachedReports.get(0)[0]);
    }

    @Test
    public void loadFileWithProgress_cancelAbortsWithIOException() {
        String url = enqueue(300_000);
        AtomicBoolean cancel = new AtomicBoolean(false);
        IOException ex = assertThrows(IOException.class, () -> loader.loadFileWithProgress(url,
                (done, total) -> cancel.set(true), cancel::get));
        assertTrue("失败信息应含取消语义: " + ex.getMessage(), ex.getMessage().contains("取消"));
    }
}
