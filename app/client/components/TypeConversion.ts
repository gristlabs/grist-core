/**
 * This module contains various logic for converting columns between types. It is used from
 * TypeTransform.js.
 */
// tslint:disable:no-console

import {isString} from 'app/client/lib/sessionObs';
import {DocModel} from 'app/client/models/DocModel';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import * as gristTypes from 'app/common/gristTypes';
import {isFullReferencingType} from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import NumberParse from 'app/common/NumberParse';
import {dateTimeWidgetOptions, guessDateFormat} from 'app/common/parseDate';
import {TableData} from 'app/common/TableData';
import {decodeObject} from 'app/plugin/objtypes';

interface ColInfo {
  type: string;
  isFormula: boolean;
  formula: string;
  visibleCol: number;
  widgetOptions?: string;
  rules: gristTypes.RefListValue
}

/**
 * Returns the suggested full type for `column` given a desired pure type to convert it to.
 * Specifically, a pure type of "DateTime" returns a full type of "DateTime:{timezone}", and "Ref"
 * returns a full type of "Ref:{TableId}". A `type` that's already complete is returned unchanged.
 */
export function addColTypeSuffix(type: string, column: ColumnRec, docModel: DocModel) {
  switch (type) {
    case "Ref":
    case "RefList":
    {
      const refTableId = getRefTableIdFromData(docModel, column) || column.table().primaryTableId();
      return `${type}:${refTableId}`;
    }
    case "DateTime":
      return 'DateTime:' + docModel.docInfoRow.timezone();
    default:
      return type;
  }
}

/**
 * Looks through the data of the given column to find the first value of the form
 * [R|r, <tableId>, <rowId>] (a Reference(List) value returned from a formula), and returns the tableId
 * from that.
 */
function getRefTableIdFromData(docModel: DocModel, column: ColumnRec): string|null {
  const tableData = docModel.docData.getTable(column.table().tableId());
  const columnData = tableData && tableData.getColValues(column.colId());
  if (columnData) {
    for (const value of columnData) {
      if (gristTypes.isReferencing(value)) {
        return value[1];
      } else if (gristTypes.isList(value)) {
        const item = value[1];
        if (gristTypes.isReference(item)) {
          return item[1];
        }
      } else if (typeof value === 'string') {
        // If it looks like a formatted Ref(List) value, e.g:
        //   - Table1[123]
        //   - [Table1[1], Table1[2], Table1[3]]
        //   - Table1[[1, 2, 3]]
        // and the tableId is valid,
        // use it. (This helps if a Ref-returning formula column got converted to Text first.)
        const match = value.match(/^\[?(\w+)\[/);
        if (match && docModel.docData.getTable(match[1])) {
          return match[1];
        }
      }
    }
  }
  return null;
}


// Given info about the original column, and the type of the new one, returns a promise for the
// ColInfo to use for the transform column. Note that isFormula will be set to true, and formula
// will be set to the expression to compute the new values from the old ones.
// @param toTypeMaybeFull: Type to convert the column to, either full ('Ref:Foo') or pure ('Ref').
export async function prepTransformColInfo(docModel: DocModel, origCol: ColumnRec, origDisplayCol: ColumnRec,
                                           toTypeMaybeFull: string): Promise<ColInfo> {
  const toType = gristTypes.extractTypeFromColType(toTypeMaybeFull);
  const tableData: TableData = docModel.docData.getTable(origCol.table().tableId())!;
  let widgetOptions: any = null;
  let rules: gristTypes.RefListValue = null;

  const colInfo: ColInfo = {
    type: addColTypeSuffix(toTypeMaybeFull, origCol, docModel),
    isFormula: true,
    visibleCol: 0,
    formula: "CURRENT_CONVERSION(rec)",
    rules,
  };

  const visibleCol = origCol.visibleColModel();
  // Column used to derive previous widget options and sample values for guessing
  const sourceCol = visibleCol.getRowId() !== 0 ? visibleCol : origCol;
  const prevOptions = sourceCol.widgetOptionsJson.peek() || {};
  const prevRules = sourceCol.rules.peek();
  switch (toType) {
    case 'Date':
    case 'DateTime': {
      let {dateFormat} = prevOptions;
      if (!dateFormat) {
        const colValues = tableData.getColValues(sourceCol.colId()) || [];
        dateFormat = guessDateFormat(colValues.map(String));
      }
      widgetOptions = dateTimeWidgetOptions(dateFormat, true);
      break;
    }
    case 'Numeric':
    case 'Int': {
      if (!["Numeric", "Int"].includes(sourceCol.type())) {
        const numberParse = NumberParse.fromSettings(docModel.docData.docSettings());
        const colValues = tableData.getColValues(sourceCol.colId()) || [];
        widgetOptions = numberParse.guessOptions(colValues.filter(isString));
      } else {
        widgetOptions = prevOptions;
        rules = prevRules;
      }
      break;
    }
    case 'Choice': {
      if (Array.isArray(prevOptions.choices)) {
        // Use previous choices if they are set, e.g. if converting from ChoiceList
        widgetOptions = {choices: prevOptions.choices, choiceOptions: prevOptions.choiceOptions};
      } else {
        // Set suggested choices. Limit to 100, since too many choices is more likely to cause
        // trouble than desired behavior. For many choices, recommend using a Ref to helper table.
        const columnData = tableData.getDistinctValues(sourceCol.colId(), 100);
        if (columnData) {
          columnData.delete("");
          columnData.delete(null);
          widgetOptions = {choices: Array.from(columnData, String)};
        }
      }
      break;
    }
    case 'ChoiceList': {
      if (Array.isArray(prevOptions.choices)) {
        // Use previous choices if they are set, e.g. if converting from ChoiceList
        widgetOptions = {choices: prevOptions.choices, choiceOptions: prevOptions.choiceOptions};
      } else {
        // Set suggested choices. This happens before the conversion to ChoiceList, so we do some
        // light guessing for likely choices to suggest.
        const choices = new Set<string>();
        for (let value of tableData.getColValues(sourceCol.colId()) || []) {
          if (value === null) { continue; }
          value = String(decodeObject(value)).trim();
          const tags: unknown[] = (value.startsWith('[') && gutil.safeJsonParse(value, null)) || value.split(",");
          for (const tag of tags) {
            choices.add(String(tag).trim());
            if (choices.size > 100) { break; }    // Don't suggest excessively many choices.
          }
        }
        choices.delete("");
        widgetOptions = {choices: Array.from(choices)};
      }
      break;
    }
    case 'Ref':
    case 'RefList':
    {
      // Set suggested destination table and visible column.
      // Undefined if toTypeMaybeFull is a pure type (e.g. converting to Ref before a table is chosen).
      const optTableId = gutil.removePrefix(toTypeMaybeFull, `${toType}:`) || undefined;

      let suggestedColRef: number;
      let suggestedTableId: string;
      const origColTypeInfo = gristTypes.extractInfoFromColType(origCol.type.peek());
      if (!optTableId && origColTypeInfo.type === "Ref" || origColTypeInfo.type === "RefList") {
        // When converting between Ref and Reflist, initially suggest the same table and visible column.
        // When converting, if the table is the same, it's a special case.
        // The visible column will not affect conversion.
        // It will simply wrap the reference (row ID) in a list or extract the one element of a reference list.
        suggestedColRef = origCol.visibleCol.peek();
        suggestedTableId = origColTypeInfo.tableId;
      } else {
        // Finds a reference suggestion column and sets it as the current reference value.
        const columnData = tableData.getDistinctValues(origDisplayCol.colId(), 100);
        if (!columnData) { break; }
        columnData.delete(gristTypes.getDefaultForType(origCol.type()));

        // 'findColFromValues' function requires an array since it sends the values to the sandbox.
        const matches: number[] = await docModel.docData.findColFromValues(Array.from(columnData), 2, optTableId);
        suggestedColRef = matches.find(match => match !== origCol.getRowId())!;
        if (!suggestedColRef) { break; }
        const suggestedCol = docModel.columns.getRowModel(suggestedColRef);
        suggestedTableId = suggestedCol.table().tableId();
        if (optTableId && suggestedTableId !== optTableId) {
          console.warn("Inappropriate column received from findColFromValues");
          break;
        }
      }
      colInfo.type = `${toType}:${suggestedTableId}`;
      colInfo.visibleCol = suggestedColRef;
      break;
    }
  }

  if (widgetOptions) {
    colInfo.widgetOptions = JSON.stringify(widgetOptions);
  }
  if (rules) {
    colInfo.rules = rules;
  }
  return colInfo;
}

// Given the transformCol, calls (if needed) a user action to update its displayCol.
export async function setDisplayFormula(
  docModel: DocModel, transformCol: ColumnRec, visibleCol?: number
): Promise<void> {
  const vcolRef = (visibleCol == null) ? transformCol.visibleCol() : visibleCol;
  if (isReferenceCol(transformCol)) {
    const vcol = getVisibleColName(docModel, vcolRef);
    const tcol = transformCol.colId();
    const displayFormula = (vcolRef === 0 ? '' : `$${tcol}.${vcol}`);
    return transformCol.saveDisplayFormula(displayFormula);
  }
}

// Returns the name of the visibleCol given its rowId.
function getVisibleColName(docModel: DocModel, visibleColRef: number): string|undefined {
  return visibleColRef ? docModel.columns.getRowModel(visibleColRef).colId() : undefined;
}

// Returns whether the given column model is of type Ref or RefList.
function isReferenceCol(colModel: ColumnRec) {
  return isFullReferencingType(colModel.type());
}
