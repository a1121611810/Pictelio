package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link PluginNetworkDispatcher} 卸载三性质测试（ADR-0159 决策 1，GitHub #521）。
 *
 * <p>Oracle = ADR-0159 决策 1「提交即返回、回调在工作线程、异常映射失败回调」；
 * 第 4 条（onSuccess 内异常同样映射失败回调）为原插件 try 块「执行体 + 结果映射」
 * 覆盖范围的行为等价锁定。全部用 CountDownLatch 同步，不触 Android runtime；
 * 直接对抗生产 cached 池（非注入执行器），锁定的是生产线程语义本身。
 */
public class PluginNetworkDispatcherTest {

    private static final long AWAIT_SECONDS = 5;

    /** 性质 1：提交后调用线程立即返回——任务仍被 gate 阻塞时 dispatch 已返回。 */
    @Test
    public void dispatch_returnsImmediately_callerNotBlockedByTask() throws Exception {
        PluginNetworkDispatcher dispatcher = new PluginNetworkDispatcher();
        CountDownLatch gate = new CountDownLatch(1);      // 任务放行闸（由本线程控制）
        CountDownLatch finished = new CountDownLatch(1);  // 任一回调触达信号
        AtomicBoolean successCalled = new AtomicBoolean(false);

        // 若 dispatch 同步执行任务，下一行会死锁在 gate.await()（以挂起形态暴露）
        dispatcher.dispatch(
                () -> {
                    gate.await();
                    return "ok";
                },
                r -> {
                    successCalled.set(true);
                    finished.countDown();
                },
                t -> finished.countDown());

        assertEquals("提交返回时任务不得已完成（调用线程未被任务阻塞）", 1, finished.getCount());
        assertFalse("任务被阻塞期间成功回调不得触发", successCalled.get());

        gate.countDown();
        assertTrue("放行后任务应在工作线程完成", finished.await(AWAIT_SECONDS, TimeUnit.SECONDS));
        assertTrue("任务完成后成功回调应触发", successCalled.get());
    }

    /** 性质 2：任务与回调均在工作线程完成，调用线程只做提交。 */
    @Test
    public void dispatch_taskAndCallbacksRunOnWorkerThread() throws Exception {
        PluginNetworkDispatcher dispatcher = new PluginNetworkDispatcher();
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<Thread> taskThread = new AtomicReference<>();
        AtomicReference<Thread> callbackThread = new AtomicReference<>();
        Thread caller = Thread.currentThread();

        dispatcher.dispatch(
                () -> {
                    taskThread.set(Thread.currentThread());
                    return "ok";
                },
                r -> {
                    callbackThread.set(Thread.currentThread());
                    finished.countDown();
                },
                t -> finished.countDown());

        assertTrue(finished.await(AWAIT_SECONDS, TimeUnit.SECONDS));
        assertNotSame("任务应在工作线程执行，不得占用调用线程", caller, taskThread.get());
        assertNotSame("回调应在工作线程执行（桥线程只做提交）", caller, callbackThread.get());
        assertTrue("工作线程名应带模块前缀（logcat 诊断，ADR-0159）",
                taskThread.get().getName().startsWith("PictelioNet-"));
    }

    /** 性质 3：任务抛异常映射为失败回调（携带原始异常对象），成功回调不触发。 */
    @Test
    public void dispatch_taskThrows_mapsToFailureCallback() throws Exception {
        PluginNetworkDispatcher dispatcher = new PluginNetworkDispatcher();
        CountDownLatch finished = new CountDownLatch(1);
        AtomicBoolean successCalled = new AtomicBoolean(false);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        RuntimeException boom = new RuntimeException("net down");

        dispatcher.dispatch(
                () -> {
                    throw boom;
                },
                r -> successCalled.set(true),
                t -> {
                    failure.set(t);
                    finished.countDown();
                });

        assertTrue(finished.await(AWAIT_SECONDS, TimeUnit.SECONDS));
        assertFalse("失败路径不得触发成功回调", successCalled.get());
        assertSame("失败回调应收原始异常对象", boom, failure.get());
    }

    /** 行为等价锁定：原插件 try 块覆盖「执行体 + 结果映射」，映射抛异常同样走失败回调。 */
    @Test
    public void dispatch_onSuccessThrows_mapsToFailureCallback() throws Exception {
        PluginNetworkDispatcher dispatcher = new PluginNetworkDispatcher();
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        IllegalStateException mappingError = new IllegalStateException("map failed");

        dispatcher.dispatch(
                () -> "ok",
                r -> {
                    throw mappingError;
                },
                t -> {
                    failure.set(t);
                    finished.countDown();
                });

        assertTrue(finished.await(AWAIT_SECONDS, TimeUnit.SECONDS));
        assertSame("onSuccess 内异常应映射为失败回调（原 try 块语义）", mappingError, failure.get());
    }
}
