import { makeT } from "app/client/lib/localization";
import { DataRowModel } from "app/client/models/DataRowModel";
import { ViewFieldRec } from "app/client/models/entities/ViewFieldRec";
import { reportError } from "app/client/models/errors";
import { GristDoc } from "app/client/components/GristDoc";
import { cssRow } from "app/client/ui/RightPanelStyles";
import { basicButton } from "app/client/ui2018/buttons";
import { cssButtonSelect, makeButtonSelect } from "app/client/ui2018/buttonSelect";
import { testId, theme } from "app/client/ui2018/cssVars";
import { parseButtonDefinitions } from "app/client/widgets/ButtonParser";
import { NewAbstractWidget, Options } from "app/client/widgets/NewAbstractWidget";
import { UserAction } from "app/common/DocActions";

import { Computed, dom, DomContents, fromKo, styled } from "grainjs";

const t = makeT("ButtonWidget");

const cssButtonCell = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  padding: 0 4px;
  box-sizing: border-box;

  &-wrap {
    flex-wrap: wrap;
  }

  &-wrap > button {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
`);

const cssConfigError = styled("span", `
  color: ${theme.errorText};
  font-size: 12px;
`);

export class ButtonWidget extends NewAbstractWidget {
  constructor(field: ViewFieldRec, options: Options = {}) {
    super(field, options);
    this.autoDispose(fromKo(this.field.wrap).addListener(() => {
      this.field.viewSection().events.trigger("rowHeightChange");
    }));
  }

  public buildConfigDom(_gristDoc: GristDoc): DomContents {
    const toggle = () => {
      this.field.config.wrap.setAndSave(!this.field.config.wrap.peek()).catch(reportError);
    };
    const wrapDisabled = Computed.create(this, use => use(this.field.config.options.disabled("wrap")));
    return cssRow(
      dom("div", { style: "margin-left: 8px;" },
        makeButtonSelect(
          fromKo(this.field.config.wrap),
          [{ value: true, icon: "Wrap" }],
          toggle,
          cssButtonSelect.cls("-disabled", wrapDisabled),
        ),
        testId("button-wrap-text"),
      ),
    );
  }

  public buildDom(row: DataRowModel): Element {
    return cssButtonCell(
      cssButtonCell.cls("-wrap", this.field.wrap),
      dom.domComputed(use => {
        if (use(row._isAddRow) || this.isDisposed()) { return null; }
        const value = row.cells[use(this.field.colId)];
        return value ? use(value) : null;
      }, value => {
        if (value == null) { return null; }

        const definitions = parseButtonDefinitions(value);
        if (!definitions) {
          return cssConfigError(t("Invalid Button formula result"),
            dom.attr("title", t("Expected a list of {button, actions} dictionaries")));
        }

        return definitions.map(({ label, actions }, index) =>
          basicButton(label,
            testId(`button-column-button-${index}`),
            dom.attr("type", "button"),
            dom.attr("aria-label", label),
            dom.on("mousedown", (event: MouseEvent) => event.stopPropagation()),
            dom.on("keydown", (event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); }
            }),
            dom.on("click", (event: MouseEvent) => {
              event.stopPropagation();
              const button = event.currentTarget as HTMLButtonElement;
              void this._runActions(actions, button);
            }),
          ),
        );
      }),
    );
  }

  private async _runActions(actions: UserAction[], button: HTMLButtonElement) {
    button.disabled = true;
    try {
      await this._getDocComm().applyUserActions(actions);
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
    }
  }
}
