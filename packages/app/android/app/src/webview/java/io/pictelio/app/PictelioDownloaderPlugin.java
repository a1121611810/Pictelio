package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 下载队列执行器插件（spec docs/specs/download-manager.md §4.3，webview 引擎薄壳）。
 *
 * <p>执行/取消/删除决策全在 {@link PictelioDownloader}（main sourceSet 深模块，与 lynx 引擎共享）；
 * 本壳只做参数校验、线程与进度转译。进度经 {@code notifyListeners("progress", { id, done, total, pct })}。
 *
 * <p>调用方式（JS 侧）：
 * <pre>start({ id, sourceUrl, fileName }) → { uri }
 * cancel({ id })；deleteFile({ uri })</pre>
 */
@CapacitorPlugin(name = "PictelioDownloader")
public class PictelioDownloaderPlugin extends Plugin {

    private static final String TAG = "PictelioDownloaderPlugin";

    /** 阻塞 IO（下载可达数十 MB），不能在主线程派发 */
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    @PluginMethod
    public void start(PluginCall call) {
        String id = call.getString("id");
        String sourceUrl = call.getString("sourceUrl");
        String fileName = call.getString("fileName");
        if (id == null || id.isEmpty() || sourceUrl == null || sourceUrl.isEmpty()
                || fileName == null || fileName.isEmpty()) {
            call.reject("id、sourceUrl、fileName 均不能为空");
            return;
        }
        final String kind = call.getString("kind");
        final String targetFormat = call.getString("targetFormat");
        final String framesJson = call.getString("framesJson");
        final String payloadJson = call.getString("payloadJson");
        if ("ugoira".equals(kind) && (targetFormat == null || targetFormat.isEmpty())) {
            call.reject("ugoira 任务缺少 targetFormat");
            return;
        }
        if ("novel".equals(kind) && (targetFormat == null || targetFormat.isEmpty()
                || payloadJson == null || payloadJson.isEmpty())) {
            call.reject("novel 任务缺少 targetFormat 或 payloadJson");
            return;
        }
        final Context app = getContext().getApplicationContext();
        final PixivImageLoader loader = PixivApiPlugin.imageLoader(getContext());
        EXECUTOR.execute(() -> {
            try {
                PictelioDownloader.ProgressListener listener =
                        (done, total) -> notifyProgress(id, done, total);
                String uri;
                if ("ugoira".equals(kind)) {
                    uri = PictelioDownloader.downloadUgoira(app, loader, id, sourceUrl,
                            targetFormat, fileName, framesJson, listener);
                } else if ("novel".equals(kind)) {
                    uri = PictelioDownloader.downloadNovel(app, loader, id, payloadJson,
                            targetFormat, fileName, listener);
                } else {
                    uri = PictelioDownloader.download(app, loader, id, sourceUrl, fileName, listener);
                }
                JSObject result = new JSObject();
                result.put("uri", uri);
                call.resolve(result);
            } catch (Throwable e) {
                Log.w(TAG, "start 失败: " + id, e);
                call.reject(msg(e));
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        PictelioDownloader.cancel(call.getString("id"));
        call.resolve();
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("uri 不能为空");
            return;
        }
        final Context app = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                PictelioDownloader.deleteFile(app, uri);
                call.resolve();
            } catch (Throwable e) {
                Log.w(TAG, "deleteFile 失败: " + uri, e);
                call.reject(msg(e));
            }
        });
    }

    private void notifyProgress(String id, long done, long total) {
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("done", done);
        data.put("total", total);
        data.put("pct", total > 0 ? (int) Math.min(100, done * 100 / total) : 0);
        notifyListeners("progress", data);
    }

    private static String msg(Throwable e) {
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }
}
