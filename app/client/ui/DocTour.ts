import {t} from 'app/client/lib/localization';

import {Placement} from '@popperjs/core';
import {placements} from '@popperjs/core/lib/enums';
import {DocComm} from 'app/client/components/DocComm';
import {sameDocumentUrlState} from 'app/client/models/gristUrlState';
import {cssButtons, cssLinkBtn, cssLinkIcon} from 'app/client/ui/ExampleCard';
import {IOnBoardingMsg, startOnBoarding} from 'app/client/ui/OnBoardingPopups';
import {isNarrowScreen} from 'app/client/ui2018/cssVars';
import {IconList, IconName} from 'app/client/ui2018/IconList';
import {DocData} from 'app/common/DocData';
import {dom} from 'grainjs';
import sortBy = require('lodash/sortBy');

const translate = (x: string, args?: any): string => t(`DocTour.${x}`, args);

export async function startDocTour(docData: DocData, docComm: DocComm, onFinishCB: () => void) {
  const docTour: IOnBoardingMsg[] = await makeDocTour(docData, docComm) || invalidDocTour;
  exposeDocTour(docTour);
  startOnBoarding(docTour, onFinishCB);
}

const invalidDocTour: IOnBoardingMsg[] = [{
  title: translate('InvalidDocTourTitle'),
  body: translate('InvalidDocTourBody'),
  selector: 'document',
  showHasModal: true,
}];

async function makeDocTour(docData: DocData, docComm: DocComm): Promise<IOnBoardingMsg[] | null> {
  const tableId = "GristDocTour";
  if (!docData.getTable(tableId)) {
    return null;
  }
  // Make sure any formulas in GristDocTour table have had time to evaluate. For example, for a
  // first time open of a new document copy, any use of SELF_HYPERLINK will be stale since the URL
  // of the document has changed.
  await docComm.waitForInitialization();
  await docData.fetchTable(tableId);
  const tableData = docData.getTable(tableId)!;

  const result = sortBy(tableData.getRowIds(), tableData.getRowPropFunc('manualSort') as any).map(rowId => {
    function getValue(colId: string): string {
      return String(tableData.getValue(rowId, colId) || "");
    }
    const title = getValue("Title");
    let body: HTMLElement | string = getValue("Body");
    const linkText = getValue("Link_Text");
    const linkUrl = getValue("Link_URL");
    const linkIcon = getValue("Link_Icon") as IconName;
    const locationValue = getValue("Location");
    let placement = getValue("Placement");

    if (!(title || body)) {
      return null;
    }

    const urlState = sameDocumentUrlState(locationValue);
    if (isNarrowScreen() || !placements.includes(placement as Placement)) {
      placement = "auto";
    }

    let validLinkUrl = true;
    try {
      new URL(linkUrl);
    } catch {
      validLinkUrl = false;
    }

    if (validLinkUrl && linkText) {
      body = dom(
        'div',
        dom('p', body),
        dom('p',
          cssButtons(cssLinkBtn(
            IconList.includes(linkIcon) ? cssLinkIcon(linkIcon) : null,
            linkText,
            {href: linkUrl, target: '_blank'},
          ))
        ),
      );
    }

    return {
      title,
      body,
      placement,
      urlState,
      selector: '.active_cursor',
      // Center the popup if the user doesn't provide a link to a cell
      showHasModal: !urlState?.hash
    };
  }).filter(x => x !== null) as IOnBoardingMsg[];
  if (!result.length) {
    return null;
  }
  return result;
}

// for easy testing
function exposeDocTour(docTour: IOnBoardingMsg[]) {
  (window as any)._gristDocTour = () =>
    docTour.map(msg => ({
      ...msg,
      body: typeof msg.body === "string" ? msg.body
        : (msg.body as HTMLElement)?.outerHTML
          .replace(/_grain\d+_/g, "_grainXXX_"),
      urlState: msg.urlState?.hash
    }));
}
