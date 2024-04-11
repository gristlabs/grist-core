import {makeT} from 'app/client/lib/localization';
import {FormModel} from 'app/client/models/FormModel';
import {
  buildFormMessagePage,
  cssFormMessageImage,
  cssFormMessageImageContainer,
  cssFormMessageText,
} from 'app/client/ui/FormContainer';
import {vars} from 'app/client/ui2018/cssVars';
import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-form-');

const t = makeT('FormSuccessPage');

export class FormSuccessPage extends Disposable {
  private _successText = Computed.create(this, this._model.formLayout, (_use, layout) => {
    if (!layout) { return null; }

    return layout.successText || t('Thank you! Your response has been recorded.');
  });

  private _showNewResponseButton = Computed.create(this, this._model.formLayout, (_use, layout) => {
    return Boolean(layout?.anotherResponse);
  });

  constructor(private _model: FormModel) {
    super();
    document.title = `${t('Form Submitted')}${getPageTitleSuffix(getGristConfig())}`;
  }

  public buildDom() {
    return buildFormMessagePage(() => [
      cssFormSuccessMessageImageContainer(
        cssFormSuccessMessageImage({src: 'img/form-success.svg'}),
      ),
      cssFormMessageText(dom.text(this._successText), testId('success-page-text')),
      dom.maybe(this._showNewResponseButton, () =>
        cssFormButtons(
          cssFormNewResponseButton(
            t('Submit new response'),
            dom.on('click', () => this._handleClickNewResponseButton()),
          ),
        )
      ),
    ], testId('success-page'));
  }

  private async _handleClickNewResponseButton() {
    await this._model.fetchForm();
  }
}

const cssFormSuccessMessageImageContainer = styled(cssFormMessageImageContainer, `
  height: 215px;
`);

const cssFormSuccessMessageImage = styled(cssFormMessageImage, `
  max-height: 215px;
  max-width: 250px;
`);

const cssFormButtons = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 24px;
`);

const cssFormNewResponseButton = styled('button', `
  position: relative;
  outline: none;
  border-style: none;
  line-height: normal;
  user-select: none;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 24px;
  min-height: 40px;
  background: ${vars.primaryBg};
  border-radius: 3px;
  color: ${vars.primaryFg};

  &:hover {
    cursor: pointer;
    background: ${vars.primaryBgHover};
  }
`);
