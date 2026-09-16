package io.pictelio.app.engine;

import android.content.Context;
import android.util.Log;

/**
 * 引擎路由门面（ADR-0164 决策 3）。
 *
 * <ul>
 *   <li>{@link #decide} —— 纯函数，spec §4 决策矩阵的唯一实现地（不触 Context / 磁盘）。</li>
 *   <li>{@link #resolve} —— 读状态 + 决策 + 落快照 + 日志（PictelioApp 预热与 MainActivity
 *       路由共用，消灭「预热与路由各读一次键」的漂移面；T2 起接线）。</li>
 *   <li>{@link #onLynxFailure} —— Lynx 运行时失败漏斗的唯一决策点（spec §6，四生产者收敛）。</li>
 * </ul>
 *
 * <p>记号：P=首选，F=失败记忆命中∧开关开，L=Lynx 可用，W=WebView 合格，A=无障碍服务启用。
 *
 * <p>探针惰性求值契约（spec §4 不变量，测试以调用计数钉住）：每探针每次 decide 至多 1 次；
 * S1 路径按 lynxAvailable → a11yActive → webviewOk（唯一一次，仅为 fallbackEntry 派生）；
 * S9 路径只调 webviewOk；F 路径先 W 后 L，A 恒不探。
 */
public final class EngineRouting {

    public static final String TAG = "EngineRouting";

    /** S6 跳转落地 extra：该次启动不重新决策（回环断路器，ADR-0164 决策 10①）。 */
    public static final String EXTRA_FORCED_WEBVIEW = "pictelio_engine_forced_webview";

    /** S6 跳转落地 extra：降级原因码（稳定 ASCII，spec §3.1）。 */
    public static final String EXTRA_STAY_REASON = "pictelio_engine_stay_reason";

    /** Lynx 运行时硬错误自动跳时携带的 stay 原因码。 */
    public static final String STAY_REASON_RUNTIME_FAILURE = "runtime_failure";

    private EngineRouting() {}

    /** Lynx 运行时失败生产者归类（spec §6：init throw / onLoadFailed / 致命渲染错误 / 10s watchdog）。 */
    public enum LynxFailureKind { INIT, BUNDLE_LOAD, RENDER_FATAL, LOAD_TIMEOUT }

    /** {@link #onLynxFailure} 裁决：跳 WebView（失败记忆已先写）或停留显示既有错误页。 */
    public enum FailureVerdict { HOP_TO_WEBVIEW, SHOW_ERROR_PAGE }

    // ── 决策矩阵（纯函数）──────────────────────────────────────

    /**
     * spec §4 决策矩阵唯一实现地。全函数纯；探针惰性求值、每探针至多 1 次。
     *
     * @param state          持久化状态（{@link EnginePrefs#read} 产出；测试可直接构造）
     * @param probe          引擎探针（适配器缝）
     * @param forcedWebview  stay 回环断路器：true = 本次启动已被强制 WebView，永不 BOOT_LYNX
     * @param stayReasonCode stay 落地携带的原因码（extra；null/未知 → forced_webview）
     */
    public static EngineRoute decide(EngineState state, EngineProbe probe,
                                     boolean forcedWebview, String stayReasonCode) {
        Engine preferred = state.preferred != null ? state.preferred : Engine.LYNX;
        boolean F = state.autoFallback && state.knownBad;

        // stay 分支（spec §4 最后一行）：结构防回环——永不 BOOT_LYNX。
        // WebView 仍过版本门禁，不合格落升级页（E7：不回弹）。
        if (forcedWebview) {
            EngineRoute.Reason stayReason = resolveStayReason(stayReasonCode);
            if (probe.webviewOk()) {
                return new EngineRoute(preferred, Engine.WEBVIEW,
                        EngineRoute.Action.BOOT_WEBVIEW, stayReason, false);
            }
            return new EngineRoute(preferred, null,
                    EngineRoute.Action.UPGRADE_PAGE, stayReason, false);
        }

        if (preferred == Engine.LYNX) {
            if (!F) {
                boolean L = probe.lynxAvailable();
                if (L) {
                    boolean A = probe.a11yActive();
                    if (!A) {
                        // S1：99% 路径。W 唯一一次探测仅为 fallbackEntry 派生（§4 派生规则：
                        // S1 且 W=false 也为 true，吸收 ADR-0153 E7 单次弹跳为不弹跳）。
                        boolean W = probe.webviewOk();
                        return new EngineRoute(preferred, Engine.LYNX,
                                EngineRoute.Action.BOOT_LYNX, EngineRoute.Reason.PREFERRED, !W);
                    }
                    boolean W = probe.webviewOk();
                    if (W) {
                        // S1a：TalkBack 等无障碍服务启用 → 无障碍退化的 Lynx 让位 WebView
                        return new EngineRoute(preferred, Engine.WEBVIEW,
                                EngineRoute.Action.BOOT_WEBVIEW, EngineRoute.Reason.A11Y_WEBVIEW, false);
                    }
                    // S1b：WebView 也不可用 → 无障碍降级优于应用不可用，仍以 Lynx 兜底
                    return new EngineRoute(preferred, Engine.LYNX,
                            EngineRoute.Action.BOOT_LYNX, EngineRoute.Reason.A11Y_LYNX_LAST_RESORT, true);
                }
                boolean W = probe.webviewOk();
                if (W) {
                    // S2：预检降级（设备事实，不落盘首选——ADR-0153 决策 2）
                    return new EngineRoute(preferred, Engine.WEBVIEW,
                            EngineRoute.Action.BOOT_WEBVIEW, EngineRoute.Reason.LYNX_UNAVAILABLE, false);
                }
                // S3：双失败
                return new EngineRoute(preferred, null,
                        EngineRoute.Action.UPGRADE_PAGE, EngineRoute.Reason.NO_ENGINE, false);
            }
            // F 路径：失败记忆只为免重复白屏；A 恒不探（矩阵 S4/S5/S5' 不含 A）
            boolean W = probe.webviewOk();
            if (W) {
                // S4：失败记忆命中 → 本启动让位 WebView
                return new EngineRoute(preferred, Engine.WEBVIEW,
                        EngineRoute.Action.BOOT_WEBVIEW, EngineRoute.Reason.LYNX_KNOWN_BAD, false);
            }
            boolean L = probe.lynxAvailable();
            if (L) {
                // S5：WebView 也走不通 → Lynx 是唯一生路，重试
                return new EngineRoute(preferred, Engine.LYNX,
                        EngineRoute.Action.BOOT_LYNX, EngineRoute.Reason.LYNX_RETRY, true);
            }
            // S5'：双失败
            return new EngineRoute(preferred, null,
                    EngineRoute.Action.UPGRADE_PAGE, EngineRoute.Reason.NO_ENGINE, false);
        }

        // P=WEBVIEW 分支
        boolean W = probe.webviewOk();
        if (W) {
            // S9：首选 webview 照旧，不探 L（用户依旧不加载 Lynx）
            return new EngineRoute(preferred, Engine.WEBVIEW,
                    EngineRoute.Action.BOOT_WEBVIEW, EngineRoute.Reason.PREFERRED, false);
        }
        boolean L = probe.lynxAvailable();
        if (L) {
            // S10：反向降级（ADR-0153 不回归）
            return new EngineRoute(preferred, Engine.LYNX,
                    EngineRoute.Action.BOOT_LYNX, EngineRoute.Reason.WEBVIEW_UNAVAILABLE, true);
        }
        // S11：双失败
        return new EngineRoute(preferred, null,
                EngineRoute.Action.UPGRADE_PAGE, EngineRoute.Reason.NO_ENGINE, false);
    }

    /** stay 原因码反序列化：已知码原样透传；null/未知一律 forced_webview（防伪造 extra 撑爆 UI 映射）。 */
    private static EngineRoute.Reason resolveStayReason(String stayReasonCode) {
        EngineRoute.Reason reason = EngineRoute.Reason.ofCode(stayReasonCode);
        return reason != null ? reason : EngineRoute.Reason.FORCED_WEBVIEW;
    }

    // ── 门面（读 + 决策 + 发布）────────────────────────────────

    /**
     * 一次完整决策：读状态 → decide → 落快照 → 打日志。
     * PictelApp 预热与 MainActivity 路由必须共用本入口（ADR-0164 决策 3）。
     */
    public static EngineRoute resolve(Context app, EngineProbe probe,
                                      boolean forcedWebview, String stayReasonCode) {
        EngineState state = EnginePrefs.read(app, probe.clientKinds());
        EngineRoute route = decide(state, probe, forcedWebview, stayReasonCode);
        EnginePrefs.publish(app, route);
        Log.i(TAG, route.snapshotLine());
        return route;
    }

    // ── 运行时失败漏斗（spec §6）───────────────────────────────

    /**
     * Lynx 运行时硬错误的唯一裁决点（四生产者收敛，spec §6）：
     * <ul>
     *   <li>{@code LOAD_TIMEOUT} → 永不自动跳（慢设备 ≠ 不支持，自动弹走会让能跑的机器
     *       每次冷启动受罚），走既有手动错误页（S8）；</li>
     *   <li>其余：开关开 ∧ 包含 webview → <strong>先写失败记忆再返回</strong>
     *       （顺序承重，hop 途中崩溃也不丢）→ HOP_TO_WEBVIEW（S6）；</li>
     *   <li>否则 → SHOW_ERROR_PAGE（S7 开关关 / E9 lynx 单引擎包）。</li>
     * </ul>
     */
    public static FailureVerdict onLynxFailure(Context app, EngineProbe probe, LynxFailureKind kind) {
        if (kind == LynxFailureKind.LOAD_TIMEOUT) {
            return FailureVerdict.SHOW_ERROR_PAGE;
        }
        if (EnginePrefs.autoFallbackEnabled(app) && containsKind(probe.clientKinds(), "webview")) {
            EnginePrefs.recordLynxFailure(app);
            return FailureVerdict.HOP_TO_WEBVIEW;
        }
        return FailureVerdict.SHOW_ERROR_PAGE;
    }

    private static boolean containsKind(String[] kinds, String kind) {
        if (kinds == null) return false;
        for (String k : kinds) {
            if (kind.equals(k)) return true;
        }
        return false;
    }
}
