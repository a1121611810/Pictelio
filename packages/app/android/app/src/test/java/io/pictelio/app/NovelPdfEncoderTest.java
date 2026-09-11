package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * T8 PDF 编码器单测。
 *
 * <p><b>期望值来源（oracle）</b>：spec docs/specs/novel-export.md §5 pdf 行 ——
 * A4 595×842pt、边距 16mm≈45pt、按页高切块、插图等比缩放、CJK 用系统字体。
 * 分页用纯逻辑 {@link NovelPdfEncoder.Paginator} 的独立期望值验证。
 *
 * <p><b>Robolectric 限制（实测，2026-09）</b>：{@code android.graphics.pdf.PdfDocument} 依赖
 * native 实现，JVM 单测（SDK 28/34，含 {@code @GraphicsMode(NATIVE)}）下 {@code nativeCreateDocument()}
 * 返回 0，任何 {@code startPage} 抛 {@code IllegalStateException: document is closed!}，
 * {@code PdfRenderer} 亦恒返回 0 页。故真实 {@code AndroidPdfBackend} 无法在单测跑通；
 * 本测试通过包可见测试缝 {@link NovelPdfEncoder.PdfBackend} 注入假件，验证编码编排/分页/落盘契约，
 * 并断言产物以 {@code %PDF-} 开头且长度非平凡。真机渲染保真度由设备批次验收覆盖。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NovelPdfEncoderTest {

    private Context context;
    private NovelExportTestData.FakeImageLoader loader;

    @Before
    public void setUp() {
        context = ApplicationProvider.getApplicationContext();
        loader = new NovelExportTestData.FakeImageLoader(context);
        loader.put(NovelExportTestData.COVER_URL,
                new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 1, 2, 3});
        loader.put(NovelExportTestData.IMAGE_URL,
                new byte[]{(byte) 0x89, 'P', 'N', 'G', 4, 5, 6});
    }

    /** 假后端：用真实 Robolectric Canvas 承接绘制，写出最小但合法的 PDF 字节流。 */
    private static final class FakePdfBackend implements NovelPdfEncoder.PdfBackend {
        int pageCount = 0;
        boolean closed = false;
        final List<int[]> pageSizes = new ArrayList<>();

        @Override
        public Canvas startPage(int width, int height) {
            pageCount++;
            pageSizes.add(new int[]{width, height});
            Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            return new Canvas(bmp);
        }

        @Override
        public void finishPage() {
            // 无需收尾
        }

        @Override
        public void writeTo(OutputStream out) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("%PDF-1.4\n");
            sb.append("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n");
            sb.append("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n");
            sb.append("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n");
            sb.append("trailer<</Size 4/Root 1 0 R>>\n");
            sb.append("%%EOF\n");
            out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
            out.flush();
        }

        @Override
        public void close() {
            closed = true;
        }
    }

    // ── 纯分页逻辑 ───────────────────────────────────────────

    @Test
    public void paginator_allFits_singlePage() {
        NovelPdfEncoder.Paginator p = new NovelPdfEncoder.Paginator(100);
        List<List<Integer>> pages = p.paginate(Arrays.asList(30, 30, 30),
                Arrays.asList(false, false, false));
        assertEquals(1, pages.size());
        assertEquals(Arrays.asList(0, 1, 2), pages.get(0));
    }

    @Test
    public void paginator_overflowsToNextPage() {
        NovelPdfEncoder.Paginator p = new NovelPdfEncoder.Paginator(100);
        List<List<Integer>> pages = p.paginate(Arrays.asList(60, 60),
                Arrays.asList(false, false));
        assertEquals(2, pages.size());
        assertEquals(Arrays.asList(0), pages.get(0));
        assertEquals(Arrays.asList(1), pages.get(1));
    }

    @Test
    public void paginator_pageBreakForcesNewPage() {
        NovelPdfEncoder.Paginator p = new NovelPdfEncoder.Paginator(100);
        List<List<Integer>> pages = p.paginate(Arrays.asList(10, 0, 10),
                Arrays.asList(false, true, false));
        assertEquals(2, pages.size());
        assertEquals(Arrays.asList(0), pages.get(0));
        assertEquals(Arrays.asList(2), pages.get(1));
    }

    @Test
    public void paginator_emptyContent_stillOnePage() {
        NovelPdfEncoder.Paginator p = new NovelPdfEncoder.Paginator(100);
        List<List<Integer>> pages = p.paginate(new ArrayList<>(), new ArrayList<>());
        assertEquals(1, pages.size());
        assertTrue(pages.get(0).isEmpty());
    }

    @Test
    public void paginator_oversizedItemGetsOwnPage() {
        NovelPdfEncoder.Paginator p = new NovelPdfEncoder.Paginator(100);
        List<List<Integer>> pages = p.paginate(Arrays.asList(150, 10),
                Arrays.asList(false, false));
        assertEquals(2, pages.size());
        assertEquals(Arrays.asList(0), pages.get(0));
        assertEquals(Arrays.asList(1), pages.get(1));
    }

    // ── 编码编排 / 落盘 ──────────────────────────────────────

    @Test
    public void encode_writesPdfHeaderAndNonTrivialBytes() throws Exception {
        FakePdfBackend backend = new FakePdfBackend();
        File f = NovelPdfEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_pdf", backend);

        assertEquals("novel_pdf.pdf", f.getName());
        byte[] bytes = Files.readAllBytes(f.toPath());
        assertTrue("缺少 PDF 头", new String(bytes, 0, 5, StandardCharsets.US_ASCII)
                .equals("%PDF-"));
        assertTrue("PDF 内容过短: " + bytes.length, bytes.length > 100);
        assertTrue("后端未关闭", backend.closed);
    }

    @Test
    public void encode_paginatesWithA4SizeAndHonoursPageBreak() throws Exception {
        FakePdfBackend backend = new FakePdfBackend();
        NovelPdfEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_pdf_pages", backend);

        assertTrue("至少一页", backend.pageCount >= 1);
        // 载荷含 pageBreak，且页眉/正文占据首页后必须换页
        assertTrue("分页符未生效: pages=" + backend.pageCount, backend.pageCount >= 2);
        for (int[] size : backend.pageSizes) {
            assertEquals(595, size[0]);
            assertEquals(842, size[1]);
        }
    }

    @Test
    public void encode_attemptsCoverAndInlineImages() throws Exception {
        FakePdfBackend backend = new FakePdfBackend();
        NovelPdfEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_pdf_img", backend);

        assertTrue("未尝试封面", loader.requested().contains(NovelExportTestData.COVER_URL));
        assertTrue("未尝试插图", loader.requested().contains(NovelExportTestData.IMAGE_URL));
    }

    @Test
    public void encode_imagesOff_doesNotFetchImages() throws Exception {
        FakePdfBackend backend = new FakePdfBackend();
        NovelPdfEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, false, false)),
                "novel_pdf_noimg", backend);

        assertFalse("关闭图片后不应取封面",
                loader.requested().contains(NovelExportTestData.COVER_URL));
        assertFalse("关闭图片后不应取插图",
                loader.requested().contains(NovelExportTestData.IMAGE_URL));
    }

    @Test
    public void encode_inlineImageDownloadFailure_isSkippedAndSucceeds() throws Exception {
        NovelExportTestData.FakeImageLoader empty =
                new NovelExportTestData.FakeImageLoader(context);
        FakePdfBackend backend = new FakePdfBackend();
        File f = NovelPdfEncoder.encode(context, empty,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_pdf_skip", backend);

        assertTrue(f.exists());
        byte[] bytes = Files.readAllBytes(f.toPath());
        assertTrue(new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-"));
    }
}
