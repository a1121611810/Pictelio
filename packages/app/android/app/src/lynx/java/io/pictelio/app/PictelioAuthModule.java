package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONObject;

/**
 * 认证 Native Module（#53）——access_token Java 堆隔离，JS 零知。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioAuth}。
 * 回调契约（Callback.invoke 双参，第二参区分错误；成功/失败均不用 null）：
 * <ul>
 *   <li>{@code loginWithRefreshToken(token, cb)}：成功 {@code cb(userInfoJson, "")}；
 *       失败 {@code cb("", errMsg)}。userInfoJson 含 userId/userName/userAccount/
 *       profileImageUrls/refreshToken（**不含 access_token**——只进 Java 堆）</li>
 *   <li>{@code setAccessToken(token)}：备用 push（JS 直登录路径）；无回调</li>
 *   <li>{@code clearTokens(cb)}：登出清 Java 堆 token；成功 {@code cb("", "")}</li>
 * </ul>
 */
public class PictelioAuthModule extends LynxModule {

    private static final String TAG = "PictelioAuthModule";

    public PictelioAuthModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    /**
     * Native OAuth refresh_token 交换（复用主项目 AuthPlugin 同款请求）。
     * access_token 写入 Java 堆（PixivApiCore.accessToken），**不回调给 JS**。 
     */
    @LynxMethod
    public void loginWithRefreshToken(String refreshToken, Callback callback) {
        try {
            JSONObject result = PixivApiCore.oauthTokenExchange(refreshToken);
            if (result == null) {
                callback.invoke("", "登录凭证无效或已失效");
                return;
            }
            // token 只进 Java 堆（JS 零知）
            PixivApiCore.accessToken = result.optString("accessToken");
            String rotated = result.optString("refreshToken");
            if (!rotated.isEmpty()) {
                PixivApiCore.refreshToken = rotated;
            }

            // 回调 JS：用户信息 + 新 refresh_token（供持久化），不含 access_token
            JSONObject user = result.optJSONObject("user");
            JSONObject info = new JSONObject();
            info.put("userId", user != null ? user.optInt("id", 0) : 0);
            info.put("userName", user != null ? user.optString("name", "") : "");
            info.put("userAccount", user != null ? user.optString("account", "") : "");
            if (user != null && user.optJSONObject("profile_image_urls") != null) {
                info.put("profileImageUrls", user.getJSONObject("profile_image_urls"));
            }
            info.put("refreshToken", rotated);
            callback.invoke(info.toString(), "");
        } catch (Exception e) {
            Log.w(TAG, "loginWithRefreshToken 失败", e);
            callback.invoke("", "登录失败: " + e.getMessage());
        }
    }

    /** 备用：JS 直登录（web 模式 OAuth 结果）后 push access_token 到 Java 堆 */
    @LynxMethod
    public void setAccessToken(String token) {
        PixivApiCore.accessToken = token;
    }

    /** 登出：清 Java 堆 token（access_token 与 refresh_token） */
    @LynxMethod
    public void clearTokens(Callback callback) {
        PixivApiCore.accessToken = null;
        PixivApiCore.refreshToken = null;
        callback.invoke("", "");
    }
}
