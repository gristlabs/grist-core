import {MomentTimezone} from 'app/client/lib/imports';
import {ACIndexImpl} from 'app/client/lib/ACIndex';
import {ACSelectItem, buildACSelect} from 'app/client/lib/ACSelect';
import {testId} from "app/client/ui2018/cssVars";
import {nativeCompare} from 'app/common/gutil';
import {IDisposableOwner, Observable} from 'grainjs';

/**
 * Returns the ordered list of offsets for names at time timestamp. See timezoneOptions for details
 * on the sorting order.
 */
// exported for testing
export function timezoneOptionsImpl(
  timestamp: number, names: string[], moment: MomentTimezone
): ACSelectItem[] {
  // What we want is moment(timestamp) but the dynamic import with our compiling settings produces
  // "moment is not a function". The following is equivalent, and easier than fixing import setup.
  const m = moment.unix(timestamp / 1000);

  const options = names.map((value) => ({
    cleanText: value.toLowerCase().trim(),
    value,
    label: `(GMT${m.tz(value).format('Z')}) ${value}`,
    // A quick test reveal that it is a bit more efficient (~0.02ms) to get the offset using
    // `moment.tz.Zone#parse` than creating a Moment instance for each zone and then getting the
    // offset with `moment#utcOffset`.
    offset: -moment.tz.zone(value)!.parse(timestamp)
  }));
  options.sort((a, b) => nativeCompare(a.offset, b.offset) || nativeCompare(a.value, b.value));
  return options;
}

/**
 * Returns the array of IOptionFull<string> expected by `select` to create the list of timezones
 * options. The returned list is sorted based on the current offset (GMT-11:00 before GMT-10:00),
 * and then on alphabetical order of the name.
 */
function timezoneOptions(moment: MomentTimezone): ACSelectItem[] {
  return timezoneOptionsImpl(Date.now(), moment.tz.names(), moment);
}

/**
 * Creates a textbox with an autocomplete dropdown to select a time zone.
 * Usage: dom.create(buildTZAutocomplete, momentModule, valueObs, saveCallback)
 */
export function buildTZAutocomplete(
  owner: IDisposableOwner,
  moment: MomentTimezone,
  valueObs: Observable<string>,
  save: (value: string) => Promise<void>|void,
  options?: { disabled?: Observable<boolean> }
) {
  // Set a large maxResults, since it's sometimes nice to see all supported timezones (there are
  // fewer than 1000 in practice).
  const acIndex = new ACIndexImpl<ACSelectItem>(timezoneOptions(moment), {
    maxResults: 1000,
    keepOrder: true,
  });

  // Only save valid time zones. If there is no selected item, we'll auto-select and save only
  // when there is a good match.
  const saveTZ = (value: string, item: ACSelectItem|undefined) => {
    if (!item) {
      const results = acIndex.search(value);
      if (results.selectIndex >= 0 && results.items.length > 0) {
        item = results.items[results.selectIndex];
        value = item.value;
      }
    }
    if (!item) { throw new Error("Invalid time zone"); }
    if (value !== valueObs.get()) {
      return save(value);
    }
  };
  return buildACSelect(owner,
    {...options, acIndex, valueObs, save: saveTZ},
    testId("tz-autocomplete")
  );
}
