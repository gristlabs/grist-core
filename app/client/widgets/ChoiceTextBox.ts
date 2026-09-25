import { DropdownConditionConfig } from "app/client/components/DropdownConditionConfig";
import {
  FormFieldRulesConfig,
  FormOptionsSortConfig,
  FormSelectConfig,
} from "app/client/components/Forms/FormConfig";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { DataRowModel } from "app/client/models/DataRowModel";
import { ViewFieldRec } from "app/client/models/entities/ViewFieldRec";
import { KoSaveableObservable } from "app/client/models/modelUtil";
import { cssLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { basicButton, primaryButton, textButton } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { textInput } from "app/client/ui/inputs";
import { select } from "app/client/ui2018/menus";
import { cssModalButtons, cssModalTitle, modal } from "app/client/ui2018/modals";
import { ChoiceListEntry } from "app/client/widgets/ChoiceListEntry";
import { choiceToken } from "app/client/widgets/ChoiceToken";
import { NTextBox } from "app/client/widgets/NTextBox";
import { Style } from "app/common/Styles";

import { Computed, dom, DomContents, Observable, styled } from "grainjs";

export type IChoiceOptions = Style;
export type ChoiceOptions = Record<string, IChoiceOptions | undefined>;
export type ChoiceOptionsByName = Map<string, IChoiceOptions | undefined>;

const t = makeT("ChoiceTextBox");

/**
 * ChoiceTextBox - A textbox for choice values with support for shared lists.
 */
export class ChoiceTextBox extends NTextBox {
  private _choices: KoSaveableObservable<string[]>;
  private _choiceValues: Computed<string[]>;
  private _choiceValuesSet: Computed<Set<string>>;
  private _choiceOptions: KoSaveableObservable<ChoiceOptions | null | undefined>;
  private _choiceOptionsByName: Computed<ChoiceOptionsByName>;
  private _sharedChoiceListId: KoSaveableObservable<string | undefined>;

  constructor(field: ViewFieldRec) {
    super(field);
    this._choices = this.options.prop("choices");
    this._choiceOptions = this.options.prop("choiceOptions");
    this._sharedChoiceListId = this.options.prop("sharedChoiceListId");

    this._choiceValues = Computed.create(this, (use) => {
      const sharedId = use(this._sharedChoiceListId);
      if (sharedId) {
        const docSettings = use(this.field.documentSettings);
        const sharedLists = docSettings?.sharedChoiceLists || {};
        if (sharedLists[sharedId]) {
          return sharedLists[sharedId].choices || [];
        }
      }
      return use(this._choices) || [];
    });

    this._choiceValuesSet = Computed.create(this, this._choiceValues, (_use, values) => new Set(values));

    this._choiceOptionsByName = Computed.create(this, (use) => {
      const sharedId = use(this._sharedChoiceListId);
      if (sharedId) {
        const docSettings = use(this.field.documentSettings);
        const sharedLists = docSettings?.sharedChoiceLists || {};
        if (sharedLists[sharedId]?.choiceColors) {
          return toMap(sharedLists[sharedId].choiceColors as unknown as ChoiceOptions);
        }
      }
      return toMap(use(this._choiceOptions));
    });
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    const isSingle = this.field.viewSection().parentKey() === "single";
    const maybeDropDownCssChoiceEditIcon = isSingle ? cssChoiceEditIcon("Dropdown") : null;

    return cssChoiceField(
      cssChoiceTextWrapper(
        dom.style("justify-content", use => use(this.alignment) === "right" ? "flex-end" : use(this.alignment)),
        maybeDropDownCssChoiceEditIcon,
        dom.domComputed((use) => {
          if (this.isDisposed() || use(row._isAddRow)) { return null; }

          const formattedValue = use(this.valueFormatter).formatAny(use(value));
          if (formattedValue === "") { return null; }

          return choiceToken(
            formattedValue,
            {
              ...(use(this._choiceOptionsByName).get(formattedValue) || {}),
              invalid: !use(this._choiceValuesSet).has(formattedValue),
            },
            dom.cls(cssChoiceText.className),
            testId("choice-token"),
          );
        }),
      ),
    );
  }

  public buildConfigDom(gristDoc: GristDoc): DomContents {
    return dom("div",
      super.buildConfigDom(gristDoc),
      this.buildChoicesConfigDom(),
      dom.create(DropdownConditionConfig, this.field, gristDoc),
    );
  }

  public buildTransformConfigDom(): DomContents {
    return dom("div", this.buildChoicesConfigDom());
  }

  public buildFormConfigDom(): DomContents {
    return dom("div",
      this.buildChoicesConfigDom(),
      dom.create(FormSelectConfig, this.field),
      dom.create(FormOptionsSortConfig, this.field),
      dom.create(FormFieldRulesConfig, this.field),
    );
  }

  public buildFormTransformConfigDom(): DomContents {
    return dom("div", this.buildChoicesConfigDom());
  }

  protected getChoiceValuesSet(): Computed<Set<string>> {
    return this._choiceValuesSet;
  }

  protected getChoiceOptions(): Computed<ChoiceOptionsByName> {
    return this._choiceOptionsByName;
  }

  protected async save(choices: string[], choiceOptions: ChoiceOptionsByName, renames: Record<string, string>) {
    const sharedId = this._sharedChoiceListId.peek();
    const optionsObj = toObject(choiceOptions);

    if (sharedId) {
      const docModel = this._getDocModel();
      const docSettings = this.field.documentSettings.peek() || {};
      const currentShared = docSettings.sharedChoiceLists || {};
      const target = currentShared[sharedId];

      if (target) {
        const updatedTarget = {
          ...target,
          choices,
          choiceColors: optionsObj as any,
        };

        await docModel.docInfoRow.documentSettingsJson.setAndSave({
          ...docSettings,
          sharedChoiceLists: {
            ...currentShared,
            [sharedId]: updatedTarget,
          },
        });
      }

      return this.field.config.updateChoices(renames, {});
    }

    const options = {
      choices,
      choiceOptions: optionsObj,
    };
    return this.field.config.updateChoices(renames, options);
  }

  protected buildChoicesConfigDom(): DomContents {
    const disabled = Computed.create(null,
      use => use(this.field.disableModify) ||
        use(use(this.field.column).disableEditData) ||
        use(this.field.config.options.disabled("choices")),
    );

    const mixed = Computed.create(null,
      use => !use(disabled) &&
        (use(this.field.config.options.mixed("choices")) || use(this.field.config.options.mixed("choiceOptions"))),
    );

    const listSelectOptions = Computed.create(this, (use) => {
      const docSettings = use(this.field.documentSettings);
      const sharedLists = docSettings?.sharedChoiceLists || {};
      return [
        { label: t("Custom (Column-specific)"), value: "" },
        ...Object.entries(sharedLists).map(([id, def]) => ({
          label: (def as any).name || id,
          value: id,
        })),
      ];
    });

    const selectedList = Computed.create(this, (use) => {
      const id = use(this._sharedChoiceListId);
      if (!id) { return ""; }
      const docSettings = use(this.field.documentSettings);
      const sharedLists = docSettings?.sharedChoiceLists || {};
      return sharedLists[id] ? id : "";
    });

    selectedList.onWrite((val: string) => {
      void this._sharedChoiceListId.setAndSave(val || undefined);
    });

    return dom("div",
      cssLabel(t("SOURCE LIST")),
      cssRow(
        dom.autoDispose(listSelectOptions),
        dom.autoDispose(selectedList),
        cssFullWidthSelect(
          select(
            selectedList,
            listSelectOptions,
            {
              defaultLabel: t("Custom (Column-specific)"),
            },
          ),
        ),
        testId("choice-list-source-select"),
      ),
      cssRow(
        textButton(
          t("Create new shared list..."),
          dom.on("click", () => this._createSharedChoiceList()),
          testId("choice-list-create-new"),
        ),
        dom.domComputed(
          (use) => {
            const id = use(this._sharedChoiceListId);
            if (!id) { return null; }
            const docSettings = use(this.field.documentSettings);
            const sharedLists = docSettings?.sharedChoiceLists || {};
            return sharedLists[id] ? id : null;
          },
          (validId) => {
            if (!validId) { return null; }
            return textButton(
              t("Delete shared list"),
              dom.on("click", () => this._deleteSharedChoiceList()),
              dom.style("color", "var(--grist-color-error, #e53935)"),
              dom.style("margin-left", "8px"),
              testId("choice-list-delete-shared"),
            );
          },
        ),
        dom.style("margin-top", "4px"),
        dom.style("margin-bottom", "6px"),
      ),

      cssLabel(t("CHOICES")),
      cssRow(
        dom.autoDispose(disabled),
        dom.autoDispose(mixed),
        dom.create(
          ChoiceListEntry,
          this._choiceValues,
          this._choiceOptionsByName,
          this.save.bind(this),
          disabled,
          mixed,
        ),
      ),
    );
  }

  private _getDocModel() {
    return (this.field as any)._table?.docModel || (this.field.column.peek().table() as any).docModel;
  }

  private _createSharedChoiceList() {
    modal((ctl, owner) => {
      const nameObs = Observable.create(owner, "");
      const canSave = Computed.create(owner, use => Boolean(use(nameObs).trim()));

      const onSave = async () => {
        const name = nameObs.get().trim();
        if (!name) { return; }
        ctl.close();

        const docModel = this._getDocModel();
        const docSettings = this.field.documentSettings.peek() || {};
        const currentShared = docSettings.sharedChoiceLists || {};

        const sharedId = "shared_" + Date.now();
        const choices = this._choices.peek() || [];
        const choiceColors = (this._choiceOptions.peek() || {}) as any;

        const newSharedList = {
          id: sharedId,
          name,
          choices,
          choiceColors,
        };

        await docModel.docInfoRow.documentSettingsJson.setAndSave({
          ...docSettings,
          sharedChoiceLists: {
            ...currentShared,
            [sharedId]: newSharedList,
          },
        });

        await this._sharedChoiceListId.setAndSave(sharedId);
      };

      return [
        cssModalTitle(t("Create shared choice list")),
        cssModalInputWrapper(
          textInput(
            nameObs,
            (elem) => { setTimeout(() => elem.focus(), 0); },
            dom.on("keydown", (e) => {
              if (e.key === "Enter" && canSave.get()) {
                e.preventDefault();
                void onSave();
              }
            }),
            testId("shared-choice-list-name-input"),
          ),
        ),
        cssModalButtons(
          primaryButton(
            t("Create"),
            dom.prop("disabled", use => !use(canSave)),
            dom.on("click", () => void onSave()),
            testId("shared-choice-list-create-confirm-btn"),
          ),
          basicButton(
            t("Cancel"),
            dom.on("click", () => ctl.close()),
            testId("shared-choice-list-cancel-btn"),
          ),
        ),
      ];
    });
  }

  private _deleteSharedChoiceList() {
    const sharedId = this._sharedChoiceListId.peek();
    if (!sharedId) { return; }

    const docSettings = this.field.documentSettings.peek() || {};
    const sharedLists = docSettings.sharedChoiceLists || {};
    const target = sharedLists[sharedId];
    const name = target?.name || sharedId;

    modal((ctl) => {
      const onDelete = async () => {
        ctl.close();
        const docModel = this._getDocModel();
        const updatedShared = { ...sharedLists };
        delete updatedShared[sharedId];

        await this._sharedChoiceListId.setAndSave(undefined);

        await docModel.docInfoRow.documentSettingsJson.setAndSave({
          ...docSettings,
          sharedChoiceLists: updatedShared,
        });
      };

      return [
        cssModalTitle(t("Delete shared choice list")),
        cssModalMessage(
          t(`Are you sure you want to delete the shared list "${name}"? Columns using it will revert to custom choices.`),
        ),
        cssModalButtons(
          primaryButton(
            t("Delete"),
            dom.style("background-color", "var(--grist-color-error, #e53935)"),
            dom.on("click", () => void onDelete()),
            testId("shared-choice-list-delete-confirm-btn"),
          ),
          basicButton(
            t("Cancel"),
            dom.on("click", () => ctl.close()),
            testId("shared-choice-list-delete-cancel-btn"),
          ),
        ),
      ];
    });
  }
}

function toMap(choiceOptions?: ChoiceOptions | null): ChoiceOptionsByName {
  if (!choiceOptions) { return new Map(); }

  return new Map(Object.entries(choiceOptions));
}

function toObject(choiceOptions: ChoiceOptionsByName): ChoiceOptions {
  const object: ChoiceOptions = {};
  for (const [choice, options] of choiceOptions.entries()) {
    object[choice] = options;
  }
  return object;
}

const cssFullWidthSelect = styled("div", `
  width: 100%;
  & > * {
    width: 100%;
  }
`);

const cssChoiceField = styled("div.field_clip", `
  padding: 0 3px;
`);

const cssChoiceTextWrapper = styled("div", `
  display: flex;
  width: 100%;
  min-width: 0px;
  overflow: hidden;
`);

const cssChoiceText = styled("div", `
  margin: 2px;
  height: min-content;
  line-height: 16px;
`);

const cssChoiceEditIcon = styled(icon, `
  background-color: ${theme.lightText};
  display: block;
  height: inherit;
`);

const cssModalInputWrapper = styled("div", `
  margin: 16px 0 24px 0;
  width: 100%;
  isolation: isolate;

  & input {
    width: 100%;
    box-sizing: border-box;
  }
`);

const cssModalMessage = styled("div", `
  margin: 16px 0 24px 0;
  font-size: 13px;
  line-height: 18px;
  color: ${theme.text};
`);