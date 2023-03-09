import * as express from 'express';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DownloadOptions, exportTable} from 'app/server/lib/Export';
import { ApiError } from 'app/common/ApiError';

interface ExportColumn {
  id: number;
  colId: string;
  label: string;
  type: string;
  widgetOptions: any;
  description?: string;
  parentPos: number;
}

export async function downloadTableSchema(
  activeDoc: ActiveDoc,
  req: express.Request,
  options: DownloadOptions
) {
  const {tableId} = options;
  if (!activeDoc.docData) {
    throw new Error('No docData in active document');
  }

  // Look up the table to make a CSV from.
  const settings = activeDoc.docData.docSettings();
  const tables = activeDoc.docData.getMetaTable('_grist_Tables');
  const tableRef = tables.findRow('tableId', tableId);

  if (tableRef === 0) {
    throw new ApiError(`Table ${tableId} not found.`, 404);
  }

  const data = await exportTable(activeDoc, tableRef, req);
  const tableSchema = columnsToTableSchema(tableId, data, settings.locale);
  return tableSchema;
}

function columnsToTableSchema(
  tableId: string,
  {tableName, columns}: {tableName: string, columns: ExportColumn[]},
  locale: string,
) {
  return {
    name: tableId.toLowerCase().replace(/_/g, '-'),
    title: tableName,
    schema: {
      fields: columns.map(col => ({
        name: col.label,
        ...(col.description ? {description: col.description} : {}),
        ...buildTypeField(col, locale),
      })),
    }
  };
}

function buildTypeField(col: ExportColumn, locale: string) {
  const type = col.type.split(':', 1)[0];
  switch (type) {
    case 'Text':
      return {
        type: 'string',
        format: col.widgetOptions.widget === 'HyperLink' ? 'uri' : 'default',
      };
    case 'Numeric':
      return {
        type: 'number',
        bareNumber: col.widgetOptions?.numMode === 'decimal',
        ...getNumberSeparators(locale),
      };
    case 'Integer':
      return {
        type: 'integer',
        bareNumber: col.widgetOptions?.numMode === 'decimal',
        groupChar: getNumberSeparators(locale).groupChar,
      };
    case 'Date':
      return {
        type: 'date',
        format: 'any',
        gristFormat: col.widgetOptions?.dateFormat || 'YYYY-MM-DD',
      };
    case 'DateTime':
      return {
        type: 'datetime',
        format: 'any',
        gristFormat: `${col.widgetOptions?.dateFormat} ${col.widgetOptions?.timeFormat}`,
      };
    case 'Bool':
      return {
        type: 'boolean',
        trueValue: ['TRUE'],
        falseValue: ['FALSE'],
      };
    case 'Choice':
      return {
        type: 'string',
        constraints: {enum: col.widgetOptions?.choices},
      };
    case 'ChoiceList':
      return {
        type: 'array',
        constraints: {enum: col.widgetOptions?.choices},
      };
    case 'Reference':
      return {type: 'string'};
    case 'ReferenceList':
      return {type: 'array'};
    default:
      return {type: 'string'};
  }
}

function getNumberSeparators(locale: string) {
  const numberWithGroupAndDecimalSeparator = 1000.1;
  const parts = Intl.NumberFormat(locale).formatToParts(numberWithGroupAndDecimalSeparator);
  return {
    groupChar: parts.find(obj => obj.type === 'group')?.value,
    decimalChar: parts.find(obj => obj.type === 'decimal')?.value,
  };
}