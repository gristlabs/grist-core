import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import * as css from 'app/client/ui/AccountPageCss';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {prefersColorSchemeDarkObs} from 'app/client/ui2018/theme';
import {select} from 'app/client/ui2018/menus';
import {ThemeName, themeNameAppearances} from 'app/common/ThemePrefs';
import {Computed, Disposable, dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-theme-config-');
const t = makeT('ThemeConfig');

export class ThemeConfig extends Disposable {
  private _themePrefs = this._appModel.themePrefs;

  private _syncWithOS = Computed.create(this, this._themePrefs, (_use, prefs) => {
    return prefs.syncWithOS;
  }).onWrite((value) => this._updateSyncWithOS(value));

  private _themeName = Computed.create(this,
    this._themePrefs,
    this._syncWithOS,
    prefersColorSchemeDarkObs(),
    (_use, prefs, syncWithOS, prefersColorSchemeDark) => {
      if (syncWithOS) {
        return prefersColorSchemeDark ? 'GristDark' : 'GristLight';
      } else {
        // The user theme name is stored in both colors.light and colors.dark, just take one of them
        // This is a bit weird but this rather contained weirdness is preferred to changing the user prefs schema.
        return prefs.colors.light;
      }
    })
    .onWrite((themeName) => {
      this._updateTheme(themeName);
    });

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    return dom('div',
      css.subHeader(t("Appearance ")),
      css.dataRow(
        cssAppearanceSelect(
          select(
            this._themeName,
            [
              {value: 'GristLight', label: 'Light'},
              {value: 'GristDark', label: 'Dark'},
              {value: 'HighContrastLight', label: 'Light (High Contrast)'},
            ],
            {
              disabled: this._syncWithOS,
              translateOptionLabels: true,
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

  private _updateTheme(themeName: ThemeName) {
    this._themePrefs.set({
      ...this._themePrefs.get(),
      appearance: themeNameAppearances[themeName],
      // Important note: the `colors` property is not actually used for its original purpose.
      // It's currently our way to store the theme name in user prefs (without having to change the user prefs schema).
      // This is why we just repeat the name in both `light` and `dark` properties.
      colors: {light: themeName, dark: themeName},
    });
  }

  private _updateSyncWithOS(syncWithOS: boolean) {
    this._themePrefs.set({...this._themePrefs.get(), syncWithOS});
  }
}

const cssAppearanceSelect = styled('div', `
  width: 180px;
`);
