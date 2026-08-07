import type { Component } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "@/components/ui/FluentIcon";
import { Avatar, MenuRow, type PersonalCenterVariantProps } from "./shared";

/**
 * /me 页面 UI 原型 — 变体 C：英雄头像版（Hero）
 *
 * 布局重构：大头像（96px）居中 + 名字/账号 + 统计行构成 Hero 卡；
 * 全部功能入口（作品/收藏/关注/粉丝/设置）合并为单张菜单卡。
 * 信息层级：身份展示优先，入口集中。A2 视觉语言。
 */
const VariantC: Component<PersonalCenterVariantProps> = (props) => {
  const ps = props.profileState;

  const stats = () => [
    { label: "作品", value: ps.totalWorks() },
    { label: "关注", value: props.profile()?.total_follow_users ?? 0 },
    { label: "粉丝", value: props.profile()?.total_mypixiv_users ?? 0 },
    { label: "收藏", value: props.profile()?.total_illust_bookmarks_public ?? 0 },
  ];

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

      {/* Hero 卡：大头像 + 名字 + 统计行 */}
      <div class="px-4 mt-4">
        <section class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalXL)] flex flex-col items-center text-center">
          <Avatar
            src={ps.avatarUrl()}
            errored={ps.avatarErrored()}
            name={ps.displayUser()?.name ?? "P"}
            sizeClass="w-24 h-24"
          />
          <p class="mt-3 [font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)] truncate max-w-full leading-snug">
            {ps.displayUser()?.name || "Pictelio"}
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] truncate max-w-full leading-snug">
            @{ps.displayUser()?.account || ""}
          </p>

          {/* 统计行 */}
          <div class="flex w-full mt-4 border-t border-[var(--colorNeutralStroke2)] pt-3">
            {stats().map((s) => (
              <div class="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                <span class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug tabular-nums">
                  {s.value.toLocaleString()}
                </span>
                <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] leading-snug">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 功能菜单 — 单张卡合并全部入口 */}
      <div class="px-4 mt-4">
        <section class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
          <MenuRow
            icon="image"
            label={ps.isCurrentUser() ? "我的作品" : "TA 的作品"}
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
            onClick={props.actions.following}
            ariaLabel={ps.isCurrentUser() ? "我的关注" : "TA 的关注"}
          />
          <MenuRow
            icon="people"
            label={ps.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
            onClick={props.actions.followers}
            ariaLabel={ps.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
          />
          <Show when={ps.isCurrentUser()}>
            <MenuRow
              icon="settings"
              label="设置"
              onClick={props.actions.settings}
              ariaLabel="设置"
            />
          </Show>
        </section>
      </div>
    </div>
  );
};

export default VariantC;
