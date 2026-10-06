package io.pictelio.app.delivery;

import androidx.annotation.Nullable;

/**
 * 送达通道 · 触达探测的**宿主侧判定纯函数**
 * （spec docs/specs/notification-delivery-probe.md / ADR-0220 决策 2、10）。
 *
 * <p><b>为什么在宿主侧也有一份判定</b>：发通知的决定最终由宿主作出（它才持有
 * {@code NotificationManager} 与权限状态）。把它做成**无状态纯函数**而不是散在
 * {@code onResume} 的分支里，是为了能被 JVM 单测直接驱动（仓库无任何测试构造过
 * LynxModule 实例，构造需 LynxContext）。
 *
 * <p><b>与 JS 侧的关系</b>：JS 侧 {@code deliveryProbeStore.ts} 持有一份同语义的判定，
 * 驱动「静默期计时 + 计数存储」。两份刻意分开：JS 侧决定**何时轮询**、宿主侧决定
 * **此刻能不能发**。跨端一致性（事件名、存储键）由
 * {@code deliveryProbeContract.test.ts} 钉，不由本类承担。
 *
 * <p><b>判定顺序即语义</b>：静默期 → 权限 → 未读。顺序反了会让「权限未授予」
 * 在用户刚进 App 时就冒出来，掩盖真正的判定阶段；两条用例专门钉住这一点。
 */
public final class ProbeDecision {

    /**
     * 静默期时长（ms）：进入前台后须静默此时长才进入判定。
     *
     * <p>⚠️ 这是**近似值**：Lynx 侧没有窗口 focus 事件，JS 侧只能用生命周期事件 +
     * 计时近似「用户没在主动看」（ADR-0220 §3.1 登记的已知取舍）。
     */
    public static final long QUIET_PERIOD_MS = 90_000L;

    public enum Kind {
        /** 静默期未过：用户刚进来，此刻发通知毫无价值且构成打扰 */
        QUIET_NOT_ELAPSED,
        /** 通知权限未授予：降级到既有外环未读角标，不发、不重复询问 */
        PERMISSION_DENIED,
        /** 没有新未读：没内容可告知就别打扰 */
        NO_UNREAD,
        /** 该发 */
        SHOULD_SEND,
    }

    private final Kind kind;
    @Nullable
    private final String reason;

    private ProbeDecision(Kind kind, @Nullable String reason) {
        this.kind = kind;
        this.reason = reason;
    }

    /**
     * 判定本轮是否该发系统通知。
     *
     * @param quietElapsedMs 自进入前台起已过的毫秒数；负值按「未过」处理（时钟回拨防御）
     * @param permissionGranted 通知权限是否已授予
     * @param unreadCount     当前未读条数；负数按「无未读」处理（脏数据防御）
     */
    public static ProbeDecision decide(long quietElapsedMs, boolean permissionGranted, int unreadCount) {
        if (quietElapsedMs < QUIET_PERIOD_MS) {
            return new ProbeDecision(Kind.QUIET_NOT_ELAPSED,
                    "静默期未过（已过 " + quietElapsedMs + "ms / 需 " + QUIET_PERIOD_MS + "ms）");
        }
        if (!permissionGranted) {
            return new ProbeDecision(Kind.PERMISSION_DENIED, "通知权限未授予，降级到外环未读角标");
        }
        if (unreadCount <= 0) {
            return new ProbeDecision(Kind.NO_UNREAD, "无新未读（unread=" + unreadCount + "）");
        }
        return new ProbeDecision(Kind.SHOULD_SEND, "未读 " + unreadCount + " 条");
    }

    public Kind kind() {
        return kind;
    }

    public boolean isShouldSend() {
        return kind == Kind.SHOULD_SEND;
    }

    /** 人类可读的判定理由，落日志用（禁静默降级：判了什么必须可追溯）。 */
    @Nullable
    public String reason() {
        return reason;
    }

    @Override
    public String toString() {
        return "ProbeDecision{" + kind + (reason == null ? "" : ": " + reason) + "}";
    }
}
