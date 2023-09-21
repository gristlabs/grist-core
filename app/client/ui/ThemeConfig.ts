import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import * as css from 'app/client/ui/AccountPageCss';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {prefersDarkModeObs} from 'app/client/ui2018/cssVars';
import {select} from 'app/client/ui2018/menus';
import {ThemeAppearance} from 'app/common/ThemePrefs';
import {Computed, Disposable, dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-theme-config-');
const t = makeT('ThemeConfig');

export class ThemeConfig extends Disposable {
  private _themePrefs = this._appModel.themePrefs;

  private _syncWithOS = Computed.create(this, this._themePrefs, (_use, prefs) => {
    return prefs.syncWithOS;
  }).onWrite((value) => this._updateSyncWithOS(value));

  private _appearance = Computed.create(this,
    this._themePrefs,
    this._syncWithOS,
    prefersDarkModeObs(),
    (_use, prefs, syncWithOS, prefersDarkMode) => {
      if (syncWithOS) {
        return prefersDarkMode ? 'dark' : 'light';
      } else {
        return prefs.appearance;
      }
    })
    .onWrite((value) => this._updateAppearance(value));

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    return dom('div',
      css.subHeader(t("Appearance ")),
      css.dataRow(
        cssAppearanceSelect(
          select(
            this._appearance,
            [
              {value: 'light', label: 'Light'},
              {value: 'dark', label: 'Dark'},
            ],
            {
              disabled: this._syncWithOS,
            },
          ),
          testId('appearance'),
        ),
      ),
      css.dataRow(
        labeledSquareCheckbox(
          this._syncWithOS,
          t("Switch appearance automatically to match system"),
          testId('sync-with-os'),
        ),
      ),
      testId('container'),
    );
  }

  private _updateAppearance(appearance: ThemeAppearance) {
    this._themePrefs.set({...this._themePrefs.get(), appearance});
  }

  private _updateSyncWithOS(syncWithOS: boolean) {
    this._themePrefs.set({...this._themePrefs.get(), syncWithOS});
  }
}

const cssAppearanceSelect = styled('div', `
  width: 120px;
`);
