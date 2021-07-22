/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import { dom, styled } from 'grainjs';
import { Computed, Observable } from 'grainjs';

import { loadMomentTimezone } from 'app/client/lib/imports';
import { DocInfoRec } from 'app/client/models/DocModel';
import { DocPageModel } from 'app/client/models/DocPageModel';
import { vars } from 'app/client/ui2018/cssVars';
import { saveModal } from 'app/client/ui2018/modals';
import { buildTZAutocomplete } from 'app/client/widgets/TZAutocomplete';

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
        cssDataRow(dom.create(buildTZAutocomplete, moment, timezone, (val) => timezone.set(val))),
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
