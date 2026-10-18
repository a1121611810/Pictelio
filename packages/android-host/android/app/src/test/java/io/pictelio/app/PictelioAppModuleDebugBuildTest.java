package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import android.app.Application;
import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.react.bridge.Callback;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * {@code PictelioAppModule.isDebugBuild} 的跨桥行为测试（#1038，补 #1035 读侧闸门的最后一段）。
 *
 * <p><b>为什么文本层证不了、只有运行时能证</b>：#1035 的读侧闸门终点是这个原生桥方法，而它
 * 在 release 包里也会被调用。此前钉住它的只有源码文本断言（方法存在 / 方法体里有那行回传 /
 * 没有自我门禁）。但文本断言证不了「值真的跨桥送到了 JS」——方法被改名、{@code Callback}
 * 参数顺序写错、模块没注册，文本全绿而客户端永远收不到判定，于是 fail closed 静默生效，
 * dev 通道在真机上无声失灵。
 *
 * <p><b>oracle</b>：回传值等于 {@link BuildConfig#DEBUG} 这个常量本身。断言右侧取自生产
 * {@code BuildConfig} 的字段、左侧是被测方法经 {@link Callback} 实际送达的值。
 *
 * <p><b>机制（已对 debug 变体反编译核实，两轴 review 结论冲突后以字节码为准）</b>：debug 变体
 * 的 {@code BuildConfig.DEBUG} 初始化为 {@code Boolean.parseBoolean("true")} —— 这是方法调用，
 * <b>不是</b> JLS §15.28 的常量表达式，因此 javac <b>不内联</b>：生产方法体与本断言两侧都发出
 * {@code getstatic io/pictelio.app/BuildConfig.DEBUG:Z}。故这不是「同一字面量被抄两份」的同义反复，
 * 断言能真打红（把方法体改成 {@code invoke(false)} 即红，见 #1038 关闭评论的反事实记录）。
 * （release 变体相反：那里是字面量 {@code = false}，属常量表达式、会内联——但本测试不跑该变体。）
 *
 * <p><b>已知失效面（显式登记，非缺陷）</b>：
 * <ul>
 *   <li><b>共享字段盲区 —— 检测不到常量自身取值变化。</b>断言两侧读的是<b>同一个</b>字段，
 *       故把 debug 变体的 {@code DEBUG} 配成 {@code false}（或给方法体换一个与该值相等的
 *       字面量）时两侧同时变化，本用例会绿。它证明的是「送达」而非「取值正确」——
 *       取值那一半挂 #1034。当前 debug 侧 {@code DEBUG == true} <b>无任何机器防线</b>
 *       （全仓 {@code buildConfig/debug} 零命中，CI 只验 release 产物）。</li>
 *   <li><b>跑在 debug 变体，证不到 release 变体的取值。</b>本仓只存在 {@code testDebugUnitTest}
 *       一个单元测试任务（实测确认）。「release 里它为 false」那一段挂 #1034（其落地方案是
 *       可执行的 gradle 门禁 {@code verifyReleaseBuildConfig}）。因此本测试<b>不</b>把
 *       {@code testBuildType} 改成 release——那会把全部既有 JVM 测试的运行变体悄悄换掉，
 *       属未受控 blast radius。</li>
 *   <li><b>证不到 {@code @LynxMethod} 注解在位</b>。本测试直调 Java 方法，注解被摘掉仍会通过。
 *       该覆盖仍挂在 {@code settingsDevOverride.test.ts} 的文本闸门上（#1035 建立）。</li>
 *   <li><b>证不到模块注册</b>。本测试直接构造实例，不经 Lynx 模块注册表。
 *       「{@code PictelioApp} 是否真的注册进 Lynx」属注册表层事实（注册点在 {@code LynxActivity}），
 *       零测试覆盖，不在本测试范围。</li>
 *   <li><b>证不到真实 CallbackImpl</b>。用记录式假 Callback，不覆盖 Lynx 真实实现的跨线程投递
 *       与 JS 编组语义。</li>
 *   <li><b>不覆盖「兜底那次 invoke 自身也抛错」的分支</b>（{@code PictelioAppModule} 内层 catch）。
 *       该分支的唯一保证是「不穿出方法」，由方法自身的 catch 保证，无测试钉住（见
 *       {@code settingsDevOverride.test.ts} 的结构层文本断言）。</li>
 * </ul>
 *
 * <p><b>先例</b>：同源集已有 6 处 Robolectric 测试直接构造 Lynx 模块并捕获 {@code Callback}
 * ——{@code PictelioTranslateAbortStreamTest} / {@code PictelioTranslateModuleSuccessTest} /
 * {@code PictelioTranslateModuleTerminalTest} / {@code PictelioTranslateAbortStreamTest} /
 * {@code PictelioTranslateModuleEmptyStreamTest} / {@code PictelioTranslateModuleCancelTest} /
 * {@code PictelioTranslateCacheModuleTest}，均在 {@code src/testLynx/java}（该目录由
 * {@code build.gradle} 并入现行 {@code test} 源集，与本文件同一编译单元）。它们一律写
 * {@code @Config(sdk = 28, application = Application.class)}：后者切掉 manifest 声明的
 * {@code io.pictelio.app.PictelioAppLynx}，避免 Robolectric 真去跑它的 {@code onCreate()}
 * （Lynx 原生初始化 + 后台缓存磁盘 IO）——本测试沿用该约定。
 *
 * <p>本测试与它们的差别只有一处，且是刻意的：它们传 {@code TestLynxContext}，本测试传裸
 * {@code Application} Context。{@code isDebugBuild} 不走 {@code appContext()}（那才会把
 * {@code mContext} 强转成 {@code LynxContext}），故裸 Context 足够——这条对
 * {@code LynxModule} 构造器也已核实：其 {@code Context} 构造器字节码只有两条 {@code putfield}，
 * 无校验、无副作用。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioAppModuleDebugBuildTest {

    /** 记录 invoke 实参的假 Callback（Lynx Callback 契约：invoke(Object...)）。 */
    private static class RecordingCallback implements Callback {
        private final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(1);
        volatile Object[] args;

        @Override
        public void invoke(Object... objects) {
            this.args = objects;
            latch.countDown();
        }

        Object[] await() throws InterruptedException {
            if (!latch.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                throw new AssertionError("Callback 未在 5s 内被调用");
            }
            return args;
        }
    }

    /**
     * 前 {@code failures} 次 invoke 抛错、之后正常记录 —— 用来驱动 {@code isDebugBuild}
     * 的兜底分支（第一次回传抛错 → catch 里再 invoke 一次）。
     */
    private static final class FlakyCallback extends RecordingCallback {
        private final int failures;
        private final java.util.concurrent.atomic.AtomicInteger calls =
                new java.util.concurrent.atomic.AtomicInteger();

        FlakyCallback(int failures) {
            this.failures = failures;
        }

        @Override
        public void invoke(Object... objects) {
            if (calls.getAndIncrement() < failures) {
                throw new IllegalStateException("模拟回传抛错");
            }
            super.invoke(objects);
        }
    }

    private static PictelioAppModule newModule() {
        Context ctx = ApplicationProvider.getApplicationContext();
        return new PictelioAppModule(ctx);
    }

    /**
     * 主断言：调用桥方法 → {@link Callback} 收到的值 === {@link BuildConfig#DEBUG}。
     *
     * <p>刻意断言 {@code args.length == 1}：多传一个参数在 JS 侧仍可能被读到，但会让
     * 「回传的是布尔值」这个契约变得不可验证；参数顺序写错正是本票要防的失效模式之一。
     */
    @Test
    public void isDebugBuild_invokesCallbackWithBuildConfigDebugValue() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        newModule().isDebugBuild(cb);

        Object[] args = cb.await();
        assertEquals("应恰好回传一个参数", 1, args.length);
        assertEquals("回传值必须就是 BuildConfig.DEBUG 本身", BuildConfig.DEBUG, args[0]);
    }

    /**
     * 兜底分支：首次回传抛错时，catch 内的第二次 {@code invoke} 必须送达 {@code false}
     * —— 这是 #1035 读侧 fail closed 的最后一道保证（客户端拿不到 true 就按 release 处理，
     * 后果是 dev 通道不可用，而不是受限正文外发）。
     */
    @Test
    public void isDebugBuild_callbackThrowsFirstTime_fallsBackToFalse() throws Exception {
        FlakyCallback cb = new FlakyCallback(1);
        newModule().isDebugBuild(cb);

        Object[] args = cb.await();
        assertEquals(1, args.length);
        assertEquals("首次回传抛错后必须兜底 false（fail closed）", Boolean.FALSE, args[0]);
    }

    /**
     * 内层 catch：兜底那次 {@code invoke} 自己也抛错时，异常<b>不得穿出方法</b>。
     *
     * <p>{@code PictelioAppModule} 的注释点名了这条：兜底 invoke 若不单独包 try，它自身
     * 抛错会穿出 {@code @LynxMethod}，把「fail closed」变成「抛到 JS」。本用例钉住这个
     * 「不抛」契约（此前无运行时覆盖，只有结构层文本断言）。
     */
    @Test
    public void isDebugBuild_bothInvocationsThrow_doesNotPropagate() {
        // failures=2 ⇒ 主 invoke 与兜底 invoke 两次都抛错；方法仍须正常返回。
        FlakyCallback cb = new FlakyCallback(2);
        newModule().isDebugBuild(cb);
        // 不抛即通过；若异常穿出，Robolectric 会把它作为测试错误报出。
    }
}
