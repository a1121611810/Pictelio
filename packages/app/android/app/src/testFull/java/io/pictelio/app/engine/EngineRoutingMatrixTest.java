package io.pictelio.app.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * {@link EngineRouting#decide} 决策矩阵测试（纯 JUnit，无 Robolectric，先例
 * {@code LynxRuntimeInitializerTest}）。
 *
 * <p>oracle: docs/specs/engine-default-lynx-bidirectional-fallback.md
 * §4（决策矩阵 + fallbackEntry 派生规则 + 不变量行）、§3.1（原因码字面量）。
 * 表驱动用例逐格标注 S 编号与 spec 表一一对应；探针调用计数锁惰性求值
 * 不变量（防未来重构把探针提升到函数顶部）。只测外缝可见行为
 * （action/effective/reason/fallbackEntry），不测内部分支结构（spec §9）。
 */
public class EngineRoutingMatrixTest {

    // ── 测试脚手架 ─────────────────────────────────────────────

    /** 计数假探针：记录每个探针的调用次数与全局调用顺序（锁惰性求值契约）。 */
    private static final class FakeProbe implements EngineProbe {
        private final boolean lynx;
        private final boolean webview;
        private final boolean a11y;
        int lynxCalls;
        int webviewCalls;
        int a11yCalls;
        final List<String> order = new ArrayList<>();

        FakeProbe(boolean lynx, boolean webview, boolean a11y) {
            this.lynx = lynx;
            this.webview = webview;
            this.a11y = a11y;
        }

        @Override
        public String[] clientKinds() {
            return new String[]{"lynx", "webview"};
        }

        @Override
        public boolean lynxAvailable() {
            lynxCalls++;
            order.add("lynx");
            return lynx;
        }

        @Override
        public boolean webviewOk() {
            webviewCalls++;
            order.add("webview");
            return webview;
        }

        @Override
        public boolean a11yActive() {
            a11yCalls++;
            order.add("a11y");
            return a11y;
        }
    }

    /** spec §4 一格的输入与期望输出（S 编号 = spec 表行号）。 */
    private static final class Row {
        final String name;
        final Engine preferred;
        final boolean knownBad;
        final boolean autoFallback;
        final boolean L;
        final boolean W;
        final boolean A;
        final boolean forced;
        final String stayReason;
        final EngineRoute.Action action;
        final Engine effective; // null = 无引擎
        final String reasonCode;
        final boolean fallbackEntry;

        Row(String name, Engine preferred, boolean knownBad, boolean autoFallback,
            boolean L, boolean W, boolean A, boolean forced, String stayReason,
            EngineRoute.Action action, Engine effective, String reasonCode, boolean fallbackEntry) {
            this.name = name;
            this.preferred = preferred;
            this.knownBad = knownBad;
            this.autoFallback = autoFallback;
            this.L = L;
            this.W = W;
            this.A = A;
            this.forced = forced;
            this.stayReason = stayReason;
            this.action = action;
            this.effective = effective;
            this.reasonCode = reasonCode;
            this.fallbackEntry = fallbackEntry;
        }
    }

    /** 缺省状态：无失败记忆、自动回退开（开关缺省值，EnginePrefsTest 另测其读盘口径）。 */
    private static Row row(String name, Engine preferred, boolean L, boolean W, boolean A,
                           EngineRoute.Action action, Engine effective, String reasonCode,
                           boolean fallbackEntry) {
        return new Row(name, preferred, false, true, L, W, A, false, null,
                action, effective, reasonCode, fallbackEntry);
    }

    private static List<Row> rows() {
        List<Row> rs = new ArrayList<>();
        // S1：P=lynx ∧ ¬F ∧ L ∧ ¬A。W=false 角：fallbackEntry 派生规则为 true
        //（吸收 ADR-0153 E7 单次弹跳为不弹跳）。
        rs.add(row("S1", Engine.LYNX, true, false, false,
                EngineRoute.Action.BOOT_LYNX, Engine.LYNX, "preferred", true));
        // S1 的 W=true 角：fallbackEntry = false。
        rs.add(row("S1(W=true)", Engine.LYNX, true, true, false,
                EngineRoute.Action.BOOT_LYNX, Engine.LYNX, "preferred", false));
        // S1a：无障碍服务启用 ∧ WebView 合格 → 无障碍回退。
        rs.add(row("S1a", Engine.LYNX, true, true, true,
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "a11y_webview", false));
        // S1b：无障碍启用 ∧ WebView 不合格 → 无障碍降级优于不可用，仍 Lynx 兜底。
        rs.add(row("S1b", Engine.LYNX, true, false, true,
                EngineRoute.Action.BOOT_LYNX, Engine.LYNX, "a11y_lynx_last_resort", true));
        // S2：Lynx 预检不可用 ∧ WebView 合格 → 预检降级（不落盘首选）。A 恶意置 true：
        // L=false 时矩阵不含 A，结果不得受 A 影响。
        rs.add(row("S2", Engine.LYNX, false, true, true,
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "lynx_unavailable", false));
        // S3：双失败。
        rs.add(row("S3", Engine.LYNX, false, false, false,
                EngineRoute.Action.UPGRADE_PAGE, null, "no_engine", false));
        // S4：失败记忆命中 ∧ WebView 合格。A 恶意置 true：F 路径矩阵不含 A，
        // 若实现误走 a11y 分支会落 a11y_webview 而非 lynx_known_bad。
        rs.add(new Row("S4", Engine.LYNX, true, true, true, true, true, false, null,
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "lynx_known_bad", false));
        // S5：失败记忆命中 ∧ WebView 不合格 ∧ Lynx 可用 → 唯一生路重试。A 恶意置 true。
        rs.add(new Row("S5", Engine.LYNX, true, true, true, false, true, false, null,
                EngineRoute.Action.BOOT_LYNX, Engine.LYNX, "lynx_retry", true));
        // S5'：失败记忆命中 ∧ 双不可用。
        rs.add(new Row("S5'", Engine.LYNX, true, true, false, false, true, false, null,
                EngineRoute.Action.UPGRADE_PAGE, null, "no_engine", false));
        // S9：首选 webview ∧ W → 照旧，不探 L（L/A 恶意置 true：被调用即计数超标）。
        rs.add(row("S9", Engine.WEBVIEW, true, true, true,
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "preferred", false));
        // S10：首选 webview ∧ ¬W ∧ L → 反向降级（ADR-0153 不回归）；fallbackEntry = true。
        rs.add(row("S10", Engine.WEBVIEW, true, false, true,
                EngineRoute.Action.BOOT_LYNX, Engine.LYNX, "webview_unavailable", true));
        // S11：首选 webview ∧ 双不可用。
        rs.add(row("S11", Engine.WEBVIEW, false, false, true,
                EngineRoute.Action.UPGRADE_PAGE, null, "no_engine", false));
        // stay(W=true)：S6 跳转落地 ∧ WebView 合格 → BOOT_WEBVIEW，reason = extra 原因码。
        rs.add(new Row("stay(W=true)", Engine.LYNX, false, true, true, true, true, true,
                "runtime_failure",
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "runtime_failure", false));
        // stay(W=false)：落地后 WebView 仍 <85 → 升级页（E7 不回弹），reason 仍为 extra 原因码。
        rs.add(new Row("stay(W=false)", Engine.LYNX, false, true, true, false, true, true,
                "runtime_failure",
                EngineRoute.Action.UPGRADE_PAGE, null, "runtime_failure", false));
        // stay + 未知原因码：映射失败 → forced_webview。
        rs.add(new Row("stay(未知原因码)", Engine.WEBVIEW, false, true, true, true, false, true,
                "bogus_code",
                EngineRoute.Action.BOOT_WEBVIEW, Engine.WEBVIEW, "forced_webview", false));
        // stay + 无原因码（extra 缺失）：同样归 forced_webview。
        rs.add(new Row("stay(无原因码)", Engine.WEBVIEW, false, true, true, false, false, true,
                null,
                EngineRoute.Action.UPGRADE_PAGE, null, "forced_webview", false));
        return rs;
    }

    private static EngineState stateOf(Row r) {
        return new EngineState(r.preferred, r.knownBad, r.autoFallback);
    }

    private static FakeProbe probeOf(Row r) {
        return new FakeProbe(r.L, r.W, r.A);
    }

    // ── 表驱动矩阵 ─────────────────────────────────────────────

    @Test
    public void decisionMatrix_matchesSpecSection4() {
        for (Row r : rows()) {
            EngineRoute route = EngineRouting.decide(stateOf(r), probeOf(r), r.forced, r.stayReason);
            assertEquals(r.name + ": action", r.action, route.action);
            assertEquals(r.name + ": effective", r.effective, route.effective);
            assertEquals(r.name + ": reason", r.reasonCode, route.reason.code);
            assertEquals(r.name + ": fallbackEntry", r.fallbackEntry, route.fallbackEntry);
            assertEquals(r.name + ": preferred", r.preferred, route.preferred);
        }
    }

    // ── 不变量 ─────────────────────────────────────────────────

    /** stay ⇒ action ≠ BOOT_LYNX（结构防回环），落点随 W 翻转；L/A 四角组合无关。 */
    @Test
    public void stay_neverBootsLynx_allFourCorners() {
        for (boolean L : new boolean[]{true, false}) {
            for (boolean W : new boolean[]{true, false}) {
                for (boolean A : new boolean[]{true, false}) {
                    EngineRoute route = EngineRouting.decide(
                            new EngineState(Engine.LYNX, false, true),
                            new FakeProbe(L, W, A), true, "runtime_failure");
                    assertNotEquals("stay(L=" + L + ",W=" + W + ",A=" + A + ") 永不 BOOT_LYNX",
                            EngineRoute.Action.BOOT_LYNX, route.action);
                    assertEquals("stay(L=" + L + ",W=" + W + ",A=" + A + ") 落点随 W 翻转",
                            W, route.action == EngineRoute.Action.BOOT_WEBVIEW);
                }
            }
        }
    }

    /** 开关关 ⇒ F 惰性（落 S1 系）：knownBad=true+开关关 与 knownBad=false 全 (L,A,W) 空间逐格同结果。 */
    @Test
    public void autoFallbackOff_makesFailureMemoryInert() {
        for (boolean L : new boolean[]{true, false}) {
            for (boolean W : new boolean[]{true, false}) {
                for (boolean A : new boolean[]{true, false}) {
                    EngineRoute switchOff = EngineRouting.decide(
                            new EngineState(Engine.LYNX, true, false),
                            new FakeProbe(L, W, A), false, null);
                    EngineRoute noMemory = EngineRouting.decide(
                            new EngineState(Engine.LYNX, false, true),
                            new FakeProbe(L, W, A), false, null);
                    String where = "L=" + L + ",W=" + W + ",A=" + A;
                    assertEquals("开关关 + 失败记忆应与无记忆同格: " + where,
                            noMemory.action, switchOff.action);
                    assertEquals(noMemory.effective, switchOff.effective);
                    assertEquals(noMemory.reason, switchOff.reason);
                    assertEquals(noMemory.fallbackEntry, switchOff.fallbackEntry);
                }
            }
        }
    }

    // ── 探针惰性求值（spec §4 不变量：每探针至多 1 次 + 最少求值）──

    /** S9 只调 webviewOk（L/A 计数必须为 0——防「预热与路由错位」式的多余探针）。 */
    @Test
    public void s9_touchesOnlyWebview() {
        FakeProbe p = new FakeProbe(true, true, true);
        EngineRoute route = EngineRouting.decide(
                new EngineState(Engine.WEBVIEW, false, true), p, false, null);
        assertEquals(EngineRoute.Action.BOOT_WEBVIEW, route.action);
        assertEquals("S9 webviewOk 恰 1 次", 1, p.webviewCalls);
        assertEquals("S9 不得探 lynx", 0, p.lynxCalls);
        assertEquals("S9 不得探 a11y", 0, p.a11yCalls);
    }

    /**
     * S1 路径决策只依赖 lynx 与 a11y：lynxAvailable → a11yActive 各恰 1 次；
     * webviewOk 恰 1 次且仅服务于 fallbackEntry 派生（spec §4 派生规则——
     * S1 且 W=false 也为 true，无法在不探 W 的前提下求值）。
     */
    @Test
    public void probeLaziness_s1_touchesLynxAndA11yOnce_webviewOnceForFallbackEntry() {
        FakeProbe p = new FakeProbe(true, true, false);
        EngineRoute route = EngineRouting.decide(
                new EngineState(Engine.LYNX, false, true), p, false, null);
        assertEquals(EngineRoute.Action.BOOT_LYNX, route.action);
        assertEquals("S1 lynxAvailable 恰 1 次", 1, p.lynxCalls);
        assertEquals("S1 a11yActive 恰 1 次", 1, p.a11yCalls);
        assertEquals("S1 webviewOk 恰 1 次（仅 fallbackEntry 派生）", 1, p.webviewCalls);
        // 求值顺序契约：L 先于 A（A 只在 L 可用时才有意义）。
        assertEquals(Arrays.asList("lynx", "a11y", "webview"), p.order);
    }

    /** L=false（S2 系路径）时 a11y 恒不探——无障碍只在两引擎都可能生效时才问。 */
    @Test
    public void probeLaziness_a11yOnlyProbedWhenLynxAvailable() {
        FakeProbe s2 = new FakeProbe(false, true, true); // A 恶意置 true
        EngineRouting.decide(new EngineState(Engine.LYNX, false, true), s2, false, null);
        assertEquals("S2 不得探 a11y", 0, s2.a11yCalls);
    }

    /** F 路径（S4）短路：W 合格即返回，不探 L 与 A。 */
    @Test
    public void probeLaziness_failureMemoryPath_shortCircuitsOnWebviewOk() {
        FakeProbe p = new FakeProbe(true, true, true); // L/A 恶意置 true
        EngineRoute route = EngineRouting.decide(
                new EngineState(Engine.LYNX, true, true), p, false, null);
        assertEquals(EngineRoute.Action.BOOT_WEBVIEW, route.action);
        assertEquals(1, p.webviewCalls);
        assertEquals("S4 不探 lynx", 0, p.lynxCalls);
        assertEquals("S4 不探 a11y", 0, p.a11yCalls);
    }

    /** 全矩阵逐格：每探针每次 decide 至多 1 次（调用计数锁，防探针被提升到函数顶部）。 */
    @Test
    public void eachProbeCalledAtMostOnce() {
        for (Row r : rows()) {
            FakeProbe p = probeOf(r);
            EngineRouting.decide(stateOf(r), p, r.forced, r.stayReason);
            assertTrue(r.name + ": lynxAvailable 至多 1 次（实际 " + p.lynxCalls + "）",
                    p.lynxCalls <= 1);
            assertTrue(r.name + ": webviewOk 至多 1 次（实际 " + p.webviewCalls + "）",
                    p.webviewCalls <= 1);
            assertTrue(r.name + ": a11yActive 至多 1 次（实际 " + p.a11yCalls + "）",
                    p.a11yCalls <= 1);
        }
    }
}
