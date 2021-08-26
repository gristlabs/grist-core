/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {dom, IDisposableOwner, styled} from 'grainjs';
import {Computed, Observable} from 'grainjs';


import {ACSelectItem, buildACSelect} from "app/client/lib/ACSelect";
import {ACIndexImpl} from "app/client/lib/ACIndex";
import {loadMomentTimezone} from 'app/client/lib/imports';
import {DocInfoRec} from 'app/client/models/DocModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {testId, vars} from 'app/client/ui2018/cssVars';
import {saveModal} from 'app/client/ui2018/modals';
import {buildTZAutocomplete} from 'app/client/widgets/TZAutocomplete';
import {locales} from "app/common/Locales";
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import * as LocaleCurrency from "locale-currency";

/**
 * Builds a simple saveModal for saving settings.
 */
export async function showDocSettingsModal(docInfo: DocInfoRec, docPageModel: DocPageModel): Promise<void> {
  const moment = await loadMomentTimezone();
  return saveModal((ctl, owner) => {
    const timezoneObs = Observable.create(owner, docInfo.timezone.peek());

    const {locale, currency} = docInfo.documentSettingsJson.peek();
    const localeObs = Observable.create(owner, locale);
    const currencyObs = Observable.create(owner, currency);

    return {
      title: 'Document Settings',
      body: [
        cssDataRow("This document's ID (for API use):"),
        cssDataRow(dom('tt', docPageModel.currentDocId.get())),
        cssDataRow('Time Zone:'),
        cssDataRow(dom.create(buildTZAutocomplete, moment, timezoneObs, (val) => timezoneObs.set(val))),
        cssDataRow('Locale:'),
        cssDataRow(dom.create(buildLocaleSelect, localeObs)),
        cssDataRow('Currency:'),
        cssDataRow(dom.domComputed(localeObs, (l) =>
          dom.create(buildCurrencyPicker, currencyObs, (val) => currencyObs.set(val),
            {defaultCurrencyLabel: `Local currency (${LocaleCurrency.getCurrency(l)})`})
        )),
      ],
      saveFunc: () => docInfo.updateColValues({
        timezone: timezoneObs.get(),
        documentSettings: JSON.stringify({
          ...docInfo.documentSettingsJson.peek(),
          locale: localeObs.get(),
          currency: currencyObs.get()
        })
      }),
      // If timezone, locale, or currency hasn't changed, disable the Save button.
      saveDisabled: Computed.create(owner,
        (use) => {
          const docSettings = docInfo.documentSettingsJson.peek();
          return (
            use(timezoneObs) === docInfo.timezone.peek() &&
            use(localeObs) === docSettings.locale &&
            use(currencyObs) === docSettings.currency
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
  }));
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
