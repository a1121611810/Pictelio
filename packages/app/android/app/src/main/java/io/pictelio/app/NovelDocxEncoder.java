package io.pictelio.app;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * DOCX 编码器（T7；spec docs/specs/novel-export.md §5）。
 *
 * <p>把 {@link NovelExportModel} 编码为真 OOXML（WordprocessingML）zip（非 HTML 伪装 .doc）：
 * <ul>
 *   <li>必需部件 {@code [Content_Types].xml}、{@code _rels/.rels}、{@code word/document.xml}、
 *       {@code word/styles.xml}、{@code word/_rels/document.xml.rels}、{@code word/media/*}；</li>
 *   <li>A4（{@code w:pgSz w:w="11906" w:h="16838"}）+ 16mm 边距（{@code w:pgMar} 907 twips）；</li>
 *   <li>行内样式 → {@code w:b/w:i/w:strike/w:u}；章节 → 加大 {@code w:sz} 的加粗标题段；
 *       分页 → {@code w:br w:type="page"}；图片/封面 → 内联 {@code w:drawing} + media 关系；</li>
 *   <li>CJK 用字体名（{@code w:rFonts w:eastAsia="Microsoft YaHei"}）不嵌入字体。</li>
 * </ul>
 *
 * <p>取图经 {@link PixivImageLoader} 缓存优先（字节零进 JS 堆）；单张失败 {@code Log.w} 跳过。
 */
public final class NovelDocxEncoder {

    private static final String TAG = "NovelDocxEncoder";
    private static final String W_NS =
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static final String R_NS =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static final String WP_NS =
            "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private static final String A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static final String PIC_NS =
            "http://schemas.openxmlformats.org/drawingml/2006/picture";
    /** 正文内容宽度（A4 宽 11906 - 左右各 907 twips = 10092 twips；1 twip = 635 EMU） */
    private static final long CONTENT_WIDTH_EMU = 10092L * 635L;
    private static final int DOCPR_START = 1;

    private NovelDocxEncoder() {}

    /** 编码为 {@code <outputDir>/<id>.docx} 并返回该文件。 */
    public static File encode(Context context, PixivImageLoader loader, NovelExportModel model,
            String id) throws IOException {
        return encode(context, loader, model, id, () -> false);
    }

    /** 可取消版本：编码前与每次取图前轮询取消信号，命中抛 {@link NovelExportCancelledException}。 */
    static File encode(Context context, PixivImageLoader loader, NovelExportModel model,
            String id, BooleanSupplier cancelled) throws IOException {
        if (cancelled.getAsBoolean()) {
            throw new NovelExportCancelledException();
        }
        File dir = NovelExporter.outputDir(context);
        File out = new File(dir, id + ".docx");

        List<Media> media = new ArrayList<>();
        int[] counters = {1, 2, DOCPR_START}; // [mediaIndex, relId, docPrId]
        StringBuilder body = new StringBuilder();

        // ① 封面（可选）：内联图片段
        if (model.options.includeCover && model.meta.coverUrl != null) {
            byte[] cover = loadImage(loader, model.meta.coverUrl, cancelled);
            if (cover != null) {
                Media m = newMedia(cover, model.meta.coverUrl, media, counters);
                appendPicture(body, m, media.size());
            }
        }

        // ② 标题段（恒含，作为文档标题）
        appendHeading(body, model.meta.title, "Title");

        // ③ 元数据段（仅在开关打开时）
        if (model.options.includeMetadata) {
            appendParagraph(body, "作者：" + model.meta.authorName);
            if (!model.meta.tags.isEmpty()) {
                appendParagraph(body, "标签：" + String.join("、", model.meta.tags));
            }
            if (model.meta.seriesTitle != null) {
                appendParagraph(body, "系列：" + model.meta.seriesTitle);
            }
            appendParagraph(body, "发布：" + model.meta.createDate);
            appendParagraph(body, "原文：" + model.meta.sourceUrl);
            if (model.meta.description != null && !model.meta.description.isEmpty()) {
                appendParagraph(body, "简介：" + model.meta.description);
            }
        }

        // ④ 正文块
        for (NovelExportModel.Block b : model.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                appendRunsParagraph(body, t.text, t.inlineRuns);
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                appendHeading(body, ((NovelExportModel.ChapterBlock) b).title, "Heading1");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                body.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (model.options.includeInlineImages) {
                    NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                    byte[] bytes = loadImage(loader, img.url, cancelled);
                    if (bytes != null) {
                        Media m = newMedia(bytes, img.url, media, counters);
                        appendPicture(body, m, media.size());
                    }
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                appendParagraph(body, "[" + j.kind + ":" + j.target + "] " + j.url);
            }
        }

        // ⑤ 组装 document.xml / rels / styles / content types
        String documentXml = buildDocument(body.toString());
        String documentRels = buildDocumentRels(media);
        String contentTypes = buildContentTypes(media);

        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(out))) {
            put(zip, "[Content_Types].xml", contentTypes);
            put(zip, "_rels/.rels", rootRels());
            put(zip, "word/document.xml", documentXml);
            put(zip, "word/styles.xml", stylesXml());
            put(zip, "word/_rels/document.xml.rels", documentRels);
            for (Media m : media) {
                put(zip, "word/media/" + m.name, m.bytes);
            }
        }
        return out;
    }

    // ── 图片媒体 / 关系 ──────────────────────────────────────

    private static final class Media {
        final String name;
        final byte[] bytes;
        final String relId;
        final int width;
        final int height;

        Media(String name, byte[] bytes, String relId, int width, int height) {
            this.name = name;
            this.bytes = bytes;
            this.relId = relId;
            this.width = width;
            this.height = height;
        }
    }

    private static Media newMedia(byte[] bytes, String url, List<Media> media, int[] counters) {
        String name = "image" + counters[0]++ + "." + ext(url);
        String relId = "rId" + counters[1]++;
        int[] size = imageSize(bytes);
        Media m = new Media(name, bytes, relId, size[0], size[1]);
        media.add(m);
        return m;
    }

    /** 图片像素尺寸；解码失败/无 bounds → 回退 600×400（仅为绘图比例，不影响可打开性）。 */
    private static int[] imageSize(byte[] bytes) {
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (opts.outWidth > 0 && opts.outHeight > 0) {
                return new int[]{opts.outWidth, opts.outHeight};
            }
        } catch (Throwable e) {
            // 测试/异常环境下解码不可用：退回默认比例（降级可见，硬约束 #3）
            Log.w(TAG, "图片尺寸解码失败，回退 600x400", e);
        }
        return new int[]{600, 400};
    }

    private static void appendPicture(StringBuilder body, Media m, int docPrId) {
        long cx = CONTENT_WIDTH_EMU;
        long cy = CONTENT_WIDTH_EMU * m.height / m.width;
        body.append("<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:drawing>");
        body.append("<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">");
        body.append("<wp:extent cx=\"").append(cx).append("\" cy=\"").append(cy).append("\"/>");
        body.append("<wp:docPr id=\"").append(docPrId).append("\" name=\"")
                .append(escapeXml(m.name)).append("\"/>");
        body.append("<a:graphic><a:graphicData uri=\"")
                .append(PIC_NS).append("\">");
        body.append("<pic:pic><pic:nvPicPr><pic:cNvPr id=\"").append(docPrId)
                .append("\" name=\"").append(escapeXml(m.name)).append("\"/>")
                .append("<pic:cNvPicPr/></pic:nvPicPr>");
        body.append("<pic:blipFill><a:blip r:embed=\"").append(m.relId)
                .append("\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>");
        body.append("<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"").append(cx)
                .append("\" cy=\"").append(cy).append("\"/></a:xfrm>")
                .append("<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr>");
        body.append("</pic:pic></a:graphicData></a:graphic>");
        body.append("</wp:inline></w:drawing></w:r></w:p>\n");
    }

    // ── 段落 / 行内 run ──────────────────────────────────────

    private static void appendHeading(StringBuilder body, String text, String styleId) {
        body.append("<w:p><w:pPr><w:pStyle w:val=\"").append(styleId)
                .append("\"/></w:pPr><w:r><w:rPr>")
                .append("<w:rFonts w:eastAsia=\"Microsoft YaHei\"/><w:b/>")
                .append("<w:sz w:val=\"").append("Title".equals(styleId) ? "48" : "36")
                .append("\"/><w:szCs w:val=\"").append("Title".equals(styleId) ? "48" : "36")
                .append("\"/></w:rPr><w:t xml:space=\"preserve\">")
                .append(escapeXml(text)).append("</w:t></w:r></w:p>\n");
    }

    private static void appendParagraph(StringBuilder body, String text) {
        appendRunsParagraph(body, text, null);
    }

    /** 文本段：按重叠 run 的样式并集切分为连续片段，每段一个 w:r。 */
    private static void appendRunsParagraph(StringBuilder body, String text,
            List<NovelExportModel.InlineRun> runs) {
        body.append("<w:p>");
        int len = text.length();
        if (len > 0) {
            boolean[][] flags = styleFlags(text, runs);
            int segStart = 0;
            for (int pos = 1; pos <= len; pos++) {
                if (pos == len || !sameFlags(flags, segStart, pos)) {
                    appendRun(body, text.substring(segStart, pos), flags[segStart]);
                    segStart = pos;
                }
            }
        }
        body.append("</w:p>\n");
    }

    private static void appendRun(StringBuilder body, String text, boolean[] flags) {
        body.append("<w:r><w:rPr><w:rFonts w:eastAsia=\"Microsoft YaHei\"/>");
        if (flags[0]) {
            body.append("<w:b/>");
        }
        if (flags[1]) {
            body.append("<w:i/>");
        }
        if (flags[2]) {
            body.append("<w:strike/>");
        }
        if (flags[3]) {
            body.append("<w:u w:val=\"single\"/>");
        }
        body.append("</w:rPr><w:t xml:space=\"preserve\">").append(escapeXml(text))
                .append("</w:t></w:r>");
    }

    /** 每个字符的 [bold, italic, strike, underline] 并集（越界/重叠安全）。 */
    private static boolean[][] styleFlags(String text, List<NovelExportModel.InlineRun> runs) {
        int len = text.length();
        boolean[][] flags = new boolean[len][4];
        if (runs == null) {
            return flags;
        }
        for (NovelExportModel.InlineRun r : runs) {
            int from = Math.max(0, r.start);
            int to = Math.min(len, r.end);
            int slot = slotOf(r.tag);
            if (slot < 0) {
                continue;
            }
            for (int p = from; p < to; p++) {
                flags[p][slot] = true;
            }
        }
        return flags;
    }

    private static int slotOf(String tag) {
        switch (tag) {
            case "bold":
                return 0;
            case "italic":
                return 1;
            case "strike":
                return 2;
            case "underline":
                return 3;
            default:
                return -1;
        }
    }

    private static boolean sameFlags(boolean[][] flags, int a, int b) {
        for (int i = 0; i < 4; i++) {
            if (flags[a][i] != flags[b][i]) {
                return false;
            }
        }
        return true;
    }

    // ── 部件 XML ─────────────────────────────────────────────

    private static String buildDocument(String body) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<w:document xmlns:w=\"" + W_NS + "\" xmlns:r=\"" + R_NS + "\" xmlns:wp=\""
                + WP_NS + "\" xmlns:a=\"" + A_NS + "\" xmlns:pic=\"" + PIC_NS + "\"><w:body>\n"
                + body
                + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
                + "<w:pgMar w:top=\"907\" w:right=\"907\" w:bottom=\"907\" w:left=\"907\" "
                + "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>\n"
                + "</w:body></w:document>\n";
    }

    private static String buildDocumentRels(List<Media> media) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
        sb.append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n");
        sb.append("<Relationship Id=\"rId1\" Type=\"")
                .append(R_NS).append("/styles\" Target=\"styles.xml\"/>\n");
        for (Media m : media) {
            sb.append("<Relationship Id=\"").append(m.relId).append("\" Type=\"")
                    .append(R_NS).append("/image\" Target=\"media/")
                    .append(escapeXml(m.name)).append("\"/>\n");
        }
        sb.append("</Relationships>\n");
        return sb.toString();
    }

    private static String buildContentTypes(List<Media> media) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
        sb.append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n");
        sb.append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n");
        sb.append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>\n");
        // 图片默认扩展：按实际用到的扩展补充
        boolean png = false;
        boolean jpg = false;
        boolean gif = false;
        boolean webp = false;
        for (Media m : media) {
            switch (ext(m.name)) {
                case "png":
                    png = true;
                    break;
                case "gif":
                    gif = true;
                    break;
                case "webp":
                    webp = true;
                    break;
                default:
                    jpg = true;
                    break;
            }
        }
        if (png) {
            sb.append("<Default Extension=\"png\" ContentType=\"image/png\"/>\n");
        }
        if (jpg) {
            sb.append("<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>\n");
            sb.append("<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>\n");
        }
        if (gif) {
            sb.append("<Default Extension=\"gif\" ContentType=\"image/gif\"/>\n");
        }
        if (webp) {
            sb.append("<Default Extension=\"webp\" ContentType=\"image/webp\"/>\n");
        }
        sb.append("<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\n");
        sb.append("<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\n");
        sb.append("</Types>\n");
        return sb.toString();
    }

    private static String rootRels() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n"
                + "<Relationship Id=\"rId1\" Type=\"" + R_NS
                + "/officeDocument\" Target=\"word/document.xml\"/>\n"
                + "</Relationships>\n";
    }

    private static String stylesXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<w:styles xmlns:w=\"" + W_NS + "\">\n"
                + "<w:docDefaults><w:rPrDefault><w:rPr>"
                + "<w:rFonts w:ascii=\"Microsoft YaHei\" w:hAnsi=\"Microsoft YaHei\" "
                + "w:eastAsia=\"Microsoft YaHei\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/>"
                + "</w:rPr></w:rPrDefault>"
                + "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"360\" "
                + "w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>\n"
                + "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\">"
                + "<w:name w:val=\"Normal\"/><w:rPr>"
                + "<w:rFonts w:eastAsia=\"Microsoft YaHei\"/></w:rPr></w:style>\n"
                + "<w:style w:type=\"paragraph\" w:styleId=\"Title\">"
                + "<w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/>"
                + "<w:pPr><w:jc w:val=\"center\"/><w:spacing w:before=\"120\" "
                + "w:after=\"240\"/></w:pPr>"
                + "<w:rPr><w:b/><w:sz w:val=\"48\"/><w:szCs w:val=\"48\"/></w:rPr></w:style>\n"
                + "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\">"
                + "<w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/>"
                + "<w:pPr><w:outlineLvl w:val=\"0\"/>"
                + "<w:spacing w:before=\"240\" w:after=\"120\"/></w:pPr>"
                + "<w:rPr><w:b/><w:sz w:val=\"36\"/><w:szCs w:val=\"36\"/></w:rPr></w:style>\n"
                + "</w:styles>\n";
    }

    // ── zip / 工具 ───────────────────────────────────────────

    private static void put(ZipOutputStream zip, String path, String content) throws IOException {
        put(zip, path, content.getBytes(StandardCharsets.UTF_8));
    }

    private static void put(ZipOutputStream zip, String path, byte[] bytes) throws IOException {
        ZipEntry entry = new ZipEntry(path);
        entry.setMethod(ZipEntry.DEFLATED);
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    /** 取图：先轮询取消（命中抛 {@link NovelExportCancelledException}，绝不降级为跳过）。 */
    private static byte[] loadImage(PixivImageLoader loader, String url, BooleanSupplier cancelled)
            throws NovelExportCancelledException {
        try {
            if (cancelled.getAsBoolean()) {
                throw new NovelExportCancelledException();
            }
            byte[] bytes = loader.loadBytes(url);
            if (bytes == null || bytes.length == 0) {
                Log.w(TAG, "图片为空，已跳过: " + url);
                return null;
            }
            return bytes;
        } catch (NovelExportCancelledException e) {
            throw e; // 取消是任务级硬中止，不得被下方 catch 吞掉
        } catch (Exception e) {
            Log.w(TAG, "图片下载失败，已跳过: " + url, e);
            return null;
        }
    }

    private static String ext(String url) {
        String path = url == null ? "" : url;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot < 0 || dot < slash || dot == path.length() - 1) {
            return "jpg";
        }
        String e = path.substring(dot + 1).toLowerCase(Locale.US);
        if ("jpeg".equals(e)) {
            return "jpg";
        }
        return e;
    }

    private static void appendXmlChar(StringBuilder out, char c) {
        switch (c) {
            case '&':
                out.append("&amp;");
                break;
            case '<':
                out.append("&lt;");
                break;
            case '>':
                out.append("&gt;");
                break;
            case '"':
                out.append("&quot;");
                break;
            case '\'':
                out.append("&apos;");
                break;
            default:
                out.append(c);
        }
    }

    private static String escapeXml(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            appendXmlChar(sb, s.charAt(i));
        }
        return sb.toString();
    }
}
