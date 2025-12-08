/**
 * This file contains logic moved from BaseView.js and ported to TS.
 */

import {GristDoc} from 'app/client/components/GristDoc';
import {getDocIdHash, PasteData} from 'app/client/lib/tableUtil';
import {uploadFiles} from 'app/client/lib/uploads';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {UserAction} from 'app/common/DocActions';
import {isFullReferencingType} from 'app/common/gristTypes';
import {getSetMapValue} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {BulkColValues, CellValue, GristObjCode} from 'app/plugin/GristData';
import omit from 'lodash/omit';
import pick from 'lodash/pick';

function isFileList(value: unknown): value is File[] {
  return Array.isArray(value) && value.every(item => (item instanceof File));
}

/**
 * Given a 2-d paste column-oriented paste data and target cols, transform the data to omit
 * fields that shouldn't be pasted over and extract rich paste data if available.
 * When pasting into empty columns, also update them with options from the source column.
 * `data` is a column-oriented 2-d array of either
 *    plain strings or rich paste data returned by `tableUtil.parsePasteHtml`.
 * `fields` are the target fields being pasted into.
 */
export async function parsePasteForView(
  data: PasteData, fields: ViewFieldRec[], gristDoc: GristDoc
): Promise<BulkColValues> {
  const result: BulkColValues = {};
  const actions: UserAction[] = [];
  const thisDocIdHash = getDocIdHash();

  // If we have pasted-in files, they can go into Attachments-type columns. We collect the tasks
  // to upload them, and perform after going through the paste data.
  const uploadTasks: Array<{colId: string, valueIndex: number, fileList: File[]}> = [];

  data.forEach((col, idx) => {
    const field = fields[idx];
    const colRec = field?.column();
    if (!colRec || colRec.isRealFormula() || colRec.disableEditData()) {
      return;
    }
    if (isFileList(col[0]) && colRec.type.peek() !== 'Attachments') {
      // If you attempt to paste files into a non-Attachments column, ignore rather than paste
      // empty values.
      return;
    }

    const parser = field.createValueParser() || (x => x);
    let typeMatches = false;
    if (col[0] && typeof col[0] === "object" && !isFileList(col[0])) {
      const {colType, docIdHash, colRef} = col[0];
      const targetType = colRec.type();
      const docIdMatches = docIdHash === thisDocIdHash;
      typeMatches = docIdMatches || !isFullReferencingType(colType || "");

      if (targetType !== "Any") {
        typeMatches = typeMatches && colType === targetType;
      } else if (docIdMatches && colRef) {
        // Try copying source column type and options into empty columns
        const sourceColRec = gristDoc.docModel.columns.getRowModel(colRef);
        const sourceType = sourceColRec.type();
        // Check that the source column still exists, has a type other than Text, and the type hasn't changed.
        // For Text columns, we don't copy over column info so that type guessing can still happen.
        if (sourceColRec.getRowId() && sourceType !== "Text" && sourceType === colType) {
          const colInfo: Partial<SchemaTypes["_grist_Tables_column"]> = {
            type: sourceType,
            visibleCol: sourceColRec.visibleCol(),
            // Conditional formatting rules are not copied right now, that's a bit more complicated
            // and copying the formula may or may not be desirable.
            widgetOptions: JSON.stringify(omit(sourceColRec.widgetOptionsJson(), "rulesOptions")),
          };
          actions.push(
            ["UpdateRecord", "_grist_Tables_column", colRec.getRowId(), colInfo],
            ["MaybeCopyDisplayFormula", colRef, colRec.getRowId()],
          );
        }
      }
    }

    const colId = colRec.colId.peek();
    result[colId] = col.map((v, valueIndex) => {
      if (v) {
        if (typeof v === "string") {
          return parser(v);
        }
        if (isFileList(v)) {
          uploadTasks.push({colId, valueIndex, fileList: v});
          return null;
        }
        if (typeMatches && v.hasOwnProperty('rawValue')) {
          return v.rawValue;
        }
        if (v.hasOwnProperty('displayValue')) {
          return parser(v.displayValue);
        }
      }
      return v;
    });
  });

  // Replace any file values going into an Attachments column with upload results.
  // We cache uploads on the **array of files**, because the entire array value may be duplicated
  // in the input data when pasting into multiple rows.
  const uploads = new Map<File[], Promise<CellValue>>();
  for (const {colId, valueIndex, fileList} of uploadTasks) {
    const value = await getSetMapValue(uploads, fileList, async (): Promise<CellValue> => {
      const uploadResult = await uploadFiles(fileList,
        {docWorkerUrl: gristDoc.docComm.docWorkerUrl, sizeLimit: 'attachment'});

      if (!uploadResult) { return null; }

      // Upload the attachments.
      const attRowIds = await gristDoc.docComm.addAttachments(uploadResult.uploadId);
      return [GristObjCode.List, ...attRowIds];
    });
    result[colId][valueIndex] = value;
  }

  if (actions.length) {
    await gristDoc.docData.sendActions(actions);
  }

  return result;
}

/**
 * Get default values for a new record so that it continues to satisfy the current linking filters.
 * Exclude formula columns since we can't set their values.
 */
export function getDefaultColValues(viewSection: ViewSectionRec): Record<string, any> {
  const linkingState = viewSection.linkingState.peek();
  if (!linkingState) {
    return {};
  }
  const dataColIds = viewSection.columns.peek()
    .filter(col => !col.isRealFormula.peek())
    .map(col => col.colId.peek());
  return pick(linkingState.getDefaultColValues(), dataColIds);
}
