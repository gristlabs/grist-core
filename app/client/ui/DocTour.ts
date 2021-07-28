import {IOnBoardingMsg, startOnBoarding} from "app/client/ui/OnBoardingPopups";
import {DocData} from "../../common/DocData";
import * as _ from "lodash";
import {Placement} from "@popperjs/core";
import {placements} from "@popperjs/core/lib/enums";
import {sameDocumentUrlState} from "../models/gristUrlState";
import {dom} from "grainjs";
import {IconList, IconName} from "../ui2018/IconList";
import {cssButtons, cssLinkBtn, cssLinkIcon} from "./ExampleCard";


export async function startDocTour(docData: DocData, onFinishCB: () => void) {
  const docTour: IOnBoardingMsg[] = await makeDocTour(docData) || invalidDocTour;
  exposeDocTour(docTour);
  startOnBoarding(docTour, onFinishCB);
}

const invalidDocTour: IOnBoardingMsg[] = [{
  title: 'No valid document tour',
  body: 'Cannot construct a document tour from the data in this document. ' +
    'Ensure there is a table named GristDocTour with columns Title, Body, Placement, and Location.',
  selector: 'document',
  showHasModal: true,
}];

async function makeDocTour(docData: DocData): Promise<IOnBoardingMsg[] | null> {
  const tableId = "GristDocTour";
  if (!docData.getTable(tableId)) {
    return null;
  }
  await docData.fetchTable(tableId);
  const tableData = docData.getTable(tableId)!;
  const result = _.sortBy(tableData.getRowIds(), tableData.getRowPropFunc('manualSort') as any).map(rowId => {
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
    if (!placements.includes(placement as Placement)) {
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
