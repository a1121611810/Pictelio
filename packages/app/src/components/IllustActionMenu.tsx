import type { Component } from "solid-js";

// ── 作品操作菜单：举报、屏蔽作者 ──

interface IllustActionMenuProps {
  isOpen: boolean;
  onReport: () => void;
  onBlock: () => void;
  onClose: () => void;
}

const IllustActionMenu: Component<IllustActionMenuProps> = (props) => {
  return (
    <Show when={props.isOpen}>
      <div
        class="absolute right-3 top-12 z-20 min-w-[140px] py-1 surface-flyout flex flex-col"
        style={{ "box-shadow": "var(--elevation8)" }}
      >
        <button
          class="flex items-center gap-3 px-4 py-2.5 text-left [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground1Hover)] active:bg-[var(--colorNeutralBackground1Pressed)] transition-colors appearance-none border-none outline-none cursor-pointer focus-visible:bg-[var(--colorNeutralBackground1Selected)]"
          onClick={props.onReport}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 6a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 12 6zm0 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
              fill="currentColor"
            />
          </svg>
          举报
        </button>
        <button
          class="flex items-center gap-3 px-4 py-2.5 text-left [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground1Hover)] active:bg-[var(--colorNeutralBackground1Pressed)] transition-colors appearance-none border-none outline-none cursor-pointer focus-visible:bg-[var(--colorNeutralBackground1Selected)]"
          onClick={props.onBlock}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm4.25 6.25a.75.75 0 0 1 0 1.06l-8.5 8.5a.75.75 0 1 1-1.06-1.06l8.5-8.5a.75.75 0 0 1 1.06 0z"
              fill="currentColor"
            />
          </svg>
          屏蔽作者
        </button>
      </div>
    </Show>
  );
};

export default IllustActionMenu;
