import { CellValue, CellVersions } from 'app/common/DocActions';
import { GristObjCode, GristType } from 'app/plugin/GristData';
import isString = require('lodash/isString');
import { removePrefix } from "./gutil";

// tslint:disable:object-literal-key-quotes

export type GristTypeInfo =
  {type: 'DateTime', timezone: string} |
  {type: 'Ref', tableId: string} |
  {type: 'RefList', tableId: string} |
  {type: Exclude<GristType, 'DateTime'|'Ref'|'RefList'>};

export const MANUALSORT = 'manualSort';

// Whether a column is internal and should be hidden.
export function isHiddenCol(colId: string): boolean {
  return colId.startsWith('gristHelper_') || colId === MANUALSORT;
}

// This mapping includes both the default value, and its representation for SQLite.
const _defaultValues: {[key in GristType]: [CellValue, string]} = {
  'Any':              [ null,  "NULL"  ],
  'Attachments':      [ null,  "NULL"  ],
  'Blob':             [ null,  "NULL"  ],
  // Bool is only supported by SQLite as 0 and 1 values.
  'Bool':             [ false, "0" ],
  'Choice':           [ '',    "''"    ],
  'ChoiceList':       [ null,  "NULL"  ],
  'Date':             [ null,  "NULL"  ],
  'DateTime':         [ null,  "NULL"  ],
  'Id':               [ 0,     "0"     ],
  'Int':              [ 0,     "0"     ],
  // Note that "1e999" is a way to store Infinity into SQLite. This is verified by "Defaults"
  // tests in DocStorage.js. See also http://sqlite.1065341.n5.nabble.com/Infinity-td55327.html.
  'ManualSortPos':    [ Number.POSITIVE_INFINITY, "1e999" ],
  'Numeric':          [ 0,     "0"     ],
  'PositionNumber':   [ Number.POSITIVE_INFINITY, "1e999" ],
  'Ref':              [ 0,     "0"     ],
  'RefList':          [ null,  "NULL"  ],
  'Text':             [ '',    "''"    ],
};


/**
 * Given a grist column type (e.g Text, Numeric, ...) returns the default value for that type.
 * If options.sqlFormatted is true, returns the representation of the value for SQLite.
 */
export function getDefaultForType(colType: string, options: {sqlFormatted?: boolean} = {}) {
  const type = extractTypeFromColType(colType);
  return (_defaultValues[type as GristType] || _defaultValues.Any)[options.sqlFormatted ? 1 : 0];
}

/**
 * Convert a type like 'Numeric', 'DateTime:America/New_York', or 'Ref:Table1' to a GristTypeInfo
 * object.
 */
export function extractInfoFromColType(colType: string): GristTypeInfo {
  const colon = colType.indexOf(':');
  const [type, arg] = (colon === -1) ? [colType] : [colType.slice(0, colon), colType.slice(colon + 1)];
  return (type === 'Ref') ? {type, tableId: String(arg)} :
    (type === 'RefList')  ? {type, tableId: String(arg)} :
    (type === 'DateTime') ? {type, timezone: String(arg)} :
    {type} as GristTypeInfo;
}

/**
 * Re-encodes a CellValue of a given Grist type as a value suitable to use in an Any column. E.g.
 *    reencodeAsAny(123, 'Numeric') -> 123
 *    reencodeAsAny(123, 'Date') -> ['d', 123]
 *    reencodeAsAny(123, 'Reference', 'Table1') -> ['R', 'Table1', 123]
 */
export function reencodeAsAny(value: CellValue, typeInfo: GristTypeInfo): CellValue {
  if (typeof value === 'number') {
    switch (typeInfo.type) {
      case 'Date': return [GristObjCode.Date, value];
      case 'DateTime': return [GristObjCode.DateTime, value, typeInfo.timezone];
      case 'Ref': return [GristObjCode.Reference, typeInfo.tableId, value];
    }
  }
  return value;
}


/**
 * Returns whether a value (as received in a DocAction) represents a custom object.
 */
export function isObject(value: CellValue): value is [GristObjCode, any?] {
  return Array.isArray(value);
}

/**
 * Returns GristObjCode of the value if the value is an object, or null otherwise.
 * The return type includes any string, since we should not assume we can only get valid codes.
 */
export function getObjCode(value: CellValue): GristObjCode|string|null {
  return Array.isArray(value) ? value[0] : null;
}

/**
 * Returns whether a value (as received in a DocAction) represents a raised exception.
 */
export function isRaisedException(value: CellValue): boolean {
  return getObjCode(value) === GristObjCode.Exception;
}

/**
 * Returns whether a value (as received in a DocAction) represents a group of versions for
 * a comparison or conflict.
 */
export function isVersions(value: CellValue): value is [GristObjCode.Versions, CellVersions] {
  return getObjCode(value) === GristObjCode.Versions;
}

export function isSkip(value: CellValue): value is [GristObjCode.Skip] {
  return getObjCode(value) === GristObjCode.Skip;
}

export function isCensored(value: CellValue): value is [GristObjCode.Censored] {
  return getObjCode(value) === GristObjCode.Censored;
}

/**
 * Returns whether a value (as received in a DocAction) represents a list.
 */
export function isList(value: CellValue): value is [GristObjCode.List, ...CellValue[]] {
  return Array.isArray(value) && value[0] === GristObjCode.List;
}

/**
 * Returns whether a value (as received in a DocAction) represents a reference to a record.
 */
export function isReference(value: CellValue): value is [GristObjCode.Reference, string, number] {
  return Array.isArray(value) && value[0] === GristObjCode.Reference;
}

/**
 * Returns whether a value (as received in a DocAction) represents a reference list (RecordSet).
 */
export function isReferenceList(value: CellValue): value is [GristObjCode.ReferenceList, string, number[]] {
  return Array.isArray(value) && value[0] === GristObjCode.ReferenceList;
}

/**
 * Returns whether a value (as received in a DocAction) represents a reference or reference list.
 */
export function isReferencing(value: CellValue):
  value is [GristObjCode.ReferenceList|GristObjCode.Reference, string, number[]|number]
{
  return Array.isArray(value) &&
    (value[0] === GristObjCode.ReferenceList || value[0] === GristObjCode.Reference);
}

/**
 * Returns whether a value (as received in a DocAction) represents a list or is null,
 * which is a valid value for list types in grist.
 */
export function isListOrNull(value: CellValue): boolean {
  return value === null || isList(value);
}

/**
 * Returns whether a value (as received in a DocAction) represents an empty list.
 */
export function isEmptyList(value: CellValue): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === GristObjCode.List;
}

function isNumber(v: CellValue) { return typeof v === 'number' || typeof v === 'boolean'; }
function isNumberOrNull(v: CellValue) { return isNumber(v) || v === null; }
function isBoolean(v: CellValue) { return typeof v === 'boolean' || v === 1 || v === 0; }

// These values are not regular cell values, even in a column of type Any.
const abnormalValueTypes: string[] = [GristObjCode.Exception, GristObjCode.Pending, GristObjCode.Skip,
                                      GristObjCode.Unmarshallable, GristObjCode.Versions];

function isNormalValue(value: CellValue) {
  return !abnormalValueTypes.includes(getObjCode(value)!);
}

/**
 * Map of Grist type to an "isRightType" checker function, which determines if a given values type
 * matches the declared type of the column.
 */
const rightType: {[key in GristType]: (value: CellValue) => boolean} = {
  Any:            isNormalValue,
  Attachments:    isListOrNull,
  Text:           isString,
  Blob:           isString,
  Int:            isNumberOrNull,
  Bool:           isBoolean,
  Date:           isNumberOrNull,
  DateTime:       isNumberOrNull,
  Numeric:        isNumberOrNull,
  Id:             isNumber,
  PositionNumber: isNumber,
  ManualSortPos:  isNumber,
  Ref:            isNumber,
  RefList:        isListOrNull,
  Choice:         (v: CellValue, options?: any) => {
    // TODO widgets options should not be used outside of the client. They are an instance of
    // modelUtil.jsonObservable, passed in by FieldBuilder.
    if (v === '') {
      // Accept empty-string values as valid
      return true;
    } else if (options) {
      const choices = options().choices;
      return Array.isArray(choices) && choices.includes(v);
    } else {
      return false;
    }
  },
  ChoiceList:     isListOrNull,
};

export function isRightType(type: string): undefined | ((value: CellValue, options?: any) => boolean) {
  return rightType[type as GristType];
}

export function extractTypeFromColType(type: string): string {
  if (!type) { return type; }
  const colon = type.indexOf(':');
  return (colon === -1 ? type : type.slice(0, colon));
}

/**
 * Convert pureType to Grist python type name, e.g. 'Ref' to 'Reference'.
 */
export function getGristType(pureType: string): string {
  switch (pureType) {
    case 'Ref': return 'Reference';
    case 'RefList': return 'ReferenceList';
    default: return pureType;
  }
}

/**
 * Enum for values of columns' recalcWhen property, corresponding to Python definitions in
 * schema.py.
 */
export enum RecalcWhen {
  DEFAULT = 0,         // Calculate on new records or when any field in recalcDeps changes.
  NEVER = 1,           // Don't calculate automatically (but user can trigger manually)
  MANUAL_UPDATES = 2,  // Calculate on new records and on manual updates to any data field.
}


/**
 * Converts SQL type strings produced by the Sequelize library into its corresponding
 * Grist type. The list of types is based on an analysis of SQL type string outputs
 * produced by the Sequelize library (mostly covered in lib/data-types.js). Some
 * additional engine/dialect specific types are detailed in dialect directories.
 *
 * TODO: A handful of exotic SQL types (mostly from PostgreSQL) will currently throw an
 * Error, rather than returning a type. Further testing is required to determine
 * whether Grist can manage those data types.
 *
 * @param  {String} sqlType A string produced by Sequelize's describeTable query
 * @return {String}         The corresponding Grist type string
 * @throws {Error}          If the sqlType is unrecognized or unsupported
 */
export function sequelizeToGristType(sqlType: string): GristType {
  // Sequelize type strings can include parens (e.g., `CHAR(10)`). This function
  // ignores those additional details when determining the Grist type.
  let endMarker = sqlType.length;
  const parensMarker = sqlType.indexOf('(');
  endMarker = parensMarker > 0 ? parensMarker : endMarker;

  // Type strings might also include a space after the basic type description.
  // The type `DOUBLE PRECISION` is one such example, but modifiers or attributes
  // relevant to the type might also appear after the type itself (e.g., UNSIGNED,
  // NONZERO). These are ignored when determining the Grist type.
  const spaceMarker = sqlType.indexOf(' ');
  endMarker = spaceMarker > 0 && spaceMarker < endMarker ? spaceMarker : endMarker;

  switch (sqlType.substring(0, endMarker)) {
    case 'INTEGER':
    case 'BIGINT':
    case 'SMALLINT':
    case 'INT':
      return 'Int';
    case 'NUMBER':
    case 'FLOAT':
    case 'DECIMAL':
    case 'NUMERIC':
    case 'REAL':
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
      return 'Numeric';
    case 'BOOLEAN':
    case 'TINYINT':
      return 'Bool';
    case 'STRING':
    case 'CHAR':
    case 'TEXT':
    case 'UUID':
    case 'UUIDV1':
    case 'UUIDV4':
    case 'VARCHAR':
    case 'NVARCHAR':
    case 'TINYTEXT':
    case 'MEDIUMTEXT':
    case 'LONGTEXT':
    case 'ENUM':
      return 'Text';
    case 'TIME':
    case 'DATE':
    case 'DATEONLY':
    case 'DATETIME':
    case 'NOW':
      return 'Text';
    case 'BLOB':
    case 'TINYBLOB':
    case 'MEDIUMBLOB':
    case 'LONGBLOB':
      // TODO: Passing binary data to the Sandbox is throwing Errors. Proper support
      // for these Blob data types requires some more investigation.
      throw new Error('SQL type: `' + sqlType + '` is currently unsupported');
    case 'NONE':
    case 'HSTORE':
    case 'JSON':
    case 'JSONB':
    case 'VIRTUAL':
    case 'ARRAY':
    case 'RANGE':
    case 'GEOMETRY':
      throw new Error('SQL type: `' + sqlType + '` is currently untested');
    default:
      throw new Error('Unrecognized datatype: `' + sqlType + '`');
  }
}

export function getReferencedTableId(type: string) {
  return removePrefix(type, "Ref:") || removePrefix(type, "RefList:");
}

export function isRefListType(type: string) {
  return type.startsWith('RefList:');
}

export function isFullReferencingType(type: string) {
  return type.startsWith('Ref:') || isRefListType(type);
}
