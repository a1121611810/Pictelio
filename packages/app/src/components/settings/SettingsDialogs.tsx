import type { Component } from "solid-js";
import BlocklistSheet from "../BlocklistSheet";
import FluentDialog from "../ui/FluentDialog";

interface SettingsDialogsProps {
  showBlocklist: boolean;
  onCloseBlocklist: () => void;
  dialogType: "clear" | "deleteAccount" | null;
  onCloseDialog: () => void;
  onConfirmClear: () => void;
  onConfirmDelete: () => void;
}

const SettingsDialogs: Component<SettingsDialogsProps> = (props) => {
  return (
    <>
      {/* BlocklistSheet */}
      <Show when={props.showBlocklist}>
        <BlocklistSheet
          isOpen={props.showBlocklist}
          onClose={() => {
            props.onCloseBlocklist();
          }}
        />
      </Show>

      {/* Clear data dialog */}
      <FluentDialog
        open={props.dialogType === "clear"}
        onClose={() => props.onCloseDialog()}
        aria-label="清除所有本地数据？"
      >
        <h3 slot="title">清除所有本地数据？</h3>
        <p>
          这将删除本应用在本机保存的全部数据，包括：登录凭证、图片缓存、浏览设置、屏蔽列表、举报记录。此操作不可恢复，但不会删除你的
          Pixiv 账号及其在 Pixiv 服务器上的数据。
        </p>
        <fluent-button slot="actions" appearance="secondary" on:click={() => props.onCloseDialog()}>
          取消
        </fluent-button>
        <fluent-button slot="actions" appearance="primary" on:click={() => props.onConfirmClear()}>
          确认清除
        </fluent-button>
      </FluentDialog>

      {/* Delete account dialog */}
      <FluentDialog
        open={props.dialogType === "deleteAccount"}
        onClose={() => props.onCloseDialog()}
        aria-label="删除 Pixiv 账号？"
      >
        <h3 slot="title">删除 Pixiv 账号？</h3>
        <p>
          Pictelio 是第三方客户端，无法直接删除你的 Pixiv 账号。点击确认将打开 Pixiv
          官方账号删除页面，请按官方流程操作。
        </p>
        <fluent-button slot="actions" appearance="secondary" on:click={() => props.onCloseDialog()}>
          取消
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          on:click={() => {
            props.onConfirmDelete();
          }}
        >
          前往 Pixiv
        </fluent-button>
      </FluentDialog>
    </>
  );
};

export default SettingsDialogs;
