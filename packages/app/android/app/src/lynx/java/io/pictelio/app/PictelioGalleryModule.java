package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 保存到相册 Native Module（spec docs/specs/image-save-download.md §3 D2，lynx 引擎薄壳）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioGallery}。
 * 下载/缓存/落盘决策全在 {@link GallerySaver}（main sourceSet 深模块，与 webview 引擎共享）。
 *
 * <p>回调契约（Callback.invoke；无 null——真机 CallbackImpl 对 null 崩溃）：
 * {@code saveImage(url, fileName, cb)}——成功 cb(uri, "")（content:// 或 file://）；
 * 失败 cb("", errMsg)（可读错误信息）。
 */
public class PictelioGalleryModule extends LynxModule {

    private static final String TAG = "PictelioGalleryModule";

    /** 保存为阻塞 IO（下载 + 写媒体库，原图可达数十 MB），不能占用 Lynx 调用线程 */
    private static final ExecutorService SAVE_EXECUTOR = Executors.newCachedThreadPool();

    /** 共享图片加载器单例（Context 键控，与 PixivApiPlugin 同款防 Robolectric 跨测试泄漏） */
    private static volatile PixivImageLoader imageLoader;
    private static volatile Context imageLoaderApp;

    /** 包可见：测试注入隔离（生产与保存链路共享同一 loader） */
    static PixivImageLoader imageLoader(Context context) {
        Context app = context.getApplicationContext();
        PixivImageLoader l = imageLoader;
        if (l == null || imageLoaderApp != app) {
            synchronized (PictelioGalleryModule.class) {
                app = context.getApplicationContext();
                if (imageLoader == null || imageLoaderApp != app) {
                    imageLoader = new PixivImageLoader(app);
                    imageLoaderApp = app;
                }
                l = imageLoader;
            }
        }
        return l;
    }

    public PictelioGalleryModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void saveImage(String url, String fileName, Callback callback) {
        if (url == null || url.isEmpty() || fileName == null || fileName.isEmpty()) {
            callback.invoke("", "url 和 fileName 不能为空");
            return;
        }

        final Context appContext = appContext();
        SAVE_EXECUTOR.execute(() -> {
            try {
                GallerySaver.SaveResult r = GallerySaver.save(appContext,
                        imageLoader(appContext), url, fileName);
                callback.invoke(r.uri.toString(), "");
            } catch (Throwable e) {
                Log.w(TAG, "saveImage 失败: " + url, e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", msg);
            }
        });
    }
}
