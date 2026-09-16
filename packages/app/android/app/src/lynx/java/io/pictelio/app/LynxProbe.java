package io.pictelio.app;

import android.app.Application;

import io.pictelio.app.engine.EnginePrefs;
import io.pictelio.app.engine.EngineProbe;

/**
 * lynx 引擎探针适配器（src/lynx 源集，ADR-0164 决策 3 / spec §5）。
 *
 * <p>webviewOk / a11yActive 恒 false：lynx 单引擎包语义上不存在 WebView 与
 * 无障碍回退路径（矩阵 S1a/S1b/S10 仅 full 包可达）；full 包经
 * {@link FullEngineProbe} 组合本类与 WebView / 无障碍探测。
 */
public final class LynxProbe implements EngineProbe {

    private final Application app;

    private LynxProbe(Application app) {
        this.app = app;
    }

    public static LynxProbe create(Application app) {
        return new LynxProbe(app);
    }

    @Override
    public String[] clientKinds() {
        return BuildConfig.CLIENT_KINDS;
    }

    @Override
    public boolean lynxAvailable() {
        // DEBUG 取证键优先（ADR-0164 决策 11）：仅在 DEBUG 构建被读取——BuildConfig.DEBUG
        // 为编译期常量，release 下本分支连同键字符串一起被 R8 死代码消除（发布验收断言）。
        if (BuildConfig.DEBUG && EnginePrefs.debugForceLynxUnavailable(app)) {
            return false;
        }
        return LynxRuntimeInitializer.isAvailable(app);
    }

    @Override
    public boolean webviewOk() {
        return false;
    }

    @Override
    public boolean a11yActive() {
        return false;
    }
}
