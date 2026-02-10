import AirtableSchemaTypeSuite from "app/common/airtable/AirtableAPITypes-ti";
import {
  AirtableBaseSchema,
  AirtableFieldSchema, AirtableListBasesResponse,
  AirtableTableSchema,
} from "app/common/airtable/AirtableAPITypes";

import Airtable, { Record } from "airtable";
import { QueryParams } from "airtable/lib/query_params";
import { CheckerT, createCheckers } from "ts-interface-checker";

export interface AirtableAPIOptions {
  apiKey: string;
}

// TODO - Improve error handling. Airtable's API throws if an error response is returned,
//        but we don't want to show that directly to users.

/**
 * Simplifies access to Airtable's API.
 * - Allows easy access to meta methods (e.g. schema retrieval, listing bases) that aren't exposed
 *   by the "airtable" package.
 * - Applies type checking and assertions to the responses
 */
export class AirtableAPI {
  private readonly _airtable: Airtable;
  private _metaRequester: Airtable.Base;

  constructor(_options: AirtableAPIOptions) {
    this._airtable = new Airtable(_options);
    // Airtable's JS library doesn't support fetching schemas, but by passing an empty baseId
    // we can still force it to request the URL we want, and re-use the library's backoff logic
    // to help with Airtable's rate limiting.
    this._metaRequester = this._airtable.base("");
  }

  public base(baseId: string) {
    return this._airtable.base(baseId);
  }

  public async listBases(): Promise<AirtableListBasesResponse["bases"]> {
    // Technically there's pagination here - but each request returns 1000 bases, so it feels
    // premature to implement.
    const response = await this._metaRequester.makeRequest({ path: `meta/bases` });
    const body = response.body as AirtableListBasesResponse;
    return body.bases;
  }

  public async getBaseSchema(baseId: string): Promise<AirtableBaseSchema> {
    const response = await this._metaRequester.makeRequest({
      path: `meta/bases/${baseId}/tables`,
    });
    const schema = response.body;
    if (!AirtableSchemaChecker.test(schema)) {
      throw new AirtableAPIError("unexpected response structure when fetching base schema");
    }
    return schema;
  }
}

export class AirtableAPIError extends Error {
  constructor(message: string) {
    super(`Airtable API error: ${message}`);
  }
}

export interface ListAirtableRecordsResult {
  records: Airtable.Records<any>,
  hasMoreRecords: boolean,
  fetchNextPage: FetchNextPageFunc
}

type FetchNextPageFunc = () => Promise<ListAirtableRecordsResult>;

const fetchPageWhenNoMoreData: FetchNextPageFunc = () => Promise.resolve({
  records: [],
  hasMoreRecords: false,
  fetchNextPage: fetchPageWhenNoMoreData,
});

/**
 * Airtable's built-in record querying (base.table("MyTable").select().eachPage()) is prone
 * to hanging indefinitely when an error is thrown from the callback, or if the callback fails to
 * call `nextPage()` correctly.
 *
 * This re-implements the listRecords functionality, while keeping the error handling,
 * rate-limiting and auth logic from the Airtable library.
 */
export function listRecords(
  base: Airtable.Base, tableName: string, params: QueryParams<any>,
): Promise<ListAirtableRecordsResult> {
  const table = base.table(tableName);

  const fetchNextPage = async (offset?: number): ReturnType<FetchNextPageFunc> => {
    const { body } = await base.makeRequest({
      method: "GET",
      path: `/${encodeURIComponent(tableName)}`,
      qs: {
        ...params,
        offset,
      },
    });

    const records = body.records.map((recordJson: string) => new Record(table, "", recordJson));
    const hasMoreRecords = body.offset !== undefined;

    return {
      records,
      hasMoreRecords,
      fetchNextPage: hasMoreRecords ? () => fetchNextPage(body.offset) : fetchPageWhenNoMoreData,
    };
  };

  return fetchNextPage();
}

const checkers = createCheckers(AirtableSchemaTypeSuite);
export const AirtableSchemaChecker = checkers.AirtableBaseSchema as CheckerT<AirtableBaseSchema>;
export const AirtableSchemaTableChecker = checkers.AirtableSchemaTable as CheckerT<AirtableTableSchema>;
export const AirtableSchemaFieldChecker = checkers.AirtableSchemaField as CheckerT<AirtableFieldSchema>;
