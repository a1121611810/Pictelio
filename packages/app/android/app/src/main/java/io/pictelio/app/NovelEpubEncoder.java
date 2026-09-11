package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * EPUB 编码器（T6；spec docs/specs/novel-export.md §5）。
 *
 * <p>把 {@link NovelExportModel} 编码为 EPUB 3 OCF 容器（zip）：
 * <ul>
 *   <li>{@code mimetype} 恒为首条且 {@link ZipEntry#STORED}（level 0），内容恰为
 *       {@code application/epub+zip}（EPUB 规范硬要求）；</li>
 *   <li>{@code META-INF/container.xml} → rootfile {@code OEBPS/content.opf}；</li>
 *   <li>{@code OEBPS/content.opf}（version 3.0、unique-identifier、dc:* 元数据、
 *       manifest + spine、{@code page-progression-direction="ltr"}）；</li>
 *   <li>{@code OEBPS/nav.xhtml}（EPUB3 导航）+ {@code OEBPS/toc.ncx}（EPUB2 回退）；</li>
 *   <li>按 {@link NovelExportModel.ChapterBlock} 把流切成章节 XHTML（无章节则单章）；
 *       行内样式 → strong/em/s/u，分页符 → hr，插图 → img + {@code OEBPS/images/*}。</li>
 * </ul>
 *
 * <p>取图经 {@link PixivImageLoader} 缓存优先（字节零进 JS 堆）；单张图片失败
 * {@code Log.w} 并跳过（导出仍成功），元数据/正文结构性失败抛可读 {@link IOException}。
 */
public final class NovelEpubEncoder {

    private static final String TAG = "NovelEpubEncoder";
    private static final String MIMETYPE = "application/epub+zip";
    private static final String OEBPS = "OEBPS/";
    private static final DateTimeFormatter MODIFIED_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'").withZone(ZoneOffset.UTC);

    private NovelEpubEncoder() {}

    /** 编码为 {@code <outputDir>/<id>.epub} 并返回该文件。 */
    public static File encode(Context context, PixivImageLoader loader, NovelExportModel model,
            String id) throws IOException {
        File dir = NovelExporter.outputDir(context);
        File out = new File(dir, id + ".epub");

        // ① 资源清单：先取字节并分配稳定文件名。key = zip 内路径，value = 字节。
        Map<String, String> imageHrefByUrl = new HashMap<>();
        Map<String, byte[]> imageBytesByPath = new LinkedHashMap<>();
        String coverHref = null;
        if (model.options.includeCover && model.meta.coverUrl != null) {
            byte[] cover = loadImage(loader, model.meta.coverUrl);
            if (cover != null) {
                String name = "cover." + ext(model.meta.coverUrl);
                imageBytesByPath.put(OEBPS + "images/" + name, cover);
                coverHref = "images/" + name;
                imageHrefByUrl.put(model.meta.coverUrl, coverHref);
            }
        }
        int imageIndex = 0;
        if (model.options.includeInlineImages) {
            for (NovelExportModel.Block b : model.blocks) {
                if (!(b instanceof NovelExportModel.ImageBlock)) {
                    continue;
                }
                NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                if (imageHrefByUrl.containsKey(img.url)) {
                    continue;
                }
                byte[] bytes = loadImage(loader, img.url);
                if (bytes == null) {
                    continue; // loadImage 内已 Log.w，跳过该图但导出继续
                }
                String href = "images/img-" + (imageIndex++) + "." + ext(img.url);
                imageHrefByUrl.put(img.url, href);
                imageBytesByPath.put(OEBPS + href, bytes);
            }
        }

        // ② 分章（无 ChapterBlock 时单章）
        List<Chapter> chapters = splitChapters(model);
        List<String> chapterHrefs = new ArrayList<>();
        for (int i = 0; i < chapters.size(); i++) {
            chapterHrefs.add("chapter-" + (i + 1) + ".xhtml");
        }
        List<String> chapterXhtml = new ArrayList<>();
        for (int i = 0; i < chapters.size(); i++) {
            chapterXhtml.add(renderChapter(chapters.get(i), imageHrefByUrl));
        }

        String pubId = "urn:pictelio:novel:" + model.meta.id;
        String opf = buildOpf(model, pubId, chapters, chapterHrefs, coverHref, imageBytesByPath);
        String nav = buildNav(chapters, chapterHrefs);
        String ncx = buildNcx(model, pubId, chapters, chapterHrefs);

        // ③ 写 zip：mimetype 必须首条且 stored
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(out))) {
            zip.setLevel(Deflater.DEFAULT_COMPRESSION);
            writeMimetype(zip);
            put(zip, "META-INF/container.xml", containerXml());
            put(zip, OEBPS + "content.opf", opf);
            put(zip, OEBPS + "nav.xhtml", nav);
            put(zip, OEBPS + "toc.ncx", ncx);
            put(zip, OEBPS + "style.css", STYLE_CSS);
            if (coverHref != null) {
                put(zip, OEBPS + "cover.xhtml", coverXhtml(coverHref, model.meta.title));
            }
            for (int i = 0; i < chapterHrefs.size(); i++) {
                put(zip, OEBPS + chapterHrefs.get(i), chapterXhtml.get(i));
            }
            for (Map.Entry<String, byte[]> e : imageBytesByPath.entrySet()) {
                put(zip, e.getKey(), e.getValue());
            }
        }
        return out;
    }

    // ── 分章 ─────────────────────────────────────────────────

    /** 章节：标题 + 归属块。 */
    private static final class Chapter {
        final String title;
        final List<NovelExportModel.Block> blocks;

        Chapter(String title, List<NovelExportModel.Block> blocks) {
            this.title = title;
            this.blocks = blocks;
        }
    }

    /** 以 ChapterBlock 为界切分块流；章前内容归入以书名命名的前导章；无章节则单章。 */
    private static List<Chapter> splitChapters(NovelExportModel model) {
        List<Chapter> chapters = new ArrayList<>();
        List<NovelExportModel.Block> current = new ArrayList<>();
        String currentTitle = null;
        for (NovelExportModel.Block b : model.blocks) {
            if (b instanceof NovelExportModel.ChapterBlock) {
                if (!current.isEmpty()) {
                    chapters.add(new Chapter(
                            currentTitle == null ? model.meta.title : currentTitle, current));
                    current = new ArrayList<>();
                }
                currentTitle = ((NovelExportModel.ChapterBlock) b).title;
            } else {
                current.add(b);
            }
        }
        if (!current.isEmpty() || chapters.isEmpty()) {
            chapters.add(new Chapter(currentTitle == null ? model.meta.title : currentTitle,
                    current));
        }
        return chapters;
    }

    // ── XHTML 章节 ───────────────────────────────────────────

    private static String renderChapter(Chapter chapter, Map<String, String> imageHrefByUrl) {
        StringBuilder body = new StringBuilder();
        for (NovelExportModel.Block b : chapter.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                body.append("<p>").append(renderInline(t.text, t.inlineRuns)).append("</p>\n");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                body.append("<hr/>\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                String href = imageHrefByUrl.get(img.url);
                if (href != null) {
                    body.append("<div class=\"image\"><img src=\"").append(escapeXml(href))
                            .append("\" alt=\"").append(escapeXml(img.imageId))
                            .append("\"/></div>\n");
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                body.append("<p><a href=\"").append(escapeXml(j.url)).append("\">")
                        .append(escapeXml("[" + j.kind + ":" + j.target + "]"))
                        .append("</a></p>\n");
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" ")
                .append("xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh\" lang=\"zh\">\n");
        sb.append("<head>\n<meta charset=\"utf-8\"/>\n<title>")
                .append(escapeXml(chapter.title))
                .append("</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/>\n")
                .append("</head>\n<body>\n<section epub:type=\"chapter\">\n");
        if (chapter.title != null && !chapter.title.isEmpty()) {
            sb.append("<h1>").append(escapeXml(chapter.title)).append("</h1>\n");
        }
        sb.append(body);
        sb.append("</section>\n</body>\n</html>\n");
        return sb.toString();
    }

    private static String coverXhtml(String coverHref, String title) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" ")
                .append("xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh\" lang=\"zh\">\n");
        sb.append("<head>\n<meta charset=\"utf-8\"/>\n<title>")
                .append(escapeXml(title))
                .append("</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/>\n")
                .append("</head>\n<body>\n<section epub:type=\"cover\">\n");
        sb.append("<img class=\"cover\" src=\"").append(escapeXml(coverHref))
                .append("\" alt=\"").append(escapeXml(title)).append("\"/>\n");
        sb.append("</section>\n</body>\n</html>\n");
        return sb.toString();
    }

    // ── OPF / nav / ncx ──────────────────────────────────────

    private static String buildOpf(NovelExportModel model, String pubId, List<Chapter> chapters,
            List<String> chapterHrefs, String coverHref, Map<String, byte[]> imageBytesByPath) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" ")
                .append("unique-identifier=\"pub-id\" xml:lang=\"zh\">\n");

        sb.append("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
        sb.append("<dc:identifier id=\"pub-id\">").append(escapeXml(pubId))
                .append("</dc:identifier>\n");
        sb.append("<dc:title>").append(escapeXml(model.meta.title)).append("</dc:title>\n");
        sb.append("<dc:language>zh</dc:language>\n");
        if (model.options.includeMetadata) {
            sb.append("<dc:creator>").append(escapeXml(model.meta.authorName))
                    .append("</dc:creator>\n");
            sb.append("<dc:date>").append(escapeXml(model.meta.createDate)).append("</dc:date>\n");
            sb.append("<dc:source>").append(escapeXml(model.meta.sourceUrl))
                    .append("</dc:source>\n");
            if (model.meta.description != null && !model.meta.description.isEmpty()) {
                sb.append("<dc:description>").append(escapeXml(model.meta.description))
                        .append("</dc:description>\n");
            }
            for (String tag : model.meta.tags) {
                sb.append("<dc:subject>").append(escapeXml(tag)).append("</dc:subject>\n");
            }
            if (model.meta.seriesTitle != null) {
                sb.append("<meta property=\"belongs-to-collection\">")
                        .append(escapeXml(model.meta.seriesTitle))
                        .append("</meta>\n");
            }
        }
        // dcterms:modified 是 EPUB3 包的必填项（与内容开关无关）
        sb.append("<meta property=\"dcterms:modified\">")
                .append(MODIFIED_FORMAT.format(Instant.now())).append("</meta>\n");
        sb.append("</metadata>\n");

        sb.append("<manifest>\n");
        sb.append("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" ")
                .append("properties=\"nav\"/>\n");
        sb.append("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n");
        sb.append("<item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>\n");
        if (coverHref != null) {
            sb.append("<item id=\"cover-image\" href=\"").append(escapeXml(coverHref))
                    .append("\" media-type=\"").append(mediaType(coverHref))
                    .append("\" properties=\"cover-image\"/>\n");
            sb.append("<item id=\"cover\" href=\"cover.xhtml\" ")
                    .append("media-type=\"application/xhtml+xml\"/>\n");
        }
        for (int i = 0; i < chapterHrefs.size(); i++) {
            sb.append("<item id=\"chapter-").append(i + 1).append("\" href=\"")
                    .append(escapeXml(chapterHrefs.get(i)))
                    .append("\" media-type=\"application/xhtml+xml\"/>\n");
        }
        int img = 0;
        for (String path : imageBytesByPath.keySet()) {
            String href = path.startsWith(OEBPS) ? path.substring(OEBPS.length()) : path;
            if (href.equals(coverHref)) {
                continue; // 封面已作为 cover-image 声明，避免重复 manifest 条目
            }
            sb.append("<item id=\"image-").append(img++).append("\" href=\"")
                    .append(escapeXml(href)).append("\" media-type=\"").append(mediaType(href))
                    .append("\"/>\n");
        }
        sb.append("</manifest>\n");

        sb.append("<spine toc=\"ncx\" page-progression-direction=\"ltr\">\n");
        if (coverHref != null) {
            sb.append("<itemref idref=\"cover\"/>\n");
        }
        for (int i = 0; i < chapterHrefs.size(); i++) {
            sb.append("<itemref idref=\"chapter-").append(i + 1).append("\"/>\n");
        }
        sb.append("</spine>\n");
        sb.append("</package>\n");
        return sb.toString();
    }

    private static String buildNav(List<Chapter> chapters, List<String> chapterHrefs) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" ")
                .append("xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh\" lang=\"zh\">\n");
        sb.append("<head>\n<meta charset=\"utf-8\"/>\n<title>目录</title>\n</head>\n<body>\n");
        sb.append("<nav epub:type=\"toc\" id=\"toc\">\n<h1>目录</h1>\n<ol>\n");
        for (int i = 0; i < chapters.size(); i++) {
            sb.append("<li><a href=\"").append(escapeXml(chapterHrefs.get(i))).append("\">")
                    .append(escapeXml(chapters.get(i).title)).append("</a></li>\n");
        }
        sb.append("</ol>\n</nav>\n</body>\n</html>\n");
        return sb.toString();
    }

    private static String buildNcx(NovelExportModel model, String pubId, List<Chapter> chapters,
            List<String> chapterHrefs) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n");
        sb.append("<head>\n");
        sb.append("<meta name=\"dtb:uid\" content=\"").append(escapeXml(pubId)).append("\"/>\n");
        sb.append("<meta name=\"dtb:depth\" content=\"1\"/>\n");
        sb.append("<meta name=\"dtb:totalPageCount\" content=\"0\"/>\n");
        sb.append("<meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n");
        sb.append("</head>\n");
        sb.append("<docTitle><text>").append(escapeXml(model.meta.title))
                .append("</text></docTitle>\n");
        sb.append("<navMap>\n");
        for (int i = 0; i < chapters.size(); i++) {
            sb.append("<navPoint id=\"navPoint-").append(i + 1).append("\" playOrder=\"")
                    .append(i + 1).append("\">\n");
            sb.append("<navLabel><text>").append(escapeXml(chapters.get(i).title))
                    .append("</text></navLabel>\n");
            sb.append("<content src=\"").append(escapeXml(chapterHrefs.get(i))).append("\"/>\n");
            sb.append("</navPoint>\n");
        }
        sb.append("</navMap>\n</ncx>\n");
        return sb.toString();
    }

    private static String containerXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<container version=\"1.0\" "
                + "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n"
                + "<rootfiles>\n"
                + "<rootfile full-path=\"OEBPS/content.opf\" "
                + "media-type=\"application/oebps-package+xml\"/>\n"
                + "</rootfiles>\n</container>\n";
    }

    // ── zip 写入 ─────────────────────────────────────────────

    private static void writeMimetype(ZipOutputStream zip) throws IOException {
        byte[] mime = MIMETYPE.getBytes(StandardCharsets.US_ASCII);
        ZipEntry entry = new ZipEntry("mimetype");
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(mime.length);
        entry.setCompressedSize(mime.length);
        CRC32 crc = new CRC32();
        crc.update(mime);
        entry.setCrc(crc.getValue());
        zip.putNextEntry(entry);
        zip.write(mime);
        zip.closeEntry();
    }

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

    // ── 行内样式渲染（strong/em/s/u） ────────────────────────

    private static String renderInline(String text,
            List<NovelExportModel.InlineRun> runs) {
        if (runs == null || runs.isEmpty()) {
            return escapeXml(text);
        }
        List<NovelExportModel.InlineRun> sorted = new ArrayList<>(runs);
        sorted.sort(Comparator.comparingInt(r -> r.start));
        StringBuilder out = new StringBuilder();
        List<NovelExportModel.InlineRun> active = new ArrayList<>();
        int ri = 0;
        int len = text.length();
        for (int pos = 0; pos <= len; pos++) {
            for (int i = active.size() - 1; i >= 0; i--) {
                if (active.get(i).end <= pos) {
                    out.append(closeTag(active.get(i).tag));
                    active.remove(i);
                }
            }
            while (ri < sorted.size() && sorted.get(ri).start <= pos) {
                NovelExportModel.InlineRun r = sorted.get(ri);
                if (r.start >= 0 && r.end > r.start && r.end <= len) {
                    String open = openTag(r.tag);
                    if (open != null) {
                        out.append(open);
                        active.add(r);
                    }
                }
                ri++;
            }
            if (pos < len) {
                char c = text.charAt(pos);
                if (c == '\n') {
                    out.append("<br/>"); // 段内换行 → XHTML 自闭换行（well-formed）
                } else {
                    appendXmlChar(out, c);
                }
            }
        }
        return out.toString();
    }

    private static String openTag(String tag) {
        switch (tag) {
            case "bold":
                return "<strong>";
            case "italic":
                return "<em>";
            case "strike":
                return "<s>";
            case "underline":
                return "<u>";
            default:
                return null;
        }
    }

    private static String closeTag(String tag) {
        switch (tag) {
            case "bold":
                return "</strong>";
            case "italic":
                return "</em>";
            case "strike":
                return "</s>";
            case "underline":
                return "</u>";
            default:
                return "";
        }
    }

    // ── 取图 / 扩展名 / MIME / 转义 ──────────────────────────

    /** 取图：失败（异常/空字节）→ Log.w 返回 null，调用方跳过该图。 */
    private static byte[] loadImage(PixivImageLoader loader, String url) {
        try {
            byte[] bytes = loader.loadBytes(url);
            if (bytes == null || bytes.length == 0) {
                Log.w(TAG, "图片为空，已跳过: " + url);
                return null;
            }
            return bytes;
        } catch (Exception e) {
            Log.w(TAG, "图片下载失败，已跳过: " + url, e);
            return null;
        }
    }

    /** URL 后缀（小写，去 query）；未知回退 jpg。 */
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
        return path.substring(dot + 1).toLowerCase(Locale.US);
    }

    private static String mediaType(String href) {
        String e = ext(href);
        switch (e) {
            case "png":
                return "image/png";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "svg":
                return "image/svg+xml";
            case "jpeg":
            case "jpg":
            default:
                return "image/jpeg";
        }
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

    /** 最小可读排版样式（单文件自包含）。 */
    private static final String STYLE_CSS =
            "body{font-family:serif;line-height:1.8;margin:1em;}"
            + "h1{font-size:1.4em;margin:.6em 0;}"
            + "p{margin:.5em 0;text-indent:2em;}"
            + "img{max-width:100%;height:auto;}"
            + "img.cover{max-width:100%;height:auto;}"
            + "hr{border:0;border-top:1px solid #999;margin:1em 0;}";
}
