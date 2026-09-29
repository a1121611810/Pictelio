package io.pictelio.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 小说导出文档模型（NovelExportPayload，spec docs/specs/novel-export.md §3.3）解析深模块。
 *
 * <p>输入：共享包 {@code @pictelio/novel-export} 构造的 payloadJson；输出：强类型、不可变模型，
 * 供 {@link NovelExporter} 与后续 T6/T7/T8 二进制编码器消费。字段全部 {@code public final}，
 * 无 getter/setter，无 hasOption 之类动态查询——这是编码器依赖的稳定接口。
 *
 * <p><b>严格解析</b>（术语表「降级可见」）：顶层结构缺失 / 类型错误 / schema 不符 / 未知块类型
 * 一律抛可读 {@link IOException}（消息以「导出失败：」开头），绝不静默兜底。
 */
public final class NovelExportModel {

    /** 当前 schema 版本（spec §3.3） */
    public static final int SCHEMA = 1;

    public final int schema;
    public final Meta meta;
    public final Options options;
    public final List<Block> blocks;

    private NovelExportModel(int schema, Meta meta, Options options, List<Block> blocks) {
        this.schema = schema;
        this.meta = meta;
        this.options = options;
        this.blocks = Collections.unmodifiableList(blocks);
    }

    /** 解析 payloadJson；任何结构性错误抛可读 IOException。 */
    public static NovelExportModel parse(String payloadJson) throws IOException {
        if (payloadJson == null || payloadJson.trim().isEmpty()) {
            throw new IOException("导出失败：payload 为空");
        }
        JSONObject root;
        try {
            root = new JSONObject(payloadJson);
        } catch (JSONException e) {
            throw new IOException("导出失败：payload 非法 JSON", e);
        }
        int schema = requireInt(root, "schema", "schema");
        if (schema != SCHEMA) {
            throw new IOException("导出失败：不支持的 payload schema：" + schema);
        }
        Meta meta = parseMeta(requireObject(root, "meta", "meta"));
        Options options = parseOptions(requireObject(root, "options", "options"));
        List<Block> blocks = parseBlocks(requireArray(root, "blocks", "blocks"));
        return new NovelExportModel(schema, meta, options, blocks);
    }

    // ── 顶层字段解析 ─────────────────────────────────────────

    private static Meta parseMeta(JSONObject o) throws IOException {
        long id = requireLong(o, "id", "meta.id");
        String title = requireString(o, "title", "meta.title");
        long authorId = requireLong(o, "authorId", "meta.authorId");
        String authorName = requireString(o, "authorName", "meta.authorName");
        List<String> tags = parseTags(requireArray(o, "tags", "meta.tags"));
        Long seriesId = optLong(o, "seriesId", "meta.seriesId");
        String seriesTitle = optString(o, "seriesTitle", "meta.seriesTitle");
        String createDate = requireString(o, "createDate", "meta.createDate");
        String sourceUrl = requireString(o, "sourceUrl", "meta.sourceUrl");
        String description = optString(o, "description", "meta.description");
        int xRestrict = requireInt(o, "xRestrict", "meta.xRestrict");
        String coverUrl = optString(o, "coverUrl", "meta.coverUrl");
        return new Meta(id, title, authorId, authorName, tags, seriesId, seriesTitle, createDate,
                sourceUrl, description, xRestrict, coverUrl);
    }

    private static Options parseOptions(JSONObject o) throws IOException {
        return new Options(
                requireBoolean(o, "includeMetadata", "options.includeMetadata"),
                requireBoolean(o, "includeCover", "options.includeCover"),
                requireBoolean(o, "includeInlineImages", "options.includeInlineImages"));
    }

    private static List<Block> parseBlocks(JSONArray arr) throws IOException {
        List<Block> blocks = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) {
                throw new IOException("导出失败：blocks[" + i + "] 不是对象");
            }
            String type = requireString(o, "type", "blocks[" + i + "].type");
            switch (type) {
                case "text":
                    blocks.add(new TextBlock(
                            requireInt(o, "index", "blocks[" + i + "].index"),
                            requireString(o, "text", "blocks[" + i + "].text"),
                            parseRuns(o, i)));
                    break;
                case "image":
                    blocks.add(new ImageBlock(
                            requireString(o, "imageId", "blocks[" + i + "].imageId"),
                            requireString(o, "url", "blocks[" + i + "].url")));
                    break;
                case "pageBreak":
                    blocks.add(new PageBreakBlock());
                    break;
                case "chapter":
                    blocks.add(new ChapterBlock(
                            requireString(o, "title", "blocks[" + i + "].title")));
                    break;
                case "jump":
                    blocks.add(new JumpBlock(
                            requireString(o, "kind", "blocks[" + i + "].kind"),
                            requireString(o, "target", "blocks[" + i + "].target"),
                            requireString(o, "url", "blocks[" + i + "].url")));
                    break;
                default:
                    throw new IOException("导出失败：未知块类型「" + type + "」（blocks[" + i + "]）");
            }
        }
        return blocks;
    }

    private static List<String> parseTags(JSONArray arr) throws IOException {
        List<String> tags = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            Object v = arr.opt(i);
            if (!(v instanceof String)) {
                throw new IOException("导出失败：meta.tags[" + i + "] 不是字符串");
            }
            tags.add((String) v);
        }
        return tags;
    }

    private static List<InlineRun> parseRuns(JSONObject block, int blockIndex) throws IOException {
        if (!block.has("inlineRuns") || block.isNull("inlineRuns")) {
            return Collections.emptyList();
        }
        JSONArray arr = block.optJSONArray("inlineRuns");
        if (arr == null) {
            throw new IOException("导出失败：blocks[" + blockIndex + "].inlineRuns 不是数组");
        }
        List<InlineRun> runs = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject r = arr.optJSONObject(i);
            String label = "blocks[" + blockIndex + "].inlineRuns[" + i + "]";
            if (r == null) {
                throw new IOException("导出失败：" + label + " 不是对象");
            }
            int start = requireInt(r, "start", label + ".start");
            int end = requireInt(r, "end", label + ".end");
            String tag = requireString(r, "tag", label + ".tag");
            if (!"bold".equals(tag) && !"italic".equals(tag)
                    && !"strike".equals(tag) && !"underline".equals(tag)) {
                throw new IOException("导出失败：" + label + " 未知行内样式「" + tag + "」");
            }
            runs.add(new InlineRun(start, end, tag));
        }
        return runs;
    }

    // ── 类型校验助手（缺失/类型错误 → 可读 IOException） ──────

    private static JSONObject requireObject(JSONObject parent, String key, String label)
            throws IOException {
        JSONObject o = parent.optJSONObject(key);
        if (o == null) {
            throw new IOException("导出失败：payload 缺少 " + label + " 对象");
        }
        return o;
    }

    private static JSONArray requireArray(JSONObject parent, String key, String label)
            throws IOException {
        JSONArray a = parent.optJSONArray(key);
        if (a == null) {
            throw new IOException("导出失败：payload 缺少 " + label + " 数组");
        }
        return a;
    }

    private static long requireLong(JSONObject o, String key, String label) throws IOException {
        Object v = requiredValue(o, key, label);
        if (!(v instanceof Number)) {
            throw new IOException("导出失败：字段 " + label + " 不是数字");
        }
        return ((Number) v).longValue();
    }

    private static int requireInt(JSONObject o, String key, String label) throws IOException {
        Object v = requiredValue(o, key, label);
        if (!(v instanceof Number)) {
            throw new IOException("导出失败：字段 " + label + " 不是数字");
        }
        return ((Number) v).intValue();
    }

    private static String requireString(JSONObject o, String key, String label) throws IOException {
        Object v = requiredValue(o, key, label);
        if (!(v instanceof String)) {
            throw new IOException("导出失败：字段 " + label + " 不是字符串");
        }
        return (String) v;
    }

    private static boolean requireBoolean(JSONObject o, String key, String label) throws IOException {
        Object v = requiredValue(o, key, label);
        if (!(v instanceof Boolean)) {
            throw new IOException("导出失败：字段 " + label + " 不是布尔值");
        }
        return (Boolean) v;
    }

    private static Object requiredValue(JSONObject o, String key, String label) throws IOException {
        if (!o.has(key) || o.isNull(key)) {
            throw new IOException("导出失败：payload 缺少字段 " + label);
        }
        return o.opt(key);
    }

    private static Long optLong(JSONObject o, String key, String label) throws IOException {
        if (!o.has(key) || o.isNull(key)) {
            return null;
        }
        Object v = o.opt(key);
        if (!(v instanceof Number)) {
            throw new IOException("导出失败：字段 " + label + " 不是数字");
        }
        return ((Number) v).longValue();
    }

    private static String optString(JSONObject o, String key, String label) throws IOException {
        if (!o.has(key) || o.isNull(key)) {
            return null;
        }
        Object v = o.opt(key);
        if (!(v instanceof String)) {
            throw new IOException("导出失败：字段 " + label + " 不是字符串");
        }
        return (String) v;
    }

    // ── 模型（public final 字段；构造器包可见，仅 parse 产出） ─

    /** 元数据（spec §3.3 meta）。 */
    public static final class Meta {
        public final long id;
        public final String title;
        public final long authorId;
        public final String authorName;
        public final List<String> tags;
        public final Long seriesId;
        public final String seriesTitle;
        public final String createDate;
        public final String sourceUrl;
        public final String description;
        public final int xRestrict;
        public final String coverUrl;

        Meta(long id, String title, long authorId, String authorName, List<String> tags,
                Long seriesId, String seriesTitle, String createDate, String sourceUrl,
                String description, int xRestrict, String coverUrl) {
            this.id = id;
            this.title = title;
            this.authorId = authorId;
            this.authorName = authorName;
            this.tags = Collections.unmodifiableList(tags);
            this.seriesId = seriesId;
            this.seriesTitle = seriesTitle;
            this.createDate = createDate;
            this.sourceUrl = sourceUrl;
            this.description = description;
            this.xRestrict = xRestrict;
            this.coverUrl = coverUrl;
        }
    }

    /** 内容开关（spec §3.2 options）。 */
    public static final class Options {
        public final boolean includeMetadata;
        public final boolean includeCover;
        public final boolean includeInlineImages;

        Options(boolean includeMetadata, boolean includeCover, boolean includeInlineImages) {
            this.includeMetadata = includeMetadata;
            this.includeCover = includeCover;
            this.includeInlineImages = includeInlineImages;
        }
    }

    /** 正文块基类（spec §3.3 NovelExportBlock）。 */
    public abstract static class Block {
        Block() {}
    }

    /** 文本段落块。 */
    public static final class TextBlock extends Block {
        public final int index;
        public final String text;
        public final List<InlineRun> inlineRuns;

        TextBlock(int index, String text, List<InlineRun> inlineRuns) {
            this.index = index;
            this.text = text;
            this.inlineRuns = Collections.unmodifiableList(inlineRuns);
        }
    }

    /** 正文内嵌插图块（url 已解析为可下载单 URL）。 */
    public static final class ImageBlock extends Block {
        public final String imageId;
        public final String url;

        ImageBlock(String imageId, String url) {
            this.imageId = imageId;
            this.url = url;
        }
    }

    /** 强制分页块。 */
    public static final class PageBreakBlock extends Block {
        PageBreakBlock() {}
    }

    /** 章节标题块。 */
    public static final class ChapterBlock extends Block {
        public final String title;

        ChapterBlock(String title) {
            this.title = title;
        }
    }

    /** 跳转块（kind: illust/novel/user/external/unknown）。 */
    public static final class JumpBlock extends Block {
        public final String kind;
        public final String target;
        public final String url;

        JumpBlock(String kind, String target, String url) {
            this.kind = kind;
            this.target = target;
            this.url = url;
        }
    }

    /** 行内样式区间（沿用 parseNovelBlocks 的 {start,end,tag} 契约）。 */
    public static final class InlineRun {
        public final int start;
        public final int end;
        public final String tag;

        InlineRun(int start, int end, String tag) {
            this.start = start;
            this.end = end;
            this.tag = tag;
        }
    }
}
