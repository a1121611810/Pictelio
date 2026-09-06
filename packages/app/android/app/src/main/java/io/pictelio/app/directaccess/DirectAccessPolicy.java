package io.pictelio.app.directaccess;

import io.pictelio.app.ImageHostConfig;

import java.util.Objects;

/**
 * 直连路由判定纯函数（spec #385 / ticket #387）：官方域名进 → 路线决策出。
 * SYSTEM = 系统路线（现状行为，直连无感）；PINNED(channel, ip) = 钉定直连
 * （传输层 T2 据此钉 IP + 剥 SNI）。
 *
 * <p><b>判定门序</b>（短路返回 SYSTEM；顺序有契约含义，违反视为契约破坏）：
 * <ol>
 *   <li><b>开关门</b>：开关非 ON（OFF / UNSET / null）→ SYSTEM——直连永远默认关（user story 5）；</li>
 *   <li><b>入参门</b>：host null/空白 → SYSTEM；</li>
 *   <li><b>白名单门</b>：非 {@code *.pixiv.net} / {@code *.pximg.net} → SYSTEM——
 *       复用 {@link ImageHostConfig#isOfficialDomain}（白名单单一事实源，不自实现同语义判定）；
 *       镜像 URL、GitHub（更新检查）、OTA host 不在域族内，<b>天然排除恒走系统路线</b>
 *       （spec 白名单边界，线缆形态与未安装直连时逐字节一致）；</li>
 *   <li><b>IP 表门</b>：表缺失或该 host 无条目 → SYSTEM——白名单内但无钉定值即不瞎猜边缘
 *       （421 特化：错边缘 IP 得错配而非封锁，宁回退不误钉）；</li>
 *   <li><b>通道分类</b>：pximg 系 → IMAGE，pixiv.net 系 → API_REFRESH
 *       （自实现后缀判定 {@link #classifyChannel}，裸域/子域/大小写覆盖，伪装后缀不误判）；</li>
 *   <li><b>装配门</b>：熔断器 null（装配缺失，spec：provider 缺失 = 纯系统路线）→ SYSTEM；</li>
 *   <li><b>熔断门</b>：{@link ChannelCircuitBreaker#allowDirect} 拒绝 → SYSTEM；
 *       放行 → PINNED。</li>
 * </ol>
 *
 * <p><b>门序为何表在熔断前</b>：{@code allowDirect} 在半开态有授凭副作用（单探资格）——
 * 若先问熔断后查表缺条目，会白白消耗单探资格且无请求去回收它（电路滞留半开）。
 * 因此「确定真有直连可走」的一切检查必须先于熔断门；熔断门是最后一道、
 * 通过即立刻产出 PINNED（调用方随即承担记账义务，见 Breaker 契约 1）。
 *
 * <p><b>纯函数纪律</b>：零 IO、零静态可变态、同输入恒同输出（可重放审计——
 * 决策值类型 {@link Decision} 带 equals/toString）；熔断器是显式输入维度，
 * 其状态推进是状态机语义本身（半开单探授凭），除此之外判定无任何副作用。
 * 多线程并发调用线程安全（无共享可变态；熔断器自身 CAS 保证）。
 */
public final class DirectAccessPolicy {

    /**
     * 直连开关三态（oracle = spec「独立开关（默认关）」+ ticket #387 验收「开关三态」）：
     * 行为上 OFF 与 UNSET 同为系统路线，审计上可区分「用户显式关闭」与
     * 「从未配置/解析失败兜底」（T3 Config 映射：key 缺失或解析失败 → UNSET，显式 false → OFF）。
     */
    public enum SwitchState { ON, OFF, UNSET }

    /** 路线决策（不可变值对象；equals/toString 支持重放审计） */
    public static final class Decision {
        public enum Kind { SYSTEM, PINNED }

        private static final Decision SYSTEM = new Decision(Kind.SYSTEM, null, null);

        private final Kind kind;
        private final ChannelCircuitBreaker.Channel channel;
        private final String ip;

        private Decision(Kind kind, ChannelCircuitBreaker.Channel channel, String ip) {
            this.kind = kind;
            this.channel = channel;
            this.ip = ip;
        }

        /** 系统路线决策（共享单例，语义无关实例身份） */
        public static Decision systemRoute() {
            return SYSTEM;
        }

        /** 钉定直连决策（channel/ip 非 null；ip 已是快照内规范化值） */
        public static Decision pinned(ChannelCircuitBreaker.Channel channel, String ip) {
            return new Decision(Kind.PINNED, channel, ip);
        }

        public Kind kind() {
            return kind;
        }

        /** 是否直连（传输层据此决定是否进钉定路线） */
        public boolean isDirect() {
            return kind == Kind.PINNED;
        }

        /** 直连通道（SYSTEM 时 null） */
        public ChannelCircuitBreaker.Channel channel() {
            return channel;
        }

        /** 钉定边缘 IP（SYSTEM 时 null） */
        public String ip() {
            return ip;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Decision)) {
                return false;
            }
            Decision d = (Decision) o;
            return kind == d.kind && channel == d.channel && Objects.equals(ip, d.ip);
        }

        @Override
        public int hashCode() {
            return Objects.hash(kind, channel, ip);
        }

        @Override
        public String toString() {
            return kind == Kind.SYSTEM ? "SYSTEM" : "PINNED(" + channel + ", " + ip + ")";
        }
    }

    private DirectAccessPolicy() {
        // 纯静态函数类，禁实例化
    }

    /**
     * 路由判定（门序契约见类 javadoc）。
     *
     * @param host        官方域 hostname（裸 host，无 scheme/path/port；大小写不敏感，内部规范化）
     * @param switchState 直连开关三态（null 防御视为 UNSET）
     * @param breaker     双通道熔断器（null = 装配缺失 → 恒系统路线，零异常）
     * @param table       IP 表快照（null = 无表 → 恒系统路线）
     */
    public static Decision decide(String host, SwitchState switchState,
                                  ChannelCircuitBreaker breaker, IpTableMerger.Snapshot table) {
        if (switchState != SwitchState.ON) {
            return Decision.systemRoute(); // OFF / UNSET / null：直连默认关
        }
        if (host == null || host.trim().isEmpty()) {
            return Decision.systemRoute();
        }
        String h = host.trim().toLowerCase();
        // 白名单单一事实源 = ImageHostConfig.isOfficialDomain（其契约前提为小写入参，
        // 故先规范化再问——镜像 URL / GitHub / OTA host 不在域族，天然排除）
        if (!ImageHostConfig.isOfficialDomain(h)) {
            return Decision.systemRoute();
        }
        if (table == null) {
            return Decision.systemRoute();
        }
        String ip = table.ipFor(h);
        if (ip == null) {
            return Decision.systemRoute(); // 白名单内缺条目：不瞎猜边缘（421 特化），回退系统路线
        }
        ChannelCircuitBreaker.Channel channel = classifyChannel(h);
        if (channel == null) {
            // 理论不可达：白名单已保证 host ∈ 两域族之一；防御兜底（禁不可达态外泄）
            return Decision.systemRoute();
        }
        if (breaker == null) {
            return Decision.systemRoute(); // 装配缺失（provider 未装配）= 纯系统路线，零异常
        }
        // 熔断门必须是最后一道：allowDirect 在半开态有单探授凭副作用，
        // 走到这里即承诺产出 PINNED（传输层随即承担 recordSuccess/recordFailure 义务）
        if (!breaker.allowDirect(channel)) {
            return Decision.systemRoute();
        }
        return Decision.pinned(channel, ip);
    }

    // ── 通道分类（自实现后缀判定，白名单的通道维度） ──────────

    /**
     * 按 host 后缀分类直连通道：pximg 系（等于或子域于 {@code pximg.net}）→ {@code IMAGE}；
     * pixiv.net 系（等于或子域于 {@code pixiv.net}）→ {@code API_REFRESH}。
     * 入参大小写不敏感；其余（含伪装后缀 {@code evil-pximg.net} / {@code pximg.net.evil.com}）
     * → {@code null}。decide 流程内白名单门已保证可达，null 仅为防御面。
     */
    public static ChannelCircuitBreaker.Channel classifyChannel(String host) {
        if (host == null) {
            return null;
        }
        String h = host.trim().toLowerCase();
        if (equalsOrSubdomainOf(h, "pximg.net")) {
            return ChannelCircuitBreaker.Channel.IMAGE;
        }
        if (equalsOrSubdomainOf(h, "pixiv.net")) {
            return ChannelCircuitBreaker.Channel.API_REFRESH;
        }
        return null;
    }

    /** 等于或真子域判定（{@code .}边界精确：{@code evil-pximg.net} 不算 {@code pximg.net} 系） */
    private static boolean equalsOrSubdomainOf(String host, String domain) {
        return host.equals(domain) || host.endsWith("." + domain);
    }
}
