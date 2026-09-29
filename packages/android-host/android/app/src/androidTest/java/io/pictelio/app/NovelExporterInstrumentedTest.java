package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 设备端（模拟器）原生编码器验证 —— code-review 遗留的「设备批次」缺口。
 *
 * <p>Robolectric 无法执行 {@code android.graphics.pdf.PdfDocument}（nativeCreateDocument 返回 0），
 * 本 instrumented 测试在真实 Android runtime 上调用 {@link NovelExporter}，验证：
 * txt/docx/epub/pdf 均能生成；PDF 以 {@code %PDF-} 开头且 {@link PdfRenderer} 能读出 >=2 页
 * （载荷含 pageBreak + 足够段落强制分页）；{@link GallerySaver#saveDownloadFile} 能把产物落到系统下载。
 *
 * <p>载荷 options 关闭封面/插图（{@code includeCover=false} / {@code includeInlineImages=false}），
 * 因此不依赖网络与图片下载。
 */
@RunWith(AndroidJUnit4.class)
public class NovelExporterInstrumentedTest {

    private Context context;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    /** 构造 spec §3.3 形态的载荷；段落足够多 + 一个 pageBreak 以强制 PDF 多页。 */
    private static String payload() throws Exception {
        JSONObject root = new JSONObject();
        root.put("schema", 1);
        JSONObject meta = new JSONObject();
        meta.put("id", 999999999);
        meta.put("title", "设备端导出验证");
        meta.put("authorId", 1);
        meta.put("authorName", "测试作者");
        meta.put("tags", new JSONArray().put("测试").put("CJK"));
        meta.put("createDate", "2025-01-01T00:00:00+00:00");
        meta.put("sourceUrl", "https://www.pixiv.net/novel/show.php?id=999999999");
        meta.put("description", "设备端 NovelExporter 验证");
        meta.put("xRestrict", 0);
        root.put("meta", meta);
        JSONObject options = new JSONObject();
        options.put("includeMetadata", true);
        options.put("includeCover", false);
        options.put("includeInlineImages", false);
        root.put("options", options);
        JSONArray blocks = new JSONArray();
        blocks.put(new JSONObject().put("type", "chapter").put("title", "第一章 起"));
        for (int i = 0; i < 80; i++) {
            blocks.put(new JSONObject().put("type", "text").put("index", i)
                    .put("text", "第 " + (i + 1) + " 段：设备端导出验证中文 CJK 与 English 混排，"
                            + "标点，。！？——数字 1234567890。"));
        }
        blocks.put(new JSONObject().put("type", "pageBreak"));
        blocks.put(new JSONObject().put("type", "text").put("index", 80).put("text", "分页后的最后一段。"));
        root.put("blocks", blocks);
        return root.toString();
    }

    private byte[] read(File f) throws Exception {
        return Files.readAllBytes(f.toPath());
    }

    private static boolean startsWith(byte[] b, byte[] prefix) {
        if (b.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) {
            if (b[i] != prefix[i]) return false;
        }
        return true;
    }

    @Test
    public void exportsAllFourFormatsAndPdfPaginatesOnDevice() throws Exception {
        PixivImageLoader loader = new PixivImageLoader(context);
        String payload = payload();

        // txt：UTF-8 BOM
        File txt = NovelExporter.export(context, loader, payload, "txt", "itest_txt");
        assertTrue("txt 文件不存在", txt.exists());
        byte[] txtBytes = read(txt);
        assertTrue("txt 应带 UTF-8 BOM", startsWith(txtBytes, new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF}));
        String txtText = new String(txtBytes, StandardCharsets.UTF_8);
        assertTrue("txt 应含标题", txtText.contains("设备端导出验证"));

        // docx：zip（PK）
        File docx = NovelExporter.export(context, loader, payload, "docx", "itest_docx");
        assertTrue("docx 文件不存在", docx.exists());
        assertTrue("docx 应为 zip", startsWith(read(docx), new byte[]{0x50, 0x4B, 0x03, 0x04}));

        // epub：zip
        File epub = NovelExporter.export(context, loader, payload, "epub", "itest_epub");
        assertTrue("epub 文件不存在", epub.exists());
        assertTrue("epub 应为 zip", startsWith(read(epub), new byte[]{0x50, 0x4B, 0x03, 0x04}));

        // pdf：真实 PdfDocument + PdfRenderer 页数
        File pdf = NovelExporter.export(context, loader, payload, "pdf", "itest_pdf");
        assertTrue("pdf 文件不存在", pdf.exists());
        assertTrue("pdf 文件过小", pdf.length() > 1000);
        assertTrue("pdf 应以 %PDF- 开头", startsWith(read(pdf), "%PDF-".getBytes(StandardCharsets.US_ASCII)));
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
                PdfRenderer renderer = new PdfRenderer(pfd)) {
            int pages = renderer.getPageCount();
            assertTrue("PDF 页数应 >=2（含 pageBreak + 80 段），实际 " + pages, pages >= 2);
        }

        // 落盘：GallerySaver.saveDownloadFile → 系统下载
        GallerySaver.SaveResult saved = GallerySaver.saveDownloadFile(context, epub, "Pictelio_itest.epub");
        assertNotNull("saveDownloadFile 应返回 uri", saved.uri);
        assertTrue("uri 非空", saved.uri.toString().length() > 0);
    }
}
