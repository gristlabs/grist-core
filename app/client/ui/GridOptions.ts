import { makeT } from "app/client/lib/localization";
import { obsPropWithSaveOnWrite } from "app/client/lib/obsPropWithSaveOnWrite";
import { ViewSectionRec } from "app/client/models/DocModel";
import { RowNumbersMode } from "app/client/models/entities/ViewSectionRec";
import { rowNumbersMenu } from "app/client/ui/GridViewMenus";
import { cssGroupLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu } from "app/client/ui2018/menus";

import { Computed, Disposable, dom, Observable, styled } from "grainjs";

const t = makeT("GridOptions");

/**
 * Builds the grid options.
 */
export class GridOptions extends Disposable {
  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const options = this._section.optionsObj;
    const rowNumbers = obsPropWithSaveOnWrite(this, options, "rowNumbers", "number" as RowNumbersMode);

    // What the gutter shows when visible. Remembered while hidden, so that re-checking "Show"
    // restores the last mode rather than always resetting to numbers.
    const shownMode = Observable.create<RowNumbersMode>(this,
      rowNumbers.get() === "hidden" ? "number" : rowNumbers.get());
    this.autoDispose(rowNumbers.addListener((mode) => {
      if (mode !== "hidden") { shownMode.set(mode); }
    }));

    const showRowNumbers = Computed.create(this, use => use(rowNumbers) !== "hidden")
      .onWrite(show => rowNumbers.set(show ? shownMode.get() : "hidden"));

    return dom("div",
      { "role": "group", "aria-labelledby": "grid-options-label" },
      cssGroupLabel(t("Grid Options"), { id: "grid-options-label" }),
      dom("div", [
        cssRow(
          labeledSquareCheckbox(
            obsPropWithSaveOnWrite(this, options, "verticalGridlines", true),
            t("Vertical gridlines"),
          ),
          testId("v-grid-button"),
        ),

        cssRow(
          labeledSquareCheckbox(
            obsPropWithSaveOnWrite(this, options, "horizontalGridlines", true),
            t("Horizontal gridlines"),
          ),
          testId("h-grid-button"),
        ),

        cssRow(
          labeledSquareCheckbox(
            obsPropWithSaveOnWrite(this, options, "zebraStripes", false),
            t("Zebra stripes"),
          ),
          testId("zebra-stripe-button"),
        ),

        cssRow(
          labeledSquareCheckbox(showRowNumbers, t("Show"), testId("row-numbers-show")),
          cssModeLink(
            dom.text(use => use(shownMode) === "rowId" ? t("row IDs") : t("row numbers")),
            icon("Dropdown"),
            menu(() => rowNumbersMenu(this._section, { includeHidden: false })),
            testId("row-numbers-mode"),
          ),
          testId("row-numbers"),
        ),

        testId("grid-options"),
      ]),
    );
  }
}

// Link-like trigger for the row-numbers mode menu, continuing the checkbox's label.
const cssModeLink = styled("div", `
  display: flex;
  align-items: center;
  margin-left: 4px;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  cursor: pointer;
`);
