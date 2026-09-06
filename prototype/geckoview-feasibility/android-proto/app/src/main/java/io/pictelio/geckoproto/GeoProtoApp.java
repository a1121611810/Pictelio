package io.pictelio.geckoproto;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;

/**
 * 冷启动预热实验（A/B 经 run-as 写 prefs 旗标 gvproto_flags/warmup）：
 * true  = Application.onCreate 即在 UI 线程 create runtime + warmUp()（预分配内容进程，
 *         引擎初始化与 Activity/窗口构建重叠）；
 * false = 现状（Activity onCreate 里才 create）。
 * warmUp 会提前拉起内容进程：启动换内存的权衡旋钮。
 */
public final class GeoProtoApp extends Application {

    public static volatile GeckoRuntime eagerRuntime;

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences flags = getSharedPreferences("gvproto_flags", Context.MODE_PRIVATE);
        boolean warmup = flags.getBoolean("warmup", false);
        if (!warmup) return;
        long t0 = System.nanoTime();
        eagerRuntime = GeckoRuntime.create(this, new GeckoRuntimeSettings.Builder()
                .fissionEnabled(false)
                .glMsaaLevel(0)
                .consoleOutput(false)
                .build());
        eagerRuntime.warmUp();
        Log.i("GVPROTO", "[boot][app] eager create+warmUp done t+"
                + ((System.nanoTime() - t0) / 1_000_000) + "ms");
    }
}
