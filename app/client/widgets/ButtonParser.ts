import { UserAction } from "app/common/DocActions";
import { CellValue, GristObjCode } from "app/plugin/GristData";

export interface ButtonDefinition {
  label: string;
  actions: UserAction[];
}

function listItems(value: CellValue): CellValue[] | null {
  if (!Array.isArray(value)) { return null; }
  if (value[0] === GristObjCode.List) { return value.slice(1) as CellValue[]; }
  if (typeof value[0] === "string" &&
      Object.values(GristObjCode).includes(value[0] as GristObjCode)) {
    return null;
  }
  return value as CellValue[];
}

function dictEntries(value: CellValue): Record<string, CellValue> | null {
  if (Array.isArray(value) && value[0] === GristObjCode.Dict) {
    const entries = value[1];
    return entries && typeof entries === "object" && !Array.isArray(entries) ?
      entries as Record<string, CellValue> : null;
  }
  return value && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, CellValue> : null;
}

export function parseButtonDefinitions(value: CellValue): ButtonDefinition[] | null {
  if (value === "") { return []; }
  const definitions = listItems(value);
  if (!definitions) { return null; }

  const result: ButtonDefinition[] = [];
  for (const definition of definitions) {
    const fields = dictEntries(definition);
    const label = fields?.button;
    const actionValues = fields?.actions && listItems(fields.actions);
    if (typeof label !== "string" || !label.trim() || !actionValues) { return null; }

    const actions: UserAction[] = [];
    for (const actionValue of actionValues) {
      const parts = listItems(actionValue);
      if (!parts || typeof parts[0] !== "string") { return null; }
      const action: UserAction = [parts[0], ...parts.slice(1, 3)];
      if (parts[3] !== undefined) {
        action.push(dictEntries(parts[3]) ?? parts[3]);
      }
      action.push(...parts.slice(4));
      actions.push(action);
    }
    result.push({ label, actions });
  }
  return result;
}
