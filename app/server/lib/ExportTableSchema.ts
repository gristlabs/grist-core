import * as express from 'express';
import {ApiError} from 'app/common/ApiError';
import {WidgetOptions} from 'app/common/WidgetOptions';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DownloadOptions, exportTable} from 'app/server/lib/Export';

interface ExportColumn {
  id: number;
  colId: string;
  label: string;
  type: string;
  widgetOptions: WidgetOptions;
  description?: string;
  parentPos: number;
}

interface FrictionlessFormat {
  name: string;
  title: string;
  schema: {
    fields: {
      name: string;
      type: string;
      description?: string;
      format?: string;
      bareNumber?: boolean;
      groupChar?: string;
      decimalChar?: string;
      gristFormat?: string;
      constraint?: {};
      trueValue?: string[];
      falseValue?: string[];
    }[]
  }
}

/**
 * Return a table schema for frictionless interoperability
 *
 * See https://specs.frictionlessdata.io/table-schema/#page-frontmatter-title for spec
 * @param {Object} activeDoc - the activeDoc that the table being converted belongs to.
 * @param {Object} options - options to get the table ID
 * @return {Promise<FrictionlessFormat>} Promise for the resulting schema.
 */
export async function collectTableSchemaInFrictionlessFormat(
  activeDoc: ActiveDoc,
  req: express.Request,
  options: DownloadOptions
): Promise<FrictionlessFormat> {
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
): FrictionlessFormat {
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