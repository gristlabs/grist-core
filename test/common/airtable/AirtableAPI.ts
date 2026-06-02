import { listRecords } from "app/common/airtable/AirtableAPI";

import Airtable from "airtable";
import { assert } from "chai";
import * as sinon from "sinon";

describe("AirtableAPI", () => {
  interface RawRecord {
    id: string;
    fields: Airtable.FieldSet;
  }

  describe("listRecords", () => {
    function makeFakedListRecordsBase(records: RawRecord[]) {
      return Object.assign(
        new Airtable({ apiKey: "AnyOldKey" }).base(""),
        { makeRequest: makeListRecordsRequestFake(records) },
      );
    }

    function makeListRecordsRequestFake(records: RawRecord[]) {
      type MakeRequest = Airtable.Base["makeRequest"];
      return sinon.fake((...params: NonNullable<Parameters<MakeRequest>>): ReturnType<MakeRequest> => {
        const qs = params[0]?.qs ?? {};
        const offset = Number.parseInt((qs.offset ?? "itr0").replace("itr", ""));
        const pageSize = qs.pageSize ?? 100;
        const hasMore = offset + pageSize < records.length;

        return Promise.resolve({
          headers: new Headers(),
          statusCode: 200,
          body: {
            records: records.slice(offset, pageSize + offset),
            // Airtable uses string offsets, replicate it here.
            offset: hasMore ? `itr${offset + pageSize}` : undefined,
          },
        });
      });
    }

    it("can request a page of records from the correct API endpoint", async () => {
      const mockRecords = [
        { id: "rec1", fields: { Name: "Alice" } },
        { id: "rec2", fields: { Name: "Bob" } },
      ];

      const mockBase = makeFakedListRecordsBase(mockRecords);

      const result = await listRecords(mockBase, "TestTable", {});

      assert.equal(result.records.length, 2);
      assert.isFalse(result.hasMoreRecords);
      assert.equal((await result.fetchNextPage()).records.length, 0);

      // Verify the request was made correctly
      const call = mockBase.makeRequest.getCall(0);
      assert.equal(call.args[0]?.method, "GET");
      assert.equal(call.args[0]?.path, "/TestTable");
      assert.isUndefined(call.args[0]?.qs?.offset);
    });

    it("sends query parameters to the Airtable API", async () => {
      const mockRecords = [
        { id: "rec1", fields: { Name: "Alice" } },
      ];

      const mockBase = makeFakedListRecordsBase(mockRecords);

      const params = {
        fields: ["Name", "Email"],
        filterByFormula: "{Name}='Alice'",
        maxRecords: 10,
      };

      await listRecords(mockBase, "TestTable", params);

      const call = mockBase.makeRequest.getCall(0);
      assert.deepInclude(call.args[0]?.qs, params);
    });

    it("correctly encodes table names with special characters", async () => {
      const mockBase = makeFakedListRecordsBase([]);

      await listRecords(mockBase, "My Table With Spaces", {});

      const call = mockBase.makeRequest.getCall(0);
      assert.equal(call.args[0]?.path, "/My%20Table%20With%20Spaces");
    });

    it("indicates when there are more records to fetch", async () => {
      const mockRecords = Array.from({ length: 3 }, (_, i) => ({
        id: `rec${i}`,
        fields: { Name: `User${i}` },
      }));

      const mockBase = makeFakedListRecordsBase(mockRecords);

      const result = await listRecords(mockBase, "TestTable", { pageSize: 1 });

      assert.isTrue(result.hasMoreRecords);
    });

    it("can fetch the next page when more records exist", async () => {
      const mockRecords = Array.from({ length: 6 }, (_, i) => ({
        id: `rec${i}`,
        fields: { Name: `User${i}` },
      }));

      const mockBase = makeFakedListRecordsBase(mockRecords);
      const firstResult = await listRecords(mockBase, "TestTable", { pageSize: 2 });

      assert.isTrue(firstResult.hasMoreRecords);
      assert.equal(firstResult.records.length, 2);

      const secondResult = await firstResult.fetchNextPage();

      assert.isTrue(secondResult.hasMoreRecords);
      assert.equal(secondResult.records.length, 2);

      // Verify offset was passed to second request
      const secondCall = mockBase.makeRequest.getCall(1);
      assert.equal(secondCall.args[0]?.qs?.offset, "itr2");

      const thirdResult = await secondResult.fetchNextPage();

      assert.isFalse(thirdResult.hasMoreRecords);
      assert.equal(secondResult.records.length, 2);
    });

    it("returns empty fetchNextPage when there are no more records", async () => {
      const mockBase = makeFakedListRecordsBase([]);

      const result = await listRecords(mockBase, "TestTable", {});

      assert.isFalse(result.hasMoreRecords);

      const nextPage = await result.fetchNextPage();

      assert.equal(nextPage.records.length, 0);
      assert.isFalse(nextPage.hasMoreRecords);
    });

    it("retains query parameters across requests", async () => {
      const mockRecords = Array.from({ length: 4 }, (_, i) => ({
        id: `rec${i}`,
        fields: { Status: "Active", Name: `User${i}` },
      }));

      const mockBase = makeFakedListRecordsBase(mockRecords);

      const params = {
        filterByFormula: "{Status}='Active'",
        fields: ["Name", "Status"],
        pageSize: 2,
      };

      const page1 = await listRecords(mockBase, "TestTable", params);
      await page1.fetchNextPage();

      // Verify both requests included the query parameters
      assert.deepInclude(mockBase.makeRequest.getCall(0).args[0]?.qs, params);
      assert.deepInclude(mockBase.makeRequest.getCall(1).args[0]?.qs, {
        ...params,
        offset: "itr2",
      });
    });
  });
});
