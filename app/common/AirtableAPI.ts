import AirtableSchemaTypeSuite from 'app/common/AirtableAPI-ti';

import Airtable from 'airtable';
import {CheckerT, createCheckers} from 'ts-interface-checker';

export interface AirtableAPIOptions {
  apiKey: string;
}

export class AirtableAPI {
  private readonly _airtable: Airtable;

  constructor(_options: AirtableAPIOptions) {
    this._airtable = new Airtable(_options);
  }

  public async getBaseSchema(baseId: string): Promise<AirtableBaseSchema> {
    // Airtable's JS library doesn't support fetching schemas, but by passing an empty baseId
    // we can still force it to request the URL we want, and re-use the library's backoff logic
    // to help with Airtable's rate limiting.
    const base = new Airtable.Base(this._airtable, '');
    const response = await base.makeRequest({
      path: `meta/bases/${baseId}/tables`,
    });
    const schema = response.body;
    if (!AirtableSchemaChecker.test(schema)) {
      throw new AirtableAPIError("unexpected response structure when fetching base schema");
    }
    return schema;
  }

  /*
  public get apiUrl(): string {
    // This is derived from Airtable.js endpoint logic and re-uses the library's internal values.
    // If Airtable update their endpoint versions, hopefully updating the Airtable library will fix it.
    return `${this._airtable._endpointUrl}/v${this._airtable._apiVersionMajor}/`;
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private _getBasicRequestHeaders() {
    return {
      'Authorization': `Bearer ${this._options.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
  */
}

export class AirtableAPIError extends Error {
  constructor(message: string) {
    super(`Airtable API error: ${message}`);
  }
}

const AirtableTypeSuiteCheckers = createCheckers(AirtableSchemaTypeSuite);
const AirtableSchemaChecker = AirtableTypeSuiteCheckers.AirtableBaseSchema as CheckerT<AirtableBaseSchema>;
//const AirtableSchemaTableChecker = AirtableTypeSuiteCheckers.AirtableSchemaTable as CheckerT<AirtableSchemaTable>;
//const AirtableSchemaFieldChecker = AirtableTypeSuiteCheckers.AirtableSchemaField as CheckerT<AirtableSchemaField>;

// Airtable schema response. Limit this to only needed fields to minimise chance of breakage.
export interface AirtableBaseSchema {
  tables: AirtableTableSchema[];
}

export interface AirtableTableSchema {
  id: string;
  name: string;
  fields: AirtableFieldSchema[];
}

export interface AirtableFieldSchema {
  id: string;
  name: string;
  type: string;
  options?: any;
}
