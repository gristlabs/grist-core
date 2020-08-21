export type CellValue = number|string|boolean|null|[string, ...unknown[]];

export interface RowRecord {
  id: number;
  [colId: string]: CellValue;
}
