package io.pictelio.app;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BooleanSupplier;

/**
 * 小说导出深模块（spec docs/specs/novel-export.md §5；ADR-0154 D2；main sourceSet 双引擎共享）。
 *
 * <p>输入：共享包构造的 payloadJson + 目标格式 + 任务 id；输出：目标格式文件（cache 目录，
 * 供 {@link GallerySaver#saveDownloadFile} 落盘）。本类实现文本/结构化格式
 * （txt/html/md/rtf/json/fb2），并把 epub/docx/pdf 分派给 T6/T7/T8 的独立编码器。
 *
 * <p>封面与正文插图经注入的 {@link PixivImageLoader} 缓存优先取字节（ADR-0037 字节零进 JS 堆）；
 * 单张图片下载失败 → {@code Log.w} 并跳过该图（导出仍成功），元数据/正文这类硬契约失败 →
 * 抛可读 {@link IOException}（术语表「降级可见」，无静默降级）。
 */
public final class NovelExporter {

    private static final String TAG = "NovelExporter";
    /** 输出目录（cache 子目录；与 UgoiraExporter 同约定） */
    static final String EXPORT_DIR = "pictelio-novel-export";
    private static final byte[] UTF8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final String PAGE_BREAK_LINE = "----------";
    private static final String[] KNOWN_FORMATS =
            {"txt", "html", "md", "docx", "pdf", "epub", "rtf", "json", "fb2"};

    private static final Map<String, String> HTML_OPEN = Map.of(
            "bold", "<strong>", "italic", "<em>", "strike", "<s>", "underline", "<u>");
    private static final Map<String, String> HTML_CLOSE = Map.of(
            "bold", "</strong>", "italic", "</em>", "strike", "</s>", "underline", "</u>");
    private static final Map<String, String> MD_OPEN = Map.of(
            "bold", "**", "italic", "*", "strike", "~~", "underline", "<u>");
    private static final Map<String, String> MD_CLOSE = Map.of(
            "bold", "**", "italic", "*", "strike", "~~", "underline", "</u>");
    private static final Map<String, String> FB2_OPEN = Map.of(
            "bold", "<strong>", "italic", "<emphasis>", "strike", "<strikethrough>",
            "underline", "<style name=\"underline\">");
    private static final Map<String, String> FB2_CLOSE = Map.of(
            "bold", "</strong>", "italic", "</emphasis>", "strike", "</strikethrough>",
            "underline", "</style>");

    private NovelExporter() {}

    /**
     * 导出单本小说到目标格式文件（cache），返回输出文件。
     *
     * @param loader      取图深模块（缓存优先；测试可注入子类假件）
     * @param payloadJson NovelExportPayload JSON（spec §3.3）
     * @param format      txt/html/md/docx/pdf/epub/rtf/json/fb2
     * @param id          任务 id（输出文件名 = {@code id + "." + format}）
     */
    public static File export(Context context, PixivImageLoader loader, String payloadJson,
            String format, String id) throws IOException {
        return export(context, loader, payloadJson, format, id, () -> false);
    }

    /**
     * 可取消版本：编码前与每次取图前轮询 {@code cancelled}，命中即抛
     * {@link NovelExportCancelledException}（消息「导出已取消」），不降级为跳过图片。
     *
     * @param cancelled 取消信号（如 {@code AtomicBoolean::get}）；非空
     */
    public static File export(Context context, PixivImageLoader loader, String payloadJson,
            String format, String id, BooleanSupplier cancelled) throws IOException {
        if (cancelled.getAsBoolean()) {
            throw new NovelExportCancelledException();
        }
        if (!isKnownFormat(format)) {
            throw new IOException("不支持的导出格式：" + format);
        }
        NovelExportModel model = NovelExportModel.parse(payloadJson);
        File dir = outputDir(context);
        switch (format) {
            case "txt":
                return write(dir, id, "txt", txt(model));
            case "html":
                return write(dir, id, "html", utf8(html(model, loader, cancelled)));
            case "md":
                return write(dir, id, "md", utf8(md(model)));
            case "rtf":
                return write(dir, id, "rtf", utf8(rtf(model)));
            case "json":
                return write(dir, id, "json", utf8(json(payloadJson)));
            case "fb2":
                return write(dir, id, "fb2", utf8(fb2(model, loader, cancelled)));
            case "epub":
                return NovelEpubEncoder.encode(context, loader, model, id, cancelled);
            case "docx":
                return NovelDocxEncoder.encode(context, loader, model, id, cancelled);
            case "pdf":
                return NovelPdfEncoder.encode(context, loader, model, id, cancelled);
            default:
                throw new IOException("不支持的导出格式：" + format);
        }
    }

    /** 输出目录（mkdirs；T6/T7/T8 编码器共用同一落点，避免各自硬编码）。 */
    static File outputDir(Context context) throws IOException {
        File dir = new File(context.getCacheDir(), EXPORT_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("导出失败：无法创建目录 " + dir);
        }
        return dir;
    }

    private static boolean isKnownFormat(String format) {
        if (format == null || format.isEmpty()) {
            return false;
        }
        for (String known : KNOWN_FORMATS) {
            if (known.equals(format)) {
                return true;
            }
        }
        return false;
    }

    private static File write(File dir, String id, String format, byte[] bytes) throws IOException {
        File out = new File(dir, id + "." + format);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(bytes);
        }
        return out;
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    // ── TXT（UTF-8 BOM；元数据头部；段落空行分隔；图片 URL 行） ──

    private static byte[] txt(NovelExportModel m) {
        StringBuilder sb = new StringBuilder();
        if (m.options.includeMetadata) {
            appendTxtMeta(sb, m);
        }
        // 封面开关独立于元数据开关（spec §5：文本格式封面退化为链接）
        if (m.options.includeCover && m.meta.coverUrl != null) {
            sb.append("封面：").append(m.meta.coverUrl).append("\n\n");
        }
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                sb.append(((NovelExportModel.TextBlock) b).text).append("\n\n");
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                sb.append(((NovelExportModel.ChapterBlock) b).title).append("\n\n");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                sb.append(PAGE_BREAK_LINE).append("\n\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                // 文本格式无内嵌能力：开关只控制是否输出插图 URL 行
                if (m.options.includeInlineImages) {
                    sb.append(((NovelExportModel.ImageBlock) b).url).append("\n\n");
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                sb.append("[").append(j.kind).append(":").append(j.target).append("] ")
                        .append(j.url).append("\n\n");
            }
        }
        byte[] body = utf8(sb.toString());
        byte[] out = new byte[UTF8_BOM.length + body.length];
        System.arraycopy(UTF8_BOM, 0, out, 0, UTF8_BOM.length);
        System.arraycopy(body, 0, out, UTF8_BOM.length, body.length);
        return out;
    }

    private static void appendTxtMeta(StringBuilder sb, NovelExportModel m) {
        sb.append("《").append(m.meta.title).append("》\n");
        sb.append("作者：").append(m.meta.authorName).append("\n");
        if (!m.meta.tags.isEmpty()) {
            sb.append("标签：").append(String.join("、", m.meta.tags)).append("\n");
        }
        if (m.meta.seriesTitle != null) {
            sb.append("系列：").append(m.meta.seriesTitle).append("\n");
        }
        sb.append("发布：").append(m.meta.createDate).append("\n");
        sb.append("原文：").append(m.meta.sourceUrl).append("\n");
        if (m.meta.description != null && !m.meta.description.isEmpty()) {
            sb.append("简介：").append(m.meta.description).append("\n");
        }
        sb.append("\n");
    }

    // ── HTML（单文件自包含；转义 5 字符；data URI 内嵌图片） ────

    private static String html(NovelExportModel m, PixivImageLoader loader,
            BooleanSupplier cancelled) throws NovelExportCancelledException {
        StringBuilder sb = new StringBuilder();
        sb.append("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n");
        sb.append("<title>").append(escapeHtml(m.meta.title)).append("</title>\n");
        sb.append("<style>").append(HTML_STYLE).append("</style>\n</head>\n<body>\n");
        if (m.options.includeMetadata) {
            appendHtmlMeta(sb, m);
        }
        if (m.options.includeCover && m.meta.coverUrl != null) {
            byte[] cover = loadImage(loader, m.meta.coverUrl, cancelled);
            if (cover != null) {
                sb.append("<p class=\"cover\"><img src=\"").append(dataUri(m.meta.coverUrl, cover))
                        .append("\" alt=\"cover\"></p>\n");
            }
        }
        sb.append("<article>\n");
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                sb.append("<p>").append(renderRuns(t.text, t.inlineRuns, HTML_OPEN, HTML_CLOSE,
                        NovelExporter::appendHtmlChar)).append("</p>\n");
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                sb.append("<h2>").append(escapeHtml(((NovelExportModel.ChapterBlock) b).title))
                        .append("</h2>\n");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                sb.append("<hr>\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (m.options.includeInlineImages) {
                    NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                    byte[] bytes = loadImage(loader, img.url, cancelled);
                    if (bytes != null) {
                        sb.append("<img src=\"").append(dataUri(img.url, bytes))
                                .append("\" alt=\"").append(escapeHtml(img.imageId))
                                .append("\">\n");
                    }
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                sb.append("<p><a href=\"").append(escapeHtml(j.url)).append("\">")
                        .append(escapeHtml("[" + j.kind + ":" + j.target + "]"))
                        .append("</a></p>\n");
            }
        }
        sb.append("</article>\n</body>\n</html>\n");
        return sb.toString();
    }

    private static void appendHtmlMeta(StringBuilder sb, NovelExportModel m) {
        sb.append("<header>\n");
        sb.append("<h1>").append(escapeHtml(m.meta.title)).append("</h1>\n");
        sb.append("<p class=\"author\">").append(escapeHtml(m.meta.authorName)).append("</p>\n");
        if (!m.meta.tags.isEmpty()) {
            sb.append("<p class=\"tags\">");
            for (String tag : m.meta.tags) {
                sb.append("<span>").append(escapeHtml(tag)).append("</span>");
            }
            sb.append("</p>\n");
        }
        if (m.meta.seriesTitle != null) {
            sb.append("<p class=\"series\">系列：").append(escapeHtml(m.meta.seriesTitle))
                    .append("</p>\n");
        }
        sb.append("<p class=\"date\">").append(escapeHtml(m.meta.createDate)).append("</p>\n");
        sb.append("<p class=\"source\"><a href=\"").append(escapeHtml(m.meta.sourceUrl))
                .append("\">原文链接</a></p>\n");
        if (m.meta.description != null) {
            sb.append("<p class=\"description\">").append(escapeHtml(m.meta.description))
                    .append("</p>\n");
        }
        if (m.options.includeCover && m.meta.coverUrl != null) {
            sb.append("<p class=\"cover-link\"><a href=\"").append(escapeHtml(m.meta.coverUrl))
                    .append("\">封面</a></p>\n");
        }
        sb.append("</header>\n");
    }

    // ── Markdown（CommonMark；YAML front matter；链接为原始 URL） ──

    private static String md(NovelExportModel m) {
        StringBuilder sb = new StringBuilder();
        if (m.options.includeMetadata) {
            appendMdMeta(sb, m);
        }
        if (m.options.includeCover && m.meta.coverUrl != null) {
            sb.append("![封面](").append(m.meta.coverUrl).append(")\n\n");
        }
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                sb.append(renderRuns(t.text, t.inlineRuns, MD_OPEN, MD_CLOSE,
                        NovelExporter::appendPlainChar)).append("\n\n");
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                sb.append("## ").append(((NovelExportModel.ChapterBlock) b).title).append("\n\n");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                sb.append("---\n\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (m.options.includeInlineImages) {
                    NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                    sb.append("![").append(img.imageId).append("](").append(img.url).append(")\n\n");
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                sb.append("[").append(j.kind).append(":").append(j.target).append("](")
                        .append(j.url).append(")\n\n");
            }
        }
        return sb.toString();
    }

    private static void appendMdMeta(StringBuilder sb, NovelExportModel m) {
        sb.append("---\n");
        sb.append("title: \"").append(escapeYaml(m.meta.title)).append("\"\n");
        sb.append("author: \"").append(escapeYaml(m.meta.authorName)).append("\"\n");
        sb.append("tags: [");
        for (int i = 0; i < m.meta.tags.size(); i++) {
            if (i > 0) {
                sb.append(", ");
            }
            sb.append("\"").append(escapeYaml(m.meta.tags.get(i))).append("\"");
        }
        sb.append("]\n");
        if (m.meta.seriesTitle != null) {
            sb.append("series: \"").append(escapeYaml(m.meta.seriesTitle)).append("\"\n");
        }
        sb.append("createDate: \"").append(escapeYaml(m.meta.createDate)).append("\"\n");
        sb.append("sourceUrl: \"").append(escapeYaml(m.meta.sourceUrl)).append("\"\n");
        if (m.meta.description != null) {
            sb.append("description: \"").append(escapeYaml(m.meta.description)).append("\"\n");
        }
        sb.append("xRestrict: ").append(m.meta.xRestrict).append("\n");
        sb.append("---\n\n");
    }

    private static String escapeYaml(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "");
    }

    // ── RTF（头 \rtf1...；CJK 以 Unicode 转义序列输出；图片退化为链接） ──

    private static String rtf(NovelExportModel m) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}}")
                .append("\\viewkind4\\uc1\\pard\\f0\\fs24 ");
        if (m.options.includeMetadata) {
            sb.append("\\b ").append(escapeRtf(m.meta.title)).append("\\b0\\par\n");
            sb.append(escapeRtf("作者：" + m.meta.authorName)).append("\\par\n");
            if (!m.meta.tags.isEmpty()) {
                sb.append(escapeRtf("标签：" + String.join("、", m.meta.tags))).append("\\par\n");
            }
            if (m.meta.seriesTitle != null) {
                sb.append(escapeRtf("系列：" + m.meta.seriesTitle)).append("\\par\n");
            }
            sb.append(escapeRtf("发布：" + m.meta.createDate)).append("\\par\n");
            sb.append(escapeRtf("原文：" + m.meta.sourceUrl)).append("\\par\n");
            if (m.meta.description != null && !m.meta.description.isEmpty()) {
                sb.append(escapeRtf("简介：" + m.meta.description)).append("\\par\n");
            }
            sb.append("\\par\n");
        }
        // 封面开关独立于元数据开关（spec §5：文本格式封面退化为链接）
        if (m.options.includeCover && m.meta.coverUrl != null) {
            sb.append(escapeRtf("封面：" + m.meta.coverUrl)).append("\\par\n");
        }
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                sb.append(escapeRtf(((NovelExportModel.TextBlock) b).text)).append("\\par\n");
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                sb.append("\\b ").append(escapeRtf(((NovelExportModel.ChapterBlock) b).title))
                        .append("\\b0\\par\n");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                sb.append(PAGE_BREAK_LINE).append("\\par\n");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (m.options.includeInlineImages) {
                    sb.append(escapeRtf(((NovelExportModel.ImageBlock) b).url)).append("\\par\n");
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                sb.append(escapeRtf("[" + j.kind + ":" + j.target + "] " + j.url))
                        .append("\\par\n");
            }
        }
        sb.append("}");
        return sb.toString();
    }

    /** RTF 文本转义：ASCII 原样，反斜杠/花括号转义，CJK 转 16 位 Unicode 转义序列。 */
    static String escapeRtf(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\') {
                sb.append("\\\\");
            } else if (c == '{') {
                sb.append("\\{");
            } else if (c == '}') {
                sb.append("\\}");
            } else if (c == '\n') {
                sb.append("\\par\n");
            } else if (c == '\r') {
                // 丢弃（\par 已由 \n 处理）
            } else if (c == '\t') {
                sb.append("\\tab ");
            } else if (c >= 0x20 && c < 0x7f) {
                sb.append(c);
            } else if (c > 0x7f) {
                sb.append("\\u").append((int) (short) c).append("?");
            } else {
                sb.append("\\'").append(String.format(Locale.US, "%02x", (int) c));
            }
        }
        return sb.toString();
    }

    // ── JSON（无损 IR；始终全量 meta，与开关无关） ─────────────

    private static String json(String payloadJson) throws IOException {
        try {
            return new JSONObject(payloadJson).toString(2);
        } catch (JSONException e) {
            throw new IOException("导出失败：payload 非法 JSON", e);
        }
    }

    // ── FB2（FictionBook 2 XML；图片 base64 <binary>） ─────────

    private static String fb2(NovelExportModel m, PixivImageLoader loader,
            BooleanSupplier cancelled) throws NovelExportCancelledException {
        StringBuilder binaries = new StringBuilder();
        StringBuilder body = new StringBuilder();
        String coverId = null;
        if (m.options.includeCover && m.meta.coverUrl != null) {
            byte[] cover = loadImage(loader, m.meta.coverUrl, cancelled);
            if (cover != null) {
                coverId = "cover";
                binaries.append("<binary id=\"cover\" content-type=\"").append(imageMime(m.meta.coverUrl))
                        .append("\">").append(Base64.encodeToString(cover, Base64.NO_WRAP))
                        .append("</binary>");
            }
        }
        int imageIndex = 0;
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                body.append("<p>").append(renderRuns(t.text, t.inlineRuns, FB2_OPEN, FB2_CLOSE,
                        NovelExporter::appendXmlChar)).append("</p>");
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                body.append("<title><p>")
                        .append(escapeXml(((NovelExportModel.ChapterBlock) b).title))
                        .append("</p></title>");
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                body.append("<empty-line/>");
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (m.options.includeInlineImages) {
                    NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                    byte[] bytes = loadImage(loader, img.url, cancelled);
                    if (bytes != null) {
                        String id = "img" + imageIndex++;
                        binaries.append("<binary id=\"").append(id).append("\" content-type=\"")
                                .append(imageMime(img.url)).append("\">")
                                .append(Base64.encodeToString(bytes, Base64.NO_WRAP))
                                .append("</binary>");
                        body.append("<image l:href=\"#").append(id).append("\"/>");
                    }
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                body.append("<p><a l:href=\"").append(escapeXml(j.url)).append("\">")
                        .append(escapeXml("[" + j.kind + ":" + j.target + "]"))
                        .append("</a></p>");
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\" ")
                .append("xmlns:l=\"http://www.w3.org/1999/xlink\">");
        sb.append("<description><title-info>");
        sb.append("<genre>fanfiction</genre>");
        sb.append("<author><nickname>").append(escapeXml(m.meta.authorName)).append("</nickname></author>");
        sb.append("<book-title>").append(escapeXml(m.meta.title)).append("</book-title>");
        if (m.options.includeMetadata) {
            if (m.meta.description != null) {
                sb.append("<annotation><p>").append(escapeXml(m.meta.description))
                        .append("</p></annotation>");
            }
            sb.append("<keywords>").append(escapeXml(String.join(", ", m.meta.tags)))
                    .append("</keywords>");
            if (m.meta.seriesTitle != null) {
                sb.append("<sequence name=\"").append(escapeXml(m.meta.seriesTitle)).append("\"");
                if (m.meta.seriesId != null) {
                    sb.append(" number=\"").append(m.meta.seriesId).append("\"");
                }
                sb.append("/>");
            }
            sb.append("<date value=\"").append(escapeXml(m.meta.createDate)).append("\"/>");
        }
        if (coverId != null) {
            sb.append("<coverpage><image l:href=\"#").append(coverId).append("\"/></coverpage>");
        }
        sb.append("</title-info>");
        sb.append("<document-info><author><nickname>Pictelio</nickname></author>")
                .append("<program-used>Pictelio</program-used><id>").append(m.meta.id)
                .append("</id><version>1.0</version></document-info>");
        sb.append("</description>");
        sb.append("<body><section>").append(body).append("</section></body>");
        sb.append(binaries);
        sb.append("</FictionBook>");
        return sb.toString();
    }

    // ── 行内样式渲染 ─────────────────────────────────────────

    /** 字符转义器（HTML/XML 转义；Markdown 原样）。 */
    private interface CharEscaper {
        void append(StringBuilder out, char c);
    }

    /**
     * 按 inline run 边界渲染文本：tag 开/闭标签来自映射，文本逐字符经 escaper 转义。
     * run 区间为 UTF-16 code unit [start,end)；非嵌套/越界区间安全退化为普通文本包裹。
     */
    private static String renderRuns(String text, List<NovelExportModel.InlineRun> runs,
            Map<String, String> openTags, Map<String, String> closeTags, CharEscaper escaper) {
        if (runs == null || runs.isEmpty()) {
            StringBuilder plain = new StringBuilder();
            for (int i = 0; i < text.length(); i++) {
                escaper.append(plain, text.charAt(i));
            }
            return plain.toString();
        }
        List<NovelExportModel.InlineRun> sorted = new ArrayList<>(runs);
        sorted.sort(Comparator.comparingInt(r -> r.start));
        StringBuilder out = new StringBuilder();
        List<NovelExportModel.InlineRun> active = new ArrayList<>();
        int ri = 0;
        int len = text.length();
        for (int pos = 0; pos <= len; pos++) {
            for (int i = active.size() - 1; i >= 0; i--) {
                NovelExportModel.InlineRun r = active.get(i);
                if (r.end <= pos) {
                    String close = closeTags.get(r.tag);
                    if (close != null) {
                        out.append(close);
                    }
                    active.remove(i);
                }
            }
            while (ri < sorted.size() && sorted.get(ri).start <= pos) {
                NovelExportModel.InlineRun r = sorted.get(ri);
                if (r.start >= 0 && r.end > r.start && r.end <= len) {
                    String open = openTags.get(r.tag);
                    if (open != null) {
                        out.append(open);
                        active.add(r);
                    }
                }
                ri++;
            }
            if (pos < len) {
                escaper.append(out, text.charAt(pos));
            }
        }
        return out.toString();
    }

    // ── 图片取字节 / data URI / MIME ──────────────────────────

    /**
     * 取图：先轮询取消（命中抛 {@link NovelExportCancelledException}，绝不降级为跳过）；
     * 其余失败（IOException/空字节）→ Log.w 返回 null，调用方跳过该图。
     */
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

    private static String dataUri(String url, byte[] bytes) {
        return "data:" + imageMime(url) + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static String imageMime(String url) {
        String path = url == null ? "" : url;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        String ext = (dot < 0 || dot < slash) ? "" : path.substring(dot + 1).toLowerCase(Locale.US);
        switch (ext) {
            case "png":
                return "image/png";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "jpeg":
            case "jpg":
            default:
                return "image/jpeg";
        }
    }

    // ── 转义助手 ─────────────────────────────────────────────

    private static void appendPlainChar(StringBuilder out, char c) {
        out.append(c);
    }

    private static void appendHtmlChar(StringBuilder out, char c) {
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
                out.append("&#39;");
                break;
            default:
                out.append(c);
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

    private static String escapeHtml(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            appendHtmlChar(sb, s.charAt(i));
        }
        return sb.toString();
    }

    private static String escapeXml(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            appendXmlChar(sb, s.charAt(i));
        }
        return sb.toString();
    }

    /** HTML 内联样式（单文件自包含，最小可读排版）。 */
    private static final String HTML_STYLE =
            "body{font-family:serif;line-height:1.8;max-width:42em;margin:2em auto;padding:0 1em;}"
            + "header{border-bottom:1px solid #ccc;margin-bottom:1.5em;}"
            + "h1{font-size:1.6em;}h2{font-size:1.3em;margin-top:1.4em;}"
            + ".tags span{display:inline-block;border:1px solid #ccc;border-radius:3px;"
            + "padding:0 .4em;margin-right:.3em;font-size:.85em;}"
            + "img{max-width:100%;height:auto;}a{color:#06c;}";
}
