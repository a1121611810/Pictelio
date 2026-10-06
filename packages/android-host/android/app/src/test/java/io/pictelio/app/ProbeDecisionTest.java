package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import io.pictelio.app.delivery.ProbeDecision;

/**
 * 送达通道 · 触达探测的**宿主侧判定** JVM 行为测试
 * （spec docs/specs/notification-delivery-probe.md / ADR-0220 决策 2、10）。
 *
 * <p><b>为什么宿主侧要有一份</b>：JS 侧 {@code deliveryProbeStore.test.ts} 钉的是「静默期计时
 * + 计数存储 + 权限/未读的判定顺序」，本类钉的是**宿主侧同一套判定的纯函数**——两处都调用
 * 同一个 {@code ProbeDecision}，但驱动路径不同（JS 走 store、宿主走本类），故两份断言不是重复：
 * 任一侧被改成另一套口径，只有对应那份会红。
 *
 * <p><b>oracle</b>：判定顺序与语义来自 ADR-0220 决策 2（静默期优先）与决策 10
 * （权限未授予 ⇒ 降级到外环未读角标，不发），不是从实现反推。
 *
 * <p><b>驱动方式</b>：直接调纯静态函数（不构造 LynxModule —— 仓库无任何测试构造过模块实例，
 * 与 PictelioClipboardModuleTest / PictelioWebDavModuleTest 同款先例）。
 */
/**
 * ⚠️ 必须显式钉 sdk：本仓 targetSdk=36 超出 Robolectric 本版支持上限，
 *   不钉会在**初始化期**就抛 initializationError（不是断言红，且看不出是哪个类）。
 *   口径同 PictelioClipboardModuleTest / PictelioDownloaderTest。
 *   本类不碰任何系统 API，sdk 取值不影响判定结果。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class ProbeDecisionTest {

    private static final long QUIET_MS = ProbeDecision.QUIET_PERIOD_MS;

    private static ProbeDecision decide(long quietElapsed, boolean granted, int unread) {
        return ProbeDecision.decide(quietElapsed, granted, unread);
    }

    @Test
    public void 静默期未过不判() {
        assertEquals(ProbeDecision.Kind.QUIET_NOT_ELAPSED, decide(0, true, 9).kind());
        assertEquals(ProbeDecision.Kind.QUIET_NOT_ELAPSED, decide(QUIET_MS - 1, true, 9).kind());
    }

    @Test
    public void 静默期刚过且有权限有未读则发() {
        assertEquals(ProbeDecision.Kind.SHOULD_SEND, decide(QUIET_MS, true, 1).kind());
        assertEquals(ProbeDecision.Kind.SHOULD_SEND, decide(QUIET_MS + 5_000, true, 42).kind());
    }

    @Test
    public void 权限未授予则降级不发() {
        assertEquals(ProbeDecision.Kind.PERMISSION_DENIED, decide(QUIET_MS, false, 5).kind());
    }

    @Test
    public void 无未读则不发() {
        assertEquals(ProbeDecision.Kind.NO_UNREAD, decide(QUIET_MS, true, 0).kind());
        // 负数是脏数据：同样判「无未读」，不得当成「有更新」
        assertEquals(ProbeDecision.Kind.NO_UNREAD, decide(QUIET_MS, true, -3).kind());
    }

    @Test
    public void 静默期判定优先于权限与未读() {
        // 顺序即语义：静默期没过时即便无权限/无未读也应报静默期。
        // 顺序反了会让「权限未授予」在用户刚进 App 时就冒出来，掩盖真正的判定阶段。
        assertEquals(ProbeDecision.Kind.QUIET_NOT_ELAPSED, decide(0, false, 0).kind());
        assertEquals(ProbeDecision.Kind.QUIET_NOT_ELAPSED, decide(QUIET_MS - 1, false, 7).kind());
    }

    @Test
    public void 负的静默时长不崩且判为未过() {
        // 时钟回拨 / 计算错误都可能给出负值；不得当成「静默期已过」而立刻发通知。
        assertEquals(ProbeDecision.Kind.QUIET_NOT_ELAPSED, decide(-1_000, true, 5).kind());
    }

    @Test
    public void 静默期常量是正值且为可读量级() {
        assertTrue("静默期应为正毫秒数", ProbeDecision.QUIET_PERIOD_MS > 0);
        assertTrue("静默期不应短到等于没设（<10s）", ProbeDecision.QUIET_PERIOD_MS >= 10_000L);
    }

    @Test
    public void 是否应发只认shouldSend这一个真值() {
        assertTrue(decide(QUIET_MS, true, 3).isShouldSend());
        assertFalse(decide(QUIET_MS, false, 3).isShouldSend());
        assertFalse(decide(0, true, 3).isShouldSend());
        assertFalse(decide(QUIET_MS, true, 0).isShouldSend());
    }
}
