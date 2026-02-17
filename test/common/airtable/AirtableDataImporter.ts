import { AirtableTableId } from "app/common/airtable/AirtableAPITypes";
import {
  AirtableBaseSchemaCrosswalk,
  AirtableTableCrosswalk, GristTableId,
} from "app/common/airtable/AirtableCrosswalk";
import { importDataFromAirtableBase } from "app/common/airtable/AirtableDataImporter";
import { AirtableDataImportParams } from "app/common/airtable/AirtableDataImporterTypes";
import { ReferenceTracker } from "app/common/airtable/AirtableReferenceTracker";
import { AirtableIdColumnLabel } from "app/common/airtable/AirtableSchemaImporter";
import { ExistingColumnSchema } from "app/common/DocSchemaImportTypes";
import { BulkColValues, GristObjCode } from "app/plugin/GristData";

import Airtable from "airtable";
import { assert } from "chai";
import { sum } from "lodash";
import * as sinon from "sinon";

describe("AirtableDataImporter", function() {
  const basicCrosswalkFields = [
    {
      airtableField: { id: "fld0", name: "Name", type: "singleLineText" as const, options: {} },
      gristColumn: { id: "Name", ref: 100, label: "Name", isFormula: false },
    },
    {
      airtableField: { id: "fld1", name: "Count", type: "number" as const, options: {} },
      gristColumn: { id: "Count", ref: 101, label: "Count", isFormula: true },
    },
    {
      airtableField: { id: "fld2", name: "Formula", type: "formula" as const, options: {} },
      gristColumn: { id: "Formula", ref: 102, label: "Formula", isFormula: true },
    },
    {
      airtableField: { id: "fld3", name: "Links", type: "multipleRecordLinks" as const, options: {} },
      gristColumn: { id: "Links", ref: 103, label: "Links", isFormula: false },
    },
    {
      airtableField: { id: "fld4", name: "AiField", type: "aiText" as const, options: {} },
      gristColumn: { id: "AiField", ref: 104, label: "AiField", isFormula: false },
    },
    {
      airtableField: { id: "fld5", name: "CreatedBy", type: "createdBy" as const, options: {} },
      gristColumn: { id: "CreatedBy", ref: 105, label: "CreatedBy", isFormula: false },
    },
    {
      airtableField: { id: "fld6", name: "ModifiedBy", type: "lastModifiedBy" as const, options: {} },
      gristColumn: { id: "ModifiedBy", ref: 106, label: "ModifiedBy", isFormula: false },
    },
    {
      airtableField: { id: "fld7", name: "Collaborators", type: "multipleCollaborators" as const, options: {} },
      gristColumn: { id: "Collaborators", ref: 107, label: "Collaborators", isFormula: false },
    },
    {
      airtableField: { id: "fld8", name: "SingleCollaborator", type: "singleCollaborator" as const, options: {} },
      gristColumn: { id: "SingleCollaborator", ref: 108, label: "SingleCollaborator", isFormula: false },
    },
    {
      airtableField: { id: "fld9", name: "MultipleSelects", type: "multipleSelects" as const, options: {} },
      gristColumn: { id: "MultipleSelects", ref: 109, label: "MultipleSelects", isFormula: false },
    },
    {
      airtableField: { id: "fld10", name: "Rollup", type: "rollup" as const, options: {} },
      gristColumn: { id: "Rollup", ref: 110, label: "Rollup", isFormula: true },
    },
    {
      airtableField: { id: "fld11", name: "Lookup", type: "lookup" as const, options: {} },
      gristColumn: { id: "Lookup", ref: 111, label: "Lookup", isFormula: true },
    },
  ];

  function createBasicTableCrosswalk(airtableTableId: string, gristTableId: string): AirtableTableCrosswalk {
    const fields: AirtableTableCrosswalk["fields"] = new Map();
    const gristColumns: ExistingColumnSchema[] = [];
    const airtableFields: any[] = [];

    for (const fieldPair of basicCrosswalkFields) {
      airtableFields.push(fieldPair.airtableField);
      gristColumns.push(fieldPair.gristColumn);
      fields.set(fieldPair.airtableField.name, fieldPair);
    }

    const airtableIdColumn = { id: "Airtable_Id", ref: 111, label: AirtableIdColumnLabel, isFormula: false };
    gristColumns.push(airtableIdColumn);

    return {
      airtableTable: { id: airtableTableId, name: gristTableId, primaryFieldId: "fld0", fields: airtableFields },
      gristTable: { id: gristTableId, ref: 1, columns: gristColumns },
      fields,
      airtableIdColumn,
    };
  }

  function createBasicSchemaCrosswalk(tableIdPairs: [AirtableTableId, GristTableId][]): AirtableBaseSchemaCrosswalk {
    return {
      tables: new Map(tableIdPairs.map(
        ([airtableTableId, gristTableId]) =>
          [airtableTableId, createBasicTableCrosswalk(airtableTableId, gristTableId)],
      )),
    };
  }

  const addRowsMock =
    sinon.fake(async (tableId, rows) => {
      const key = Object.keys(rows)[0];
      const values: any[] | undefined = rows[key];
      if (!values) {
        return Promise.resolve([]);
      }

      const lastIds = await addRowsMock.lastCall.returnValue ?? [0];
      const maxId = Math.max(...lastIds);

      const newIds = values.map((_, index) => maxId + 1 + index);

      return Promise.resolve(newIds);
    }) satisfies AirtableDataImportParams["addRows"];

  const updateRowsMock =
    sinon.fake((tableId, rows) => Promise.resolve(rows.id)) satisfies AirtableDataImportParams["updateRows"];

  const uploadAttachmentMock = sinon.fake((value: string | Blob, filename?: string) =>
    Promise.resolve(1)) satisfies AirtableDataImportParams["uploadAttachment"];

  afterEach(function() {
    sinon.reset();
  });

  describe("ReferenceTracker", () => {
    it("stores and retrieves mappings from original record id to Grist record id", () => {
      const tracker = new ReferenceTracker();

      tracker.addRecordIdMapping("airtable-rec-1", 42);
      tracker.addRecordIdMapping("airtable-rec-2", 99);

      assert.equal(tracker.resolve("airtable-rec-1"), 42);
      assert.equal(tracker.resolve("airtable-rec-2"), 99);
    });

    it("returns undefined for unknown record ids", () => {
      const tracker = new ReferenceTracker();

      assert.isUndefined(tracker.resolve("unknown-rec-id"));
    });
  });

  describe("TableReferenceTracker.bulkUpdateRowsWithUnresolvedReferences", () => {
    it("resolves reference updates correctly", async () => {
      const tracker = new ReferenceTracker();

      tracker.addRecordIdMapping("airtable-rec-1", 10);
      tracker.addRecordIdMapping("airtable-rec-2", 20);
      tracker.addRecordIdMapping("airtable-rec-3", 30);
      tracker.addRecordIdMapping("airtable-food-1", 101);
      tracker.addRecordIdMapping("airtable-food-2", 102);

      const tableTracker = tracker.addTable("country", ["cities", "foods"]);

      tableTracker.addUnresolvedRecord({
        gristRecordId: 1,
        refsByColumnId: {
          cities: ["airtable-rec-1", "airtable-rec-2"],
          foods: ["airtable-food-1", "airtable-food-2"],
        },
      });

      tableTracker.addUnresolvedRecord({
        gristRecordId: 2,
        refsByColumnId: {
          cities: ["airtable-rec-3"],
          // Omit foods - make sure undefined reference values are handled correctly
        },
      });

      await tableTracker.bulkUpdateRowsWithUnresolvedReferences(updateRowsMock);

      const call = updateRowsMock.getCall(0);
      assert.equal(call.args[0], "country");

      const updates = call.args[1];
      assert.deepEqual(updates, {
        id: [1, 2],
        cities: [
          [GristObjCode.List, 10, 20],
          [GristObjCode.List, 30],
        ],
        foods: [
          [GristObjCode.List, 101, 102],
          [GristObjCode.List],
        ],
      });
    });

    it("skips unresolvable references without error", async () => {
      const tracker = new ReferenceTracker();

      tracker.addRecordIdMapping("airtable-rec-1", 10);

      const tableTracker = tracker.addTable("users", ["friends"]);

      // Reference to an unmapped record
      tableTracker.addUnresolvedRecord({
        gristRecordId: 1,
        refsByColumnId: {
          friends: ["airtable-rec-1", "airtable-rec-unknown"],
        },
      });

      await tableTracker.bulkUpdateRowsWithUnresolvedReferences(updateRowsMock);

      const call = updateRowsMock.getCall(0);
      const updates = call.args[1];

      // Only the resolvable reference should be included
      assert.deepEqual(updates.friends, [[GristObjCode.List, 10]]);
    });

    it("handles batch updates with default batch size", async () => {
      const tracker = new ReferenceTracker();

      tracker.addRecordIdMapping("airtable-rec-1", 10);
      const tableTracker = tracker.addTable("users", ["col1"]);

      // Add more than default batch size (100) records
      for (let i = 0; i < 150; i++) {
        tableTracker.addUnresolvedRecord({
          gristRecordId: i + 1,
          refsByColumnId: { col1: ["airtable-rec-1"] },
        });
      }

      await tableTracker.bulkUpdateRowsWithUnresolvedReferences(updateRowsMock);

      // Should be called twice: once for first 100, once for remaining 50
      assert.equal(updateRowsMock.callCount, 2);

      const firstCall = updateRowsMock.getCall(0);
      const firstUpdates = firstCall.args[1];
      assert.equal(firstUpdates.id.length, 100);

      const secondCall = updateRowsMock.getCall(1);
      const secondUpdates = secondCall.args[1];
      assert.equal(secondUpdates.id.length, 50);
    });

    it("respects custom batch size option", async () => {
      const tracker = new ReferenceTracker();

      tracker.addRecordIdMapping("airtable-rec-1", 10);
      const tableTracker = tracker.addTable("users", ["col1"]);

      // Add 25 records
      for (let i = 0; i < 25; i++) {
        tableTracker.addUnresolvedRecord({
          gristRecordId: i + 1,
          refsByColumnId: { col1: ["airtable-rec-1"] },
        });
      }

      await tableTracker.bulkUpdateRowsWithUnresolvedReferences(
        updateRowsMock,
        { batchSize: 10 },
      );

      // Should be called 3 times: 10, 10, 5
      assert.equal(updateRowsMock.callCount, 3);
    });

    it("does not update if there are no unresolved records", async () => {
      const tracker = new ReferenceTracker();
      const tableTracker = tracker.addTable("users", ["friends"]);

      const updateRowsMock = sinon.stub().resolves([]);

      await tableTracker.bulkUpdateRowsWithUnresolvedReferences(updateRowsMock);

      assert.isFalse(updateRowsMock.called);
    });
  });

  describe("importDataFromAirtableBase", () => {
    it("calls addRows for each table with converted field values", async () => {
      const mockRecord = {
        id: "rec123",
        fields: {
          Name: "Test Name",
          Count: 42,
        },
      };

      const listRecords = createListRecordsFake(new Map([["tblMain", [mockRecord]]]));

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      assert.isTrue(addRowsMock.called);
      const call = addRowsMock.getCall(0);
      assert.equal(call.args[0], "Main");
      assert.deepEqual(
        call.args[1],
        getBulkColSyntaxForRecords(schemaCrosswalk.tables.get("tblMain")!, [mockRecord]));
    });

    it("excludes formula columns from import", async () => {
      const mockRecord = {
        id: "rec123",
        fields: {
          Name: "Test",
          Formula: "should be ignored",
          Rollup: "some value",
          Count: 42,
          Lookup: ["value1", "value2"],
        },
      };

      const listRecords = createListRecordsFake(new Map([["tblMain", [mockRecord]]]));

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      const call = addRowsMock.getCall(0);
      const bulkColValues = call.args[1];
      assert.notProperty(bulkColValues, "Formula");
      assert.notProperty(bulkColValues, "Count");
      assert.notProperty(bulkColValues, "Rollup");
      assert.notProperty(bulkColValues, "Lookup");
      assert.property(bulkColValues, "Name");
    });

    async function testAirtableIdColumn(params = { omitAirtableId: false }) {
      const mockRecord = {
        id: "rec999",
        fields: {
          Name: "Test",
        },
      };

      const listRecords = createListRecordsFake(new Map([["tblMain", [mockRecord]]]));

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);
      if (params.omitAirtableId) {
        schemaCrosswalk.tables.get("tblMain")!.airtableIdColumn = undefined;
      }

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      const call = addRowsMock.getCall(0);
      return call.args[1];
    }

    it("stores airtable id when airtableIdColumn is configured", async () => {
      const bulkColValues = await testAirtableIdColumn({ omitAirtableId: false });
      assert.deepEqual(bulkColValues.Airtable_Id, ["rec999"], "Airtable ID column data missing");
    });

    it("skips airtable id when airtableIdColumn is missing", async () => {
      const bulkColValues = await testAirtableIdColumn({ omitAirtableId: true });
      assert.isUndefined(bulkColValues.Airtable_Id, "Airtable ID column present when it shouldn't be");
    });

    it("handles multipleRecordLinks references and defers resolution", async () => {
      const mockRecords = [
        {
          id: "recA",
          fields: {
            Name: "Test",
            Links: ["recC", "recB"],
          },
        },
        {
          id: "recB",
          fields: {},
        },
        {
          id: "recC",
          fields: {},
        },
      ];

      const listRecords = createListRecordsFake(new Map([["tblMain", mockRecords]]));

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      // First add rows with links as null
      const addRowsCall = addRowsMock.getCall(0);
      const initialBulkValues = addRowsCall.args[1];
      assert.deepEqual(initialBulkValues.Links, [null, null, null]);

      // Update rows with resolved links
      assert.isTrue(updateRowsMock.called);
      const updateCall = updateRowsMock.getCall(0);
      const updates = updateCall.args[1];
      // Row IDs are created incrementally starting at 1 - so the two referenced rows have 2 and 3.
      assert.deepEqual(updates.Links, [[GristObjCode.List, 3, 2], [GristObjCode.List], [GristObjCode.List]]);
    });

    it("handles multiple pages of records", async () => {
      const mockRecords = [
        { id: "rec1", fields: { Name: "Alice" } },
        { id: "rec2", fields: { Name: "Bob" } },
        { id: "rec3", fields: { Name: "Charlie" } },
        { id: "rec4", fields: { Name: "Diana" } },
        { id: "rec5", fields: { Name: "Eve" } },
        { id: "rec6", fields: { Name: "Frank" } },
        { id: "rec7", fields: { Name: "Grace" } },
        { id: "rec8", fields: { Name: "Hank" } },
        { id: "rec9", fields: { Name: "Ivy" } },
        { id: "rec10", fields: { Name: "Jack" } },
      ];

      const listRecords = createListRecordsFake(new Map([["tblMain", mockRecords]]), { pageSize: 3 });

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      // Expect 4 pages - 3 pages of 3, and 1 of 1.
      assert.equal(addRowsMock.callCount, 4);
      const totalRows = sum(addRowsMock.getCalls().map(call => call.args[1].Name.length));
      // Expect all rows to have been added.
      assert.equal(totalRows, 10);
    });

    async function testFieldValueConversion(fieldName: string, fieldValue: any) {
      sinon.reset();

      const mockRecord: AirtableRecordKeyFieldsOnly = {
        id: "rec123",
        fields: {},
      };

      mockRecord.fields[fieldName] = fieldValue;

      const listRecords = createListRecordsFake(new Map([["tblMain", [mockRecord]]]));
      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      const call = addRowsMock.getCall(0);
      const bulkColValues = call.args[1];
      const colId = schemaCrosswalk.tables.get("tblMain")!.fields.get(fieldName)!.gristColumn.id;
      if (bulkColValues[colId] === undefined) {
        throw new Error("Expected column not in addRows call");
      }
      return bulkColValues[colId][0];
    }

    it("converts aiText fields correctly", async () => {
      const value1 = await testFieldValueConversion("AiField", { value: "Generated text" });
      assert.equal(value1, "Generated text");

      const value2 = await testFieldValueConversion("AiField", undefined);
      assert.isNull(value2);
    });

    it("converts createdBy fields correctly", async () => {
      const value1 = await testFieldValueConversion("CreatedBy", { name: "Alice", email: "alice@example.com" });
      assert.equal(value1, "Alice");

      const value2 = await testFieldValueConversion("CreatedBy", { name: "Bob" });
      assert.equal(value2, "Bob");

      const value3 = await testFieldValueConversion("CreatedBy", undefined);
      assert.isNull(value3);
    });

    it("converts lastModifiedBy fields correctly", async () => {
      const value1 = await testFieldValueConversion("ModifiedBy", { name: "Charlie", email: "charlie@example.com" });
      assert.equal(value1, "Charlie");

      const value2 = await testFieldValueConversion("ModifiedBy", undefined);
      assert.isNull(value2);
    });

    it("converts singleCollaborator fields correctly", async () => {
      const value1 = await testFieldValueConversion("SingleCollaborator", { name: "Diana" });
      assert.equal(value1, "Diana");

      const value2 = await testFieldValueConversion("SingleCollaborator", undefined);
      assert.isNull(value2);
    });

    it("converts multipleCollaborators fields correctly", async () => {
      const value1 = await testFieldValueConversion("Collaborators", [
        { name: "Eve" },
        { name: "Frank" },
      ]);
      assert.equal(value1, "Eve, Frank");

      const value2 = await testFieldValueConversion("Collaborators", [{ name: "Grace" }]);
      assert.equal(value2, "Grace");

      const value3 = await testFieldValueConversion("Collaborators", undefined);
      assert.isNull(value3);

      const value4 = await testFieldValueConversion("Collaborators", []);
      assert.equal(value4, "");
    });

    it("converts multipleSelects fields correctly", async () => {
      const value1 = await testFieldValueConversion("MultipleSelects", ["Option1", "Option2"]);
      assert.deepEqual(value1, [GristObjCode.List, "Option1", "Option2"]);

      const value2 = await testFieldValueConversion("MultipleSelects", ["Single"]);
      assert.deepEqual(value2, [GristObjCode.List, "Single"]);

      const value3 = await testFieldValueConversion("MultipleSelects", undefined);
      assert.isNull(value3);

      const value4 = await testFieldValueConversion("MultipleSelects", []);
      assert.deepEqual(value4, [GristObjCode.List]);
    });

    it("skips count field data conversion because it's a formula column", async () => {
      await assert.isRejected(
        testFieldValueConversion("Count", 42),
        "Expected column not in addRows call",
      );
    });

    it("skips formula field data conversion because it's a formula column", async () => {
      await assert.isRejected(
        testFieldValueConversion("Formula", "computed result"),
        "Expected column not in addRows call",
      );
    });

    it("skips lookup field data conversion because it's a formula column", async () => {
      await assert.isRejected(
        testFieldValueConversion("Lookup", ["value1", "value2"]),
        "Expected column not in addRows call",
      );
    });

    it("skips rollup field data conversion because it's a formula column", async () => {
      await assert.isRejected(
        testFieldValueConversion("Rollup", {}),
        "Expected column not in addRows call",
      );
    });

    it("preserves the values of fields without explicit converters", async () => {
      const value1 = await testFieldValueConversion("Name", "Plain text");
      assert.equal(value1, "Plain text");

      const value2 = await testFieldValueConversion("Name", 42);
      assert.equal(value2, 42);

      const value3 = await testFieldValueConversion("Name", [GristObjCode.List, 1]);
      assert.deepEqual(value3, [GristObjCode.List, 1]);

      const value4 = await testFieldValueConversion("Name", undefined);
      assert.isNull(value4);
    });

    it("uses null for crosswalk fields without values in the record", async () => {
      const mockRecord = {
        id: "rec123",
        fields: {
        },
      };

      const listRecords = createListRecordsFake(new Map([["tblMain", [mockRecord]]]));

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      await importDataFromAirtableBase({
        listRecords,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      const call = addRowsMock.getCall(0);
      const bulkColValues = call.args[1];
      assert.deepEqual(bulkColValues.Name, [null]);
      assert.deepEqual(bulkColValues.CreatedBy, [null]);
    });

    it("propagates errors thrown from listRecords", async () => {
      const listRecords = () => {
        throw new Error("Airtable API error");
      };

      const schemaCrosswalk = createBasicSchemaCrosswalk([["tblMain", "Main"]]);

      try {
        await importDataFromAirtableBase({
          listRecords,
          addRows: addRowsMock,
          updateRows: updateRowsMock,
          uploadAttachment: uploadAttachmentMock,
          schemaCrosswalk,
        });
        assert.fail("Should have thrown");
      } catch (e: any) {
        assert.equal(e.message, "Airtable API error");
      }
    });

    it("handles an empty base without errors", async () => {
      const schemaCrosswalk: AirtableBaseSchemaCrosswalk = {
        tables: new Map(),
      };

      const listEmptyResult = () => Promise.resolve({
        records: [],
        hasMoreRecords: false,
        fetchNextPage: listEmptyResult,
      });

      // Should not throw
      await importDataFromAirtableBase({
        listRecords: listEmptyResult,
        addRows: addRowsMock,
        updateRows: updateRowsMock,
        uploadAttachment: uploadAttachmentMock,
        schemaCrosswalk,
      });

      assert.isFalse(addRowsMock.called);
      assert.isFalse(updateRowsMock.called);
    });
  });
});

type AirtableRecordKeyFieldsOnly = Pick<Airtable.Record<any>, "id" | "fields">;

// Converts Airtable records into the expected bulk-column syntax
function getBulkColSyntaxForRecords(tableCrosswalk: AirtableTableCrosswalk, records: AirtableRecordKeyFieldsOnly[]) {
  const fieldMappings = Array.from(tableCrosswalk.fields.values()).filter(mapping => !mapping.gristColumn.isFormula);
  const bulkCol: BulkColValues = {};

  for (const fieldMapping of fieldMappings) {
    bulkCol[fieldMapping.gristColumn.id] = [];
  }

  if (tableCrosswalk.airtableIdColumn) {
    bulkCol[tableCrosswalk.airtableIdColumn.id] = [];
  }

  for (const record of records) {
    for (const fieldMapping of fieldMappings) {
      const bulkValues = bulkCol[fieldMapping.gristColumn.id];
      bulkValues.push(record.fields[fieldMapping.airtableField.name] ?? null);
    }

    if (tableCrosswalk.airtableIdColumn) {
      const bulkValues = bulkCol[tableCrosswalk.airtableIdColumn.id];
      bulkValues.push(record.id);
    }
  }
  return bulkCol;
}

function createListRecordsFake(
  data: Map<string, Pick<Airtable.Record<any>, "id" | "fields">[]>,
  { pageSize } = { pageSize: 100 },
): AirtableDataImportParams["listRecords"]  {
  return function(tableId: string) {
    if (!data.has(tableId)) {
      throw new Error("TableId is not valid - table does not exist in fake data");
    }
    function doListing(offset: number = 0) {
      const tableRecords = data.get(tableId)!;
      return Promise.resolve({
        // Cast to prevent us having to create a full Airtable.Record instance. Any issues should show in tests.
        records: tableRecords.slice(offset, offset + pageSize) as unknown as Airtable.Records<any>,
        hasMoreRecords: tableRecords.length > offset + pageSize,
        fetchNextPage: () => doListing(offset + pageSize),
      });
    }
    return doListing();
  };
}
