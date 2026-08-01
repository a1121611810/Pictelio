package io.pictelio.app;

import android.content.Context;

import com.lynx.tasm.provider.AbsTemplateProvider;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Lynx bundle 模板提供器 —— 读取 assets/main.lynx.bundle（官方 demo DemoTemplateProvider 同款）。
 *
 * <p>bundle 产物由 {@code pnpm sync:lynx-bundle} 从 packages/app-lynx/dist/ 同步（#51）。
 */
public class PictelioTemplateProvider extends AbsTemplateProvider {

    private static final String BUNDLE_ASSET = "main.lynx.bundle";

    private final Context context;

    public PictelioTemplateProvider(Context context) {
        this.context = context;
    }

    @Override
    public void loadTemplate(String url, Callback callback) {
        try (InputStream is = context.getAssets().open(BUNDLE_ASSET)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = is.read(buffer)) != -1) {
                out.write(buffer, 0, n);
            }
            callback.onSuccess(out.toByteArray());
        } catch (IOException e) {
            callback.onFailed("bundle 读取失败: " + e.getMessage());
        }
    }
}
