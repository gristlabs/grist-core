import { makeT } from 'app/client/lib/localization';
import { ViewSectionRec } from "app/client/models/DocModel";
import { KoSaveableObservable, setSaveValue } from "app/client/models/modelUtil";
import { cssGroupLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId } from "app/client/ui2018/cssVars";
import { Computed, Disposable, dom, IDisposableOwner } from "grainjs";

const t = makeT('GridOptions');

/**
 * Builds the grid options.
 */
export class GridOptions extends Disposable {
  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const section = this._section;
    return dom('div',
      { role: 'group', 'aria-labelledby': 'grid-options-label' },
      cssGroupLabel(t("Grid Options"), { id: 'grid-options-label' }),
      dom('div', [
        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop('verticalGridlines')),
            t("Vertical gridlines"),
          ),
          testId('v-grid-button'),
        ),

        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop('horizontalGridlines')),
            t("Horizontal gridlines"),
          ),
          testId('h-grid-button'),
        ),

        cssRow(
          labeledSquareCheckbox(
            setSaveValueFromKo(this, section.optionsObj.prop('zebraStripes')),
            t("Zebra stripes"),
          ),
          testId('zebra-stripe-button'),
        ),

        testId('grid-options'),
      ]),
    );
  }
}

// Returns a grainjs observable that reflects the value of obs a knockout saveable observable. The
// returned observable will set and save obs to the given value when written. If the obs.save() call
// fails, then it gets reset to its previous value.
function setSaveValueFromKo(owner: IDisposableOwner, obs: KoSaveableObservable<boolean | undefined>) {
  const ret = Computed.create(null, use => use(obs) ?? false);
  ret.onWrite(async (val) => {
    await setSaveValue(obs, val);
  });
  return ret;
}
