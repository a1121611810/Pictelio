package io.pictelio.app;

/**
 * 图片加载链路归属（#984）——判定一次缓存访问<b>是否计入命中率分子</b>。
 *
 * <h3>为什么需要它（#984 修的口径缺陷）</h3>
 * #983 的命中率分母只数显示链路（{@code PictelioImageService.deliver} 记
 * {@link ImageCacheStatsStore#recordRequest()}），但分子里的 {@code diskHits} 是
 * {@link PixivImageLoader} <b>在磁盘层自计</b>的——预取、zip 导出、作品保存三条链路
 * 都经同一个 {@code loadBytesCachedFirst}，它们的命中同样被记进去。
 * 分子含非显示链路、分母不含 ⇒ 命中率可能 {@code >100%}，或分母为 0 时无意义。
 * 这条数字要展示给用户，{@code >100%} 是荒谬的，故本枚举把归属显式化。
 *
 * <h3>口径（分子分母同源）</h3>
 * <ul>
 *   <li><b>分母</b>：显示链路的加载请求数（现状已如此，见 {@link ImageCacheStats}）；</li>
 *   <li><b>分子</b>：<b>显示链路</b>的内存命中 + 磁盘命中。预取 / zip / 保存链路的命中
 *       一律不计入分子；</li>
 *   <li>⇒ 命中率恒落在 0–100%。</li>
 * </ul>
 *
 * <h3>为什么用显式枚举而不是靠方法名推断</h3>
 * {@code loadBytesCachedFirst} 被显示、预取、作品导出三条链路共用
 * （{@code PictelioImageService} 两处 + {@code NovelPdfEncoder} 一处），<b>方法名无法区分</b>；
 * 而磁盘层的命中计数发生在方法内部，若靠「谁调用我」反推，就得引入 ThreadLocal 之类的隐式上下文——
 * 那在复用线程池（预取与显示共用 executor）下极易串味。显式传参是唯一可靠且可单测钉死的做法。
 *
 * <h3>默认值取向</h3>
 * 旧签名 {@link PixivImageLoader#loadBytesCachedFirst(String)} <b>默认
 * {@link #NON_DISPLAY}</b>：漏传时表现为「该次命中不计入分子」（命中率被<b>低估</b>），
 * 而不是被高估成 {@code >100%}。宁可少算，不可算出荒谬值。
 */
public enum ImageLoadChain {

    /** 显示链路（图片要上屏）：磁盘命中<b>计入</b>命中率分子 */
    DISPLAY,

    /**
     * 不计入命中率分子：预取、zip 导出、作品保存、作品导出等非显示链路。
     *
     * <p>另含一处显示链路的<b>回退分支</b>：{@code PictelioImageService.deliver} 探测到内存
     * 条目、但该 Bitmap 已被 {@code recycle} 或交付时抛异常而回退到磁盘层重取的路径。
     * 那次请求的分子<b>已在内存层计入</b>（{@link ImageLoadChain} 口径下内存命中已归因），
     * 若再让磁盘命中计一次，同一请求就贡献 2 次分子、令命中率突破 100%。
     * 故该分支按 {@code NON_DISPLAY} 归因——它仍是显示请求（分母照计），
     * 只是不得<b>重复</b>计入分子。
     */
    NON_DISPLAY
}