package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * OTA 慢通道 Worker（#252）：WorkManager 调度的后台预热——共用 {@link OtaInstaller}
 * 流水线（下载→验签→解压→写 pending），不触碰 WebView/指针（无桥）：下次启动由
 * {@link OtaPlugin#load()} adopt pending 生效。
 *
 * 失败语义：瞬态（"error:*"，网络/IO/5xx）→ retry（WorkManager 指数退避，上限
 * {@link #MAX_ATTEMPTS} 次转 failure 防风暴）；契约失败（bad-signature / checksum /
 * apk-too-old 等重试无意义）→ 直接 failure。
 */
public class OtaWorker extends Worker {

    static final String TAG = "OtaWorker";
    static final String KEY_URL_BASE = "urlBase";
    /** unique work 名（ExistingWorkPolicy.KEEP：重复检查不堆叠任务） */
    static final String UNIQUE_NAME = "ota-prewarm";
    static final int MAX_ATTEMPTS = 5;

    public OtaWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String urlBase = getInputData().getString(KEY_URL_BASE);
        if (urlBase == null || urlBase.isEmpty()) {
            Log.w(TAG, "[ota-worker] no urlBase → failure");
            return Result.failure();
        }
        try {
            OtaInstaller.InstallResult r = OtaInstaller.installBundle(getApplicationContext(), urlBase);
            Log.i(TAG, "[ota-worker] prewarm-ok version=" + r.version + " → pending（下次启动生效）");
            return Result.success();
        } catch (OtaInstaller.OtaInstallException e) {
            int attempt = getRunAttemptCount();
            boolean transientFailure = e.reason.startsWith("error:");
            if (transientFailure && attempt < MAX_ATTEMPTS) {
                Log.w(TAG, "[ota-worker] 瞬态失败（第 " + attempt + " 次）→ retry: " + e.reason);
                return Result.retry();
            }
            Log.w(TAG, "[ota-worker] failure（attempt=" + attempt + "）: " + e.reason);
            return Result.failure();
        }
    }
}
