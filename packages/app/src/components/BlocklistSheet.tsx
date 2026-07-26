import type { Component } from "solid-js";
import { blockedIds, unblockUser } from "../stores/blockStore";

function ids() {
  return [...blockedIds()];
}

interface BlocklistSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const BlocklistSheet: Component<BlocklistSheetProps> = (props) => {
  function close() {
    props.onClose();
  }

  return (
    <div class="fixed inset-0 z-50">
      {/* Scrim */}
      <div class="absolute inset-0" style="background-color:var(--colorScrim)" onClick={close} />
      {/* Sheet — slides up from bottom */}
      <div
        class="absolute bottom-0 left-0 right-0 surface-appbar rounded-t-[var(--borderRadius4XLarge)] shadow-[var(--elevation28)]"
        style="max-height:70vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
      >
        {/* Drag handle */}
        <div class="flex justify-center pt-2 pb-1">
          <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
        </div>

        {/* Header */}
        <div class="flex items-center justify-between px-5 pt-1 pb-2">
          <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
            屏蔽列表
          </h2>
          <fluent-button
            appearance="subtle"
            aria-label="关闭"
            on:click={close}
            class="w-8 h-8 p-0 min-w-8"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
        </div>

        {/* Divider */}
        <fluent-divider style="margin-inline:var(--spacingHorizontalXL)"></fluent-divider>

        {/* Blocked user list */}
        <div class="px-5 py-3 min-h-[160px]">
          <Show
            when={ids().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-10 gap-3">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  class="text-[var(--colorNeutralForeground3)]"
                >
                  <path
                    d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm4.25 6.25a.75.75 0 0 1 0 1.06l-8.5 8.5a.75.75 0 1 1-1.06-1.06l8.5-8.5a.75.75 0 0 1 1.06 0z"
                    fill="currentColor"
                  />
                </svg>
                <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground3)]">
                  暂无屏蔽用户
                </p>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              {ids().map((userId) => (
                <div class="flex items-center justify-between px-3 py-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
                  <div class="min-w-0">
                    <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate">
                      用户 ID: {userId}
                    </p>
                  </div>
                  <fluent-button
                    appearance="secondary"
                    on:click={() => unblockUser(userId)}
                    aria-label={`取消屏蔽用户 ${userId}`}
                  >
                    取消屏蔽
                  </fluent-button>
                </div>
              ))}
            </div>
          </Show>
        </div>

        {/* Footer hint */}
        <div class="px-5 pb-6 pt-2">
          <p class="text-center [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            屏蔽用户后，其作品将不再出现在推荐和关注列表中
          </p>
        </div>
      </div>
    </div>
  );
};

export default BlocklistSheet;
