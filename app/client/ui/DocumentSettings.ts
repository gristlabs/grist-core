/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {t} from 'app/client/lib/localization';
import {dom, IDisposableOwner, styled} from 'grainjs';
import {Computed, Observable} from 'grainjs';


import {ACSelectItem, buildACSelect} from "app/client/lib/ACSelect";
import {ACIndexImpl} from "app/client/lib/ACIndex";
import {loadMomentTimezone} from 'app/client/lib/imports';
import {DocInfoRec} from 'app/client/models/DocModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {testId, vars} from 'app/client/ui2018/cssVars';
import {select} from 'app/client/ui2018/menus';
import {saveModal} from 'app/client/ui2018/modals';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {buildTZAutocomplete} from 'app/client/widgets/TZAutocomplete';
import {EngineCode} from 'app/common/DocumentSettings';
import {GristLoadConfig} from 'app/common/gristUrls';
import {propertyCompare} from "app/common/gutil";
import {getCurrency, locales} from "app/common/Locales";

const translate = (x: string, args?: any): string => t(`DocumentSettings.${x}`, args);

/**
 * Builds a simple saveModal for saving settings.
 */
export async function showDocSettingsModal(docInfo: DocInfoRec, docPageModel: DocPageModel): Promise<void> {
  const moment = await loadMomentTimezone();
  return saveModal((ctl, owner) => {
    const timezoneObs = Observable.create(owner, docInfo.timezone.peek());

    const docSettings = docInfo.documentSettingsJson.peek();
    const {locale, currency, engine} = docSettings;
    const localeObs = Observable.create(owner, locale);
    const currencyObs = Observable.create(owner, currency);
    const engineObs = Observable.create(owner, engine);

    // Check if server supports engine choices - if so, we will allow user to pick.
    const canChangeEngine = getSupportedEngineChoices().length > 0;

    return {
      title: translate('DocumentSettings'),
      body: [
        cssDataRow(translate('ThisDocumentID')),
        cssDataRow(dom('tt', docPageModel.currentDocId.get())),
        cssDataRow(translate('TimeZone')),
        cssDataRow(dom.create(buildTZAutocomplete, moment, timezoneObs, (val) => timezoneObs.set(val))),
        cssDataRow(translate('Locale')),
        cssDataRow(dom.create(buildLocaleSelect, localeObs)),
        cssDataRow(translate('Currency')),
        cssDataRow(dom.domComputed(localeObs, (l) =>
          dom.create(buildCurrencyPicker, currencyObs, (val) => currencyObs.set(val),
            {defaultCurrencyLabel: translate('LocalCurrency', {currency: getCurrency(l)})})
        )),
        canChangeEngine ? [
          // Small easter egg: you can click on the skull-and-crossbones to
          // force a reload of the document.
          cssDataRow(translate('EngineRisk', {span: 
            dom('span', '☠',
              dom.style('cursor', 'pointer'),
              dom.on('click', async () => {
                await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
                document.location.reload();
              }))
          })),
          select(engineObs, getSupportedEngineChoices()),
        ] : null,
      ],
      // Modal label is "Save", unless engine is changed. If engine is changed, the document will
      // need a reload to switch engines, so we replace the label with "Save and Reload".
      saveLabel: dom.text((use) => (use(engineObs) === docSettings.engine) ? translate('Save') : translate('SaveAndReload')),
      saveFunc: async () => {
        await docInfo.updateColValues({
          timezone: timezoneObs.get(),
          documentSettings: JSON.stringify({
            ...docInfo.documentSettingsJson.peek(),
            locale: localeObs.get(),
            currency: currencyObs.get(),
            engine: engineObs.get()
          })
        });
        // Reload the document if the engine is changed.
        if (engineObs.get() !== docSettings.engine) {
          await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
        }
      },
      // If timezone, locale, or currency hasn't changed, disable the Save button.
      saveDisabled: Computed.create(owner,
        (use) => {
          return (
            use(timezoneObs) === docInfo.timezone.peek() &&
            use(localeObs) === docSettings.locale &&
            use(currencyObs) === docSettings.currency &&
            use(engineObs) === docSettings.engine
          );
        })
    };
  });
}


type LocaleItem = ACSelectItem & {locale?: string};

function buildLocaleSelect(
  owner: IDisposableOwner,
  locale: Observable<string>
) {
  const localeList: LocaleItem[] = locales.map(l => ({
    value: l.name, // Use name as a value, we will translate the name into the locale on save
    label: l.name,
    locale: l.code,
    cleanText: l.name.trim().toLowerCase(),
  })).sort(propertyCompare("label"));
  const acIndex = new ACIndexImpl<LocaleItem>(localeList, 200, true);
  // AC select will show the value (in this case locale) not a label when something is selected.
  // To show the label - create another observable that will be in sync with the value, but
  // will contain text.
  const localeCode = locale.get();
  const localeName = locales.find(l => l.code === localeCode)?.name || localeCode;
  const textObs = Observable.create(owner, localeName);
  return buildACSelect(owner,
    {
      acIndex, valueObs: textObs,
      save(value, item: LocaleItem | undefined) {
        if (!item) { throw new Error("Invalid locale"); }
        textObs.set(value);
        locale.set(item.locale!);
      },
    },
    testId("locale-autocomplete")
  );
}

// This matches the style used in showProfileModal in app/client/ui/AccountWidget.
const cssDataRow = styled('div', `
  margin: 16px 0px;
  font-size: ${vars.largeFontSize};
`);

// Check which engines can be selected in the UI, if any.
export function getSupportedEngineChoices(): EngineCode[] {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.supportEngines || [];
}
