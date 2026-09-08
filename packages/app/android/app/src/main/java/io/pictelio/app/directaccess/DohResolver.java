package io.pictelio.app.directaccess;

import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import okhttp3.OkHttpClient;

/**
 * DoH 解析器——pictelio-pure-client-direct-access T4 顶层入口。
 *
 * <p><b>职责</b>：封装 {@link DohClient} + {@link DohCache}，提供"查缓存 → 调 DoH → 写缓存"
 * 的一体化接口，供 T6 设置页"立即刷新直连 IP"按钮调用。
 *
 * <p><b>不接入 PinnedDns</b>：基于 T0 探针结果（沙箱环境所有 DoH 端点不可达，与 GFW 时代
 * 封锁模型一致），DoH 不作为运行时 Dns 实现的依赖——运行时直连完全走内置 IP 表 + 远端
 * IP 表（{@link DirectIpTableDefaults} + {@link IpTableMerger}）。DoH 仅作为用户主动
 * 刷新时的辅助查询手段。
 *
 * <p><b>失败语义</b>：
 * <ul>
 *   <li>缓存命中 → 直接返回（不调 DoH）；</li>
 *   <li>缓存未命中 → 调 {@link DohClient#resolve} → 成功写缓存 + 返回；</li>
 *   <li>DoH 失败 → warn 必打，返回空列表（不抛异常——调用方应展示"刷新失败"UI）；</li>
 *   <li>空 hostname / 已为 IP 字面量 → 直接返回 / 短路。</li>
 * </ul>
 *
 * <p><b>线程安全</b>：{@link DohClient} + {@link DohCache} 自身线程安全；本类无共享可变状态。
 */
public final class DohResolver {

    private static final String TAG = "[DohResolver]";

    private final DohClient client;
    private final DohCache cache;

    /** 默认构造：从应用上下文绑定的 CapacitorStorage + 默认 OkHttpClient */
    public DohResolver(Context context) {
        this(new DohClient(), new DohCache(context));
    }

    /** 包可见注入构造（测试用） */
    DohResolver(DohClient client, DohCache cache) {
        this.client = client;
        this.cache = cache;
    }

    /**
     * 解析 hostname → IP 列表（缓存优先；缓存未命中时实时调 DoH）。
     *
     * @param hostname 要解析的主机名（需小写）
     * @return 非 null IP 列表（可能为空——表示 DoH 失败 + 缓存未命中）
     */
    public List<String> resolveWithCache(String hostname) {
        if (hostname == null || hostname.isEmpty()) {
            return Collections.emptyList();
        }
        String normalized = hostname.toLowerCase();

        // 短路：已是 IP 字面量
        if (DohClient.isIpv4Literal(normalized)) {
            return Collections.singletonList(normalized);
        }

        // 1) 查缓存
        List<String> cached = cache.get(normalized);
        if (cached != null && !cached.isEmpty()) {
            Log.i(TAG, "resolveWithCache 命中缓存: host=" + normalized + " ips=" + cached);
            return cached;
        }

        // 2) 缓存未命中 → 调 DoH
        try {
            List<String> fresh = client.resolve(normalized);
            if (fresh != null && !fresh.isEmpty()) {
                // 过滤污染 IP（双保险：DohClient.resolve 内部已过滤；此处再防一手）
                List<String> clean = new ArrayList<>(fresh.size());
                for (String ip : fresh) {
                    if (!DohClient.isPolluted(ip) && DohClient.isResolvableIp(ip)) {
                        clean.add(ip);
                    }
                }
                if (!clean.isEmpty()) {
                    cache.put(normalized, clean, System.currentTimeMillis());
                    Log.i(TAG, "resolveWithCache DoH 解析成功: host=" + normalized + " ips=" + clean);
                    return clean;
                }
            }
            Log.w(TAG, "resolveWithCache DoH 解析后过滤为空（可能全为污染 IP）: host=" + normalized);
            return Collections.emptyList();
        } catch (IOException e) {
            // 失败 → warn 必打，返回空列表（调用方展示刷新失败 UI）
            Log.w(TAG, "resolveWithCache DoH 失败（缓存未命中，调用方应展示失败 UI）: host="
                    + normalized + " error=" + e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 仅查缓存（不调 DoH）——用于设置页"显示缓存中 IP"展示。
     *
     * @return 缓存中的 IP 列表；不存在/过期返回空列表
     */
    public List<String> peekCached(String hostname) {
        if (hostname == null || hostname.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> cached = cache.get(hostname.toLowerCase());
        return cached != null ? cached : Collections.emptyList();
    }

    /**
     * 主动强制刷新（忽略缓存）——供设置页"立即刷新直连 IP"按钮调用。
     *
     * @return 解析成功的 IP 列表；失败返回空列表
     */
    public List<String> forceRefresh(String hostname) {
        if (hostname == null || hostname.isEmpty()) {
            return Collections.emptyList();
        }
        String normalized = hostname.toLowerCase();

        // 清缓存强制走实时 DoH
        cache.evict(normalized);

        try {
            List<String> fresh = client.resolve(normalized);
            if (fresh != null && !fresh.isEmpty()) {
                List<String> clean = new ArrayList<>(fresh.size());
                for (String ip : fresh) {
                    if (!DohClient.isPolluted(ip) && DohClient.isResolvableIp(ip)) {
                        clean.add(ip);
                    }
                }
                if (!clean.isEmpty()) {
                    cache.put(normalized, clean, System.currentTimeMillis());
                    Log.i(TAG, "forceRefresh DoH 解析成功: host=" + normalized + " ips=" + clean);
                    return clean;
                }
            }
            Log.w(TAG, "forceRefresh DoH 解析为空或全污染: host=" + normalized);
            return Collections.emptyList();
        } catch (IOException e) {
            Log.w(TAG, "forceRefresh DoH 失败: host=" + normalized + " error=" + e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 显式清缓存：用于设置"重置 DoH 缓存"按钮。
     */
    public void evict(String hostname) {
        if (hostname != null) {
            cache.evict(hostname.toLowerCase());
        }
    }

    /** 获取缓存写入时刻（毫秒）；不存在返回 0 */
    public long getCacheTimestamp(String hostname) {
        return hostname != null ? cache.getTimestamp(hostname.toLowerCase()) : 0L;
    }

    /** 包可见：测试断言 OkHttp 注入 */
    OkHttpClient clientOkHttp() {
        // 通过反射或包私有访问器获取 DohClient.client？不必要——测试用包私有构造即可
        return null;
    }
}