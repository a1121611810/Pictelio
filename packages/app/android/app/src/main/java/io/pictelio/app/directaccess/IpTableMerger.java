package io.pictelio.app.directaccess;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;

/**
 * IP 表三层合并器（spec #385 / ticket #387）：手动编辑 &gt; 远端 JSON &gt; APK 内置，
 * <b>逐条覆盖</b>（per-entry override，非整层替换——手动只改一条不影响其余条目的远端/内置值），
 * 产出不可变快照 {@link Snapshot}。
 *
 * <p><b>输入形态（已解析结构，JSON 解析不在本层）</b>：各层为 {@link Entry} 列表，
 * 由上游（T3 Config 的 JSON 解析 / T5 设置页手动编辑）产出；本层只做结构校验，
 * 不触碰存储、不发网络请求、零 android.* / okhttp3.* 依赖。
 *
 * <p><b>合并语义</b>（违反视为契约破坏）：
 * <ol>
 *   <li>应用顺序 内置 → 远端 → 手动：后应用的层<b>按 host 逐条覆盖</b>先应用的层，
 *       同层内后者覆盖前者（list 顺序即确定性 tie-break）；</li>
 *   <li><b>缺层跳过</b>：任一层为 {@code null} 或空列表 = 该层不存在（正常状态，
 *       如用户从未配置手动表），<b>不告警</b>——缺失非异常；</li>
 *   <li><b>非法条目跳过 + 告警</b>（禁静默降级硬约束）：空 host / 空 IP / 非法 IP 字面量
 *       （仅接受严格 IPv4 点分十进制，拒绝前导零等歧义形态）→ 跳过该条目并经 warn sink
 *       输出告警；其余合法条目照常合并；</li>
 *   <li>产出 {@link Snapshot} 不可变：合并后上游配置变化不影响已产出快照。</li>
 * </ol>
 *
 * <p><b>条目不校验白名单</b>：非官方域条目结构上合法即入表（路由判定由
 * {@link DirectAccessPolicy} 的白名单门先行拦截，天然 inert）——本层只管结构合法性，
 * 白名单单一事实源归 Policy。手动编辑误配官方域外条目属无害冗余，不在此告警。
 *
 * <p><b>告警接缝</b>：{@code warnSink} 构造器注入（接口即测试面，ImageHostConfig 先例）——
 * 纯核心不知 Log/Android；生产装配层注入 {@code msg -> Log.w(TAG, msg)} 适配，测试注入收集器。
 * 线程安全：{@link #merge} 为纯函数（无共享可变态），并发调用安全。
 */
public final class IpTableMerger {

    // ── 值类型 ───────────────────────────────────────────────

    /**
     * host → IP 条目（不可变值对象）。构造即规范化：host 去首尾空白并转小写
     * （域名大小写不敏感，快照 key 统一小写形），IP 仅去首尾空白。
     * 合法性校验在 {@link #merge}（跳过式），构造器不做校验——便于上游透传待校验原始行。
     */
    public static final class Entry {
        private final String host;
        private final String ip;

        public Entry(String host, String ip) {
            this.host = host == null ? null : host.trim().toLowerCase();
            this.ip = ip == null ? null : ip.trim();
        }

        /** 规范形 host（小写、去空白；可能为 null/空 = 非法，由 merge 跳过） */
        public String host() {
            return host;
        }

        /** IP 字面量（去空白；可能为 null/空/非法，由 merge 跳过） */
        public String ip() {
            return ip;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Entry)) {
                return false;
            }
            Entry entry = (Entry) o;
            return Objects.equals(host, entry.host) && Objects.equals(ip, entry.ip);
        }

        @Override
        public int hashCode() {
            return Objects.hash(host, ip);
        }

        @Override
        public String toString() {
            return host + " -> " + ip;
        }
    }

    /**
     * 合并产出的不可变快照：规范化 host（小写）→ 边缘 IP 的只读映射。
     * 供 {@link DirectAccessPolicy#decide} 与设置卡展示消费；线程安全（只读）。
     */
    public static final class Snapshot {
        private final Map<String, String> byHost;

        /** 包可见：快照只应由 {@link #merge} 产出（测试同包可直接构造桩表） */
        Snapshot(List<Entry> entries) {
            Map<String, String> m = new LinkedHashMap<>();
            for (Entry e : entries) {
                m.put(e.host(), e.ip());
            }
            this.byHost = Collections.unmodifiableMap(m);
        }

        /**
         * 精确查询 host 的钉定 IP。host 大小写不敏感（内部转小写后查）；
         * 无条目 / 入参 null 或空白 → {@code null}（缺条目语义，调用方回退系统路线）。
         * 仅精确匹配——域名族通配语义归 Policy 白名单，不在表层。
         */
        public String ipFor(String host) {
            if (host == null) {
                return null;
            }
            String key = host.trim().toLowerCase();
            if (key.isEmpty()) {
                return null;
            }
            return byHost.get(key);
        }

        /** 只读视图（迭代顺序 = 合并应用顺序：内置在前，覆盖不改变首插位置）；禁外部修改 */
        public Map<String, String> entries() {
            return byHost;
        }

        /** 无任何条目（三层全缺/全非法） */
        public boolean isEmpty() {
            return byHost.isEmpty();
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Snapshot)) {
                return false;
            }
            return byHost.equals(((Snapshot) o).byHost);
        }

        @Override
        public int hashCode() {
            return byHost.hashCode();
        }

        @Override
        public String toString() {
            return byHost.toString();
        }
    }

    // ── 合并器本体 ───────────────────────────────────────────

    /** 告警接缝（禁静默降级：每跳过一条非法条目必须可见） */
    private final Consumer<String> warnSink;

    /** @param warnSink 非法条目告警出口，禁 null（生产 = Log.w 适配，测试 = 收集器） */
    public IpTableMerger(Consumer<String> warnSink) {
        this.warnSink = Objects.requireNonNull(warnSink, "warnSink 不得为 null——禁静默降级");
    }

    /**
     * 三层合并（手动 &gt; 远端 &gt; 内置，逐条覆盖）。语义契约见类 javadoc；
     * 恒返回非 null 快照（三层全缺 = 空快照）。
     *
     * @param manual  手动编辑层（最高优先级；null = 未配置）
     * @param remote  远端 JSON 层（null = 未拉取/未配置）
     * @param builtIn APK 内置层（通常传 {@link DirectIpTableDefaults#builtIn()}）
     */
    public Snapshot merge(List<Entry> manual, List<Entry> remote, List<Entry> builtIn) {
        Map<String, String> m = new LinkedHashMap<>();
        // 应用顺序 = 优先级升序：内置 → 远端 → 手动（put 逐条覆盖）
        mergeLayer(m, builtIn, "builtIn");
        mergeLayer(m, remote, "remote");
        mergeLayer(m, manual, "manual");
        // 包可见构造器复用：直接以条目列表重建（保持 key 集合与去重语义一致）
        List<Entry> merged = new ArrayList<>(m.size());
        for (Map.Entry<String, String> e : m.entrySet()) {
            merged.add(new Entry(e.getKey(), e.getValue()));
        }
        return new Snapshot(merged);
    }

    /** 单层应用：逐条校验（合法才 put 覆盖；非法跳过 + warn） */
    private void mergeLayer(Map<String, String> target, List<Entry> layer, String layerName) {
        if (layer == null) {
            return; // 缺层 = 正常状态，静默跳过（契约 2）
        }
        for (int i = 0; i < layer.size(); i++) {
            Entry e = layer.get(i);
            String reason = invalidReason(e);
            if (reason != null) {
                // 禁静默降级：跳过必须可见（含层名与序号，便于定位上游数据问题）
                warnSink.accept("[DirectIpTable] " + layerName + "[" + i + "] 非法条目跳过（"
                        + reason + "）: " + e);
                continue;
            }
            target.put(e.host(), e.ip());
        }
    }

    /** @return 条目非法原因（null = 合法）；只查结构：host 空白 / IP 空白 / 非严格 IPv4 字面量 */
    private static String invalidReason(Entry e) {
        if (e == null) {
            return "null 条目";
        }
        String host = e.host();
        if (host == null || host.isEmpty()) {
            return "host 为空";
        }
        String ip = e.ip();
        if (ip == null || ip.isEmpty()) {
            return "IP 为空";
        }
        if (!isValidIpv4Literal(ip)) {
            return "非法 IPv4 字面量";
        }
        return null;
    }

    /**
     * 严格 IPv4 点分十进制字面量校验：恰 4 段、每段 1–3 位十进制数字、值 0–255、
     * <b>拒绝前导零</b>（{@code 01.2.3.4} 等歧义形态——部分解析器按八进制解释，
     * 钉定表不接受歧义，宁跳过告警）。IPv6 不在支持范围（探针实测边缘均为 IPv4；
     * IPv6 条目按非法跳过 + 告警，可见非静默）。
     */
    static boolean isValidIpv4Literal(String ip) {
        int segStart = 0;
        int segments = 0;
        int len = ip.length();
        for (int i = 0; i <= len; i++) {
            if (i < len && ip.charAt(i) != '.') {
                continue;
            }
            // 段边界：[segStart, i)
            segments++;
            if (segments > 4) {
                return false; // 超过 4 段
            }
            int segLen = i - segStart;
            if (segLen < 1 || segLen > 3) {
                return false; // 空段 / 超 3 位
            }
            int value = 0;
            for (int j = segStart; j < i; j++) {
                char c = ip.charAt(j);
                if (c < '0' || c > '9') {
                    return false; // 非数字
                }
                value = value * 10 + (c - '0');
            }
            if (value > 255) {
                return false; // 越界
            }
            if (segLen > 1 && ip.charAt(segStart) == '0') {
                return false; // 前导零（"0" 本身合法）
            }
            segStart = i + 1;
        }
        return segments == 4;
    }
}
