import type { Component } from "solid-js";
import BlocklistSheet from "../BlocklistSheet";
import FluentDialog from "../ui/FluentDialog";
import { t } from "../../i18n";

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
        aria-label={t("settings.dialogs.clearAria")}
      >
        <h3 slot="title">{t("settings.dialogs.clearTitle")}</h3>
        <p>{t("settings.dialogs.clearBody")}</p>
        <fluent-button
          slot="actions"
          appearance="secondary"
          ref={fluentOn("click", () => props.onCloseDialog())}
        >
          {t("settings.dialogs.cancel")}
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          ref={fluentOn("click", () => props.onConfirmClear())}
        >
          {t("settings.dialogs.clearConfirm")}
        </fluent-button>
      </FluentDialog>

      {/* Delete account dialog */}
      <FluentDialog
        open={props.dialogType === "deleteAccount"}
        onClose={() => props.onCloseDialog()}
        aria-label={t("settings.dialogs.deleteAria")}
      >
        <h3 slot="title">{t("settings.dialogs.deleteTitle")}</h3>
        <p>{t("settings.dialogs.deleteBody")}</p>
        <fluent-button
          slot="actions"
          appearance="secondary"
          ref={fluentOn("click", () => props.onCloseDialog())}
        >
          {t("settings.dialogs.cancel")}
        </fluent-button>
        <fluent-button
          slot="actions"
          appearance="primary"
          ref={fluentOn("click", () => {
            props.onConfirmDelete();
          })}
        >
          {t("settings.dialogs.deleteConfirm")}
        </fluent-button>
      </FluentDialog>
    </>
  );
};

export default SettingsDialogs;
