# android-e2e 测试工具

真机/模拟器端到端验证用的本地工具，**不参与构建与 CI**。

## mock-responses-sse-server.mjs

一个最小 OpenAI Responses API（`/v1/responses`）兼容的 SSE 服务，用于在**不依赖外网 LLM** 的前提下
验证 app-lynx 的翻译链路（设置页 → store → native bridge → SSE 解析 → UI 渲染）。

```bash
node packages/app/tests/android-e2e/tools/mock-responses-sse-server.mjs        # 完整回放（逐段）
MOCK_TINY=1 node packages/app/tests/android-e2e/tools/mock-responses-sse-server.mjs  # 只回 3 段（快速）
```

监听 `0.0.0.0:8811`，对 `input` 里以 `[N]` 前缀锚定的段落回 `【译N】…`（确定性伪翻译，便于在截图里确认往返）。

### 与模拟器对接（关键：`adb reverse`）

Android 模拟器到宿主的两条路：

1. `http://10.0.2.2:8811` —— 需放行 cleartext，debug 包默认被 network security policy 拒绝
   （`CLEARTEXT communication to 10.0.2.2 not permitted`）。
2. **`adb reverse tcp:8811 tcp:8811` + `http://127.0.0.1:8811`** —— 推荐：走回环，且
   `PictelioTranslateModule` 明确放行 `127.0.0.1` / `localhost` 的 http base URL（仅本地联调窗口）。

```bash
adb reverse tcp:8811 tcp:8811
adb shell am start -n io.pictelio.app/io.pictelio.app.LynxActivity \
  --es pictelio_dev_refresh_token "$PIXIV_REFRESH_TOKEN" \
  --es pictelio_dev_force_r18 true \
  --es pictelio_dev_llm_base_url "http://127.0.0.1:8811/v1" \
  --es pictelio_dev_llm_model "mock-model" \
  --es pictelio_dev_llm_api_key "sk-mock-key-0123456789012345678901234" \
  --es benchNav novel
```

dev intent hooks（全部 `BuildConfig.DEBUG` 门禁，release 包不含）：

| extra                                               | 作用                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `pictelio_dev_refresh_token`                        | 自动登录（写 Keystore + OAuth 交换）                              |
| `pictelio_dev_force_r18`                            | 强制 `showR18` / `showR18G`（否则受限作品不进列表、翻译入口隐藏） |
| `pictelio_dev_llm_base_url` / `_model` / `_api_key` | 播种翻译 endpoint（apiKey 进 Keystore，其余进 SharedPreferences） |
| `benchNav`                                          | 直达页面（`novel` = 小说列表等，见 LynxActivity）                 |

### 已知限制（2026-09-19 实测）

模拟器上长流式响应的后续帧不稳定送达：app 侧能收到 HTTP 200，但同一连接此后不再有数据；
同一请求在宿主机数秒内完成，且 mock 明确回 response.created / in_progress / output_item.added 等帧。
**不是** app 侧解析逻辑问题：建流、请求构造（mock 收到正确 model 与 56 段 input）、HTTP 200 均已取证。

app 侧现在不会因此永久挂起（此前会）：

- 流式请求改用**专用 OkHttp 客户端**（callTimeout=0、readTimeout=120s）——共享客户端的 45s
  callTimeout 会把正常长流掐断，且掐断后 call.isCanceled() 被当成「用户取消」而静默退出；
- 用户中断改由显式 USER_ABORTED 集合标记，其余取消一律走 error 回调；
- 因此最坏情况是 120s 后失败并显示错误，不再停在「N% 翻译中」。

真机（物理设备）验证仍待补。
