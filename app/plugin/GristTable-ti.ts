import * as t from "ts-interface-checker";
// tslint:disable:object-literal-key-quotes

export const GristTable = t.iface([], {
  "table_name": t.union("string", "null"),
  "column_metadata": t.array("GristColumn"),
  "table_data": t.array(t.array("any")),
});

export const GristTables = t.iface([], {
  "tables": t.array("GristTable"),
});

export const GristColumn = t.iface([], {
  "id": "string",
  "type": "string",
});

const exportedTypeSuite: t.ITypeSuite = {
  GristTable,
  GristTables,
  GristColumn,
};
export default exportedTypeSuite;
