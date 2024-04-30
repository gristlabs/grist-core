import {makeT} from 'app/client/lib/localization';
import {
  buildFormMessagePage,
  cssFormMessageImage,
  cssFormMessageImageContainer,
  cssFormMessageText,
} from 'app/client/ui/FormContainer';
import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-form-');

const t = makeT('FormErrorPage');

export class FormErrorPage extends Disposable {
  constructor(private _message: string) {
    super();
    document.title = `${t('Error')}${getPageTitleSuffix(getGristConfig())}`;
  }

  public buildDom() {
    return buildFormMessagePage(() => [
      cssFormErrorMessageImageContainer(
        cssFormErrorMessageImage({src: 'img/form-error.svg'}),
      ),
      cssFormMessageText(this._message, testId('error-page-text')),
    ], testId('error-page'));
  }
}

const cssFormErrorMessageImageContainer = styled(cssFormMessageImageContainer, `
  height: 281px;
`);

const cssFormErrorMessageImage = styled(cssFormMessageImage, `
  max-height: 281px;
  max-width: 250px;
`);
