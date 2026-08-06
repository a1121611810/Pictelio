# Pictelio 公共版本发布前检查清单

> 本文件由 Task 15「最终集成与发布」生成，记录 Tasks 1-15 完成情况、验证结果以及正式发布前仍需处理的占位符与检查项。

---

## 一、Tasks 1-15 完成摘要

| 任务    | 内容                    | 关键产出                                                                                   |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Task 1  | 重命名应用身份          | 应用名/包名改为 Pictelio (`io.pictelio.app`)，`APP_VERSION` 从 `package.json` 注入         |
| Task 2  | 重新生成应用图标        | 生成 Pictelio 品牌图标与启动图，覆盖 `assets/`、`public/`、`android/app/src/main/res/`     |
| Task 3  | 移除用户名/密码登录     | 仅保留 refresh_token 登录方式，移除密码输入与相关 API                                      |
| Task 4  | 加密本地 token 存储     | 使用 `capacitor-secure-storage-plugin` 将 refresh_token 存入 Android Keystore              |
| Task 5  | 年龄门与默认过滤改造    | 默认过滤 R-18/R-18G，首次展示敏感内容前弹出年龄确认                                        |
| Task 6  | 举报与屏蔽功能          | 新增 `ReportSheet`、`BlockSheet` 与对应 store，支持举报/屏蔽用户或作品                     |
| Task 7  | 免责声明与 About 页更新 | `About.tsx` 加入第三方免责声明，说明与 Pixiv 无关联                                        |
| Task 8  | 隐私政策页面            | 新增 `docs/privacy-policy.md`、`website/privacy-policy.html`、`public/privacy-policy.html` |
| Task 9  | 账号删除入口            | 设置中提供「清除所有本地数据」入口                                                         |
| Task 10 | Release 构建与签名配置  | 配置 Gradle release 签名、`android/app/pictelio-release.keystore` 占位                     |
| Task 11 | 本地 release 构建测试   | 验证签名 APK 构建流程                                                                      |
| Task 12 | F-Droid Fastlane 元数据 | 创建 `fastlane/metadata/android/` 多语言描述、图标、截图与功能图占位                       |
| Task 13 | GitHub Release 脚本     | `scripts/release-github.mjs` 自动构建签名 APK 并发布到 GitHub Releases                     |
| Task 14 | 官网落地页              | 创建 `website/index.html`、`website/privacy-policy.html` 等品牌官网                        |
| Task 15 | 最终集成与发布          | 替换 GitHub 仓库占位符、同步隐私政策、全量验证、Android 构建冒烟测试                       |

---

## 二、占位符替换情况

- ✅ `YOUR_USERNAME/pictelio` → `a1121611810/pixivizer`（已替换于 `website/index.html`）
- ✅ `YOUR_NAME` → `a1121611810`（已替换于 `website/index.html` 版权信息）
- ✅ `YOUR_PRIVACY_EMAIL@example.com` → `a1121611810@outlook.com`（已替换于隐私政策文件）
- ✅ `YOUR_REPORT_EMAIL@example.com` → `a1121611810@outlook.com`（已替换于 `ReportSheet.tsx` 与隐私政策文件）
- ✅ `public/privacy-policy.html` 已与 `website/privacy-policy.html` 保持同步

---

## 三、预发布检查清单

- [x] 替换 `YOUR_PRIVACY_EMAIL@example.com` 为真实隐私联系邮箱
- [x] 替换 `YOUR_REPORT_EMAIL@example.com` 为真实举报联系邮箱
- [x] 创建真实 release keystore 于 `android/app/pictelio-release.keystore`
- [x] 设置环境变量 `PICTELIO_KEYSTORE_PASSWORD` 与 `PICTELIO_KEY_PASSWORD`（已验证 release 构建成功）
- [x] 验证 `pnpm release:github --repo=a1121611810/pixivizer` 可正常工作（已发布 https://github.com/a1121611810/pixivizer/releases/tag/v1.0.0）
- [x] 向 `fastlane/metadata/android/en-US/images/phoneScreenshots/` 添加真实截图
- [x] 向 `fastlane/metadata/android/en-US/images/featureGraphic.png` 添加真实功能图
- [ ] 提交 F-Droid 收录申请（参考 `docs/superpowers/plans/2026-06-27-pictelio-public-release.md` 中的 metadata 模板）

---

## 四、Task 15 验证结果

| 验证项             | 命令                                                | 结果                                                         |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| 格式化             | `pnpm fmt`                                          | ✅ 通过（134 文件，863 ms）                                  |
| 类型检查与代码检查 | `pnpm check`                                        | ✅ 通过（格式化 + lint 均无问题）                            |
| 单元测试           | `pnpm test -- --run`                                | ✅ 通过（6 个测试文件，48 个测试）                           |
| 生产构建           | `pnpm build`                                        | ✅ 成功生成 `dist/`                                          |
| Android Debug 构建 | `cd android && ./gradlew assembleDebug --no-daemon` | ✅ `BUILD SUCCESSFUL`（213 个任务，27 执行，186 up-to-date） |

> 注：Android Debug 构建仅作冒烟测试；正式发布前仍需使用真实 keystore 执行 `pnpm build:android:release:all` 生成三个签名 APK（full / webview / lynx）。
>
> 注（引擎切换）：`build:android*` 与 `release`/`release-github` 发布流水线已内置 Lynx bundle 构建与同步（`pnpm --dir ../app-lynx run build` → `node ../app-lynx/scripts/sync-android-assets.mjs`），无需手工执行 `pnpm sync:app-lynx-bundle`。若 full/lynx 包 APK 缺 `main.lynx.bundle`，切换渲染引擎后 LynxActivity 将加载失败（历史白屏问题，见 #51）；构建完成后可检查 `packages/app/android/app/src/main/assets/main.lynx.bundle` 是否存在。

---

## 五、Git 信息

- **分支**：`main`
- **当前 commit**：`cc54e24`
- **commit message**：`assets(fastlane): improve Playwright screenshots with API mocking and settings scroll`
- **GitHub Release**：https://github.com/a1121611810/pixivizer/releases/tag/v1.0.0
- **已上传 APK**：`app-release.apk`（版本 1.0.0，versionCode 10000）

---

## 六、后续行动

GitHub Release 已发布完成。

## 七、覆盖发布（`pnpm run release -o`）

**场景**：已发布的版本（如 v4.2.4）漏发资产或文案有误，需要修正 GitHub Release 页面，而非发布新版本。

- **命令**：`pnpm run release -o`（别名 `--overwrite`）；加 `--dry-run` 仅打印将执行的 gh 命令、不实际调用。
- **交互流程**：
  1. 选择覆盖范围：`1` 仅文案 / `2` 仅资产 / `3` 全部（默认）。
  2. 本地已存在全部变体 APK 时询问「复用本地 APK 还是重新构建」；存在缺失变体则自动重新构建。
  3. 文案默认读取 `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`，可确认（Y）或重新粘贴（e）；缺失时交互粘贴。
  4. 展示覆盖计划（覆盖/新增资产清单 + 警告）→ 输入 `Y` 后再输入 tag 名（如 `v4.2.4`）双重确认。
  5. 执行：下载备份旧资产 → `gh release edit` 更新文案 → `gh release upload --clobber` 覆盖/补齐资产；上传失败自动从备份恢复。
- **硬约束**：
  - 覆盖发布**不 bump 版本号**（versionCode 不变）：已安装该版本的用户**无法通过系统覆盖安装**获得新 APK。代码功能修复请走正常发布（如 4.2.4 → 4.2.5）。
  - 目标必须为**已存在且已发布**（非 draft）的 Release；`package.json` 版本与远端 tag 不一致时拒绝执行。
  - 不移动 tag、不创建新 commit、不 force push；操作范围严格限定于 GitHub Release 页面。
- **验证**：正式覆盖前先跑 `pnpm run release -o --dry-run` 预览计划与命令，确认无误后再实际执行。

## 官网部署

- ✅ `website/` 已推送到 `origin/gh-pages` 分支
- ⏳ 需要你在 GitHub 仓库设置中启用 GitHub Pages：
  1. 打开 https://github.com/a1121611810/pixivizer/settings/pages
  2. Source 选择 **Deploy from a branch**
  3. Branch 选择 `gh-pages`，文件夹选 `/ (root)`
  4. 点击 Save
- 启用后官网地址：https://a1121611810.github.io/pixivizer
