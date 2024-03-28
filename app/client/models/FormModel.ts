import {FormLayoutNode, patchLayoutSpec} from 'app/client/components/FormRenderer';
import {TypedFormData, typedFormDataToJson} from 'app/client/lib/formUtils';
import {makeT} from 'app/client/lib/localization';
import {getHomeUrl} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {Form, FormAPI, FormAPIImpl} from 'app/client/ui/FormAPI';
import {ApiError} from 'app/common/ApiError';
import {safeJsonParse} from 'app/common/gutil';
import {bundleChanges, Computed, Disposable, Observable} from 'grainjs';

const t = makeT('FormModel');

export interface FormModel {
  readonly form: Observable<Form|null>;
  readonly formLayout: Computed<FormLayoutNode|null>;
  readonly submitting: Observable<boolean>;
  readonly submitted: Observable<boolean>;
  readonly error: Observable<string|null>;
  fetchForm(): Promise<void>;
  submitForm(formData: TypedFormData): Promise<void>;
}

export class FormModelImpl extends Disposable implements FormModel {
  public readonly form = Observable.create<Form|null>(this, null);
  public readonly formLayout = Computed.create(this, this.form, (_use, form) => {
    if (!form) { return null; }

    const layout = safeJsonParse(form.formLayoutSpec, null) as FormLayoutNode | null;
    if (!layout) { throw new Error('invalid formLayoutSpec'); }

    const patchedLayout = patchLayoutSpec(layout, new Set(Object.keys(form.formFieldsById).map(Number)));
    if (!patchedLayout) { throw new Error('invalid formLayoutSpec'); }

    return patchedLayout;
  });
  public readonly submitting = Observable.create<boolean>(this, false);
  public readonly submitted = Observable.create<boolean>(this, false);
  public readonly error = Observable.create<string|null>(this, null);

  private readonly _formAPI: FormAPI = new FormAPIImpl(getHomeUrl());

  constructor() {
    super();
  }

  public async fetchForm(): Promise<void> {
    try {
      bundleChanges(() => {
        this.form.set(null);
        this.submitted.set(false);
        this.error.set(null);
      });
      this.form.set(await this._formAPI.getForm(this._getFetchFormParams()));
    } catch (e: unknown) {
      let error: string | undefined;
      if (e instanceof ApiError) {
        const code = e.details?.code;
        if (code === 'FormNotFound') {
          error = t("Oops! The form you're looking for doesn't exist.");
        } else if (code === 'FormNotPublished') {
          error = t('Oops! This form is no longer published.');
        } else if (e.status === 401 || e.status === 403) {
          error = t("You don't have access to this form.");
        } else if (e.status === 404) {
          error = t("Oops! The form you're looking for doesn't exist.");
        }
      }

      this.error.set(error || t('There was a problem loading the form.'));
      if (!(e instanceof ApiError && (e.status >= 400 && e.status < 500))) {
        // Re-throw if the error wasn't a user error (i.e. a 4XX HTTP response).
        throw e;
      }
    }
  }

  public async submitForm(formData: TypedFormData): Promise<void> {
    const form = this.form.get();
    if (!form) { throw new Error('form is not defined'); }

    const colValues = typedFormDataToJson(formData);
    try {
      this.submitting.set(true);
      await this._formAPI.createRecord({
        ...this._getDocIdOrShareKeyParam(),
        tableId: form.formTableId,
        colValues,
      });
    } finally {
      this.submitting.set(false);
    }
  }

  private _getFetchFormParams() {
    const {form} = urlState().state.get();
    if (!form) { throw new Error('invalid urlState: undefined "form"'); }

    return {...this._getDocIdOrShareKeyParam(), vsId: form.vsId};
  }

  private _getDocIdOrShareKeyParam() {
    const {doc, form} = urlState().state.get();
    if (!form) { throw new Error('invalid urlState: undefined "form"'); }

    if (doc) {
      return {docId: doc};
    } else if (form.shareKey) {
      return {shareKey: form.shareKey};
    } else {
      throw new Error('invalid urlState: undefined "doc" or "shareKey"');
    }
  }
}
