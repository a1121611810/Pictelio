package io.pictelio.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.util.Log;

import com.lynx.tasm.LynxEnv;
import com.lynx.tasm.behavior.Behavior;
import com.lynx.tasm.behavior.LynxContext;
import com.lynx.tasm.behavior.shadow.ShadowNode;
import com.lynx.tasm.behavior.ui.LynxFlattenUI;
import com.lynx.tasm.behavior.ui.LynxUI;
import com.lynx.tasm.behavior.ui.image.FlattenUIImage;
import com.lynx.tasm.behavior.ui.image.InlineImageShadowNode;
import com.lynx.tasm.behavior.ui.image.UIImage;
import com.lynx.tasm.image.AutoSizeImage;
import com.lynx.tasm.image.ImageContent;
import com.lynx.tasm.image.model.AnimationListener;
import com.lynx.tasm.image.model.ImageInfo;
import com.lynx.tasm.image.model.ImageLoadListener;
import com.lynx.tasm.image.model.ImageRequestInfo;
import com.lynx.tasm.service.ILynxImageService;
import com.lynx.tasm.service.IServiceProvider;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 自研 Lynx 图片服务（#59）——Lynx client 图片加载的唯一出口。
 *
 * <p>必须自研的原因（官方集成文档 + 研究 §3）：Lynx 引擎自身不下载图片；
 * 官方默认服务（Fresco）不把图片请求的 customParam 传为 HTTP header，
 * 无法注入 {@code Referer} → i.pximg.net 防盗链返回 403。
 *
 * <p>实现：{@code fetchImage} 走 {@link PixivImageLoader} 公共核心
 * （URL 重写 / 下载注入 Referer-UA / 磁盘缓存），成功解码 Bitmap 回调
 * {@code onSuccess}，失败回调 {@code onFailure}。静态图，动画 4 件套返回 false。
 *
 * <p>注册：{@code LynxServiceCenter.inst().registerService(PictelioImageService.getInstance())}
 * （在 {@code PictelioApp.initLynx()}，须早于任何 LynxView 创建）。
 */
public class PictelioImageService implements ILynxImageService {

    private static final String TAG = "PictelioImageService";

    private static final PictelioImageService INSTANCE = new PictelioImageService();

    /** 下载/解码线程池（fetchImage 为阻塞 IO + Bitmap 解码，不占 JS/主线程） */
    private final ExecutorService executor = Executors.newCachedThreadPool();

    /** onInitialize 注入的 Application context（loader 惰性初始化用；避免 decodeImage/prefetch 传 null） */
    private volatile Context appContext;
    private volatile PixivImageLoader loader;

    public static PictelioImageService getInstance() {
        return INSTANCE;
    }

    private PictelioImageService() {
        registerImageBehaviors();
    }

    /**
     * 注册 &lt;image&gt;/&lt;inline-image&gt; 元素 Behavior（对齐官方 LynxImageService 构造逻辑，
     * 真机实测 #59：只实现 ILynxImageService 接口不够——不注册 behavior 则 lynx 引擎
     * 无法创建 image UI，骨架屏永久显示、无任何图片日志）。
     */
    private void registerImageBehaviors() {
        List<Behavior> behaviorList = new ArrayList<>();
        behaviorList.add(new Behavior("image", true, true) {
            @Override
            public LynxUI createUI(LynxContext context) {
                return new UIImage(context);
            }

            @Override
            public LynxFlattenUI createFlattenUI(LynxContext context) {
                return new FlattenUIImage(context);
            }

            @Override
            public ShadowNode createShadowNode() {
                return new AutoSizeImage();
            }
        });
        behaviorList.add(new Behavior("inline-image", false, true) {
            @Override
            public ShadowNode createShadowNode() {
                return new InlineImageShadowNode();
            }
        });
        try {
            LynxEnv.inst().addBehaviors(behaviorList);
        } catch (Throwable t) {
            // 防御：addBehaviors 依赖 gson（lynx 运行时传递依赖，生产 APK 存在）。
            // 单测 classpath 缺 gson 时跳过注册（不崩构造）；生产缺失则记日志。
            Log.w(TAG, "image behaviors 注册失败（生产环境图片将不可用）", t);
        }
    }

    @Override
    public Class<? extends IServiceProvider> getServiceClass() {
        return ILynxImageService.class;
    }

    @Override
    public void onInitialize(Context context) {
        appContext = context.getApplicationContext();
        loader = new PixivImageLoader(appContext);
    }

    /** 返回已初始化的 loader；onInitialize 未调用时按 appContext 惰性创建；二者皆无返回 null */
    private PixivImageLoader loader() {
        PixivImageLoader l = loader;
        if (l != null) {
            return l;
        }
        Context ctx = appContext;
        if (ctx == null) {
            return null;
        }
        synchronized (this) {
            if (loader == null) {
                loader = new PixivImageLoader(ctx);
            }
            return loader;
        }
    }

    // ── 主入口：图片加载（成功 Bitmap / 失败 onFailure） ────────

    @Override
    public void fetchImage(ImageRequestInfo requestInfo, ImageLoadListener loadListener,
            AnimationListener animationListener, Context context) {
        deliver(requestInfo != null ? requestInfo.getUrl() : null, requestInfo, loadListener, context);
    }

    /** 下载（走 PixivImageLoader）→ 采样解码 Bitmap（防大图 OOM）→ onSuccess/onFailure；后台线程执行 */
    private void deliver(final String url, final ImageRequestInfo requestInfo,
            final ImageLoadListener loadListener, final Context context) {
        if (url == null || url.isEmpty()) {
            loadListener.onFailure(0, new IllegalArgumentException("image url is null"));
            return;
        }
        PixivImageLoader l = loader();
        if (l == null && context != null) {
            l = new PixivImageLoader(context);
        }
        if (l == null) {
            loadListener.onFailure(0, new IllegalStateException("PictelioImageService 未初始化（onInitialize 未调用）"));
            return;
        }
        final PixivImageLoader effectiveLoader = l;
        executor.execute(() -> {
            try {
                byte[] bytes = effectiveLoader.loadBytes(PixivImageLoader.rewriteUrl(url));
                Bitmap bitmap = decodeSampled(bytes);
                if (bitmap == null) {
                    loadListener.onFailure(0, new IOException("Bitmap 解码失败: " + url));
                    return;
                }
                loadListener.onSuccess(
                        new ImageContent(bitmap),
                        requestInfo,
                        new ImageInfo(bitmap.getWidth(), bitmap.getHeight(), false));
            } catch (Throwable t) {
                // fire-and-forget 路径：捕 Throwable（含 OOM），绝不把异常抛到 JS 线程
                Log.w(TAG, "图片加载失败: " + url, t);
                loadListener.onFailure(0, t instanceof Exception ? (Exception) t : new RuntimeException(t));
            }
        });
    }

    /** 大图采样上限（移动端合理内存；原图按需由 Lynx 端 resize 参数驱动，此处先防 OOM） */
    private static final int MAX_DECODE_DIMENSION = 2048;

    /** 先读 bounds 再按需 inSampleSize 解码（2 的幂采样） */
    private static Bitmap decodeSampled(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_DECODE_DIMENSION) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    // ── 动画（本项目静态图，全部返回 false） ──────────────────

    @Override
    public boolean startAnimation(Drawable animatable) {
        return false;
    }

    @Override
    public boolean resumeAnimation(Drawable animatable) {
        return false;
    }

    @Override
    public boolean pauseAnimation(Drawable animatable) {
        return false;
    }

    @Override
    public boolean stopAnimation(Drawable animatable) {
        return false;
    }

    // ── 预取 / 解码 / 释放（复用核心，fire-and-forget） ────────

    @Override
    public void prefetchImage(String uri, Object callerContext, Map<String, Object> params) {
        prefetch(uri);
    }

    @Override
    public void prefetchImage(String uri, Object callerContext, Map<String, Object> params,
            ImageLoadListener loadListener) {
        prefetch(uri);
    }

    private void prefetch(final String uri) {
        if (uri == null || uri.isEmpty()) {
            return;
        }
        final PixivImageLoader l = loader();
        if (l == null) {
            Log.w(TAG, "prefetchImage 跳过：服务未初始化");
            return;
        }
        executor.execute(() -> {
            try {
                l.loadBytes(PixivImageLoader.rewriteUrl(uri));
            } catch (Throwable t) {
                Log.w(TAG, "prefetchImage 失败: " + uri, t);
            }
        });
    }

    @Override
    public void decodeImage(ImageRequestInfo requestInfo, ImageLoadListener listener) {
        deliver(requestInfo != null ? requestInfo.getUrl() : null, requestInfo, listener, null);
    }

    @Override
    public void releaseImage(ImageRequestInfo requestInfo) {
        // Bitmap 由 GC/ImageContent.releaseImageResource 管理，无需额外释放
    }

    @Override
    public void releaseAnimDrawable(Drawable drawable) {
        // 无动画，空实现
    }

    @Override
    public boolean canParseUrl(String url) {
        // 只接管 http(s) 与 /pixiv-img/ 代理路径；data:/file:/asset: 等交给其他通道/直接失败
        return url != null && (url.startsWith("http") || url.contains("/pixiv-img/"));
    }

    // ── Fresco 专用 API（不引 Fresco，空实现保持接口完整） ─────

    @Override
    public void setCustomImageDecoder(Object customImageDecoder) {
    }

    @Override
    public Object getImageSRPostProcessor() {
        return null;
    }

    @Override
    public void setImageSRSize(Object context, android.view.View view) {
    }

    @Override
    public void setImageCacheChoice(String cacheChoice, Object bitmap) {
    }

    @Override
    public void setImagePlaceHolderHash(Object context, Object view, Object url, String hash, String hashId,
            int width, int height, int radius, int roundConer, boolean isAsync) {
    }

    @Override
    public int getImageOrigin(Object context) {
        return 0;
    }

    @Override
    public void setImageSRSize(Object context, int width, int height) {
    }

    @Override
    public void setCacheKeyUri(Object context, Uri uri) {
    }

    @Override
    public void setSampleSize(Object context, int sampleSize) {
    }

    @Override
    public void setImageDecodeRegion(Object context, Rect rect) {
    }
}
