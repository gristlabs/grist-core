import * as express from 'express';
import {ApiError} from 'app/common/ApiError';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DownloadOptions, ExportColumn, exportTable} from 'app/server/lib/Export';

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
  const {tableId, header} = options;
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

  const {tableName, columns} = await exportTable(activeDoc, tableRef, req);
  return {
    name: tableId.toLowerCase().replace(/_/g, '-'),
    title: tableName,
    schema: {
      fields: columns.map(col => ({
        name: col[header || "label"],
        ...(col.description ? {description: col.description} : {}),
        ...buildTypeField(col, settings.locale),
      })),
    }
  };
}

function buildTypeField(col: ExportColumn, locale: string) {
  const type = col.type.split(':', 1)[0];
  const widgetOptions = col.formatter.widgetOpts;
  switch (type) {
    case 'Text':
      return {
        type: 'string',
        format: widgetOptions.widget === 'HyperLink' ? 'uri' : 'default',
      };
    case 'Numeric':
      return {
        type: 'number',
        bareNumber: widgetOptions?.numMode === 'decimal',
        ...getNumberSeparators(locale),
      };
    case 'Integer':
      return {
        type: 'integer',
        bareNumber: widgetOptions?.numMode === 'decimal',
        groupChar: getNumberSeparators(locale).groupChar,
      };
    case 'Date':
      return {
        type: 'date',
        format: 'any',
        gristFormat: widgetOptions?.dateFormat || 'YYYY-MM-DD',
      };
    case 'DateTime':
      return {
        type: 'datetime',
        format: 'any',
        gristFormat: `${widgetOptions?.dateFormat} ${widgetOptions?.timeFormat}`,
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
        constraints: {enum: widgetOptions?.choices},
      };
    case 'ChoiceList':
      return {
        type: 'array',
        constraints: {enum: widgetOptions?.choices},
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
