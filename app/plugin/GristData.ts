// Letter codes for CellValue types encoded as [code, args...] tuples.
export const enum GristObjCode {
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

export type CellValue = number|string|boolean|null|[GristObjCode, ...unknown[]];

export interface RowRecord {
  id: number;
  [colId: string]: CellValue;
}
