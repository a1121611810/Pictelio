import type { Component } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "@/components/ui/FluentIcon";
import { Avatar, MenuRow, type PersonalCenterVariantProps } from "./shared";

/**
 * /me 页面 UI 原型 — 变体 A：统一版
 *
 * 现状结构（顶部栏 + 信息卡 + 菜单卡 + 设置卡）整体换上 A2 视觉语言
 * （无边框 + 大圆角 2XLarge + 单级 elevation2 柔和阴影），与设置页统一。
 * 信息层级与主交互同现状（滚动浏览）。
 */
const VariantA: Component<PersonalCenterVariantProps> = (props) => {
  const ps = props.profileState;

  return (
    <div class="min-h-screen bg-[var(--colorNeutralBackground3)]">
      {/* 顶部栏：返回 + 搜索 */}
      <div class="flex items-center justify-between px-4 pt-3">
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          on:click={props.actions.back}
          class="w-10 h-10 p-0 min-w-10"
        >
          ←
        </fluent-button>
        <div
          class="flex items-center gap-1.5 rounded-full bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] px-4 py-2 cursor-pointer active:scale-[0.97] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
          onClick={props.actions.search}
          role="button"
          tabIndex={0}
          aria-label="搜索"
        >
          <FluentIcon name="search" size={16} />
          <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            搜索
          </span>
        </div>
      </div>

      {/* 用户信息卡 */}
      <div class="px-4 mt-4">
        <section class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)]">
          <div class="flex items-center gap-4">
            <Avatar
              src={ps.avatarUrl()}
              errored={ps.avatarErrored()}
              name={ps.displayUser()?.name ?? "P"}
            />
            <div class="flex-1 min-w-0">
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] truncate leading-snug">
                {ps.displayUser()?.name || "Pictelio"}
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] truncate leading-snug">
                @{ps.displayUser()?.account || ""}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 功能菜单卡 */}
      <div class="px-4 mt-4">
        <section class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
          <MenuRow
            icon="image"
            label={ps.isCurrentUser() ? "我的作品" : "TA 的作品"}
            count={ps.totalWorks()}
            onClick={props.actions.works}
            ariaLabel={ps.isCurrentUser() ? "我的作品" : "TA 的作品"}
          />
          <Show when={ps.isCurrentUser()}>
            <MenuRow
              icon="bookmark"
              label="我的收藏"
              onClick={props.actions.bookmarks}
              ariaLabel="我的收藏"
            />
          </Show>
          <MenuRow
            icon="people"
            label={ps.isCurrentUser() ? "我的关注" : "TA 的关注"}
            count={props.profile()?.total_follow_users ?? 0}
            onClick={props.actions.following}
            ariaLabel={ps.isCurrentUser() ? "我的关注" : "TA 的关注"}
          />
          <MenuRow
            icon="people"
            label={ps.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
            onClick={props.actions.followers}
            ariaLabel={ps.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
          />
        </section>
      </div>

      {/* 设置卡（仅本人） */}
      <Show when={ps.isCurrentUser()}>
        <div class="px-4 mt-3">
          <section class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
            <MenuRow
              icon="settings"
              label="设置"
              onClick={props.actions.settings}
              ariaLabel="设置"
            />
          </section>
        </div>
      </Show>
    </div>
  );
};

export default VariantA;
