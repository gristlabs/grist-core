import { fromKoSave } from "app/client/lib/fromKoSave";
import { makeT } from "app/client/lib/localization";
import { ViewFieldRec } from "app/client/models/DocModel";
import { fieldWithDefault, SaveableObjObservable } from "app/client/models/modelUtil";
import { FormFieldOptions, FormOptionsAlignment, FormOptionsSortOrder, FormSelectFormat } from "app/client/ui/FormAPI";
import {
  cssLabel,
  cssNumericSpinner,
  cssRow,
  cssSeparator,
} from "app/client/ui/RightPanelStyles";
import { withInfoTooltip } from "app/client/ui/tooltips";
import { buttonSelect } from "app/client/ui2018/buttonSelect";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { theme } from "app/client/ui2018/cssVars";
import { select } from "app/client/ui2018/menus";

import { Computed, Disposable, dom, fromKo, IDisposableOwner, makeTestId, styled } from "grainjs";

const t = makeT("FormConfig");

const testId = makeTestId("test-form-");

export class FormSelectConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const format = fieldWithDefault<FormSelectFormat>(
      this._field.widgetOptionsJson.prop("formSelectFormat"),
      "select",
    );

    return [
      cssLabel(t("Field Format")),
      cssRow(
        buttonSelect(
          fromKoSave(format),
          [
            { value: "select", label: t("Select") },
            { value: "radio", label: t("Radio") },
          ],
          testId("field-format"),
        ),
      ),
      dom.maybe(use => use(format) === "radio", () => dom.create(FormOptionsAlignmentConfig, this._field)),
    ];
  }
}

export class FormOptionsAlignmentConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const alignment = fieldWithDefault<FormOptionsAlignment>(
      this._field.widgetOptionsJson.prop("formOptionsAlignment"),
      "vertical",
    );

    return [
      cssLabel(t("Options Alignment")),
      cssRow(
        select(
          fromKoSave(alignment),
          [
            { value: "vertical", label: t("Vertical") },
            { value: "horizontal", label: t("Horizontal") },
          ],
          { defaultLabel: t("Vertical") },
        ),
      ),
    ];
  }
}

export class FormOptionsSortConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const optionsSortOrder = fieldWithDefault<FormOptionsSortOrder>(
      this._field.widgetOptionsJson.prop("formOptionsSortOrder"),
      "default",
    );

    return [
      cssLabel(t("Options Sort Order")),
      cssRow(
        select(
          fromKoSave(optionsSortOrder),
          [
            { value: "default", label: t("Default") },
            { value: "ascending", label: t("Ascending") },
            { value: "descending", label: t("Descending") },
          ],
          { defaultLabel: t("Default") },
        ),
      ),
    ];
  }
}

export class FormOptionsLimitConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const optionsLimitProp = this._field.widgetOptionsJson.prop("formOptionsLimit");
    const optionsLimit = fieldWithDefault<number | "">(
      optionsLimitProp,
      "",
    );

    return [
      cssLabel(t("Options limit")),
      cssRow(
        cssNumericSpinner(
          fromKo(optionsLimit),
          {
            defaultValue: 30,
            minValue: 1,
            maxValue: 1000,
            save: async val => optionsLimitProp.setAndSave(val ? Math.floor(val) : undefined),
            inputArgs: [testId("field-options-limit")],
          },
        ),
      ),
    ];
  }
}

/**
 * obsPropWithSaveOnWrite(owner, observable, prop, fallback) creates an observable for
 * observable()[prop], similar to fieldWithDefault(jsonObservable.prop(prop), fallback).
 *
 * It also sets and saves the observable on write, to satisfy the expectations of the checkbox
 * element. It uses `setAndSaveOrRevert` for saving.
 *
 * TODO Move this helper to a common place, e.g. modelUtil once it's converted to typescript.
 */
function obsPropWithSaveOnWrite<Props extends object, Key extends keyof Props, Val extends Props[Key]>(
  owner: IDisposableOwner,
  obs: SaveableObjObservable<Props>,
  prop: Key,
  fallback: Val,
): Computed<NonNullable<Props[Key]> | Val> {
  return Computed.create(owner, use => use(obs)[prop] ?? fallback)
    .onWrite((value) => {
      obs.setAndSaveOrRevert({ ...obs.peek(), [prop]: value }).catch(reportError);
    });
}

export class FormFieldRulesConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const widgetOptionsObs: SaveableObjObservable<FormFieldOptions> = this._field.widgetOptionsJson;
    const isRequiredObs = obsPropWithSaveOnWrite(this, widgetOptionsObs, "formRequired", false);
    const isHiddenObs = obsPropWithSaveOnWrite(this, widgetOptionsObs, "formIsHidden", false);
    const acceptFromUrl = obsPropWithSaveOnWrite(this, widgetOptionsObs, "formAcceptFromUrl", false);

    return [
      cssSeparator(),
      cssLabel(t("Field Rules")),
      cssRow(labeledSquareCheckbox(
        isRequiredObs,
        t("Required field"),
        testId("field-required"),
      )),
      cssRow(labeledSquareCheckbox(
        isHiddenObs,
        t("Hidden field"),
        testId("field-hidden"),
      )),
      cssRow(withInfoTooltip(
        labeledSquareCheckbox(
          acceptFromUrl,
          t("Accept value from URL"),
          testId("field-accept-from-url"),
        ),
        "formUrlValues",
      )),
      dom.maybe(acceptFromUrl, () => [
        // We set tabIndex to let the user select the text to copy-paste the column ID (parameter name).
        cssHintRow({ tabIndex: "-1" },
          t("URL parameter:\n{{colId}}=VALUE", { colId: dom("b", dom.text(this._field.colId)) }),
          testId("field-url-hint"),
        ),
      ]),
    ];
  }
}

const cssHintRow = styled("div", `
  margin-left: 40px;
  margin-right: 16px;
  color: ${theme.lightText};
`);
