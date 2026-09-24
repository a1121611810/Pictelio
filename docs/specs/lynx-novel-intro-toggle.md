# Spec: Lynx 小说介绍页开关（intro-first toggle）

> ADR：[ADR-0183](../adr/ADR-0183-lynx-novel-intro-toggle.md)；术语：[glossary-lynx-novel-intro-toggle](../adr/glossary-lynx-novel-intro-toggle.md)；前置：ADR-0167（三段式导航）。状态：ready-for-agent。

## Problem Statement

Lynx 客户端上点击任何小说都要先进介绍页、再点「开始阅读」才能读正文（ADR-0167 三段式）。介绍页对「发现/决策」场景有价值，但对已经想读的高频读者是每次一跳的固定摩擦；用户希望这一行为可配置——默认维持介绍页先行，关闭后点击小说直接进正文页。

## Solution

设置页（内容组）新增设备级开关「小说先进介绍页」，默认开。开启时行为与现状完全一致；关闭后，**所有**小说点击入口（列表/收藏/用户主页/追更/推荐轮播/搜索弹层）直达正文页。介绍页路由与页面保留，深链与测试通道不受影响。

## User Stories

1. As a Lynx reader who binges novels, I want to skip the intro page, so that tapping a novel takes me straight to the text.
2. As a new user, I want the intro page to stay the default, so that I keep seeing cover/tags/series/bookmark before committing to read.
3. As a user who enters novels from bookmarks, I want the tap behavior to match the novel list, so that navigation is predictable everywhere.
4. As a user who enters novels from search results, I want the same direct-to-body behavior, so that search → read is one tap.
5. As a user following a series (追更), I want tapping the latest chapter to go straight to the body, so that catching up has no detour.
6. As a user browsing the recommend carousel, I want novels (but not illusts) to honor my intro preference, so that mixed cards behave per content type.
7. As a user on a shared device with multiple accounts, I want the toggle to be device-level, so that my navigation preference does not depend on which account is logged in.
8. As a user, I want the toggle persisted across app restarts, so that I set it once.
9. As a user restoring settings from a WebDAV backup, I want the toggle restored with the rest of device settings, so that my preference survives device migration.
10. As a screen-reader user, I want the settings row to be focusable, labeled, and toggleable via a11y, so that I can operate it with TalkBack.
11. As a bilingual user, I want the toggle title/description localized (zh-CN and en), so that the settings page reads natively.
12. As a user with R-18/AI masking enabled, I want direct-to-body to keep every existing masking gate, so that the toggle never becomes a content-policy bypass.
13. As a user who turned the toggle off, I want the intro page to still exist at its route, so that deep links or future entries to it keep working.
14. As a user who keeps the toggle on, I want zero behavior change after upgrade, so that the release is invisible to me.
15. As a maintainer, I want the intro navigation string owned by one module, so that future flow changes are single-point edits.
16. As a maintainer, I want guard tests pinning both states, so that any entry hardcoding intro (or bare) navigation fails CI.
17. As a bench/QA engineer, I want `/novel/:id` to stay directly reachable with no route-level redirect, so that benchNav test channels and deep links keep working.
18. As a user, I want the toggle to affect only navigation, so that nothing about novel content, caching, or reader features changes.

## Implementation Decisions

- **设置模型**：lynx settings store 新增设备级布尔 `novel_intro_first`，默认 `true`（介绍页先行 = 现状，升级零感知）。键不带 uid（导航偏好非账号内容授权）。持久化、加载、失败 `console.warn("[settingsStore] …")` 全部照 `related_injection` / `ranking_entry` 既有范式；键纳入设备级备份键清单。
- **导航缝隙**：新建单点导航模块 `openNovel(id)`——开关开 → 导航 `/novel/:id/intro`；关 → 导航 `/novel/:id`。六入口（小说列表 / 收藏 / 用户主页 / 追更 / 推荐轮播 / 搜索弹层）的小说分支统一改走它；推荐轮播与搜索弹层的插画分支保持原导航不变。`/intro` 导航串从此只允许存在于缝隙模块内。
- **一致性范围**：开关对六入口一体生效（拒绝仅列表页生效——行为分裂对用户的惊扰大于单入口收益，见 ADR-0183 否决项）。
- **路由层零改动**：不加重定向、不动路由表；两路由共存量断言维持 ADR-0167 原样。
- **设置 UI**：设置页「内容」组新增一行，行级 `@tap` 翻转 + `<M3Switch :checked>`（ADR-0179 组件），a11y 标签走既有注册表；i18n 键 `me.content.novelIntroFirst`（标题）+ 描述键，zh-CN/en 双语落盘。
- **webview 不在范围**：无介绍页概念，不出现此设置，键不跨引擎共享。
- **受限内容正交**：直达正文后 R-18/AI 遮罩完全由正文页既有逻辑承接，缝隙不读内容分级字段。

## Testing Decisions

- **只测外部行为**：断言「给定开关状态 → 导航到哪个路由」「给定存储值 → getter 返回什么」，不测内部 ref 布线。
- **缝隙 1（最高缝，主行为缝）**：`openNovel` 双态单测——导航函数打桩，开→intro 串、关→裸串各断言一次；存储层打桩注入两态。先例：lynx 现有 router shim 集成测试的导航断言姿态。
- **缝隙 2（设置持久化）**：默认值、set 后读取、重新加载恢复、写失败 warn 不抛。先例：settings store 既有设备级开关测试（relatedInjection/rankingEntry 同族）。
- **缝隙 3（源级守卫，仓库约定）**：重写既有六入口守卫测试——六文件必须含缝隙调用；`/intro` 导航串在缝隙模块之外零命中（防个别入口回流硬编码）；路由共存量/无重定向断言逐字保留。先例：该测试文件自身（oracle 从 ADR-0167 换为 ADR-0183）。
- **缝隙 4（模板断言）**：设置页模板测试断言新行存在、`<M3Switch>` 绑定、a11y 注册表 key、双语 i18n 键存在。先例：Me 页既有模板测试。
- 不新增 E2E：单测 + 模板断言已覆盖行为与接线（CI 门禁边界口径）。

## Out of Scope

- 正文页 header 信息架构（把介绍页元素带进正文页）。
- 阅读进度恢复 /「继续阅读」语义（介绍页 CTA 固定从头读，维持票 #579 拍板）。
- webview 客户端任何改动；iOS。
- 介绍页自身的功能增删（收藏、标签、评论入口均不动）。

## Further Notes

- 关闭开关后介绍页承载的**收藏入口**对关闭用户不可达，但正文页已有收藏能力（能力不缺失，预览面后置）——ADR-0183「代价/风险」已记录。
- 设备级备份键清单若有一致性测试断言键集，需同步纳入新键。
- 实施拆票见 to-tickets 产出（依赖：设置 store → 缝隙/入口改线、设置 UI）。
