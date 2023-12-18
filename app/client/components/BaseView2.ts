/**
 * This file contains logic moved from BaseView.js and ported to TS.
 */

import {GristDoc} from 'app/client/components/GristDoc';
import {getDocIdHash, RichPasteObject} from 'app/client/lib/tableUtil';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {UserAction} from 'app/common/DocActions';
import {isFullReferencingType} from 'app/common/gristTypes';
import {SchemaTypes} from 'app/common/schema';
import {BulkColValues} from 'app/plugin/GristData';
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import omit = require('lodash/omit');
import pick = require('lodash/pick');

/**
 * Given a 2-d paste column-oriented paste data and target cols, transform the data to omit
 * fields that shouldn't be pasted over and extract rich paste data if available.
 * When pasting into empty columns, also update them with options from the source column.
 * `data` is a column-oriented 2-d array of either
 *    plain strings or rich paste data returned by `tableUtil.parsePasteHtml`.
 * `fields` are the target fields being pasted into.
 */
export async function parsePasteForView(
  data: Array<string | RichPasteObject>[], fields: ViewFieldRec[], gristDoc: GristDoc
): Promise<BulkColValues> {
  const result: BulkColValues = {};
  const actions: UserAction[] = [];
  const thisDocIdHash = getDocIdHash();

  data.forEach((col, idx) => {
    const field = fields[idx];
    const colRec = field?.column();
    if (!colRec || colRec.isRealFormula() || colRec.disableEditData()) {
      return;
    }

    const parser = field.createValueParser() || (x => x);
    let typeMatches = false;
    if (col[0] && typeof col[0] === "object") {
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

    result[colRec.colId()] = col.map(v => {
      if (v) {
        if (typeof v === "string") {
          return parser(v);
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
