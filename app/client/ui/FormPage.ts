import {FormRenderer} from 'app/client/components/FormRenderer';
import {handleSubmit, TypedFormData} from 'app/client/lib/formUtils';
import {makeT} from 'app/client/lib/localization';
import {FormModel, FormModelImpl} from 'app/client/models/FormModel';
import {buildFormContainer} from 'app/client/ui/FormContainer';
import {FormErrorPage} from 'app/client/ui/FormErrorPage';
import * as css from 'app/client/ui/FormPagesCss';
import {FormSuccessPage} from 'app/client/ui/FormSuccessPage';
import {colors} from 'app/client/ui2018/cssVars';
import {ApiError} from 'app/common/ApiError';
import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, dom, Observable, styled, subscribe} from 'grainjs';

const t = makeT('FormPage');

export class FormPage extends Disposable {
  private readonly _model: FormModel = new FormModelImpl();
  private readonly _error = Observable.create<string|null>(this, null);

  constructor() {
    super();
    this._model.fetchForm().catch(reportError);

    this.autoDispose(subscribe(this._model.form, (_use, form) => {
      if (!form) { return; }

      document.title = `${form.formTitle}${getPageTitleSuffix(getGristConfig())}`;
    }));
  }

  public buildDom() {
    return css.pageContainer(
      dom.domComputed(use => {
        const error = use(this._model.error);
        if (error) { return dom.create(FormErrorPage, error); }

        const submitted = use(this._model.submitted);
        if (submitted) { return dom.create(FormSuccessPage, this._model); }

        return this._buildFormDom();
      }),
    );
  }

  private _buildFormDom() {
    return dom.domComputed(use => {
      const form = use(this._model.form);
      const rootLayoutNode = use(this._model.formLayout);
      if (!form || !rootLayoutNode) { return null; }

      const formRenderer = FormRenderer.new(rootLayoutNode, {
        fields: form.formFieldsById,
        rootLayoutNode,
        disabled: this._model.submitting,
        error: this._error,
      });

      return buildFormContainer(() =>
        cssForm(
          dom.autoDispose(formRenderer),
          formRenderer.render(),
          handleSubmit(this._model.submitting,
            (_formData, formElement) => this._handleFormSubmit(formElement),
            () => this._handleFormSubmitSuccess(),
            (e) => this._handleFormError(e),
          ),
        ),
      );
    });
  }

  private async _handleFormSubmit(formElement: HTMLFormElement) {
    await this._model.submitForm(new TypedFormData(formElement));
  }

  private async _handleFormSubmitSuccess() {
    const formLayout = this._model.formLayout.get();
    if (!formLayout) { throw new Error('formLayout is not defined'); }

    const {successURL} = formLayout;
    if (successURL) {
      try {
        const url = new URL(successURL);
        window.location.href = url.href;
        return;
      } catch {
        // If the URL is invalid, just ignore it.
      }
    }

    this._model.submitted.set(true);
  }

  private _handleFormError(e: unknown) {
    this._error.set(t('There was an error submitting your form. Please try again.'));
    if (!(e instanceof ApiError) || e.status >= 500) {
      // If it doesn't look like a user error (i.e. a 4XX HTTP response), report it.
      reportError(e as Error|string);
    }
  }
}

// TODO: see if we can move the rest of this to `FormRenderer.ts`.
const cssForm = styled('form', `
  color: ${colors.dark};
  font-size: 15px;
  line-height: 1.42857143;

  & > div + div {
    margin-top: 16px;
  }
  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    margin: 4px 0px;
    font-weight: normal;
  }
  & h1 {
    font-size: 24px;
  }
  & h2 {
    font-size: 22px;
  }
  & h3 {
    font-size: 16px;
  }
  & h4 {
    font-size: 13px;
  }
  & h5 {
    font-size: 11px;
  }
  & h6 {
    font-size: 10px;
  }
  & p {
    margin: 0px;
  }
  & strong {
    font-weight: 600;
  }
  & hr {
    border: 0px;
    border-top: 1px solid ${colors.darkGrey};
    margin: 4px 0px;
  }
`);
