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

import java.io.File;
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
 *
 * <h3>交付副本为何可以撤掉（#147 → 2026-10-04 实测）</h3>
 * #147 曾让每次交付都带一份 {@code copy(ARGB_8888, false)}，理由是「引擎管理所收
 * Bitmap 的生命周期，渲染后可能 recycle，复用缓存原图会导致二次显示空白」。
 * 2026-10-04 在 {@code pictelio_ui}（API 34）实测该前提不成立：
 * <ul>
 *   <li>直接交付缓存原实例，copy 与 direct 两轮合计 <b>185 次交付</b>，
 *       1.5s / 5s 两个观察窗内 {@code isRecycled()} 命中 <b>0 次</b>；</li>
 *   <li>direct 模式下 100/100 次交付的就是缓存实例本身，二次显示（同 URL 重取）
 *       全部成功、拿到同一实例、0 失败、0 条「图片加载失败」。</li>
 * </ul>
 * ⇒ 引擎当前不回收所收 Bitmap，copy 是每张图一份 {@code w×h×4} 的纯开销
 * （600×800 缩略图 ≈ 1.9MB/张，1200 级 master ≈ 5.8MB/张）。
 *
 * <p><b>未覆盖，改动前需复测的边界</b>：真机（本次全程模拟器）、master 大图
 * （实测样本全是 600px 级缩略图）、>5s 的观察窗（若引擎改为「出屏才回收」则抓不到）、
 * 以及与 #147 原始复现所用的引擎版本差异。命中路径因此保留
 * {@code cached.isRecycled()} 检查作为兜底：若缓存项真被外部回收，仍走重取而非崩。
 * 证据留档：issue #924 + throwaway 分支 {@code proto/image-copy-feasibility}。
 */
public class PictelioImageService implements ILynxImageService {

    private static final String TAG = "PictelioImageService";

    private static final PictelioImageService INSTANCE = new PictelioImageService();

    /** 下载/解码线程池（fetchImage 为阻塞 IO + Bitmap 解码，不占 JS/主线程） */
    private final ExecutorService executor = Executors.newCachedThreadPool();

    /** 解码后 Bitmap 内存缓存（#147）：命中免磁盘读+解码；未命中走原链路后入缓存 */
    private final ImageMemoryCache memoryCache = new ImageMemoryCache();

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

    /** 内存缓存命中在 executor 内交付副本；未命中下载+解码后入缓存再回调；后台线程执行 */
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
        // #147 内存缓存命中：跳过磁盘读 + 解码。交付 Bitmap **副本**（ARGB_8888 copy）——
        // lynx 引擎管理所收 Bitmap 的生命周期（渲染后可能 recycle），复用原图实例会导致
        // 二次显示空白/JS 异常（模拟器实测 2026-08-06）；副本交付后引擎可安全处理。
        // #147 内存缓存命中：跳过磁盘读 + 解码（隔离实验已排除非缓存因素）
        final Bitmap cached = memoryCache.get(url);
        if (cached != null) {
            executor.execute(() -> {
                try {
                    // #147 曾在此交付副本（ARGB_8888 copy）以防引擎回收缓存原实例。
                    // 2026-10-04 实测：该前提在本配置下不成立（详见下方注释），
                    // 故改为直接交付缓存实例；防御性检查从「copy 返回 null」换成
                    // 零成本的 isRecycled()——若缓存项真的被外部回收，仍走重取而非崩。
                    if (cached.isRecycled()) {
                        // 缓存项已失效（被外部 recycle/OOM）→ 移除条目并回退下载
                        memoryCache.remove(url);
                        loadAndDeliver(url, requestInfo, loadListener, effectiveLoader);
                        return;
                    }
                    loadListener.onSuccess(
                            new ImageContent(cached),
                            requestInfo,
                            new ImageInfo(cached.getWidth(), cached.getHeight(), false));
                } catch (Throwable t) {
                    Log.w(TAG, "内存缓存交付失败，回退下载: " + url, t);
                    memoryCache.remove(url);
                    loadAndDeliver(url, requestInfo, loadListener, effectiveLoader);
                }
            });
            return;
        }
        executor.execute(() -> loadAndDeliver(url, requestInfo, loadListener, effectiveLoader));
    }

    /** executor 线程内执行：磁盘缓存/下载 → 采样解码 → 入内存缓存 → onSuccess（fire-and-forget） */
    private void loadAndDeliver(final String url, final ImageRequestInfo requestInfo,
            final ImageLoadListener loadListener, final PixivImageLoader l) {
        try {
            byte[] bytes;
            if (url.startsWith("file://")) {
                // 解压写盘管线（ADR-0125）：file:// 帧直接读盘，不走 OkHttp（file scheme 会被拒）。
                // 白名单已由 canParseUrl 前置校验，此处防御性二次检查。
                File f = new File(Uri.parse(url).getPath());
                if (!isInUgoiraCacheDir(f)) {
                    throw new IOException("file:// 路径不在 ugoira 缓存白名单内: " + url);
                }
                bytes = java.nio.file.Files.readAllBytes(f.toPath());
            } else {
                bytes = l.loadBytes(PixivImageLoader.rewriteUrl(url));
            }
            Bitmap bitmap = decodeSampled(bytes);
            if (bitmap == null) {
                loadListener.onFailure(0, new IOException("Bitmap 解码失败: " + url));
                return;
            }
            // 解码成功入内存缓存（缓存存原图）并**直接交付同一实例**。
            // #147 曾交付副本防「引擎回收所收 Bitmap」，2026-10-04 实测该前提不成立：
            // 见本类「交付副本为何可以撤掉」注释。
            memoryCache.put(url, bitmap);
            loadListener.onSuccess(
                    new ImageContent(bitmap),
                    requestInfo,
                    new ImageInfo(bitmap.getWidth(), bitmap.getHeight(), false));
        } catch (Throwable t) {
            // fire-and-forget 路径：捕 Throwable（含 OOM），绝不把异常抛到 JS 线程
            Log.w(TAG, "图片加载失败: " + url, t);
            loadListener.onFailure(0, t instanceof Exception ? (Exception) t : new RuntimeException(t));
        }
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
        // 只接管 http(s) 与 /pixiv-img/ 代理路径；data:/asset: 等交给其他通道/直接失败。
        // file:// 仅放行 ugoira 缓存白名单（ADR-0125 解压写盘管线帧）。
        if (url == null) return false;
        if (url.startsWith("file://")) {
            return isInUgoiraCacheDir(new File(Uri.parse(url).getPath()));
        }
        return url.startsWith("http") || url.contains("/pixiv-img/");
    }

    /** ugoira 帧缓存目录名（与 PictelioApiModule.ugoiraExtract 写盘路径契约一致） */
    static final String UGOIRA_CACHE_DIR = "ugoira";

    /**
     * file:// 白名单：目标文件必须位于「应用缓存目录/ugoira/」内（防任意文件读取）。
     * 校验规范化绝对路径前缀；cacheDir 未初始化时保守拒绝（canParseUrl 返回 false）。
     */
    private boolean isInUgoiraCacheDir(File f) {
        if (f == null) return false;
        try {
            Context ctx = appContext;
            if (ctx == null) return false;
            File allowedDir = new File(ctx.getCacheDir(), UGOIRA_CACHE_DIR);
            String allowed = allowedDir.getCanonicalPath();
            String target = f.getCanonicalPath();
            return target.startsWith(allowed + File.separator);
        } catch (Throwable t) {
            return false;
        }
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
