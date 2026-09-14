package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 下载队列执行器 Native Module（spec docs/specs/download-manager.md §4.3，lynx 引擎薄壳）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioDownloader}；执行决策全在 {@link PictelioDownloader}。
 * 回调契约（Callback.invoke；无 null）：成功 {@code cb(value, "")}，失败 {@code cb("", errMsg)}。
 * 进度采用**拉模式**（Lynx Callback 一次性，对齐 UgoiraStreamEngine）：{@code pollProgress(id)}
 * 返回 {@code "done/total"}（无在途任务返回 {@code "-1/0"}）。
 */
public class PictelioDownloaderModule extends LynxModule {

    private static final String TAG = "PictelioDownloaderModule";

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    /** 在途任务进度快照：taskId → [done, total] */
    private static final ConcurrentHashMap<String, long[]> PROGRESS = new ConcurrentHashMap<>();

    public PictelioDownloaderModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void start(String id, String sourceUrl, String fileName, String kind, String targetFormat,
            String framesJson, String payloadJson, Callback callback) {
        if (id == null || id.isEmpty() || sourceUrl == null || sourceUrl.isEmpty()
                || fileName == null || fileName.isEmpty()) {
            callback.invoke("", "id、sourceUrl、fileName 均不能为空");
            return;
        }
        if ("ugoira".equals(kind) && (targetFormat == null || targetFormat.isEmpty())) {
            callback.invoke("", "ugoira 任务缺少 targetFormat");
            return;
        }
        if ("novel".equals(kind) && (targetFormat == null || targetFormat.isEmpty()
                || payloadJson == null || payloadJson.isEmpty())) {
            callback.invoke("", "novel 任务缺少 targetFormat 或 payloadJson");
            return;
        }
        final Context app = appContext();
        EXECUTOR.execute(() -> {
            try {
                PictelioDownloader.ProgressListener listener =
                        (done, total) -> PROGRESS.put(id, new long[]{done, total});
                String uri;
                if ("ugoira".equals(kind)) {
                    uri = PictelioDownloader.downloadUgoira(app, PictelioGalleryModule.imageLoader(app),
                            id, sourceUrl, targetFormat, fileName, framesJson, listener);
                } else if ("novel".equals(kind)) {
                    uri = PictelioDownloader.downloadNovel(app, PictelioGalleryModule.imageLoader(app),
                            id, payloadJson, targetFormat, fileName, listener);
                } else {
                    uri = PictelioDownloader.download(app, PictelioGalleryModule.imageLoader(app),
                            id, sourceUrl, fileName, listener);
                }
                PROGRESS.remove(id);
                callback.invoke(uri, "");
            } catch (Throwable e) {
                PROGRESS.remove(id);
                Log.w(TAG, "start 失败: " + id, e);
                callback.invoke("", msg(e));
            }
        });
    }

    @LynxMethod
    public void pollProgress(String id, Callback callback) {
        long[] p = id == null ? null : PROGRESS.get(id);
        if (p == null) {
            callback.invoke("-1/0", "");
            return;
        }
        callback.invoke(p[0] + "/" + p[1], "");
    }

    @LynxMethod
    public void cancel(String id, Callback callback) {
        boolean hit = PictelioDownloader.cancel(id);
        callback.invoke(hit ? "1" : "0", "");
    }

    @LynxMethod
    public void deleteFile(String uri, Callback callback) {
        final Context app = appContext();
        EXECUTOR.execute(() -> {
            try {
                PictelioDownloader.deleteFile(app, uri);
                callback.invoke("1", "");
            } catch (Throwable e) {
                Log.w(TAG, "deleteFile 失败: " + uri, e);
                callback.invoke("", msg(e));
            }
        });
    }

    private static String msg(Throwable e) {
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }
}
