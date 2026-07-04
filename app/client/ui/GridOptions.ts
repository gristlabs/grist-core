import { makeT } from "app/client/lib/localization";
import { ViewSectionRec } from "app/client/models/DocModel";
import { KoSaveableObservable, setSaveValue } from "app/client/models/modelUtil";
import { rowNumbersModeOptions } from "app/client/ui/GridViewMenus";
import { cssGroupLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId } from "app/client/ui2018/cssVars";
import { select } from "app/client/ui2018/menus";

import { Computed, Disposable, dom, IDisposableOwner, styled } from "grainjs";

const t = makeT("GridOptions");

/**
 * Builds the grid options.
 */
export class GridOptions extends Disposable {
  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const section = this._section;
    return dom("div",
      { "role": "group", "aria-labelledby": "grid-options-label" },
      cssGroupLabel(t("Grid Options"), { id: "grid-options-label" }),
      dom("div", [
        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop("verticalGridlines")),
            t("Vertical gridlines"),
          ),
          testId("v-grid-button"),
        ),

        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop("horizontalGridlines")),
            t("Horizontal gridlines"),
          ),
          testId("h-grid-button"),
        ),

        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop("zebraStripes")),
            t("Zebra stripes"),
          ),
          testId("zebra-stripe-button"),
        ),

        cssRow(
          cssSelectLabel(t("Row numbers"), { id: "row-numbers-label" }),
          dom.update(
            select(setSaveValueFromKo(this, section.optionsObj.prop("rowNumbers")), rowNumbersModeOptions()),
            { "aria-labelledby": "row-numbers-label" },
          ),
          testId("row-numbers"),
        ),

        testId("grid-options"),
      ]),
    );
  }
}

// Returns a grainjs observable that reflects the value of obs a knockout saveable observable.
// The returned observable will set and save obs to the given value when written; the save is
// skipped if the value is unchanged, and if the obs.save() call fails, then obs gets reset to
// its previous value. The value is never actually undefined: all grid options get defaults
// merged in by ViewSectionRec's defaultOptions.
function setSaveValueFromKo<T>(owner: IDisposableOwner, obs: KoSaveableObservable<T | undefined>) {
  const ret = Computed.create(owner, use => use(obs)!);
  ret.onWrite(async (val) => {
    await setSaveValue(obs, val);
  });
  return ret;
}

const cssSelectLabel = styled("span", `
  flex: 1 0 auto;
  margin-right: 16px;
`);
