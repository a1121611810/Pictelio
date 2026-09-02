package io.pictelio.app;

import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.MotionEvent;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * 双端滚动跟手性 T1 注入器（wayfinder #304 / #312）。
 *
 * 用 UiAutomation.injectInputEvent 注入自建 MotionEvent 序列（eventTime 已知，
 * 与 framestats 同 SYSTEM_TIME_MONOTONIC 域），记录 down/move/up 时刻（ns）到 logcat
 * （tag=BenchInput），供 bench 脚本与 gfxinfo framestats 做「触摸 → 内容首帧」对齐。
 *
 * 用法（adb）：
 *   am instrument -w \
 *     -e kind drag|fling|e4 \
 *     -e x 540 -e y1 1500 -e y2 900 -e duration 200 -e steps 10 \
 *     io.pictelio.app.test/androidx.test.runner.AndroidJUnitRunner \
 *     -e class io.pictelio.app.BenchInputInjectorTest
 */
@RunWith(AndroidJUnit4.class)
public class BenchInputInjectorTest {

    private static final String TAG = "BenchInput";

    @Test
    public void injectGesture() throws InterruptedException {
        Bundle args = InstrumentationRegistry.getArguments();
        String kind = args.getString("kind", "drag");
        float x = Float.parseFloat(args.getString("x", "540"));
        float y1 = Float.parseFloat(args.getString("y1", "1500"));
        float y2 = Float.parseFloat(args.getString("y2", "900"));
        int steps = Integer.parseInt(args.getString("steps", "10"));
        int stepMs = Integer.parseInt(args.getString("stepMs", "16"));
        // 注入前预热（UI 稳定 + 避免与 am instrument 启动抖动重叠）
        Thread.sleep(1200);

        long startMem = SystemClock.uptimeMillis();
        long downNs = SystemClock.uptimeMillis() * 1_000_000L;
        StringBuilder evts = new StringBuilder("kind=").append(kind).append(" down=").append(downNs);

        // down
        MotionEvent down = MotionEvent.obtain(downNs, downNs, MotionEvent.ACTION_DOWN, x, y1, 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(down, true);

        // moves（16ms 步频，匀速直线）
        long[] moveNs = new long[steps];
        for (int i = 1; i <= steps; i++) {
            long t = SystemClock.uptimeMillis();
            long evtNs = t * 1_000_000L;
            long waitTarget = (downNs / 1_000_000L) + i * stepMs;
            if (t < waitTarget) Thread.sleep(waitTarget - t);
            float ny = y1 + (y2 - y1) * i / steps;
            MotionEvent mv = MotionEvent.obtain(evtNs, evtNs, MotionEvent.ACTION_MOVE, x, ny, 0);
            mv.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(mv, true);
            moveNs[i - 1] = evtNs;
        }

        // up
        long upNs = SystemClock.uptimeMillis() * 1_000_000L;
        MotionEvent up = MotionEvent.obtain(upNs, upNs, MotionEvent.ACTION_UP, x, y2, 0);
        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(up, true);
        Thread.sleep(300);

        for (long mv : moveNs) evts.append(" move=").append(mv);
        evts.append(" up=").append(upNs).append(" wallMs=").append(SystemClock.uptimeMillis() - startMem);
        Log.i(TAG, "BENCH_INPUT " + evts);
    }
}
