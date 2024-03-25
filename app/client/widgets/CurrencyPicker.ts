import { makeT } from 'app/client/lib/localization';
import {ACSelectItem, buildACSelect} from "app/client/lib/ACSelect";
import {Computed, IDisposableOwner, Observable} from "grainjs";
import {ACIndexImpl} from "app/client/lib/ACIndex";
import {testId} from 'app/client/ui2018/cssVars';
import {currencies} from 'app/common/Locales';

const t = makeT('CurrencyPicker');

interface CurrencyPickerOptions {
  // The label to use in the select menu for the default option.
  defaultCurrencyLabel: string;
  disabled?: Observable<boolean>;
}

export function buildCurrencyPicker(
  owner: IDisposableOwner,
  currency: Observable<string|undefined>,
  onSave: (value: string|undefined) => void,
  {defaultCurrencyLabel, disabled}: CurrencyPickerOptions
) {
  const currencyItems: ACSelectItem[] = currencies
    .map(item => ({
      value: item.code,
      label: `${item.code} ${item.name}`,
      cleanText: `${item.code} ${item.name}`.trim().toLowerCase(),
    }));

  // Add default currency label option to the very front.
  currencyItems.unshift({
    label : defaultCurrencyLabel,
    value : defaultCurrencyLabel,
    cleanText : defaultCurrencyLabel.toLowerCase(),
  });
  // Create a computed that will display 'Local currency' as a value and label
  // when `currency` is undefined.
  const valueObs = Computed.create(owner, (use) => use(currency) || defaultCurrencyLabel);
  const acIndex = new ACIndexImpl<ACSelectItem>(currencyItems, {maxResults: 200, keepOrder: true});
  return buildACSelect(owner,
    {
      acIndex, valueObs,
      disabled,
      save(_, item: ACSelectItem | undefined) {
        // Save only if we have found a match
        if (!item) {
          throw new Error(t("Invalid currency"));
        }
        // For default value, return undefined to use default currency for document.
        onSave(item.value === defaultCurrencyLabel ? undefined : item.value);
      }
    },
    testId("currency-autocomplete")
  );
}
