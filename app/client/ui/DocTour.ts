import {IOnBoardingMsg, startOnBoarding} from "app/client/ui/OnBoardingPopups";
import {DocData} from "../../common/DocData";
import * as _ from "lodash";
import {Placement} from "@popperjs/core";
import {placements} from "@popperjs/core/lib/enums";
import {sameDocumentUrlState} from "../models/gristUrlState";


export async function startDocTour(docData: DocData, onFinishCB: () => void) {
  const docTour: IOnBoardingMsg[] = await makeDocTour(docData) || invalidDocTour;
  (window as any)._gristDocTour = docTour;  // for easy testing
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
    const body = getValue("Body");
    const locationValue = getValue("Location");
    let placement = getValue("Placement");

    if (!(title || body)) {
      return null;
    }

    const urlState = sameDocumentUrlState(locationValue);
    if (!placements.includes(placement as Placement)) {
      placement = "auto";
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
