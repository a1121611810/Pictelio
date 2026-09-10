package io.pictelio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * {@link LynxRuntimeInitializer.InitGate} 幂等状态机测试（ADR-0153 前置修复）。
 *
 * <p>Oracle = ADR-0153 决策「成功才置位、失败不 latch」：动作正常返回才 done；
 * 动作抛异常（含 Error，如 UnsatisfiedLinkError）必须保持未初始化以便重试。
 * 纯状态机，不触 LynxEnv / Android runtime。
 */
public class LynxRuntimeInitializerTest {

    @Test
    public void run_success_latchesAndSkipsSecondRun() {
        LynxRuntimeInitializer.InitGate gate = new LynxRuntimeInitializer.InitGate();
        int[] calls = {0};

        gate.run(() -> calls[0]++);
        gate.run(() -> calls[0]++);

        assertTrue("成功后应置位", gate.isDone());
        assertTrue("第二次 run 应被跳过", calls[0] == 1);
    }

    @Test
    public void run_runtimeException_doesNotLatch_andRetries() {
        LynxRuntimeInitializer.InitGate gate = new LynxRuntimeInitializer.InitGate();
        int[] calls = {0};

        try {
            gate.run(() -> {
                calls[0]++;
                throw new RuntimeException("init failed");
            });
        } catch (RuntimeException expected) {
            // 异常向上传播（调用方自行兜底）
        }

        assertFalse("失败不得 latch", gate.isDone());

        gate.run(() -> calls[0]++);
        assertTrue("失败后重试应真正执行", calls[0] == 2);
        assertTrue("重试成功后才置位", gate.isDone());
    }

    @Test
    public void run_error_doesNotLatch_andRetries() {
        LynxRuntimeInitializer.InitGate gate = new LynxRuntimeInitializer.InitGate();
        int[] calls = {0};

        try {
            gate.run(() -> {
                calls[0]++;
                throw new UnsatisfiedLinkError("liblynxbase.so missing");
            });
        } catch (UnsatisfiedLinkError expected) {
            // Error 同样向上传播（JVM 不会吞 Error）
        }

        assertFalse("Error 失败不得 latch", gate.isDone());

        gate.run(() -> calls[0]++);
        assertTrue("Error 后重试应真正执行", calls[0] == 2);
        assertTrue(gate.isDone());
    }
}
