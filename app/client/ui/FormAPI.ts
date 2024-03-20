import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {CellValue, ColValues} from 'app/common/DocActions';
import {addCurrentOrgToPath} from 'app/common/urlUtils';

/**
 * Form and associated field metadata from a Grist view section.
 *
 * Includes the layout of the form, metadata such as the form title, and
 * a map of data for each field in the form. All of this is used to build a
 * submittable version of the form (see `FormRenderer.ts`, which handles the
 * actual building of forms).
 */
export interface Form {
  formFieldsById: Record<number, FormField>;
  formLayoutSpec: string;
  formTitle: string;
  formTableId: string;
}

/**
 * Metadata for a field in a form.
 *
 * Form fields are directly related to Grist fields; the former is based on data
 * from the latter, with additional metadata specific to forms, like whether a
 * form field is required. All of this is used to build a field in a submittable
 * version of the form (see `FormRenderer.ts`, which handles the actual building
 * of forms).
 */
export interface FormField {
  /** The field label. Defaults to the Grist column label or id. */
  question: string;
  /** The field description. */
  description: string;
  /** The Grist column id of the field. */
  colId: string;
  /** The Grist column type of the field (e.g. "Text"). */
  type: string;
  /** Additional field options. */
  options: FormFieldOptions;
  /** Populated with data from a referenced table. Only set if `type` is a Reference type. */
  refValues: [number, CellValue][] | null;
}

interface FormFieldOptions {
  /** True if the field is required to submit the form. */
  formRequired?: boolean;
  /** Populated with a list of options. Only set if the field `type` is a Choice/Reference Liste. */
  choices?: string[];
}

export interface FormAPI {
  getForm(options: GetFormOptions): Promise<Form>;
  createRecord(options: CreateRecordOptions): Promise<void>;
}

interface GetFormCommonOptions {
  vsId: number;
}

interface GetFormWithDocIdOptions extends GetFormCommonOptions {
  docId: string;
}

interface GetFormWithShareKeyOptions extends GetFormCommonOptions {
  shareKey: string;
}

type GetFormOptions = GetFormWithDocIdOptions | GetFormWithShareKeyOptions;

interface CreateRecordCommonOptions {
  tableId: string;
  colValues: ColValues;
}

interface CreateRecordWithDocIdOptions extends CreateRecordCommonOptions {
  docId: string;
}

interface CreateRecordWithShareKeyOptions extends CreateRecordCommonOptions {
  shareKey: string;
}

type CreateRecordOptions = CreateRecordWithDocIdOptions | CreateRecordWithShareKeyOptions;

export class FormAPIImpl extends BaseAPI implements FormAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getForm(options: GetFormOptions): Promise<Form> {
    if ('docId' in options) {
      const {docId, vsId} = options;
      return this.requestJson(`${this._url}/api/docs/${docId}/forms/${vsId}`, {method: 'GET'});
    } else {
      const {shareKey, vsId} = options;
      return this.requestJson(`${this._url}/api/s/${shareKey}/forms/${vsId}`, {method: 'GET'});
    }
  }

  public async createRecord(options: CreateRecordOptions): Promise<void> {
    if ('docId' in options) {
      const {docId, tableId, colValues} = options;
      return this.requestJson(`${this._url}/api/docs/${docId}/tables/${tableId}/records`, {
        method: 'POST',
        body: JSON.stringify({records: [{fields: colValues}]}),
      });
    } else {
      const {shareKey, tableId, colValues} = options;
      const url = new URL(`${this._url}/api/s/${shareKey}/tables/${tableId}/records`);
      url.searchParams.set('utm_source', 'grist-forms');
      return this.requestJson(url.href, {
        method: 'POST',
        body: JSON.stringify({records: [{fields: colValues}]}),
      });
    }
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
