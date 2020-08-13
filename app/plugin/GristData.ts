export type CellValue = number|string|boolean|null|[string, any?];

export interface RowRecord {
  id: number;
  [colId: string]: CellValue;
}
