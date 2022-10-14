import {t} from 'app/client/lib/localization';
import { ViewSectionRec } from "app/client/models/DocModel";
import { KoSaveableObservable, setSaveValue } from "app/client/models/modelUtil";
import { cssLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { squareCheckbox } from "app/client/ui2018/checkbox";
import { testId } from "app/client/ui2018/cssVars";
import { Computed, Disposable, dom, IDisposableOwner, styled } from "grainjs";

const translate = (x: string, args?: any): string => t(`GridOptions.${x}`, args);

/**
 * Builds the grid options.
 */
export class GridOptions extends Disposable {

  constructor(private _section: ViewSectionRec) {
    super();
  }

  public buildDom() {
    const section = this._section;
    return [
      cssLabel(translate('GridOptions')),
      dom('div', [
        cssRow(
          checkbox(setSaveValueFromKo(this, section.optionsObj.prop('verticalGridlines'))),
          translate('VerticalGridlines'),
          testId('v-grid-button')
        ),

        cssRow(
          checkbox(setSaveValueFromKo(this, section.optionsObj.prop('horizontalGridlines'))),
          translate('HorizontalGridlines'),
          testId('h-grid-button')
        ),

        cssRow(
          checkbox(setSaveValueFromKo(this, section.optionsObj.prop('zebraStripes'))),
          translate('ZebraStripes'),
          testId('zebra-stripe-button')
        ),

        testId('grid-options')
      ]),
    ];
  }

}

// Returns a grainjs observable that reflects the value of obs a knockout saveable observable. The
// returned observable will set and save obs to the given value when written. If the obs.save() call
// fails, then it gets reset to its previous value.
function setSaveValueFromKo<T>(owner: IDisposableOwner, obs: KoSaveableObservable<T>) {
  const ret = Computed.create(null, (use) => use(obs));
  ret.onWrite(async (val) => {
    await setSaveValue(obs, val);
  });
  return ret;
}

const checkbox = styled(squareCheckbox, `
  margin-right: 8px;
`);
