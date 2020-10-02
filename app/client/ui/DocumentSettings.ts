/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import { dom, IOptionFull, select, styled } from 'grainjs';
import { Computed, Observable } from 'grainjs';

import { loadMomentTimezone, MomentTimezone } from 'app/client/lib/imports';
import { DocInfoRec } from 'app/client/models/DocModel';
import { DocPageModel } from 'app/client/models/DocPageModel';
import { testId, vars } from 'app/client/ui2018/cssVars';
import { saveModal } from 'app/client/ui2018/modals';
import { nativeCompare } from 'app/common/gutil';

/**
 * Returns the ordered list of offsets for names at time timestamp. See timezoneOptions for details
 * on the sorting order.
 */
// exported for testing
export function timezoneOptionsImpl(
  timestamp: number, names: string[], moment: MomentTimezone
): Array<IOptionFull<string>> {
  // What we want is moment(timestamp) but the dynamic import with our compiling settings produces
  // "moment is not a function". The following is equivalent, and easier than fixing import setup.
  const m = moment.unix(timestamp / 1000);

  const options = names.map((value) => ({
    value,
    label: `(GMT${m.tz(value).format('Z')}) ${value}`,
    // A quick test reveal that it is a bit more efficient (~0.02ms) to get the offset using
    // `moment.tz.Zone#parse` than creating a Moment instance for each zone and then getting the
    // offset with `moment#utcOffset`.
    offset: -moment.tz.zone(value)!.parse(timestamp)
  }));
  options.sort((a, b) => nativeCompare(a.offset, b.offset) || nativeCompare(a.value, b.value));
  return options.map(({value, label}) => ({value, label}));
}

/**
 * Returns the array of IOptionFull<string> expected by `select` to create the list of timezones
 * options. The returned list is sorted based on the current offset (GMT-11:00 before GMT-10:00),
 * and then on alphabetical order of the name.
 */
function timezoneOptions(moment: MomentTimezone): Array<IOptionFull<string>> {
  return timezoneOptionsImpl(Date.now(), moment.tz.names(), moment);
}


/**
 * Builds a simple saveModal for saving settings.
 */
export async function showDocSettingsModal(docInfo: DocInfoRec, docPageModel: DocPageModel): Promise<void> {
  const moment = await loadMomentTimezone();
  return saveModal((ctl, owner) => {
    const timezone = Observable.create(owner, docInfo.timezone.peek());
    return {
      title: 'Document Settings',
      body: [
        cssDataRow("This document's ID (for API use):"),
        cssDataRow(dom('tt', docPageModel.currentDocId.get())),
        cssDataRow('Time Zone:'),
        cssDataRow(select(timezone, timezoneOptions(moment)), testId('ds-tz')),
      ],
      // At this point, we only need to worry about saving this one setting.
      saveFunc: () => docInfo.timezone.saveOnly(timezone.get()),
      // If timezone hasn't changed, there is nothing to save, so disable the Save button.
      saveDisabled: Computed.create(owner, (use) => use(timezone) === docInfo.timezone.peek()),
    };
  });
}

// This matches the style used in showProfileModal in app/client/ui/AccountWidget.
const cssDataRow = styled('div', `
  margin: 16px 0px;
  font-size: ${vars.largeFontSize};
`);
