package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * T6 EPUB 编码器单测。
 *
 * <p><b>期望值来源（oracle）</b>：spec docs/specs/novel-export.md §5 epub 行 ——
 * {@code mimetype} 首个且 stored、{@code META-INF/container.xml}、{@code OEBPS/content.opf}、
 * {@code OEBPS/nav.xhtml}、{@code OEBPS/toc.ncx}、章节 XHTML well-formed、封面/插图内嵌。
 * 载荷与取图假件来自 {@link NovelExportTestData}（与 {@link NovelExporterTest} 同一现实样例）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NovelEpubEncoderTest {

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

    // ── zip 读取助手 ─────────────────────────────────────────

    private static Map<String, byte[]> readZip(File file) throws IOException {
        Map<String, byte[]> map = new LinkedHashMap<>();
        try (ZipFile zf = new ZipFile(file)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) {
                    continue;
                }
                try (InputStream in = zf.getInputStream(e)) {
                    map.put(e.getName(), readAll(in));
                }
            }
        }
        return map;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private static ZipEntry firstEntry(File file) throws IOException {
        try (ZipFile zf = new ZipFile(file)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            return en.hasMoreElements() ? en.nextElement() : null;
        }
    }

    private static String text(Map<String, byte[]> zip, String name) {
        byte[] bytes = zip.get(name);
        assertNotNull("缺少条目 " + name, bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static Document parseXml(byte[] bytes) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder()
                .parse(new InputSource(new ByteArrayInputStream(bytes)));
    }

    private String chapterName(Map<String, byte[]> zip) {
        for (String name : zip.keySet()) {
            if (name.startsWith("OEBPS/chapter-") && name.endsWith(".xhtml")) {
                return name;
            }
        }
        throw new AssertionError("缺少章节 XHTML：" + zip.keySet());
    }

    // ── 容器结构 ─────────────────────────────────────────────

    @Test
    public void epub_mimetypeIsFirstEntryAndStored() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_epub");

        assertEquals("novel_epub.epub", f.getName());

        ZipEntry first = firstEntry(f);
        assertNotNull(first);
        assertEquals("mimetype 必须是首条", "mimetype", first.getName());
        assertEquals("mimetype 必须 STORED（level 0）", ZipEntry.STORED, first.getMethod());
        assertEquals("application/epub+zip",
                new String(readZip(f).get("mimetype"), StandardCharsets.UTF_8));
    }

    @Test
    public void epub_requiredPartsAreWellFormedXml() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_epub_parts");
        Map<String, byte[]> zip = readZip(f);

        assertTrue("container.xml 缺失", zip.containsKey("META-INF/container.xml"));
        assertTrue("content.opf 缺失", zip.containsKey("OEBPS/content.opf"));
        assertTrue("nav.xhtml 缺失", zip.containsKey("OEBPS/nav.xhtml"));
        assertTrue("toc.ncx 缺失", zip.containsKey("OEBPS/toc.ncx"));

        Document container = parseXml(zip.get("META-INF/container.xml"));
        assertEquals("OEBPS/content.opf", container.getDocumentElement()
                .getElementsByTagNameNS("*", "rootfile").item(0).getAttributes()
                .getNamedItem("full-path").getNodeValue());

        Document opf = parseXml(zip.get("OEBPS/content.opf"));
        assertEquals("3.0", opf.getDocumentElement().getAttribute("version"));
        assertEquals(1, opf.getElementsByTagNameNS(
                "http://purl.org/dc/elements/1.1/", "title").getLength());
        assertEquals("夜行 & <测试>", opf.getElementsByTagNameNS(
                "http://purl.org/dc/elements/1.1/", "title").item(0).getTextContent());
        assertEquals("ltr", opf.getElementsByTagNameNS("*", "spine").item(0)
                .getAttributes().getNamedItem("page-progression-direction").getNodeValue());

        // chapter XHTML 必须 well-formed XML
        Document chapter = parseXml(zip.get(chapterName(zip)));
        assertEquals(1, chapter.getElementsByTagNameNS(
                "http://www.w3.org/1999/xhtml", "section").getLength());

        parseXml(zip.get("OEBPS/nav.xhtml"));
        parseXml(zip.get("OEBPS/toc.ncx"));
    }

    @Test
    public void epub_twoChapters_produceTwoXhtmlAndNavEntries() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildTwoChapterPayload()),
                "novel_epub_chapters");
        Map<String, byte[]> zip = readZip(f);

        int chapters = 0;
        for (String name : zip.keySet()) {
            if (name.startsWith("OEBPS/chapter-")) {
                chapters++;
            }
        }
        assertEquals(2, chapters);
        String nav = text(zip, "OEBPS/nav.xhtml");
        assertTrue(nav.contains("第一话"));
        assertTrue(nav.contains("第二话"));
    }

    // ── 图片与开关 ───────────────────────────────────────────

    @Test
    public void epub_embedsCoverAndInlineImages() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_epub_img");
        Map<String, byte[]> zip = readZip(f);

        assertTrue("封面图未内嵌", zip.containsKey("OEBPS/images/cover.jpg"));
        assertTrue("插图未内嵌", zip.containsKey("OEBPS/images/img-0.png"));
        assertTrue(zip.get("OEBPS/images/cover.jpg").length > 0);

        String opf = text(zip, "OEBPS/content.opf");
        assertTrue("cover-image 属性缺失", opf.contains("properties=\"cover-image\""));
        assertTrue("图片未声明 media-type",
                opf.contains("media-type=\"image/jpeg\"") && opf.contains("media-type=\"image/png\""));

        String chapter = text(zip, chapterName(zip));
        assertTrue("章节未引用插图", chapter.indexOf("<img") >= 0
                && chapter.contains("images/img-0.png"));
    }

    @Test
    public void epub_imagesOff_omitsImageEntriesAndCoverProperty() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, false, false)),
                "novel_epub_noimg");
        Map<String, byte[]> zip = readZip(f);

        for (String name : zip.keySet()) {
            assertFalse("不应有图片条目 " + name, name.startsWith("OEBPS/images/"));
        }
        String opf = text(zip, "OEBPS/content.opf");
        assertFalse(opf.contains("cover-image"));
        // 容器仍合法（dc:title 必填）
        assertTrue(opf.contains("<dc:title>"));
    }

    @Test
    public void epub_metadataOff_keepsMinimalRequiredMetadata() throws Exception {
        File f = NovelEpubEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(false, false, false)),
                "novel_epub_nometa");
        Map<String, byte[]> zip = readZip(f);
        String opf = text(zip, "OEBPS/content.opf");

        assertTrue("dc:title 必须保留", opf.contains("<dc:title>"));
        assertTrue("dc:identifier 必须保留", opf.contains("unique-identifier")
                && opf.contains("<dc:identifier"));
        assertFalse("关闭元数据后不应有作者", opf.contains("<dc:creator>"));
        assertFalse("关闭元数据后不应有标签", opf.contains("<dc:subject>"));
    }

    @Test
    public void epub_inlineImageDownloadFailure_isSkippedAndSucceeds() throws Exception {
        NovelExportTestData.FakeImageLoader empty =
                new NovelExportTestData.FakeImageLoader(context);
        File f = NovelEpubEncoder.encode(context, empty,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_epub_skip");

        Map<String, byte[]> zip = readZip(f);
        for (String name : zip.keySet()) {
            assertFalse("失败图片不应内嵌 " + name, name.startsWith("OEBPS/images/"));
        }
        // 行内 run 会在字符间插入标签，故解析 XML 后取 textContent 再断言
        Document chapter = parseXml(zip.get(chapterName(zip)));
        assertTrue("正文应保留",
                chapter.getDocumentElement().getTextContent().contains("普通段落"));
    }

    @Test
    public void epub_cancelled_throwsCancellationIOException() throws Exception {
        NovelExportModel model =
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true));
        IOException e = assertThrows(IOException.class,
                () -> NovelEpubEncoder.encode(context, loader, model, "novel_epub_cancel",
                        () -> true));
        assertEquals("导出已取消", e.getMessage());
        assertTrue("应为 NovelExportCancelledException",
                e instanceof NovelExportCancelledException);
    }
}
