import { makeT } from "app/client/lib/localization";
import { obsPropWithSaveOnWrite } from "app/client/lib/obsPropWithSaveOnWrite";
import { ViewSectionRec } from "app/client/models/DocModel";
import { rowNumbersModeOptions } from "app/client/ui/GridViewMenus";
import { cssGroupLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId } from "app/client/ui2018/cssVars";
import { select } from "app/client/ui2018/menus";

import { Disposable, dom, styled } from "grainjs";

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
          cssSelectLabel(t("Row numbers"), { id: "row-numbers-label" }),
          dom.update(
            select(obsPropWithSaveOnWrite(this, options, "rowNumbers", "number"), rowNumbersModeOptions()),
            { "aria-labelledby": "row-numbers-label" },
          ),
          testId("row-numbers"),
        ),

        testId("grid-options"),
      ]),
    );
  }
}

const cssSelectLabel = styled("span", `
  flex: 1 0 auto;
  margin-right: 16px;
`);
