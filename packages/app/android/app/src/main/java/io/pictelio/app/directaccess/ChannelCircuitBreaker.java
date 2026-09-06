package io.pictelio.app.directaccess;

import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 双通道独立会话级熔断状态机（spec #385 / ticket #387）：图片通道（{@link Channel#IMAGE}，
 * pximg 边缘）与 API+刷新通道（{@link Channel#API_REFRESH}，pixiv.net 边缘）各自独立计数、
 * 独立开合、互不牵连（user story 9：一条通路塌了另一条还能走）。
 *
 * <p><b>状态机</b>（阈值 3 连败 / 冷却 60s 为实现期可调常量，spec 拍板值）：
 * <pre>
 * CLOSED --连续 3 次传输层失败--> OPEN --60s 冷却后半开单探--> HALF_OPEN
 *   ^  |                            ^  |                        |
 *   |  └── recordSuccess（清零）     |  └── 迟到失败/探针失败      |（仅一个请求获准直连）
 *   └───────────── 成功恢复 ─────────┘     （重启冷却 → OPEN）   ├─ 探针成功 → CLOSED（清零）
 *   reset()（手动重置，任一态 → CLOSED 清零）                    └─ 探针失败 → OPEN（重启冷却）
 * </pre>
 *
 * <p><b>接口契约</b>：
 * <ol>
 *   <li>{@link #allowDirect} 返回 {@code true} 的调用方（传输层 T2）<b>必须</b>对该请求
 *       最终调用 {@link #recordSuccess} 或 {@link #recordFailure} <b>恰好一次</b>——
 *       半开态的单探凭据依赖此义务回收，否则电路滞留半开直至手动重置；</li>
 *   <li>半开态<b>单探</b>：冷却到期后并发竞争只有一个调用方获准直连（单一 CAS 同时完成
 *       迁移与授凭），其余一律按 open 处理（返回 false → 系统路线）；</li>
 *   <li>open 态的迟到失败（开闸前已发出的在途请求）<b>重启冷却</b>（仍有失败证据 = 通路未愈）；
 *       open 态的迟到成功为 no-op（一次陈旧成功不得重开已熔断通道，恢复只认半开探针结果）；</li>
 *   <li>成功即清零连续失败计数（spec：成功清零）；</li>
 *   <li><b>会话级内存态，不持久化</b>（spec：双通道独立会话级熔断）——进程重启即全 closed。</li>
 * </ol>
 *
 * <p><b>并发纪律（热路径零锁）</b>：每通道一枚 {@link AtomicReference} 持不可变状态，
 * 全部迁移走 CAS 循环——closed 态判定路径仅一次 volatile 读，零锁零分配
 * （单飞纪律对齐 {@code ImageHostConfig.kickProbe} 的 volatile 快路径优先）。
 * Clock 构造器注入（决策逻辑不触真时钟，测试拨钟驱动）。
 * 线程安全：所有方法可并发调用。
 */
public final class ChannelCircuitBreaker {

    // ── 通道与常量 ───────────────────────────────────────────

    /** 直连双通道（spec 拍板：按边缘 vhost 分工分通道，421 特化要求选对边缘） */
    public enum Channel {
        /** 图片通道：*.pximg.net 域族（pximg 边缘） */
        IMAGE,
        /** API+刷新通道：*.pixiv.net 域族（API+OAuth 边缘，含 oauth.secure 刷新） */
        API_REFRESH
    }

    /** 熔断相位（观测面：设置卡状态展示，user story 23） */
    public enum Phase { CLOSED, OPEN, HALF_OPEN }

    /** 连续失败熔断阈值（spec：连续 3 次传输层失败；oracle = spec #385 实施决策，实现期可调） */
    public static final int FAILURE_THRESHOLD = 3;

    /** 熔断冷却时长 ms（spec：60 秒后半开单探；≥ 探针实测 OAuth 端点 30s 短窗口限频，实现期可调） */
    public static final long COOLDOWN_MILLIS = 60_000L;

    /** 毫秒时钟（生产 = System::currentTimeMillis；测试 = 拨钟） */
    public interface Clock {
        long nowMillis();
    }

    // ── 不可变状态 + CAS ─────────────────────────────────────

    /** 单通道不可变状态快照（字段按相位裁剪：failures 仅 CLOSED 有义，openedAt 仅 OPEN 有义） */
    private static final class ChannelState {
        static final ChannelState CLOSED_CLEAN = new ChannelState(Phase.CLOSED, 0, 0L);

        final Phase phase;
        /** CLOSED 期连续失败计数（0-based）；其余相位恒 0 */
        final int consecutiveFailures;
        /** 进入 OPEN 的时刻 ms（冷却起点）；其余相位恒 0 */
        final long openedAtMillis;

        ChannelState(Phase phase, int consecutiveFailures, long openedAtMillis) {
            this.phase = phase;
            this.consecutiveFailures = consecutiveFailures;
            this.openedAtMillis = openedAtMillis;
        }
    }

    private final AtomicReference<ChannelState> imageState = new AtomicReference<>(ChannelState.CLOSED_CLEAN);
    private final AtomicReference<ChannelState> apiState = new AtomicReference<>(ChannelState.CLOSED_CLEAN);
    private final Clock clock;

    public ChannelCircuitBreaker(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock 不得为 null");
    }

    public ChannelCircuitBreaker() {
        this(System::currentTimeMillis);
    }

    private AtomicReference<ChannelState> ref(Channel channel) {
        return channel == Channel.IMAGE ? imageState : apiState;
    }

    // ── 直连许可判定（热路径） ────────────────────────────────

    /**
     * 本请求是否允许走直连（路由判定进钉定路线的前置门）。
     * closed → 放行；open → 冷却未到拒绝、到期则 CAS 竞争半开探针（单赢家放行）；
     * half-open → 探针在飞，一律拒绝。
     *
     * <p><b>调用方义务</b>：返回 true 后必须对该请求 recordSuccess/recordFailure 恰好一次（契约 1）。
     */
    public boolean allowDirect(Channel channel) {
        ChannelState s = ref(channel).get();
        if (s.phase == Phase.CLOSED) {
            return true; // 热路径：一次 volatile 读即出
        }
        if (s.phase == Phase.HALF_OPEN) {
            return false; // 单探在飞，其余按 open 处理
        }
        // OPEN：冷却未到 → 拒绝
        long now = clock.nowMillis();
        if (now - s.openedAtMillis < COOLDOWN_MILLIS) {
            return false;
        }
        // 冷却已到：单一 CAS 同时完成 OPEN→HALF_OPEN 迁移与探针授凭——
        // 赢家放行（成为本次单探），输家按 open 处理；等锁期间若有迟到失败重启冷却
        // 或手动重置，CAS 同样失败 → 拒绝（无丢失迁移）
        return ref(channel).compareAndSet(s, new ChannelState(Phase.HALF_OPEN, 0, 0L));
    }

    // ── 结果记账 ─────────────────────────────────────────────

    /**
     * 记一次传输层成功（口径由传输层 T2 裁定：connect/握手/响应头成功即计）。
     * closed → 连败计数清零；half-open → 探针成功恢复 closed 并清零；
     * open → no-op（迟到成功不重开，契约 3）。
     */
    public void recordSuccess(Channel channel) {
        AtomicReference<ChannelState> r = ref(channel);
        while (true) {
            ChannelState s = r.get();
            ChannelState next;
            switch (s.phase) {
                case CLOSED:
                    next = s.consecutiveFailures == 0 ? s : new ChannelState(Phase.CLOSED, 0, 0L);
                    break;
                case HALF_OPEN:
                    next = ChannelState.CLOSED_CLEAN; // 探针成功 → 恢复 + 清零
                    break;
                case OPEN:
                default:
                    return; // 迟到成功：不改状态（已熔断通道只认半开探针结果）
            }
            if (r.compareAndSet(s, next)) {
                return;
            }
            // CAS 失败 = 并发迁移，重读重试
        }
    }

    /**
     * 记一次传输层失败（口径由传输层 T2 裁定：IOException / 421 边缘错配 / 连接握手响应头阶段失败）。
     * closed → 连败 +1，达阈值熔断；open → 重启冷却（迟到失败 = 通路未愈的新证据）；
     * half-open → 探针失败重开并重启冷却。
     */
    public void recordFailure(Channel channel) {
        AtomicReference<ChannelState> r = ref(channel);
        while (true) {
            ChannelState s = r.get();
            long now = clock.nowMillis();
            ChannelState next;
            switch (s.phase) {
                case CLOSED:
                    int fails = s.consecutiveFailures + 1;
                    next = fails >= FAILURE_THRESHOLD
                            ? new ChannelState(Phase.OPEN, 0, now)
                            : new ChannelState(Phase.CLOSED, fails, 0L);
                    break;
                case HALF_OPEN:
                case OPEN:
                default:
                    next = new ChannelState(Phase.OPEN, 0, now); // 重开/重启冷却
                    break;
            }
            if (r.compareAndSet(s, next)) {
                return;
            }
            // CAS 失败 = 并发迁移，重读重试
        }
    }

    // ── 运维面（设置卡命令，T4/T5 消费） ─────────────────────

    /**
     * 手动重置（设置卡「熔断重置」，user story 12）：强制回 closed 并清零，
     * 立即可直连。用户显式覆盖语义：盲写（volatile set），不与在途迁移做 CAS 协商——
     * 若与半开探针的成败记账并发，后到者照常生效（失败仍会重开，证据优先）。
     */
    public void reset(Channel channel) {
        ref(channel).set(ChannelState.CLOSED_CLEAN);
    }

    /** 当前相位（只读观测，设置卡状态展示 user story 23；不产生迁移） */
    public Phase phase(Channel channel) {
        return ref(channel).get().phase;
    }
}
