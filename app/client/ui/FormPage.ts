import { FormRenderer } from 'app/client/components/FormRenderer';
import { handleSubmit, TypedFormData } from 'app/client/lib/formUtils';
import { makeT } from 'app/client/lib/localization';
import { sanitizeHttpUrl } from 'app/client/lib/sanitizeUrl';
import { FormModel, FormModelImpl } from 'app/client/models/FormModel';
import { buildFormFooter } from 'app/client/ui/FormContainer';
import { FormErrorPage } from 'app/client/ui/FormErrorPage';
import { FormSuccessPage } from 'app/client/ui/FormSuccessPage';
import { colors } from 'app/client/ui2018/cssVars';
import { ApiError } from 'app/common/ApiError';
import { getPageTitleSuffix } from 'app/common/gristUrls';
import { getGristConfig } from 'app/common/urlUtils';
import { Disposable, dom, makeTestId, Observable, styled, subscribe } from 'grainjs';
import { withInfoTooltip } from 'app/client/ui/tooltips';

const t = makeT('FormPage');

const testId = makeTestId('test-form-');

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
    return cssPageContainer(
      dom.domComputed((use) => {
        const error = use(this._model.error);
        if (error) { return dom.create(FormErrorPage, error); }

        const submitted = use(this._model.submitted);
        if (submitted) { return dom.create(FormSuccessPage, this._model); }

        return this._buildFormPageDom();
      }),
    );
  }

  private _buildFormPageDom() {
    return dom.domComputed((use) => {
      const form = use(this._model.form);
      const rootLayoutNode = use(this._model.formLayout);
      if (!form || !rootLayoutNode) { return null; }

      const formRenderer = FormRenderer.new(rootLayoutNode, {
        fields: form.formFieldsById,
        rootLayoutNode,
        disabled: this._model.submitting,
        error: this._error,
      });

      const formFraming = getGristConfig().formFraming;

      return dom('div',
        cssFormBorder(
          testId('framing'),
          cssFormBorder.cls(`-${formFraming}`),
          formFraming !== 'border' ? null :
            cssFormBorderHelp(withInfoTooltip(
              'Grist Form',
              'formFraming',
              { iconDomArgs: [cssFormBorderHelpButton.cls('')] },
            )),
          cssForm(
            cssFormBody(
              cssFormContent(
                dom.autoDispose(formRenderer),
                formRenderer.render(),
                handleSubmit({
                  pending: this._model.submitting,
                  onSubmit: (_formData, formElement) => this._handleFormSubmit(formElement),
                  onSuccess: () => this._handleFormSubmitSuccess(),
                  onError: e => this._handleFormError(e),
                }),
              ),
            ),
          ),
        ),
        cssFormFooter(
          buildFormFooter(),
        ),
        testId('page'),
      );
    });
  }

  private async _handleFormSubmit(formElement: HTMLFormElement) {
    await this._model.submitForm(new TypedFormData(formElement));
  }

  private async _handleFormSubmitSuccess() {
    const formLayout = this._model.formLayout.get();
    if (!formLayout) { throw new Error('formLayout is not defined'); }

    const { successURL } = formLayout;
    if (successURL) {
      const url = sanitizeHttpUrl(successURL);
      if (url) {
        window.location.href = url;
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

const cssPageContainer = styled('div', `
  height: 100%;
  width: 100%;
  padding: 20px;
  overflow: auto;
`);

const cssFormBorder = styled('div', `
  margin: 0px auto;
  position: relative;
  &-border {
    border: 2px solid ${colors.lightGreen};
    border-radius: 12px;
    border-top-width: 20px;
    padding: 12px;
    max-width: 624px;
    margin-bottom: 24px;
  }
  &-minimal {
    max-width: 600px;
  }
`);

const cssFormBorderHelp = styled('div', `
  color: white;
  position: absolute;
  top: -18px;
  right: 18px;
  font-size: 12px;
`);

const cssFormBorderHelpButton = styled('div', `
  border-color: white;
  color: white;
  height: 1rem;
  width: 1rem;
  font-size: 0.9rem;
  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
    border-color: white;
    color: white;
  }
`);

const cssForm = styled('div', `
  display: flex;
  position: relative;
  overflow: hidden;
  flex-direction: column;
  align-items: center;
  background-color: white;
  border-radius: 3px;
`);

const cssFormBody = styled('main', `
  width: 100%;
`);

// TODO: break up and move to `FormRendererCss.ts`.
const cssFormContent = styled('form', `
  color: ${colors.dark};
  font-size: 15px;
  line-height: 1.42857143;

  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    margin: 8px 0px 12px 0px;
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
    margin: 0 0 10px 0;
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

const cssFormFooter = styled('footer', `
  padding: 8px 16px;
  width: 100%;
`);
