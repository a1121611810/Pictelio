package io.pictelio.app;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Application;
import android.util.Log;
import android.view.accessibility.AccessibilityManager;

import java.util.List;

import io.pictelio.app.engine.EngineProbe;
import io.pictelio.app.engine.WebViewAvailability;

/**
 * full 包引擎探针适配器（ADR-0164 决策 3 / spec §5）：
 * 组合 {@link LynxProbe}（Lynx 预检 + DEBUG 取证键）、
 * {@link WebViewAvailability#isOk}（WebView 版本门禁）与
 * {@link AccessibilityManager}（无障碍服务探测，防 TalkBack 用户被静默降级）。
 *
 * <p>接口契约：全函数、永不抛异常——无障碍探测整体 try/catch → false（fail-closed，
 * 探测失败不构成把用户锁死在 Lynx 的理由，也不应让启动崩溃）。
 */
public final class FullEngineProbe implements EngineProbe {

    private static final String TAG = "FullEngineProbe";

    private final Application app;
    private final LynxProbe lynxProbe;

    private FullEngineProbe(Application app) {
        this.app = app;
        this.lynxProbe = LynxProbe.create(app);
    }

    public static FullEngineProbe create(Application app) {
        return new FullEngineProbe(app);
    }

    @Override
    public String[] clientKinds() {
        return BuildConfig.CLIENT_KINDS;
    }

    @Override
    public boolean lynxAvailable() {
        return lynxProbe.lynxAvailable();
    }

    @Override
    public boolean webviewOk() {
        return WebViewAvailability.isOk(app);
    }

    @Override
    public boolean a11yActive() {
        try {
            AccessibilityManager am = app.getSystemService(AccessibilityManager.class);
            if (am == null || !am.isEnabled()) return false;
            List<AccessibilityServiceInfo> enabled = am.getEnabledAccessibilityServiceList(
                    AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            return enabled != null && !enabled.isEmpty();
        } catch (Exception e) {
            Log.w(TAG, "无障碍服务探测失败，按未启用处理", e);
            return false;
        }
    }
}
