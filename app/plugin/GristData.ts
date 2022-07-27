/**
 * Letter codes for CellValue types encoded as [code, args...] tuples.
 */
export enum GristObjCode {
  List            = 'L',
  LookUp          = 'l',
  Dict            = 'O',
  DateTime        = 'D',
  Date            = 'd',
  Skip            = 'S',
  Censored        = 'C',
  Reference       = 'R',
  ReferenceList   = 'r',
  Exception       = 'E',
  Pending         = 'P',
  Unmarshallable  = 'U',
  Versions        = 'V',
}

/**
 * Possible types of cell content.
 */
export type CellValue = number|string|boolean|null|[GristObjCode, ...unknown[]];
export interface BulkColValues { [colId: string]: CellValue[]; }

/**
 * Map of column ids to `CellValue`s.
 *
 * ### CellValue
 *
 * Each `CellValue` may either be a primitive (e.g. `true`, `123`, `"hello"`, `null`)
 * or a tuple (JavaScript Array) representing a Grist object. The first element of the tuple
 * is a string character representing the object code. For example, `["L", "foo", "bar"]`
 * is a `CellValue` of a Choice List column, where `"L"` is the type, and `"foo"` and
 * `"bar"` are the choices.
 *
 * ### Grist Object Types
 *
 * | Code | Type           |
 * | ---- | -------------- |
 * | L    | List           |
 * | l    | LookUp         |
 * | O    | Dict           |
 * | D    | DateTime       |
 * | d    | Date           |
 * | C    | Censored       |
 * | R    | Reference      |
 * | r    | ReferenceList  |
 * | E    | Exception      |
 * | P    | Pending        |
 * | U    | Unmarshallable |
 * | V    | Version        |
 */
export interface RowRecord {
  id: number;
  [colId: string]: CellValue;
}

/**
 * Map of column ids to `CellValue` arrays, where array indexes correspond to
 * rows.
 *
 * ### CellValue
 *
 * Each `CellValue` may either be a primitive (e.g. `true`, `123`, `"hello"`, `null`)
 * or a tuple (JavaScript Array) representing a Grist object. The first element of the tuple
 * is a string character representing the object code. For example, `["L", "foo", "bar"]`
 * is a `CellValue` of a Choice List column, where `"L"` is the type, and `"foo"` and
 * `"bar"` are the choices.
 *
 * ### Grist Object Types
 *
 * | Code | Type           |
 * | ---- | -------------- |
 * | L    | List           |
 * | l    | LookUp         |
 * | O    | Dict           |
 * | D    | DateTime       |
 * | d    | Date           |
 * | C    | Censored       |
 * | R    | Reference      |
 * | r    | ReferenceList  |
 * | E    | Exception      |
 * | P    | Pending        |
 * | U    | Unmarshallable |
 * | V    | Version        |
 */
export interface RowRecords {
  id: number[];
  [colId: string]: CellValue[];
}

export type GristType = 'Any' | 'Attachments' | 'Blob' | 'Bool' | 'Choice' | 'ChoiceList' |
  'Date' | 'DateTime' |
  'Id' | 'Int' | 'ManualSortPos' | 'Numeric' | 'PositionNumber' | 'Ref' | 'RefList' | 'Text';
