package io.pictelio.app.directaccess;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * DoH 解析结果缓存——pictelio-pure-client-direct-access T4。
 *
 * <p><b>定位：DoH 辅助工具的持久化层</b>。{@link DohClient} 解析成功的 IP 列表持久化到
 * SharedPreferences，TTL = 7 天；超过 TTL 视为不可信，下次解析必须重新调 DoH。
 *
 * <p><b>不变量</b>：
 * <ul>
 *   <li>仅缓存通过 {@link DohClient} 解析成功的 IP（即已经过污染检测过滤）；</li>
 *   <li>每次写入同时更新 timestamp（lastFetchAtMillis）；</li>
 *   <li>读取时校验 TTL，过期则视同未命中并删除；</li>
 *   <li>读取时校验每个 IP 仍是合法 IPv4 字面量（防御 SharedPreferences 损坏）；</li>
 *   <li>解析失败 / 写入失败 → warn 必打，不静默降级（#395 硬约束）；</li>
 *   <li>写入失败绝不抛异常（缓存是辅助，主路径不依赖 DoH）；</li>
 * </ul>
 *
 * <p><b>线程安全</b>：{@link SharedPreferences} 自身线程安全；本类所有方法均无共享可变状态。
 *
 * <p><b>key 命名规范</b>：{@code "doh_ip_<host>"}，host 需小写规范（{@code lowercase()}）。
 */
public final class DohCache {

    private static final String TAG = "[DohCache]";

    /** SharedPreferences 文件名（与全工程其它缓存同文件，避免偏好文件碎片化） */
    private static final String PREFS_NAME = "CapacitorStorage";

    /** SharedPreferences 键前缀 */
    private static final String KEY_PREFIX = "doh_ip_";

    /** TTL = 7 天（DoH 端点偶尔轮换，缓存过长会引入过期 IP；7 天为 IP 池轮换经验值） */
    private static final long TTL_MILLIS = TimeUnit.DAYS.toMillis(7);

    private final SharedPreferences prefs;

    /** 默认构造：从应用上下文绑定的 CapacitorStorage 读取 */
    public DohCache(Context context) {
        this(context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE));
    }

    /** 包可见注入构造（测试可直接注入 mock prefs） */
    DohCache(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    /**
     * 缓存解析结果：每个 IP 单独存一个键（避免 SharedPreferences putStringSet 序列化
     * 兼容性问题；扁平结构便于 IPC 与版本迁移）。
     *
     * @param host 已规范化的 hostname（小写）
     * @param ips 解析成功的 IP 列表（必须已通过 {@link DohClient#isPolluted} 过滤）
     * @param timestamp 写入时刻（毫秒）
     */
    public void put(String host, List<String> ips, long timestamp) {
        if (host == null || host.isEmpty()) {
            Log.w(TAG, "put 收到空 host，跳过");
            return;
        }
        if (ips == null || ips.isEmpty()) {
            // 不缓存空列表：避免「空结果被缓存」造成的虚假命中
            Log.w(TAG, "put 收到空 IP 列表，跳过: host=" + host);
            return;
        }
        try {
            // 用 JSON 数组形式存 IP 列表（极简：[ip1,ip2,ip3]）
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < ips.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(ips.get(i));
            }
            sb.append(']');

            String key = KEY_PREFIX + host.toLowerCase();
            prefs.edit()
                    .putString(key, sb.toString())
                    .putLong(key + "_at", timestamp)
                    .apply(); // apply = 异步写、不阻塞、不抛异常
        } catch (Exception e) {
            Log.w(TAG, "put 写入失败（缓存不可失凭，warn 可见）: host=" + host, e);
        }
    }

    /**
     * 读取缓存：TTL 内且 IP 合法则返回，否则返回 null 并清理过期条目。
     */
    public List<String> get(String host, long nowMillis) {
        if (host == null || host.isEmpty()) {
            return null;
        }
        String key = KEY_PREFIX + host.toLowerCase();
        try {
            String stored = prefs.getString(key, null);
            if (stored == null) {
                return null;
            }
            long storedAt = prefs.getLong(key + "_at", 0L);
            if (storedAt <= 0L || (nowMillis - storedAt) > TTL_MILLIS) {
                // 过期：清理 + 返回 null（下次解析必须重新调 DoH）
                prefs.edit().remove(key).remove(key + "_at").apply();
                Log.w(TAG, "get 缓存过期（TTL=" + TTL_MILLIS + "ms），已清理: host=" + host);
                return null;
            }
            List<String> ips = parseStoredIps(stored);
            if (ips.isEmpty()) {
                return null;
            }
            return ips;
        } catch (Exception e) {
            Log.w(TAG, "get 读取失败（缓存不可失凭，warn 可见）: host=" + host, e);
            return null;
        }
    }

    /** 便捷重载：使用 {@link System#currentTimeMillis()} 作为 now */
    public List<String> get(String host) {
        return get(host, System.currentTimeMillis());
    }

    /** 清除某个 host 的缓存 */
    public void evict(String host) {
        if (host == null || host.isEmpty()) return;
        String key = KEY_PREFIX + host.toLowerCase();
        prefs.edit().remove(key).remove(key + "_at").apply();
    }

    /** 获取缓存写入时刻（毫秒）；不存在或损坏返回 0 */
    public long getTimestamp(String host) {
        if (host == null || host.isEmpty()) return 0L;
        return prefs.getLong(KEY_PREFIX + host.toLowerCase() + "_at", 0L);
    }

    /**
     * 极简解析存的 IP 数组：[ip1,ip2,ip3] → List&lt;String&gt;。
     * 每个元素必须通过 {@link DohClient#isIpv4Literal} 校验——防御 SharedPreferences 损坏。
     */
    static List<String> parseStoredIps(String stored) {
        if (stored == null || stored.length() < 2) {
            return new ArrayList<>();
        }
        String trimmed = stored.trim();
        if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
            return new ArrayList<>();
        }
        String inner = trimmed.substring(1, trimmed.length() - 1);
        if (inner.isEmpty()) {
            return new ArrayList<>();
        }
        List<String> ips = new ArrayList<>();
        for (String s : inner.split(",")) {
            String ip = s.trim();
            if (DohClient.isIpv4Literal(ip) && !DohClient.isPolluted(ip)) {
                ips.add(ip);
            }
        }
        return ips;
    }

    /** 包可见：测试断言 TTL 边界 */
    static long ttlMillis() {
        return TTL_MILLIS;
    }

    /** 包可见：测试断言 key 命名规范 */
    static String keyFor(String host) {
        return KEY_PREFIX + host.toLowerCase();
    }

    /** 包可见：测试断言 */
    static List<String> expectedPolluted() {
        return Arrays.asList("0.0.0.0", "127.0.0.1", "10.0.0.1", "192.168.1.1",
                "172.16.0.1", "169.254.0.1");
    }
}