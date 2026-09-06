package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ChannelCircuitBreaker 单测（#387）——Clock 拨钟驱动全转移。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6）</b>——期望值全部来自独立来源：
 * <ul>
 *   <li>阈值「连续 3 次失败 → open」、冷却「60 秒后半开单探、成功恢复 / 失败重开、
 *       成功清零、双通道独立」：spec #385 实施决策原文（连续 3 次传输层失败 → 该通道
 *       本会话切系统路线，冷却 60 秒后半开单请求重探）——测试用<b>字面量 3 / 60_000</b>
 *       钉死契约，不从被测常量反推（防同义反复）；</li>
 *   <li>60s ≥ 30s 的合理性来源：探针报告 §3.4 实证 OAuth {@code /auth/token}
 *       端点短窗口限频 30s（冷却须大于限频窗口）；</li>
 *   <li>双通道语义来源：spec user story 9（图片直连失败不影响 API 直连）
 *       + 探针报告 §3.3 边缘 vhost 特化（pximg / pixiv.net 是不同边缘集群，
 *       一条边缘塌不代表另一条塌）；</li>
 *   <li>open 态迟到成功不重开 / 迟到失败重启冷却：类 javadoc 契约 3 的语义选择
 *       （恢复只认半开探针结果；新失败证据 = 通路未愈）。</li>
 * </ul>
 */
public class ChannelCircuitBreakerTest {

    private static final long T0 = 1_000_000L;

    private static final class MutableClock implements ChannelCircuitBreaker.Clock {
        long now = T0;

        @Override
        public long nowMillis() {
            return now;
        }
    }

    // ── closed 基线 ──────────────────────────────────────────

    @Test
    public void freshBreaker_bothChannelsAdmit() {
        // 新会话 = 全 closed（会话级内存态，无持久化）
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(new MutableClock());
        assertTrue(breaker.allowDirect(ChannelCircuitBreaker.Channel.IMAGE));
        assertTrue(breaker.allowDirect(ChannelCircuitBreaker.Channel.API_REFRESH));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ChannelCircuitBreaker.Channel.IMAGE));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ChannelCircuitBreaker.Channel.API_REFRESH));
    }

    // ── closed → open：3 连败阈值（字面量钉契约） ────────────

    @Test
    public void twoConsecutiveFailures_stayClosed() {
        // oracle: spec「连续 3 次」——2 次不得熔断
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        assertTrue("2 连败仍 closed", breaker.allowDirect(ch));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ch));
    }

    @Test
    public void threeConsecutiveFailures_open() {
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        assertFalse("3 连败熔断", breaker.allowDirect(ch));
        assertEquals(ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ch));
    }

    @Test
    public void successResets_consecutiveCount() {
        // oracle: spec「成功即清零计数」——fail,fail,success,fail,fail 不得熔断
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        breaker.recordSuccess(ch);
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        assertTrue("成功清零后仅 2 连败", breaker.allowDirect(ch));
        // 第 3 次（清零后重新累计满 3）才熔断
        breaker.recordFailure(ch);
        assertFalse(breaker.allowDirect(ch));
    }

    // ── open 冷却边界（字面量 60_000 钉契约） ────────────────

    @Test
    public void cooldownBoundary_59999Rejected_60000Awarded() {
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch); // 在 T0 熔断
        clock.now = T0 + 59_999L;
        assertFalse("冷却未满 60s 拒绝", breaker.allowDirect(ch));
        assertEquals("仍在 open", ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ch));
        clock.now = T0 + 60_000L;
        assertTrue("冷却到期放行（半开探针）", breaker.allowDirect(ch));
        assertEquals("迁移到半开", ChannelCircuitBreaker.Phase.HALF_OPEN, breaker.phase(ch));
    }

    @Test
    public void halfOpen_singleProbe_onlyOneAdmitted() {
        // 半开单探：放行一次后其余一律按 open 处理（直到探针记账）
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        clock.now = T0 + 60_000L;
        assertTrue("探针获准", breaker.allowDirect(ch));
        assertFalse("第二请求按 open 处理", breaker.allowDirect(ch));
        assertFalse("第三请求同样", breaker.allowDirect(ch));
    }

    // ── 半开 → 恢复 / 重开 ───────────────────────────────────

    @Test
    public void halfOpen_probeSuccess_recoversAndClearsCount() {
        // oracle: spec「成功恢复」「成功即清零计数」——恢复后新一轮 2 连败不得熔断
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        clock.now = T0 + 60_000L;
        assertTrue(breaker.allowDirect(ch)); // 探针获准
        breaker.recordSuccess(ch);
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ch));
        assertTrue("恢复后立即可直连", breaker.allowDirect(ch));
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        assertTrue("清零后 2 连败仍 closed", breaker.allowDirect(ch));
    }

    @Test
    public void halfOpen_probeFailure_reopensAndRestartsCooldown() {
        // oracle: spec「失败重开」——新冷却起点 = 失败时刻
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        clock.now = T0 + 60_000L;
        assertTrue(breaker.allowDirect(ch)); // 探针获准
        long reopenAt = T0 + 100_000L;
        clock.now = reopenAt;
        breaker.recordFailure(ch); // 探针失败 → 重开
        assertEquals(ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ch));
        clock.now = reopenAt + 59_999L;
        assertFalse("重开后新冷却未满", breaker.allowDirect(ch));
        clock.now = reopenAt + 60_000L;
        assertTrue("新冷却到期再次单探", breaker.allowDirect(ch));
    }

    // ── open 态迟到记账（契约 3） ────────────────────────────

    @Test
    public void open_lateSuccess_isNoOp_circuitStaysOpen() {
        // 一次陈旧成功不得重开已熔断通道：恢复只认半开探针结果
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        breaker.recordSuccess(ch); // 开闸前在途请求的迟到成功
        assertEquals("仍 open", ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ch));
        clock.now = T0 + 59_999L;
        assertFalse("冷却不被迟到成功缩短", breaker.allowDirect(ch));
    }

    @Test
    public void open_lateFailure_restartsCooldown() {
        // 迟到失败 = 通路未愈的新证据 → 冷却起点后移
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch); // T0 熔断
        clock.now = T0 + 50_000L;
        breaker.recordFailure(ch); // 迟到失败重启冷却
        clock.now = T0 + 59_999L;
        assertFalse("按原冷却点本应到期，但被迟到失败推迟", breaker.allowDirect(ch));
        clock.now = T0 + 50_000L + 60_000L;
        assertTrue(breaker.allowDirect(ch));
    }

    // ── 双通道互不牵连（user story 9） ───────────────────────

    @Test
    public void channels_fullyIndependent() {
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        ChannelCircuitBreaker.Channel api = ChannelCircuitBreaker.Channel.API_REFRESH;
        trip(breaker, image); // 图片通道熔断
        assertFalse(breaker.allowDirect(image));
        assertTrue("图片通道塌不影响 API+刷新通道", breaker.allowDirect(api));
        assertEquals(ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(api));
        // API 通道 3 连败同样独立熔断
        breaker.recordFailure(api);
        breaker.recordFailure(api);
        breaker.recordFailure(api);
        assertFalse(breaker.allowDirect(api));
        // 半开单探也不牵连：图片半开在飞，API 冷却到期可独立探
        clock.now = T0 + 60_000L;
        assertTrue(breaker.allowDirect(image)); // 图片探针
        assertFalse(breaker.allowDirect(image));
        assertTrue(breaker.allowDirect(api)); // API 探针独立获准
    }

    // ── 手动重置（user story 12） ────────────────────────────

    @Test
    public void reset_fromOpen_admitsImmediately() {
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        breaker.reset(ch);
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ch));
        assertTrue("重置后无需等冷却", breaker.allowDirect(ch));
        assertTrue("计数已清零：再 2 败不熔断", runAndStayClosed(breaker, ch));
    }

    @Test
    public void reset_fromHalfOpen_admitsImmediately() {
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        clock.now = T0 + 60_000L;
        assertTrue(breaker.allowDirect(ch));
        assertEquals(ChannelCircuitBreaker.Phase.HALF_OPEN, breaker.phase(ch));
        breaker.reset(ch); // 半开滞留（探针记账丢失）的运维出口
        assertTrue(breaker.allowDirect(ch));
    }

    private boolean runAndStayClosed(ChannelCircuitBreaker breaker, ChannelCircuitBreaker.Channel ch) {
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        return breaker.allowDirect(ch);
    }

    /** 3 连败驱动到 open（字面量 3 = spec 阈值，非被测常量） */
    private static void trip(ChannelCircuitBreaker breaker, ChannelCircuitBreaker.Channel ch) {
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
    }

    // ── 并发：半开单探恰好一次授凭 ───────────────────────────

    @Test
    public void concurrent_allowAtCooldownExpiry_exactlyOneProbeAwarded() throws Exception {
        // 16 线程在冷却到期瞬间竞争 allowDirect：单探授凭由单一 CAS 完成，
        // 恰好一个赢家（其余按 open 处理）；探针成功后全部放行。
        final MutableClock clock = new MutableClock();
        final ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        final ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        clock.now = T0 + 60_000L; // 预拨到冷却到期点再放闸

        final int threads = 16;
        final AtomicInteger admitted = new AtomicInteger();
        final CountDownLatch start = new CountDownLatch(1);
        Thread[] workers = new Thread[threads];
        for (int i = 0; i < threads; i++) {
            workers[i] = new Thread(() -> {
                try {
                    start.await();
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    return;
                }
                if (breaker.allowDirect(ch)) {
                    admitted.incrementAndGet();
                }
            });
            workers[i].start();
        }
        start.countDown();
        for (Thread t : workers) {
            t.join(5000);
        }
        assertEquals("半开单探：并发竞争恰好一次授凭", 1, admitted.get());
        assertEquals(ChannelCircuitBreaker.Phase.HALF_OPEN, breaker.phase(ch));

        breaker.recordSuccess(ch); // 探针恢复
        final AtomicInteger allAdmitted = new AtomicInteger();
        final CountDownLatch start2 = new CountDownLatch(1);
        for (int i = 0; i < threads; i++) {
            workers[i] = new Thread(() -> {
                try {
                    start2.await();
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    return;
                }
                if (breaker.allowDirect(ch)) {
                    allAdmitted.incrementAndGet();
                }
            });
            workers[i].start();
        }
        start2.countDown();
        for (Thread t : workers) {
            t.join(5000);
        }
        assertEquals("恢复 closed 后全部放行", threads, allAdmitted.get());
    }

    // ── 时钟注入契约 ─────────────────────────────────────────

    @Test
    public void clockInjected_timeDoesNotAdvanceByItself() {
        // 会话级状态完全由注入时钟驱动：钟不拨 → 冷却永不结束（决策不触真时钟）
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(clock);
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        trip(breaker, ch);
        assertFalse(breaker.allowDirect(ch));
        assertFalse("钟不动 → 恒 open", breaker.allowDirect(ch));
        assertNotEquals(ChannelCircuitBreaker.Phase.HALF_OPEN, breaker.phase(ch));
    }
}
