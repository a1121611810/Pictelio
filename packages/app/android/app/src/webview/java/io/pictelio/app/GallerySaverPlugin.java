package io.pictelio.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 保存到相册插件（spec docs/specs/image-save-download.md §3 D2，webview 引擎薄壳）。
 *
 * <p>下载/缓存/落盘决策全在 {@link GallerySaver}（main sourceSet 深模块，与 lynx 引擎共享）；
 * 本壳只做参数校验与结果映射。阻塞执行（与 PixivApiPlugin.request 同姿态，Capacitor
 * 插件方法不在主线程派发）。
 *
 * <p>调用方式（JS 侧）：
 * <pre>GallerySaver.saveImage({ url, fileName }) → { uri }</pre>
 */
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    private static final String TAG = "GallerySaverPlugin";

    @PluginMethod
    public void saveImage(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (url == null || url.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("url and fileName are required");
            return;
        }

        try {
            GallerySaver.SaveResult r = GallerySaver.save(getContext(),
                    PixivApiPlugin.imageLoader(getContext()), url, fileName);
            JSObject result = new JSObject();
            result.put("uri", r.uri.toString());
            result.put("mediaStore", r.mediaStore);
            call.resolve(result);
        } catch (Exception e) {
            Log.w(TAG, "saveImage 失败: " + url, e);
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            call.reject("保存失败: " + msg);
        }
    }
}
