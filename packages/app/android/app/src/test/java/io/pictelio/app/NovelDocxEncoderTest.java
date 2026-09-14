package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
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
 * T7 DOCX 编码器单测。
 *
 * <p><b>期望值来源（oracle）</b>：spec docs/specs/novel-export.md §5 docx 行 ——
 * {@code [Content_Types].xml}/{@code _rels/.rels}/{@code word/document.xml}/
 * {@code word/styles.xml}/{@code word/_rels/document.xml.rels}/{@code word/media/*}、
 * A4 页面与 16mm 边距、行内样式、CJK 字体名。载荷与取图假件来自 {@link NovelExportTestData}。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NovelDocxEncoderTest {

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

    // ── 部件与结构 ───────────────────────────────────────────

    @Test
    public void docx_requiredPartsPresentAndDocumentWellFormed() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_docx");
        assertEquals("novel_docx.docx", f.getName());
        Map<String, byte[]> zip = readZip(f);

        for (String name : new String[]{"[Content_Types].xml", "_rels/.rels",
                "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"}) {
            assertTrue("缺少部件 " + name, zip.containsKey(name));
        }

        Document doc = parseXml(zip.get("word/document.xml"));
        String bodyText = doc.getDocumentElement().getTextContent();
        assertTrue("文档标题缺失", bodyText.contains("夜行 & <测试>"));
        assertTrue("正文缺失", bodyText.contains("普通段落"));
        assertTrue("章节标题缺失", bodyText.contains("第一章 <起始>"));
    }

    @Test
    public void docx_hasA4PageSizeAndMargins() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_docx_page");
        String document = text(readZip(f), "word/document.xml");

        assertTrue("缺少 A4 页面尺寸", document.contains("w:pgSz w:w=\"11906\" w:h=\"16838\""));
        assertTrue("缺少页边距", document.contains("w:pgMar"));
        assertTrue("边距非 16mm（907 twips）", document.contains("w:left=\"907\""));
    }

    @Test
    public void docx_stylesUseEastAsiaFontAndBoldHeading() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_docx_styles");
        Map<String, byte[]> zip = readZip(f);
        String styles = text(zip, "word/styles.xml");

        assertTrue("缺少 CJK 字体名", styles.contains("w:eastAsia=\"Microsoft YaHei\""));
        assertTrue("缺少加粗标题样式", styles.contains("w:styleId=\"Heading1\""));

        String document = text(zip, "word/document.xml");
        assertTrue("章节标题未用 Heading1", document.contains("w:pStyle w:val=\"Heading1\""));
        assertTrue("行内 bold 未渲染", document.contains("<w:b/>"));
        assertTrue("行内 italic 未渲染", document.contains("<w:i/>"));
        assertTrue("分页符缺失", document.contains("w:br w:type=\"page\""));
    }

    // ── 媒体与开关 ───────────────────────────────────────────

    @Test
    public void docx_embedsMediaAndRelationshipsWhenOn() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_docx_media");
        Map<String, byte[]> zip = readZip(f);

        int media = 0;
        for (String name : zip.keySet()) {
            if (name.startsWith("word/media/")) {
                media++;
            }
        }
        assertEquals("封面 + 插图 = 2 个 media", 2, media);

        String types = text(zip, "[Content_Types].xml");
        assertTrue(types.contains("image/jpeg"));
        assertTrue(types.contains("image/png"));

        String rels = text(zip, "word/_rels/document.xml.rels");
        assertTrue("缺少 styles 关系", rels.contains("/styles"));
        assertTrue("缺少 image 关系", rels.contains("/image"));

        String document = text(zip, "word/document.xml");
        assertTrue("缺少内联 drawing", document.contains("<w:drawing>"));
        assertTrue("drawing 未引用关系", document.contains("<a:blip r:embed=\"rId"));
    }

    @Test
    public void docx_imagesOff_omitsMedia() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, false, false)),
                "novel_docx_noimg");
        Map<String, byte[]> zip = readZip(f);

        for (String name : zip.keySet()) {
            assertFalse("不应有 media " + name, name.startsWith("word/media/"));
        }
        String document = text(zip, "word/document.xml");
        assertFalse("关闭图片后不应有 drawing", document.contains("<w:drawing>"));
    }

    @Test
    public void docx_metadataOff_omitsAuthorLine() throws Exception {
        File f = NovelDocxEncoder.encode(context, loader,
                NovelExportModel.parse(NovelExportTestData.buildPayload(false, false, false)),
                "novel_docx_nometa");
        String document = text(readZip(f), "word/document.xml");

        assertTrue("文档标题应保留", document.contains("夜行"));
        assertFalse("关闭元数据后不应有作者行", document.contains("作者："));
    }

    @Test
    public void docx_inlineImageDownloadFailure_isSkippedAndSucceeds() throws Exception {
        NovelExportTestData.FakeImageLoader empty =
                new NovelExportTestData.FakeImageLoader(context);
        File f = NovelDocxEncoder.encode(context, empty,
                NovelExportModel.parse(NovelExportTestData.buildPayload(true, true, true)),
                "novel_docx_skip");
        Map<String, byte[]> zip = readZip(f);

        for (String name : zip.keySet()) {
            assertFalse("失败图片不应内嵌 " + name, name.startsWith("word/media/"));
        }
        Document doc = parseXml(zip.get("word/document.xml"));
        assertTrue("正文应保留", doc.getDocumentElement().getTextContent().contains("普通段落"));
    }
}
