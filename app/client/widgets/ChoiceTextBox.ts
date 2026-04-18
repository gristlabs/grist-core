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
import { Style } from "app/client/models/Styles";
import { cssLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { ChoiceListEntry } from "app/client/widgets/ChoiceListEntry";
import { choiceToken, IChoiceTokenOptions } from "app/client/widgets/ChoiceToken";
import { NTextBox } from "app/client/widgets/NTextBox";
import { WidgetOptions } from "app/common/WidgetOptions";

import { Computed, dom, DomElementArg, styled } from "grainjs";

export type IChoiceOptions = Style;
export type ChoiceOptions = Record<string, IChoiceOptions | undefined>;
export type ChoiceOptionsByName = Map<string, IChoiceOptions | undefined>;
export type ChoiceOptionsMap = Map<string, IChoiceOptions>;

const t = makeT("ChoiceTextBox");

export class ChoiceRenderer {
  private _choiceMap: ChoiceOptionsMap;

  constructor(options: WidgetOptions) {
    const { choices, choiceOptions } = options;
    this._choiceMap = new Map((choices || []).map(c => [c, choiceOptions?.[c] || {}]));
  }

  public renderChoiceToken(token: string, ...args: DomElementArg[]) {
    const blank = (token.trim() === "");
    return choiceToken(
      blank ? "[Blank]" : token,
      this.getChoiceTokenOptions(token, blank),
      ...args,
    );
  }

  public getChoiceTokenOptions(token: string, blank?: boolean): IChoiceTokenOptions {
    return {
      ...this._choiceMap.get(token),
      invalid: !this._choiceMap.has(token),
      blank,
    };
  }
}

/**
 * ChoiceTextBox - A textbox for choice values.
 */
export class ChoiceTextBox extends NTextBox {
  protected _choiceRenderer: Computed<ChoiceRenderer>;

  private _choiceValues: Computed<string[]>;
  private _choiceOptionsByName: Computed<ChoiceOptionsByName>;

  constructor(field: ViewFieldRec) {
    super(field);
    this._choiceRenderer = Computed.create(this, use => new ChoiceRenderer(use(this.options)));
    this._choiceValues = Computed.create(this, use => use(this.options.prop("choices")) || []);
    this._choiceOptionsByName = Computed.create(this, use => toMap(use(this.options.prop("choiceOptions"))));
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

          return use(this._choiceRenderer).renderChoiceToken(
            formattedValue,
            dom.cls(cssChoiceText.className),
            testId("choice-token"),
          );
        }),
      ),
    );
  }

  public buildConfigDom(gristDoc: GristDoc) {
    return [
      super.buildConfigDom(gristDoc),
      this.buildChoicesConfigDom(),
      dom.create(DropdownConditionConfig, this.field, gristDoc),
    ];
  }

  public buildTransformConfigDom() {
    return [
      this.buildChoicesConfigDom(),
    ];
  }

  public buildFormConfigDom() {
    return [
      this.buildChoicesConfigDom(),
      dom.create(FormSelectConfig, this.field),
      dom.create(FormOptionsSortConfig, this.field),
      dom.create(FormFieldRulesConfig, this.field),
    ];
  }

  public buildFormTransformConfigDom() {
    return [
      this.buildChoicesConfigDom(),
    ];
  }

  protected save(choices: string[], choiceOptions: ChoiceOptionsByName, renames: Record<string, string>) {
    const options = {
      choices,
      choiceOptions: toObject(choiceOptions),
    };
    return this.field.config.updateChoices(renames, options);
  }

  protected buildChoicesConfigDom() {
    const disabled = Computed.create(null,
      use => use(this.field.disableModify) ||
        use(use(this.field.column).disableEditData) ||
        use(this.field.config.options.disabled("choices")),
    );

    const mixed = Computed.create(null,
      use => !use(disabled) &&
        (use(this.field.config.options.mixed("choices")) || use(this.field.config.options.mixed("choiceOptions"))),
    );

    return [
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
    ];
  }
}

// Converts a POJO containing choice options to an ES6 Map
function toMap(choiceOptions?: ChoiceOptions | null): ChoiceOptionsByName {
  if (!choiceOptions) { return new Map(); }

  return new Map(Object.entries(choiceOptions));
}

// Converts an ES6 Map containing choice options to a POJO
function toObject(choiceOptions: ChoiceOptionsByName): ChoiceOptions {
  const object: ChoiceOptions = {};
  for (const [choice, options] of choiceOptions.entries()) {
    object[choice] = options;
  }
  return object;
}

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
