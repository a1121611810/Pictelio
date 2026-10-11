package io.pictelio.app;

import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 图片缓存设置薄桥（lynx 引擎；#984）——「高级」页的占用/命中率展示与一键清理。
 *
 * <p>存在理由：图片缓存是原生两层缓存（{@code PictelioImageService} /
 * {@link PixivImageLoader}），JS 侧无从观测也无从清理；而这两个能力正是用户存储被占满时的
 * 自救手段。本模块只做「JS 调不动的那部分调用」，不含任何缓存逻辑（缓存逻辑的唯一实现在
 * {@link PictelioImageService#cacheStats()} 与 {@link PictelioImageService#clearImageCache()}）。
 *
 * <p><b>回调契约</b>（对齐 {@link PictelioApiModule} 的 {@code cb(okCode, payload)} 形态；
 * <b>无 null</b>——真机 CallbackImpl 对 null 崩溃）：
 * <ul>
 *   <li>{@code getStats(cb)}：成功 {@code cb(0, json)}；失败 {@code cb(1, errMsg)}。
 *       json = {@code {requests, hits, hitRate, diskBytes, diskEntries, memoryBytes,
 *       memoryEntries, available}}，其中 {@code available=false} 表示图片服务未初始化
 *       （读到的是空统计，JS 侧据此显示「不可用」而非 0%）；</li>
 *   <li>{@code clear(cb)}：成功 {@code cb(0, json)}；失败 {@code cb(1, errMsg)}。
 *       json = {@code {freedBytes, deletedEntries, failed}}——{@code failed=true} 表示
 *       <b>有条目没删掉</b>，JS 侧须把它显示给用户而不是当作全成功。</li>
 * </ul>
 *
 * <p><b>一律异步执行</b>：两个方法都要遍历磁盘缓存目录（{@code listFiles} + 逐条
 * {@code delete}），是阻塞 IO，放在 JS 线程会卡住渲染，故走本模块私有线程池。
 */
public class PictelioImageCacheModule extends LynxModule {

    private static final String TAG = "PictelioImageCacheModule";

    /** 统计读取与清理的专用线程池（阻塞 IO，不占 JS/主线程） */
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    public PictelioImageCacheModule(android.content.Context context) {
        super(context);
    }

    /** 读取两层缓存统计快照（占用 + 命中率）；口径见 {@link ImageCacheStats} */
    @LynxMethod
    public void getStats(Callback callback) {
        EXECUTOR.execute(() -> {
            try {
                ImageCacheStats stats = PictelioImageService.getInstance().cacheStats();
                JSONObject json = new JSONObject();
                json.put("requests", stats.requests());
                json.put("hits", stats.hits());
                json.put("hitRate", stats.hitRate());
                json.put("diskBytes", stats.diskBytes());
                json.put("diskEntries", stats.diskEntries());
                json.put("memoryBytes", stats.memoryBytes());
                json.put("memoryEntries", stats.memoryEntries());
                // available：图片服务已初始化 ⇒ 读数是真的；false ⇒ 读到的是空统计，
                // JS 侧据此显示「暂不可用」，不得把「没数据」渲染成 0%（禁静默降级）
                json.put("available", PictelioImageService.getInstance().isAvailable());
                callback.invoke(0, json.toString());
            } catch (Throwable e) {
                Log.w(TAG, "读取图片缓存统计失败", e);
                callback.invoke(1, msg(e));
            }
        });
    }

    /**
     * 一键清理：内存层 + 磁盘层，并重置统计（见 {@link PictelioImageService#clearImageCache()}）。
     *
     * <p>磁盘侧只删图片缓存目录的内容，<b>不碰父目录与四个兄弟目录</b>
     * （翻译成果 / ugoira 帧 / 两个进行中的导出目录）——锚定纪律见
     * {@link PixivImageLoader#clearDiskCache()}。
     */
    @LynxMethod
    public void clear(Callback callback) {
        EXECUTOR.execute(() -> {
            try {
                ImageCacheClearResult result = PictelioImageService.getInstance().clearImageCache();
                JSONObject json = new JSONObject();
                json.put("freedBytes", result.freedBytes());
                json.put("deletedEntries", result.deletedEntries());
                json.put("failed", result.failed());
                callback.invoke(0, json.toString());
            } catch (Throwable e) {
                Log.w(TAG, "清理图片缓存失败", e);
                callback.invoke(1, msg(e));
            }
        });
    }

    /** 回调契约无 null：getMessage 为空时降级为异常类名（与 {@link PictelioApiModule} 一致） */
    private static String msg(Throwable e) {
        String raw = e.getMessage();
        return raw != null && !raw.isEmpty() ? raw : e.getClass().getSimpleName();
    }
}