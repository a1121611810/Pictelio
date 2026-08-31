package io.pictelio.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;

/**
 * ugoira 流式渐进引擎（ADR-0128，可测核心 + 拉模式状态机；纯 Java 无 Lynx 依赖）。
 *
 * <p>接口事实（调用方必须知道）：
 * <ul>
 *   <li>{@link #start}：启动流式下载解压写盘（线程池内跑）；同一时刻仅一个活动流——
 *       新 start 自动取消旧流；<b>缓存命中（帧完整）</b>→ 不启动网络流、一次 poll 全量交付（done）</li>
 *   <li>{@link #poll}：返回自上次 poll 以来新交付的帧 URL（JSON：delivered/urls/done/error）；
 *       无新帧快速返回（不阻塞）；done=true 后仍可 poll（最终状态）；error 为可读错误
 *       （下载中断/zip 损坏/帧序不一致——帧序不一致场景由 JS 端降级全量路径）</li>
 *   <li>{@link #cancel}：取消活动流（关闭输入流中断读取；已写盘帧保留 → 下次缓存命中）；
 *       取消后 poll 返回 done=true（无 error）</li>
 *   <li>帧二进制零进 JS 堆：交付形态为 file:// URL 列表（ADR-0037 保持）</li>
 * </ul>
 */
final class UgoiraStreamEngine {

    /** 网络流提供者（生产 = OkHttp 流式响应体；测试注入内存流） */
    interface StreamSource {
        InputStream open() throws IOException;
    }

    /** 帧数解析（薄适配：测试可直接注入计数） */
    interface FrameCountParser {
        int count(String framesJson) throws IOException;
    }

    /** 一次活动流的状态（synchronized 保护） */
    static final class State {
        final String framesJson;
        final File dir;
        final int batchSize;
        final int total;
        final java.util.List<String> urls = new java.util.ArrayList<>();
        int polled;
        boolean done;
        String error;
        boolean cancelled;
        InputStream active;

        State(String framesJson, File dir, int batchSize, int total) {
            this.framesJson = framesJson;
            this.dir = dir;
            this.batchSize = batchSize;
            this.total = total;
        }
    }

    private final ExecutorService executor;
    private final FrameCountParser frameCountParser;
    private final Object lock = new Object();
    private State state;

    UgoiraStreamEngine(ExecutorService executor, FrameCountParser parser) {
        this.executor = executor;
        this.frameCountParser = parser;
    }

    /**
     * 启动流式任务。帧列表解析失败 → 抛 IOException（调用方给可读错误）；
     * 缓存命中 → 不启动网络流，一次 poll 全量交付。
     */
    void start(StreamSource source, String framesJson, File dir, int batchSize) throws IOException {
        int total = frameCountParser.count(framesJson);
        synchronized (lock) {
            cancelLocked();
            State s = new State(framesJson, dir, Math.max(1, batchSize), total);
            JSONArray cached = PictelioApiModule.ugoiraExtractCached(dir, framesJson);
            if (cached != null) {
                try {
                    for (int i = 0; i < cached.length(); i++) {
                        s.urls.add(cached.getString(i));
                    }
                } catch (org.json.JSONException e) {
                    throw new IOException("缓存帧列表解析失败", e);
                }
                android.util.Log.i("PictelioApiModule", "ugoiraStream 缓存命中: " + cached.length() + " 帧");
                s.done = true;
                state = s;
                return;
            }
            state = s;
            executor.execute(() -> runStream(source, s));
        }
    }

    /** 拉取自上次 poll 以来新交付的帧 URL；无新帧快速返回；done/error 为最终状态 */
    JSONObject poll() {
        synchronized (lock) {
            JSONObject payload;
            try {
                payload = new JSONObject();
            State s = state;
            if (s == null) {
                payload.put("delivered", 0);
                payload.put("urls", new JSONArray());
                payload.put("done", true);
                payload.put("error", "ugoira: 流未启动");
                return payload;
            }
            JSONArray urls = new JSONArray();
            for (int i = s.polled; i < s.urls.size(); i++) {
                urls.put(s.urls.get(i));
            }
            s.polled = s.urls.size();
            payload.put("delivered", urls.length());
            payload.put("urls", urls);
            payload.put("done", s.done);
            if (s.error != null) {
                payload.put("error", s.error);
            }
            return payload;
            } catch (org.json.JSONException e) {
                // put 全为字符串/数字/数组，运行期不可能失败；防御性包装
                throw new RuntimeException(e);
            }
        }
    }

    /** 取消活动流（关闭输入流；已写盘帧保留）；取消后 poll 返回 done=true */
    void cancel() {
        synchronized (lock) {
            cancelLocked();
        }
    }

    private void cancelLocked() {
        State s = state;
        if (s == null) {
            return;
        }
        s.cancelled = true;
        s.done = true; // 取消后 poll 即见 done（不报 error）
        InputStream in = s.active;
        s.active = null;
        if (in != null) {
            try {
                in.close();
            } catch (IOException ignored) {
                // 关闭中断读取；任务线程自行收敛
            }
        }
    }

    private void runStream(StreamSource source, State s) {
        try {
            InputStream in = source.open();
            synchronized (lock) {
                if (s.cancelled) {
                    in.close();
                    return;
                }
                s.active = in;
            }
            PictelioApiModule.ugoiraStreamCore(in, s.framesJson, s.dir, s.batchSize, batch -> {
                synchronized (lock) {
                    if (s.cancelled) {
                        return; // 取消后丢弃后续批次
                    }
                    try {
                        for (int i = 0; i < batch.urls.length(); i++) {
                            s.urls.add(batch.urls.getString(i));
                        }
                    } catch (org.json.JSONException e) {
                        s.error = "ugoira: 批次帧列表解析失败";
                        s.done = true;
                    }
                }
            });
            synchronized (lock) {
                s.done = true;
                s.active = null;
            }
        } catch (Throwable t) {
            synchronized (lock) {
                if (s.cancelled) {
                    s.done = true; // 取消导致的 IO 中断：无 error
                } else {
                    s.error = t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
                    s.done = true;
                }
                s.active = null;
            }
        } finally {
            InputStream in;
            synchronized (lock) {
                in = s.active;
                s.active = null;
            }
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // 收尾
                }
            }
        }
    }
}
