package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

import java.io.File;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;

import okhttp3.OkHttpClient;

/**
 * NovelExporter / NovelExportModel 单测（T5）。
 *
 * <p>期望值来源（oracle）：spec docs/specs/novel-export.md §3.3 payload schema 与 §5 格式能力矩阵；
 * 载荷字段名与共享包 {@code @pictelio/novel-export} 的 IR 逐字对齐（见 exportPayload.ts）。
 * 取图用测试假件注入（覆盖 {@link PixivImageLoader#loadBytes}），不触网络。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NovelExporterTest {

    private static final String COVER_URL = "https://i.pximg.net/c/1200x1200/img/cover.jpg";
    private static final String IMAGE_URL =
            "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/999_p0.png";

    private Context context;
    private FakeImageLoader loader;

    @Before
    public void setUp() {
        context = ApplicationProvider.getApplicationContext();
        loader = new FakeImageLoader(context);
        loader.put(COVER_URL, new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 1, 2, 3});
        loader.put(IMAGE_URL, new byte[]{(byte) 0x89, 'P', 'N', 'G', 4, 5, 6});
    }

    /** 测试假件：覆盖取图，按 URL 返回预置字节；缺失即抛（导出侧应跳过）。 */
    private static final class FakeImageLoader extends PixivImageLoader {
        private final Map<String, byte[]> store = new HashMap<>();

        FakeImageLoader(Context context) {
            super(context, new OkHttpClient.Builder().build(), 1 << 20);
        }

        void put(String url, byte[] bytes) {
            store.put(url, bytes);
        }

        @Override
        public byte[] loadBytes(String url) throws IOException {
            byte[] bytes = store.get(url);
            if (bytes == null) {
                throw new IOException("fake 未提供图片: " + url);
            }
            return bytes;
        }
    }

    // ── 载荷（字段名对齐 spec §3.3 / 共享包 IR） ──────────────

    private static String buildPayload(boolean metadata, boolean cover, boolean inlineImages)
            throws Exception {
        JSONObject root = new JSONObject();
        root.put("schema", 1);

        JSONObject meta = new JSONObject();
        meta.put("id", 123456);
        meta.put("title", "夜行 & <测试>");
        meta.put("authorId", 42);
        meta.put("authorName", "作者\"甲\"");
        meta.put("tags", new JSONArray().put("tag1").put("标签二"));
        meta.put("seriesId", 999);
        meta.put("seriesTitle", "系列 <一>");
        meta.put("createDate", "2024-01-02T03:04:05+09:00");
        meta.put("sourceUrl", "https://www.pixiv.net/novel/show.php?id=123456");
        meta.put("description", "简介 & <说明>");
        meta.put("xRestrict", 0);
        meta.put("coverUrl", COVER_URL);
        root.put("meta", meta);

        JSONObject options = new JSONObject();
        options.put("includeMetadata", metadata);
        options.put("includeCover", cover);
        options.put("includeInlineImages", inlineImages);
        root.put("options", options);

        JSONArray blocks = new JSONArray();
        blocks.put(new JSONObject().put("type", "chapter").put("title", "第一章 <起始>"));

        JSONObject para = new JSONObject();
        para.put("type", "text");
        para.put("index", 0);
        para.put("text", "普通段落 & <标记> \"引号\" '单引' 结束。");
        JSONArray runs = new JSONArray();
        runs.put(new JSONObject().put("start", 0).put("end", 2).put("tag", "bold"));
        runs.put(new JSONObject().put("start", 3).put("end", 5).put("tag", "italic"));
        para.put("inlineRuns", runs);
        blocks.put(para);

        // ruby：共享包 parseInlineRuns 把 [ruby:漢字:かんじ] 还原为主文本「漢字」+ 剥离注音
        JSONObject ruby = new JSONObject();
        ruby.put("type", "text");
        ruby.put("index", 1);
        ruby.put("text", "漢字です");
        blocks.put(ruby);

        blocks.put(new JSONObject().put("type", "pageBreak"));

        blocks.put(new JSONObject().put("type", "image").put("imageId", "img-1").put("url",
                IMAGE_URL));

        blocks.put(new JSONObject().put("type", "jump").put("kind", "illust").put("target", "123")
                .put("url", "https://www.pixiv.net/artworks/123"));
        root.put("blocks", blocks);

        return root.toString();
    }

    private static String read(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private static Document parseXml(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
    }

    // ── txt ───────────────────────────────────────────────────

    @Test
    public void export_txt_hasBomAndContent() throws Exception {
        File f = NovelExporter.export(context, loader, buildPayload(true, true, true), "txt",
                "novel_txt");
        assertEquals("novel_txt.txt", f.getName());

        byte[] bytes = Files.readAllBytes(f.toPath());
        assertEquals((byte) 0xEF, bytes[0]);
        assertEquals((byte) 0xBB, bytes[1]);
        assertEquals((byte) 0xBF, bytes[2]);

        String text = new String(bytes, StandardCharsets.UTF_8);
        assertTrue("元数据标题缺失", text.contains("夜行 & <测试>"));
        assertTrue("章节标题缺失", text.contains("第一章 <起始>"));
        assertTrue("正文缺失", text.contains("普通段落"));
        assertTrue("图片 URL 行缺失", text.contains(IMAGE_URL));
        assertTrue("跳转链接缺失", text.contains("https://www.pixiv.net/artworks/123"));
    }

    // ── html ──────────────────────────────────────────────────

    @Test
    public void export_html_escapesAndRendersStyles() throws Exception {
        File f = NovelExporter.export(context, loader, buildPayload(true, true, true), "html",
                "novel_html");
        String html = read(f);

        assertTrue(html.contains("<!doctype html>"));
        assertTrue(html.contains("charset=\"utf-8\""));
        assertTrue("& 未转义", html.contains("&amp;"));
        assertTrue("< 未转义", html.contains("&lt;标记&gt;"));
        assertTrue("加粗 run 未渲染", html.contains("<strong>"));
        assertTrue("章节未渲染为 h2", html.contains("<h2>"));
        assertTrue("内嵌图片缺失", html.contains("data:image/png;base64,"));
        assertTrue("封面未内嵌", html.contains("data:image/jpeg;base64,"));
        assertTrue("跳转未渲染为链接", html.contains("<a href=\"https://www.pixiv.net/artworks/123\">"));
    }

    // ── md ────────────────────────────────────────────────────

    @Test
    public void export_md_hasHeadingAndBold() throws Exception {
        File f = NovelExporter.export(context, loader, buildPayload(true, true, true), "md",
                "novel_md");
        String md = read(f);

        assertTrue(md.contains("## 第一章"));
        assertTrue("加粗 run 未渲染", md.contains("**"));
        assertTrue("图片链接缺失", md.contains("!["));
        assertTrue("front matter 缺失", md.startsWith("---\n"));
    }

    // ── rtf ───────────────────────────────────────────────────

    @Test
    public void export_rtf_startsWithHeaderAndEscapesCjk() throws Exception {
        File f = NovelExporter.export(context, loader, buildPayload(true, true, true), "rtf",
                "novel_rtf");
        String rtf = read(f);

        assertTrue("RTF 头缺失: " + rtf.substring(0, Math.min(20, rtf.length())),
                rtf.startsWith("{\\rtf1"));
        assertTrue("CJK 未转义", rtf.contains("\\u"));
        assertTrue(rtf.endsWith("}"));
    }

    // ── json ──────────────────────────────────────────────────

    @Test
    public void export_json_roundTripsPayload() throws Exception {
        String payload = buildPayload(true, true, true);
        File f = NovelExporter.export(context, loader, payload, "json", "novel_json");
        String json = read(f);

        JSONObject original = new JSONObject(payload);
        JSONObject round = new JSONObject(json);
        assertEquals(original.getInt("schema"), round.getInt("schema"));
        assertEquals(original.getJSONObject("meta").getString("title"),
                round.getJSONObject("meta").getString("title"));
        assertEquals(original.getJSONObject("meta").getJSONArray("tags").length(),
                round.getJSONObject("meta").getJSONArray("tags").length());
        assertEquals(original.getJSONArray("blocks").length(),
                round.getJSONArray("blocks").length());
        assertTrue("json 未 pretty 输出", json.contains("\n"));
    }

    // ── fb2 ───────────────────────────────────────────────────

    @Test
    public void export_fb2_parsesAsXmlAndEmbedsBinary() throws Exception {
        File f = NovelExporter.export(context, loader, buildPayload(true, true, true), "fb2",
                "novel_fb2");
        Document doc = parseXml(read(f));

        assertEquals("FictionBook", doc.getDocumentElement().getTagName());
        // 封面 + 正文插图 = 2 个 <binary>
        assertEquals(2, doc.getElementsByTagName("binary").getLength());
        assertTrue("标题缺失", read(f).contains("夜行 &amp; &lt;测试&gt;"));
    }

    @Test
    public void export_imagesOff_omitsBinaryAndDataUri() throws Exception {
        String payload = buildPayload(true, false, false);

        String html = read(NovelExporter.export(context, loader, payload, "html", "img_off_html"));
        assertFalse("html 不应内嵌图片", html.contains("data:image"));

        String md = read(NovelExporter.export(context, loader, payload, "md", "img_off_md"));
        assertFalse("md 不应有图片链接", md.contains("!["));

        Document doc = parseXml(read(NovelExporter.export(context, loader, payload, "fb2", "img_off_fb2")));
        assertEquals("fb2 不应有 binary", 0, doc.getElementsByTagName("binary").getLength());
    }

    // ── 降级与失败路径（测试硬约束 #1/#3） ─────────────────────

    @Test
    public void export_inlineImageDownloadFailure_isSkippedAndSucceeds() throws Exception {
        FakeImageLoader empty = new FakeImageLoader(context); // 未预置任何图片 → 取图全失败
        File f = NovelExporter.export(context, empty, buildPayload(true, true, true), "html",
                "skip_img");
        String html = read(f);

        assertTrue("正文应保留", html.contains("&amp; &lt;标记&gt;"));
        assertFalse("失败图片不应内嵌", html.contains("data:image"));
    }

    @Test
    public void export_unknownOrEmptyFormat_throwsReadable() throws Exception {
        String payload = buildPayload(true, true, true);
        IOException unknown = assertThrows(IOException.class,
                () -> NovelExporter.export(context, loader, payload, "doc", "x"));
        assertTrue(unknown.getMessage().contains("不支持的导出格式"));

        IOException empty = assertThrows(IOException.class,
                () -> NovelExporter.export(context, loader, payload, "", "x"));
        assertTrue(empty.getMessage().contains("不支持的导出格式"));
    }

    @Test
    public void export_binaryFormats_produceRealFiles() throws Exception {
        String payload = buildPayload(true, true, true);
        for (String format : new String[]{"epub", "docx"}) {
            File f = NovelExporter.export(context, loader, payload, format, "real_" + format);
            assertEquals("real_" + format + "." + format, f.getName());
            assertTrue(format + " 产物为空", f.length() > 0);
        }
        // pdf 经 NovelExporter 派发到生产 PdfDocument 后端；该 API 依赖 native 实现，
        // Robolectric（实测 SDK 28/34 + @GraphicsMode(NATIVE)）下 nativeCreateDocument()
        // 返回 0，任何 startPage 抛 IllegalStateException，JVM 单测无法跑通。PDF 编码逻辑
        // 改由 NovelPdfEncoderTest 经注入后端 + 纯分页器验证（见该测试类头注释）。
    }

    @Test
    public void parse_invalidPayload_throwsReadable() throws Exception {
        IOException missingMeta = assertThrows(IOException.class,
                () -> NovelExportModel.parse("{\"schema\":1,\"options\":{},\"blocks\":[]}"));
        assertTrue(missingMeta.getMessage().contains("meta"));

        assertThrows(IOException.class, () -> NovelExportModel.parse("not json"));
        assertThrows(IOException.class, () -> NovelExportModel.parse(""));

        IOException badSchema = assertThrows(IOException.class,
                () -> NovelExportModel.parse("{\"schema\":2,\"meta\":{},\"options\":{},\"blocks\":[]}"));
        assertTrue(badSchema.getMessage().contains("schema"));

        IOException badBlock = assertThrows(IOException.class,
                () -> NovelExportModel.parse(buildPayload(true, true, true)
                        .replace("\"chapter\"", "\"unknownBlock\"")));
        assertTrue(badBlock.getMessage().contains("未知块类型"));
    }

    @Test
    public void parse_validPayload_exposesModelFields() throws Exception {
        NovelExportModel model = NovelExportModel.parse(buildPayload(true, true, true));
        assertEquals(1, model.schema);
        assertEquals(123456L, model.meta.id);
        assertEquals("夜行 & <测试>", model.meta.title);
        assertEquals(2, model.meta.tags.size());
        assertEquals(6, model.blocks.size());
        assertTrue(model.options.includeMetadata);
        assertTrue(model.blocks.get(0) instanceof NovelExportModel.ChapterBlock);
        NovelExportModel.TextBlock para = (NovelExportModel.TextBlock) model.blocks.get(1);
        assertEquals(2, para.inlineRuns.size());
        assertEquals("bold", para.inlineRuns.get(0).tag);
    }
}
