import {makeT} from 'app/client/lib/localization';
import {buildFormContainer} from 'app/client/ui/FormContainer';
import * as css from 'app/client/ui/FormPagesCss';
import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, makeTestId} from 'grainjs';

const testId = makeTestId('test-form-');

const t = makeT('FormErrorPage');

export class FormErrorPage extends Disposable {
  constructor(private _message: string) {
    super();
    document.title = `${t('Error')}${getPageTitleSuffix(getGristConfig())}`;
  }

  public buildDom() {
    return buildFormContainer(() => [
      css.formErrorMessageImageContainer(css.formErrorMessageImage({
        src: 'img/form-error.svg',
      })),
      css.formMessageText(this._message, testId('error-text')),
    ]);
  }
}
