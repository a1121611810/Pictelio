# debug / release 变体存储隔离的运行时验证（票 #1037 · ADR-0227）

- 日期：2026-10-23
- 依据：[#1037 验收条件第 8 条](https://github.com/a1121611810/Pictelio/issues/1037)「验收记录里包含一次**真实 release 包**上的运行时验证结果，不是文本层断言」
- 决策：[ADR-0227](../adr/ADR-0227-debug-application-id-suffix-isolation.md)（debug 变体 `applicationIdSuffix ".debug"`；release 侧一字不动）
- 环境：模拟器 `emulator-5556`（Android 14 / API 34，1080×2160@480dpi），`adb root` 可读 `/data/data`（root 模拟器镜像）
- 帧：[`assets/debug-release-isolation/`](assets/debug-release-isolation/)（`io-pictelio-app-debug-logged-in.png` · `io-pictelio-app-release-login.png`）

## 1. 结论

**存储层隔离成立。** 同一台设备上 debug 变体（`io.pictelio.app.debug`）与 release 变体（`io.pictelio.app`）
**可共存安装**，且两侧**数据目录完全分离**：dev 播种键与会话凭据只存在于 debug 侧，release 侧读不到任何一个。

用户可见：debug 变体已登录、能看到作品流；release 变体停在登录页。

## 2. 测什么（与不测什么）

**测**：两个 applicationId 的**存储隔离**（键是否互相可见）。

**不测**：release 包在真实用户设备上的行为、签名/升级路径、存量污染设备（ADR-0227 D6：#1035 的读侧闸门兜底存量，本决策**治不了存量**）。

## 3. 步骤与实测

### 3.1 装 debug 变体并播种 dev 键

```bash
adb install packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk
# dev 播种（refresh_token 的值不入文档、不入库、不入聊天）
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity \
  --es pictelio_dev_refresh_token <REDACTED> --es pictelio_dev_force_r18 true
```

> ⚠️ 组件串必须是「applicationId + **全限定类名**」：相对类名在 `am start -n` 里按
> applicationId 的包展开 ⇒ 会解析到不存在的类（ADR-0227 D3/D4）。
>
> ⚠️ **补播其余 4 组 dev 键前必须 `force-stop`**：`launchMode="singleTask"` ⇒ intent 会被投递给
> **已运行的** top-most 实例（实测提示 `Activity not started, intent has been delivered to
> currently running top-most instance`），而 dev hook 挂在 `onCreate` 里 ⇒ **不 force-stop 就不会
> 再触发**，键也不会写入。正确顺序：
> ```bash
> adb shell am force-stop io.pictelio.app.debug
> adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity \
>   --es pictelio_dev_llm_base_url "https://example.invalid/v1" \
>   --es pictelio_dev_llm_model "isolation-proof-placeholder" \
>   --es pictelio_dev_llm_api_key "isolation-proof-placeholder" \
>   --es pictelio_dev_force_translate_r18 true
> ```
> （LLM 三键用**占位值**，只为验证键位隔离，不是可用配置。）

### 3.2 装 release 变体（**旧 debug 签名包必须先卸载**）

旧 debug 包（ADR-0227 落地前装的那份）的 applicationId 就是 `io.pictelio.app`，与 release **同 id** ⇒
不卸载直接装 release 会因签名不匹配失败。流程：

```bash
adb uninstall io.pictelio.app            # 旧 debug 签名包（连带清掉它的数据目录）
adb install packages/android-host/android/app/build/outputs/apk/release/pictelio-6.10.0-release.apk
```

### 3.3 共存（实测）

```
$ adb shell pm list packages | grep pictelio
package:io.pictelio.app
package:io.pictelio.app.debug
```

⇒ **两个 applicationId 同时存在**，互不覆盖、互不卸载。

### 3.4 隔离（实测，键名口径，不含值）

release 侧（`/data/data/io.pictelio.app/shared_prefs/`）：

| 文件 | 存在 | 键名 |
| --- | --- | --- |
| `CapacitorStorage.xml` | ✅（release **首次启动后**由 App 自建） | `usage_metrics_v1`（App 自身的用量统计键）——**无** `dev_force_r18` |
| `WSSecureStorageSharedPreferences.xml` | ❌ **不存在** | —— release 侧**没有任何会话凭据**落点 |

debug 侧（`/data/data/io.pictelio.app.debug/shared_prefs/`）：

| 文件 | 存在 | 键名 |
| --- | --- | --- |
| `CapacitorStorage.xml` | ✅ | `dev_force_r18`、`dev_force_translate_r18`、`llm_endpoint_base_url`、`llm_endpoint_model`（**4 个 dev 播种键**）**+** `usage_metrics_v1`（App 自身） |
| `WSSecureStorageSharedPreferences.xml` | ✅ | `capacitor-storage_refresh_token`、`capacitor-storage_translate_llm_api_key`（**2 个凭据类 dev 播种键**） |

⇒ **6 组 dev 播种键全部只在 debug 侧**；release 侧**一个都读不到**（键名完整枚举 + 凭据落点文件不存在）。

> ⚠️ **口径订正（2026-10-23）**：初次取证时记的是「release 侧 `/data/data/io.pictelio.app/` 只有
> `cache`/`code_cache`，**无 `shared_prefs`」——那只在**release 首次启动之前**成立（且它同时证明
> 旧 debug 包的数据目录确实随卸载被清干净了）。release 首次启动后 App 会**自建**
> `CapacitorStorage.xml`（键 `usage_metrics_v1`）与图片缓存标记 ⇒ 「有 shared_prefs 目录」是
> **App 自己的产物**，不是继承。**隔离的正确判据是「读不到 dev 播种键与凭据落点」**，
> 不是「目录不存在」。

> ⚠️ **验收条件口径订正（2026-10-23，双轴复核提出 + 本轮补测后收敛）**：#1037 验收条件第 2 条字面要求
> 「在 debug 上用 `am start --es` 播种**全部** dev 键后**覆盖安装** release」——该字面场景在本设计下
> **已被取代**，口径如下（隔离结论不变，且播种覆盖已补齐为 **6/6**）：
>
> 1. **「覆盖安装」这一步在 D2 落地后不再存在**：debug 与 release 是**不同 applicationId**
>    （`io.pictelio.app.debug` / `io.pictelio.app`）⇒ 两者**不存在覆盖关系**，debug 侧写什么都不会
>    触及 release 的数据目录。这正是本决策要达到的效果。可验证的等价命题是「**release 读不到 debug
>    侧任何一个 dev 播种键**」，本轮已用**键名完整枚举**逐项验完（§3.4）。
> 2. **播种覆盖已补齐 = 6/6 组**（初轮只播 2 组，本轮按复核意见补测）：dev 播种键共 6 组
>    —— `refresh_token` / `llm_base_url` / `llm_api_key` / `llm_model` / `force_r18` /
>    `force_translate_r18`。补测步骤：`adb shell am force-stop io.pictelio.app.debug`（**必须**，
>    否则 intent 投递给已运行的 singleTask 实例、`onCreate` 里的 dev hook 不再触发）→ 再 `am start`
>    带上 4 个剩余 extra。实测后 debug 侧 `CapacitorStorage.xml` = `dev_force_r18` /
>    `dev_force_translate_r18` / `llm_endpoint_base_url` / `llm_endpoint_model`（+ App 自身的
>    `usage_metrics_v1`）、`WSSecureStorageSharedPreferences.xml` = `capacitor-storage_refresh_token` /
>    `capacitor-storage_translate_llm_api_key`；**release 侧 `CapacitorStorage.xml` 仍只有
>    `usage_metrics_v1`，`WSSecureStorageSharedPreferences.xml` 仍不存在** ⇒ **一个都读不到**。
>    ⚠️ 补测用的 LLM 三键是**占位值**（`https://example.invalid/v1` / `isolation-proof-placeholder`），
>    只为验证**键位隔离**，**不是可用配置**。
> 3. **仍存的一处流程差异（如实登记）**：安装 release 前**卸载了旧 debug 签名包**（它的
>    applicationId 就是 `io.pictelio.app`，与 release 同 id ⇒ `adb install -r` 会因**签名不匹配**
>    失败）。卸载顺带清掉了旧 debug 包的数据目录 ⇒ 它**不能**替代「同 id 覆盖安装后 release 读不到
>    dev 键」的验证。⇒ 隔离结论的依据是 §3.4 的**键名枚举**，**不是**卸载这一步。
> 4. **仍缺的一项取证（如实登记）**：#1037 验收条件第 3 条的「**翻译闸门放行**」——
>    `dev_force_translate_r18` 这一键已**播种并验证隔离**（键位层面），但「实际发起一次 R18 翻译并被
>    放行」需要可用的 LLM 端点配置 + 受限章节，**本轮未实跑**，仍属机制论证。

### 3.5 用户可见（帧）

| 变体 | 帧 | 内容 |
| --- | --- | --- |
| debug | `assets/debug-release-isolation/io-pictelio-app-debug-logged-in.png` | **已登录**：作品流（顶部「全部/插画/小说」tab、作品大图、标签 chip、收藏数 193、底部导航） |
| release | `assets/debug-release-isolation/io-pictelio-app-release-login.png` | **停在登录页**：「粘贴 Pixiv refresh_token」输入框 + 「登录」按钮 |

⇒ **会话零继承**：同一个 refresh_token 播在 debug 侧，release 侧仍要求重新登录。

## 4. 已知失效面

1. **本验证只覆盖模拟器**（root 镜像 ⇒ 可直读 `/data/data`）。真机上 `adb root` 不可用 ⇒ 读数据目录须走
   `run-as`（debug 包可 debuggable）或 UI 可见性；**真机复现时数据目录那一段的取证手段不同，结论口径不变**。
2. **「release 侧无凭据」是在本机这台干净模拟器上测的**：若 release 侧曾被**用户手动登录过**，
   其自有凭据当然存在——本验证要证明的是「**debug 侧的 dev 播种键不会出现在 release 侧**」，
   不是「release 永远无凭据」。
3. **存量污染设备不在本验证范围**（ADR-0227 D6）：旧版本把 dev 键写在 `io.pictelio.app` 数据目录里的设备，
   加后缀**治不了**——那是 #1035 读侧闸门的职责。
4. **未验证**：debug 变体与 release 变体的**互升级路径**（`adb install -r`）、两者的**签名差异**在真实
   Play 渠道设备上的表现。

## 5. 复现命令（汇总）

```bash
adb install packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity \
  --es pictelio_dev_refresh_token <REDACTED> --es pictelio_dev_force_r18 true
adb uninstall io.pictelio.app
adb install packages/android-host/android/app/build/outputs/apk/release/pictelio-6.10.0-release.apk
adb shell pm list packages | grep pictelio                      # 两包共存
adb shell ls /data/data/io.pictelio.app/shared_prefs/           # release：无 WSSecureStorage*
adb shell ls /data/data/io.pictelio.app.debug/shared_prefs/     # debug：有
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity   # debug：已登录
adb shell am start -n io.pictelio.app/io.pictelio.app.LynxActivity          # release：登录页
```
