package io.pictelio.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.SpannableString;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.style.StrikethroughSpan;
import android.text.style.StyleSpan;
import android.text.style.UnderlineSpan;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * PDF 编码器（T8；spec docs/specs/novel-export.md §5）。
 *
 * <p>用 {@link PdfDocument} + {@link StaticLayout} 做 A4（595×842pt、16mm≈45pt 边距）排版：
 * <ul>
 *   <li>按内容宽度测量每个块的高度（StaticLayout），再用纯分页器 {@link Paginator}
 *       切页，最后逐页绘制（y 超出 contentBottom 即换页）；</li>
 *   <li>封面/插图 {@link BitmapFactory#decodeByteArray} 解码 → 等比缩放至内容宽度绘制；</li>
 *   <li>行内样式用 {@link SpannableString} 的 {@link StyleSpan}/{@link StrikethroughSpan}/
 *       {@link UnderlineSpan}；标题 18pt、章节 14pt、正文 11pt，系统默认 CJK 字体（不嵌入）；</li>
 *   <li>输出 {@code <outputDir>/<id>.pdf}，经 {@code document.writeTo(FileOutputStream)} 落盘。</li>
 * </ul>
 *
 * <p><b>测试缝</b>：Android 的 {@link PdfDocument} 依赖 native 实现，Robolectric（含
 * {@code @GraphicsMode(NATIVE)}）下 {@code nativeCreateDocument()} 返回 0，任何 {@code startPage}
 * 都抛「document is closed!」，JVM 单测无法跑通真实后端。因此把「新建页/结束页/写出/关闭」
 * 抽象为包可见 {@link PdfBackend}，默认实现 {@link AndroidPdfBackend}（生产路径）；
 * 单测注入假件以验证编码编排、分页与落盘契约。纯分页逻辑 {@link Paginator} 与图形无关，单独单测。
 */
public final class NovelPdfEncoder {

    private static final String TAG = "NovelPdfEncoder";

    /** A4 页面尺寸（pt） */
    static final int PAGE_WIDTH = 595;
    static final int PAGE_HEIGHT = 842;
    /** 16mm ≈ 45pt 边距 */
    static final int MARGIN = 45;
    static final int CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
    static final int CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN;

    private static final float BODY_SIZE = 11f;
    private static final float TITLE_SIZE = 18f;
    private static final float HEADING_SIZE = 14f;
    private static final float META_SIZE = 10f;

    private static final int PARAGRAPH_GAP = 6;
    private static final int TITLE_GAP = 14;
    private static final int HEADING_GAP = 8;
    private static final int IMAGE_GAP = 8;

    private NovelPdfEncoder() {}

    /** 低层 PDF 后端：把 Android native 依赖隔离在此接口后，便于单测注入。 */
    interface PdfBackend {
        /** 开始一页并返回可绘制画布（页码/尺寸由实现管理）。 */
        Canvas startPage(int width, int height);

        /** 结束当前页。 */
        void finishPage();

        /** 把文档写出到流。 */
        void writeTo(OutputStream out) throws IOException;

        /** 释放资源。 */
        void close();
    }

    /** 生产后端：{@link android.graphics.pdf.PdfDocument}。 */
    static final class AndroidPdfBackend implements PdfBackend {
        private final PdfDocument document = new PdfDocument();
        private PdfDocument.Page current;
        private int pageNumber = 1;

        @Override
        public Canvas startPage(int width, int height) {
            PdfDocument.PageInfo info =
                    new PdfDocument.PageInfo.Builder(width, height, pageNumber++).create();
            current = document.startPage(info);
            return current.getCanvas();
        }

        @Override
        public void finishPage() {
            if (current != null) {
                document.finishPage(current);
                current = null;
            }
        }

        @Override
        public void writeTo(OutputStream out) throws IOException {
            document.writeTo(out);
        }

        @Override
        public void close() {
            document.close();
        }
    }

    /** 生产入口：{@code <outputDir>/<id>.pdf}。 */
    public static File encode(Context context, PixivImageLoader loader, NovelExportModel model,
            String id) throws IOException {
        return encode(context, loader, model, id, () -> false, new AndroidPdfBackend());
    }

    /** 可取消生产入口：注入取消信号，使用生产 PdfDocument 后端。 */
    static File encode(Context context, PixivImageLoader loader, NovelExportModel model, String id,
            BooleanSupplier cancelled) throws IOException {
        return encode(context, loader, model, id, cancelled, new AndroidPdfBackend());
    }

    /** 包可见注入入口（测试缝）：允许替换 PDF 后端而保持生产签名不变。 */
    static File encode(Context context, PixivImageLoader loader, NovelExportModel model, String id,
            PdfBackend backend) throws IOException {
        return encode(context, loader, model, id, () -> false, backend);
    }

    /** 全参数版本：可取消 + 可替换后端。 */
    static File encode(Context context, PixivImageLoader loader, NovelExportModel model, String id,
            BooleanSupplier cancelled, PdfBackend backend) throws IOException {
        if (cancelled.getAsBoolean()) {
            throw new NovelExportCancelledException();
        }
        File dir = NovelExporter.outputDir(context);
        File out = new File(dir, id + ".pdf");
        try {
            render(loader, model, backend, cancelled);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                backend.writeTo(fos);
            }
        } finally {
            backend.close();
        }
        return out;
    }

    // ── 排版 ─────────────────────────────────────────────────

    private enum Kind { TITLE, META, HEADING, TEXT, IMAGE, PAGE_BREAK }

    /** 已测量的块：text 类持 StaticLayout，image 类持等比尺寸；height 为分页高度（含间距）。 */
    private static final class Item {
        final Kind kind;
        final StaticLayout layout;
        final Bitmap bitmap;
        final int imageWidth;
        final int imageHeight;
        final int gapAfter;

        Item(Kind kind, StaticLayout layout, Bitmap bitmap, int imageWidth, int imageHeight,
                int gapAfter) {
            this.kind = kind;
            this.layout = layout;
            this.bitmap = bitmap;
            this.imageWidth = imageWidth;
            this.imageHeight = imageHeight;
            this.gapAfter = gapAfter;
        }

        int height() {
            if (kind == Kind.PAGE_BREAK) {
                return 0;
            }
            if (kind == Kind.IMAGE) {
                return imageHeight + gapAfter;
            }
            return layout.getHeight() + gapAfter;
        }
    }

    /** 测量所有块并生成绘制项（封面/插图取字节 → 解码；失败跳过）。 */
    private static List<Item> layoutItems(PixivImageLoader loader, NovelExportModel model,
            BooleanSupplier cancelled) throws NovelExportCancelledException {
        List<Item> items = new ArrayList<>();
        if (model.options.includeCover && model.meta.coverUrl != null) {
            byte[] bytes = loadImage(loader, model.meta.coverUrl, cancelled);
            Bitmap bmp = decode(bytes, model.meta.coverUrl);
            if (bmp != null) {
                items.add(imageItem(bmp));
            }
        }
        items.add(textItem(Kind.TITLE, model.meta.title, null, TITLE_GAP, TITLE_SIZE, true));
        if (model.options.includeMetadata) {
            items.add(textItem(Kind.META, "作者：" + model.meta.authorName, null, PARAGRAPH_GAP,
                    META_SIZE, false));
            if (!model.meta.tags.isEmpty()) {
                items.add(textItem(Kind.META, "标签：" + String.join("、", model.meta.tags), null,
                        PARAGRAPH_GAP, META_SIZE, false));
            }
            if (model.meta.seriesTitle != null) {
                items.add(textItem(Kind.META, "系列：" + model.meta.seriesTitle, null,
                        PARAGRAPH_GAP, META_SIZE, false));
            }
            items.add(textItem(Kind.META, "发布：" + model.meta.createDate, null, PARAGRAPH_GAP,
                    META_SIZE, false));
            items.add(textItem(Kind.META, "原文：" + model.meta.sourceUrl, null, PARAGRAPH_GAP,
                    META_SIZE, false));
            if (model.meta.description != null && !model.meta.description.isEmpty()) {
                items.add(textItem(Kind.META, "简介：" + model.meta.description, null,
                        PARAGRAPH_GAP, META_SIZE, false));
            }
        }
        for (NovelExportModel.Block b : model.blocks) {
            if (b instanceof NovelExportModel.TextBlock) {
                NovelExportModel.TextBlock t = (NovelExportModel.TextBlock) b;
                items.add(textItem(Kind.TEXT, t.text, t.inlineRuns, PARAGRAPH_GAP, BODY_SIZE,
                        false));
            } else if (b instanceof NovelExportModel.ChapterBlock) {
                items.add(textItem(Kind.HEADING, ((NovelExportModel.ChapterBlock) b).title, null,
                        HEADING_GAP, HEADING_SIZE, true));
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                items.add(new Item(Kind.PAGE_BREAK, null, null, 0, 0, 0));
            } else if (b instanceof NovelExportModel.ImageBlock) {
                if (model.options.includeInlineImages) {
                    NovelExportModel.ImageBlock img = (NovelExportModel.ImageBlock) b;
                    byte[] bytes = loadImage(loader, img.url, cancelled);
                    Bitmap bmp = decode(bytes, img.url);
                    if (bmp != null) {
                        items.add(imageItem(bmp));
                    }
                }
            } else if (b instanceof NovelExportModel.JumpBlock) {
                NovelExportModel.JumpBlock j = (NovelExportModel.JumpBlock) b;
                items.add(textItem(Kind.META, "[" + j.kind + ":" + j.target + "] " + j.url, null,
                        PARAGRAPH_GAP, META_SIZE, false));
            }
        }
        return items;
    }

    private static Item imageItem(Bitmap bmp) {
        int w = bmp.getWidth() > 0 ? bmp.getWidth() : CONTENT_WIDTH;
        int h = bmp.getHeight() > 0 ? bmp.getHeight() : CONTENT_WIDTH;
        int drawWidth = CONTENT_WIDTH;
        int drawHeight = Math.max(1, (int) ((long) CONTENT_WIDTH * h / w));
        return new Item(Kind.IMAGE, null, bmp, drawWidth, drawHeight, IMAGE_GAP);
    }

    private static Item textItem(Kind kind, String text, List<NovelExportModel.InlineRun> runs,
            int gapAfter, float sizePt, boolean bold) {
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextSize(sizePt);
        paint.setColor(Color.BLACK);
        if (bold) {
            paint.setTypeface(Typeface.DEFAULT_BOLD);
        }
        CharSequence content = applyRuns(text, runs);
        StaticLayout layout = StaticLayout.Builder
                .obtain(content, 0, content.length(), paint, CONTENT_WIDTH)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setIncludePad(false)
                .build();
        return new Item(kind, layout, null, 0, 0, gapAfter);
    }

    /** 行内样式 → SpannableString span（越界安全）。 */
    private static CharSequence applyRuns(String text, List<NovelExportModel.InlineRun> runs) {
        SpannableString span = new SpannableString(text);
        if (runs == null || runs.isEmpty()) {
            return span;
        }
        int len = text.length();
        for (NovelExportModel.InlineRun r : runs) {
            int start = Math.max(0, Math.min(len, r.start));
            int end = Math.max(start, Math.min(len, r.end));
            if (end <= start) {
                continue;
            }
            switch (r.tag) {
                case "bold":
                    span.setSpan(new StyleSpan(Typeface.BOLD), start, end,
                            SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
                    break;
                case "italic":
                    span.setSpan(new StyleSpan(Typeface.ITALIC), start, end,
                            SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
                    break;
                case "strike":
                    span.setSpan(new StrikethroughSpan(), start, end,
                            SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
                    break;
                case "underline":
                    span.setSpan(new UnderlineSpan(), start, end,
                            SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
                    break;
                default:
                    break;
            }
        }
        return span;
    }

    // ── 绘制 / 分页 ──────────────────────────────────────────

    private static void render(PixivImageLoader loader, NovelExportModel model, PdfBackend backend,
            BooleanSupplier cancelled) throws NovelExportCancelledException {
        List<Item> items = layoutItems(loader, model, cancelled);
        List<Integer> heights = new ArrayList<>(items.size());
        List<Boolean> breaks = new ArrayList<>(items.size());
        for (Item item : items) {
            heights.add(item.height());
            breaks.add(item.kind == Kind.PAGE_BREAK);
        }
        List<List<Integer>> pages = new Paginator(CONTENT_HEIGHT).paginate(heights, breaks);

        Paint imagePaint = new Paint(Paint.FILTER_BITMAP_FLAG);
        for (List<Integer> page : pages) {
            Canvas canvas = backend.startPage(PAGE_WIDTH, PAGE_HEIGHT);
            int y = MARGIN;
            for (int idx : page) {
                Item item = items.get(idx);
                if (item.kind == Kind.IMAGE) {
                    RectF dst = new RectF(MARGIN, y, MARGIN + item.imageWidth,
                            y + item.imageHeight);
                    canvas.drawBitmap(item.bitmap, null, dst, imagePaint);
                    y += item.imageHeight + item.gapAfter;
                } else if (item.layout != null) {
                    canvas.save();
                    canvas.translate(MARGIN, y);
                    item.layout.draw(canvas);
                    canvas.restore();
                    y += item.layout.getHeight() + item.gapAfter;
                }
            }
            backend.finishPage();
        }
    }

    /**
     * 纯分页器（与 Android 图形无关，可单独单测）：
     * 把带高度的块序列切成每页内容高度 ≤ capacity 的页，{@code breaks} 为 true 的块
     * 强制开启新页且自身不占位、不进入任何页（作为分页标记）。
     */
    static final class Paginator {
        private final int capacity;

        Paginator(int capacity) {
            this.capacity = capacity;
        }

        List<List<Integer>> paginate(List<Integer> heights, List<Boolean> breaks) {
            List<List<Integer>> pages = new ArrayList<>();
            List<Integer> current = new ArrayList<>();
            int used = 0;
            int count = heights == null ? 0 : heights.size();
            for (int i = 0; i < count; i++) {
                if (breaks != null && i < breaks.size() && Boolean.TRUE.equals(breaks.get(i))) {
                    if (!current.isEmpty()) {
                        pages.add(current);
                        current = new ArrayList<>();
                        used = 0;
                    }
                    continue;
                }
                int h = Math.max(0, heights.get(i));
                if (!current.isEmpty() && used + h > capacity) {
                    pages.add(current);
                    current = new ArrayList<>();
                    used = 0;
                }
                current.add(i);
                used += h;
            }
            if (!current.isEmpty()) {
                pages.add(current);
            }
            if (pages.isEmpty()) {
                pages.add(new ArrayList<>());
            }
            return pages;
        }
    }

    // ── 取图 / 解码 ──────────────────────────────────────────

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

    private static Bitmap decode(byte[] bytes, String url) {
        if (bytes == null || bytes.length == 0) {
            return null;
        }
        try {
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null || bmp.getWidth() <= 0 || bmp.getHeight() <= 0) {
                Log.w(TAG, "图片解码失败，已跳过: " + url);
                return null;
            }
            return bmp;
        } catch (Throwable t) {
            Log.w(TAG, "图片解码异常，已跳过: " + url, t);
            return null;
        }
    }
}
