package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.react.bridge.Callback;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.lang.reflect.Field;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link PictelioTranslateModule#abortStream} 取消通道的契约守卫（#653 微决策 #2）。
 *
 * <p>Oracle = issue #653「实现偏离了 ADR-0170 规定的形态」修复后的双向契约：
 * <ul>
 *   <li><b>正向</b>：JS→Java 取消通道可达（JS 侧 {@code translateFrameChannel.test.ts}
 *       已钉住）；</li>
 *   <li><b>反向（本测试）</b>：当 abort 命中「无活 worker」路径时（abortStream 早于
 *       translateStream 把 Call 写入 ACTIVE_CALLS，或 streamId 本身未注册），
 *       {@code USER_ABORTED} 不能残留——否则永久内存泄漏 + 后续同名 streamId
 *       会被错误判为「用户主动中断」而静默退出。</li>
 * </ul>
 *
 * <p>关键窗口：{@code ACTIVE_CALLS.put(streamId, call)} 在 {@code translateStream}
 * 进入 worker 前执行（line 365），{@code USER_ABORTED.remove} 在 worker 的
 * {@code finally}（line 449）。abortStream 介于两者之间到达 = 永不命中 finally → 泄漏。
 *
 * <p>实测触发面：#653 修复前 abortStream 对活流不可达，故此路径事实不触发；
 * 修复后 JS 侧 abort → 立即 abortStream(streamId) → 进入可达。必须补回清理。
 *
 * <p>Oracle 溯源（AGENTS.md 测试硬约束 #6）：期望值「清理后集合为空」来自
 * ADR-0170 §D7「幂等」语义 + USER_ABORTED 注释段「永久残留 → 内存泄漏」的
 * 已记录 bug；断言不依赖实现细节。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateAbortStreamTest {

    private PictelioTranslateModule module;
    private Set<String> userAbortedRef;

    @Before
    public void setUp() throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        module = new PictelioTranslateModule(ctx);
        userAbortedRef = userAbortedSet();
        userAbortedRef.clear();
    }

    @After
    public void tearDown() {
        userAbortedRef.clear();
    }

    /** 反射拿 USER_ABORTED 静态集合，断言前清空避免污染。 */
    @SuppressWarnings("unchecked")
    private static Set<String> userAbortedSet() throws Exception {
        Field f = PictelioTranslateModule.class.getDeclaredField("USER_ABORTED");
        f.setAccessible(true);
        return (Set<String>) f.get(null);
    }

    /**
     * 关键回归用例：abortStream 对未知 streamId（无活 worker）必须**自行清理** USER_ABORTED，
     * 不能依赖 translateStream worker 的 finally（那个路径不会到达）。
     *
     * <p>防的 regression：#653 修复让 abortStream 从不可达变为可达，若 Java 侧不补
     * 清理分支，每次「abortStream 早于 ACTIVE_CALLS.put」都会在 USER_ABORTED
     * 永久残留一项 → 内存泄漏 + 同名 id 后续流被误判为 abort。
     */
    @Test
    public void abortStream_unknownId_doesNotLeakUserAborted() {
        AtomicReference<String> errRef = new AtomicReference<>();
        Callback cb = recordError(errRef);

        module.abortStream("ghost-stream-id-" + System.nanoTime(), cb);

        assertEquals("无活 worker 的 abortStream 必须 cb('', '') 成功（ADR-0170 §D7 幂等）",
                null, errRef.get());
        assertTrue("USER_ABORTED 不得残留（防内存泄漏 + 后续同名 id 误判）",
                userAbortedRef.isEmpty());
    }

    /** null streamId 走原有的参数校验分支——不应碰 USER_ABORTED。 */
    @Test
    public void abortStream_nullId_keepsUserAbortedEmpty() {
        AtomicReference<String> errRef = new AtomicReference<>();
        Callback cb = recordError(errRef);

        module.abortStream(null, cb);

        assertNotNull("null streamId 必须返回错误", errRef.get());
        assertTrue("参数校验失败路径不应污染 USER_ABORTED", userAbortedRef.isEmpty());
    }

    /** 空 streamId 同上。 */
    @Test
    public void abortStream_emptyId_keepsUserAbortedEmpty() {
        AtomicReference<String> errRef = new AtomicReference<>();
        Callback cb = recordError(errRef);

        module.abortStream("", cb);

        assertNotNull("空 streamId 必须返回错误", errRef.get());
        assertTrue("参数校验失败路径不应污染 USER_ABORTED", userAbortedRef.isEmpty());
    }

    /**
     * 抽离的 callback 工厂：成功路径是 {@code cb("", "")}——args[1] 是空字符串；
     * 只在 err 非空时记录（与 JS 侧 {@code unquoteNativeString} 对齐）。
     */
    private static Callback recordError(AtomicReference<String> errRef) {
        return (args) -> {
            if (args != null && args.length >= 2 && args[1] != null) {
                String err = String.valueOf(args[1]);
                if (!err.isEmpty()) {
                    errRef.set(err);
                }
            }
        };
    }

    /**
     * 同一 streamId 多次 abortStream（用户连续点停止 / 切章节）应保持幂等且
     * 不残留任何条目。
     */
    @Test
    public void abortStream_idempotent_neverLeavesResidue() {
        Callback cb = (args) -> {};
        String streamId = "repeated-" + System.nanoTime();

        for (int i = 0; i < 5; i++) {
            module.abortStream(streamId, cb);
        }

        assertTrue("连续 abortStream 同一 id 必须保持 USER_ABORTED 为空",
                userAbortedRef.isEmpty());
    }
}
