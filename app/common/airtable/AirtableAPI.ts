import AirtableSchemaTypeSuite from "app/common/airtable/AirtableAPI-ti";

import Airtable from "airtable";
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

export interface AirtableListBasesResponse {
  bases: {
    id: string,
    name: string,
    permissionLevel: ("none" | "read" | "comment" | "edit" | "create")[],
  }[],
  offset?: string,
}

const AirtableTypeSuiteCheckers = createCheckers(AirtableSchemaTypeSuite);
export const AirtableSchemaChecker = AirtableTypeSuiteCheckers.AirtableBaseSchema as CheckerT<AirtableBaseSchema>;
export const AirtableSchemaTableChecker = AirtableTypeSuiteCheckers.AirtableSchemaTable as CheckerT<AirtableTableSchema>;
export const AirtableSchemaFieldChecker = AirtableTypeSuiteCheckers.AirtableSchemaField as CheckerT<AirtableFieldSchema>;

// Airtable schema response. Limit this to only needed fields to minimise chance of breakage.
export interface AirtableBaseSchema {
  tables: AirtableTableSchema[];
}

export interface AirtableTableSchema {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableFieldSchema[];
}

export interface AirtableFieldSchema {
  id: string;
  name: string;
  type: string;
  options?: { [key: string]: any };
}
