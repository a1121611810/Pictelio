package io.pictelio.app;

import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.List;

/**
 * MP4（H.264）编码器（spec docs/specs/download-manager.md §6；main sourceSet 双引擎共享）。
 *
 * <p>纯函数部分（{@link #argbToYuv420} / {@link #computeFrameRate} /
 * {@link #computePresentationTimestampsUs}）与 Android 编解码器解耦，JVM 可单测；
 * {@link #encode} 走 {@link MediaCodec}（YUV420Flexible Image 输入）+ {@link MediaMuxer}，
 * 依赖真机编码器（Robolectric 无 MediaCodec 实现 → 该路径由设备批次验收，spec §9 已申报）。
 *
 * <p>限制：宽高必须为偶数（H.264 要求）；不支持的设备抛可读 IOException（无静默降级）。
 */
public final class Mp4Encoder {

    private static final String MIME = "video/avc";
    private static final int DEFAULT_BITRATE = 2_000_000;
    private static final long DEQUEUE_TIMEOUT_US = 10_000L;

    private Mp4Encoder() {}

    /** 帧率（由平均帧延时折算，clamp 1..60；无有效延时回退 10fps）。 */
    public static int computeFrameRate(int[] delaysMs) {
        long total = 0;
        int n = 0;
        if (delaysMs != null) {
            for (int d : delaysMs) {
                if (d > 0) {
                    total += d;
                    n++;
                }
            }
        }
        if (n == 0 || total == 0) {
            return 10;
        }
        int fps = (int) Math.round(n * 1000.0 / total);
        return Math.max(1, Math.min(60, fps));
    }

    /** 累计展示时间戳（微秒）：pts[i] = 前 i 帧延时之和；缺省帧延时 100ms。 */
    public static long[] computePresentationTimestampsUs(int[] delaysMs, int frameCount) {
        long[] pts = new long[frameCount];
        long acc = 0;
        for (int i = 0; i < frameCount; i++) {
            pts[i] = acc;
            long d = (delaysMs != null && i < delaysMs.length && delaysMs[i] > 0) ? delaysMs[i] : 100L;
            acc += d * 1000L;
        }
        return pts;
    }

    /** 总时长（微秒），用于 EOS 时间戳。 */
    public static long computeDurationUs(int[] delaysMs, int frameCount) {
        long acc = 0;
        for (int i = 0; i < frameCount; i++) {
            long d = (delaysMs != null && i < delaysMs.length && delaysMs[i] > 0) ? delaysMs[i] : 100L;
            acc += d;
        }
        return acc * 1000L;
    }

    private static int bitrateFor(int width, int height) {
        return Math.max(DEFAULT_BITRATE, width * height * 8);
    }

    /**
     * ARGB（长度 width*height）→ YUV420 平面（BT.601 有限范围，H.264 常用）。
     * yPlane 长度 width*height；uPlane/vPlane 长度 width*height/4（4:2:0 下采样均值）。
     */
    public static void argbToYuv420(int[] argb, int width, int height, byte[] yPlane,
            byte[] uPlane, byte[] vPlane) {
        for (int j = 0; j < height; j++) {
            for (int i = 0; i < width; i++) {
                int p = argb[j * width + i];
                int r = (p >> 16) & 0xff;
                int g = (p >> 8) & 0xff;
                int b = p & 0xff;
                int y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                yPlane[j * width + i] = (byte) clamp(y);
            }
        }
        int cw = width / 2;
        for (int j = 0; j < height / 2; j++) {
            for (int i = 0; i < cw; i++) {
                int sr = 0;
                int sg = 0;
                int sb = 0;
                for (int dy = 0; dy < 2; dy++) {
                    for (int dx = 0; dx < 2; dx++) {
                        int p = argb[(j * 2 + dy) * width + (i * 2 + dx)];
                        sr += (p >> 16) & 0xff;
                        sg += (p >> 8) & 0xff;
                        sb += p & 0xff;
                    }
                }
                int r = sr / 4;
                int g = sg / 4;
                int b = sb / 4;
                int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                uPlane[j * cw + i] = (byte) clamp(u);
                vPlane[j * cw + i] = (byte) clamp(v);
            }
        }
    }

    private static int clamp(int v) {
        return Math.max(0, Math.min(255, v));
    }

    /**
     * 编码为 MP4（H.264）并写入 out。阻塞 IO，调用方自备线程。
     *
     * @param frames   每帧 ARGB（长度 width*height）
     * @param delaysMs 每帧延时（缺省 100ms）
     */
    public static void encode(List<int[]> frames, int width, int height, int[] delaysMs, File out)
            throws IOException {
        if (frames == null || frames.isEmpty()) {
            throw new IOException("MP4 编码失败：无帧");
        }
        if (width <= 0 || height <= 0) {
            throw new IOException("MP4 编码失败：尺寸非法 " + width + "x" + height);
        }
        if ((width & 1) != 0 || (height & 1) != 0) {
            throw new IOException("MP4 编码失败：H.264 要求宽高为偶数 " + width + "x" + height);
        }
        MediaCodec codec = null;
        MediaMuxer muxer = null;
        try {
            MediaFormat format = MediaFormat.createVideoFormat(MIME, width, height);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrateFor(width, height));
            format.setInteger(MediaFormat.KEY_FRAME_RATE, computeFrameRate(delaysMs));
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);

            codec = MediaCodec.createEncoderByType(MIME);
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            muxer = new MediaMuxer(out.getAbsolutePath(),
                    MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            int[] track = {-1};
            boolean[] muxerStarted = {false};
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long[] pts = computePresentationTimestampsUs(delaysMs, frames.size());

            int cw = width / 2;
            int ch = height / 2;
            byte[] yPlane = new byte[width * height];
            byte[] uPlane = new byte[cw * ch];
            byte[] vPlane = new byte[cw * ch];

            for (int f = 0; f < frames.size(); f++) {
                int inIndex = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US);
                if (inIndex < 0) {
                    throw new IOException("MP4 编码失败：等待输入缓冲超时（第 " + f + " 帧）");
                }
                Image image = codec.getInputImage(inIndex);
                if (image == null) {
                    throw new IOException("MP4 编码失败：编码器不支持 Image 输入");
                }
                argbToYuv420(frames.get(f), width, height, yPlane, uPlane, vPlane);
                copyPlane(image.getPlanes()[0], yPlane, width, height);
                copyPlane(image.getPlanes()[1], uPlane, cw, ch);
                copyPlane(image.getPlanes()[2], vPlane, cw, ch);
                codec.queueInputBuffer(inIndex, 0, width * height * 3 / 2, pts[f], 0);
                drain(codec, muxer, info, track, muxerStarted, false);
            }

            int inIndex = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US);
            if (inIndex >= 0) {
                codec.queueInputBuffer(inIndex, 0, 0, computeDurationUs(delaysMs, frames.size()),
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            }
            drain(codec, muxer, info, track, muxerStarted, true);
        } catch (IOException e) {
            throw e;
        } catch (Throwable e) {
            throw new IOException("MP4 编码失败：" + (e.getMessage() != null ? e.getMessage()
                    : e.getClass().getSimpleName()), e);
        } finally {
            if (codec != null) {
                try {
                    codec.stop();
                } catch (Throwable ignored) {
                    // 停止失败不覆盖主异常
                }
                codec.release();
            }
            if (muxer != null) {
                try {
                    muxer.stop();
                } catch (Throwable ignored) {
                    // 未启动则 stop 抛错，忽略
                }
                muxer.release();
            }
        }
    }

    private static void copyPlane(Image.Plane plane, byte[] src, int w, int h) {
        ByteBuffer buf = plane.getBuffer();
        int rowStride = plane.getRowStride();
        int pixelStride = plane.getPixelStride();
        for (int j = 0; j < h; j++) {
            for (int i = 0; i < w; i++) {
                buf.put(j * rowStride + i * pixelStride, src[j * w + i]);
            }
        }
    }

    /** 排空编码器输出到 muxer；endOfStream=true 时持续排空到 EOS。 */
    private static void drain(MediaCodec codec, MediaMuxer muxer, MediaCodec.BufferInfo info,
            int[] track, boolean[] muxerStarted, boolean endOfStream) {
        boolean eos = false;
        while (!eos) {
            int outIndex = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US);
            if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) {
                    return;
                }
            } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                track[0] = muxer.addTrack(codec.getOutputFormat());
                muxer.start();
                muxerStarted[0] = true;
            } else if (outIndex >= 0) {
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0
                        && muxerStarted[0]) {
                    muxer.writeSampleData(track[0], codec.getOutputBuffer(outIndex), info);
                }
                codec.releaseOutputBuffer(outIndex, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    eos = true;
                }
            }
        }
    }
}
