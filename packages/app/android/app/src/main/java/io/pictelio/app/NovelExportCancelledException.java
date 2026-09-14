package io.pictelio.app;

import java.io.IOException;

/**
 * 小说导出取消异常（spec docs/specs/novel-export.md §8；ADR-0154 D2）。
 *
 * <p>与「单张图片下载失败 → Log.w 跳过该图」区分：取消是任务级硬中止，必须向上抛出为
 * {@link IOException}，绝不能降级为跳过图片。{@link NovelExporter} 与三个二进制编码器
 * 在编码前与每次取图前轮询取消信号，命中即抛本异常。
 */
final class NovelExportCancelledException extends IOException {

    private static final long serialVersionUID = 1L;

    NovelExportCancelledException() {
        super("导出已取消");
    }
}
