import {makeT} from 'app/client/lib/localization';
import * as css from 'app/client/ui/FormPagesCss';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls} from 'app/common/gristUrls';
import {DomContents, makeTestId} from 'grainjs';

const t = makeT('FormContainer');

const testId = makeTestId('test-form-');

export function buildFormContainer(buildBody: () => DomContents) {
  return css.formContainer(
    css.form(
      css.formBody(
        buildBody(),
      ),
      css.formFooter(
        css.poweredByGrist(
          css.poweredByGristLink(
            {href: commonUrls.forms, target: '_blank'},
            t('Powered by'),
            css.gristLogo(),
          )
        ),
        css.buildForm(
          css.buildFormLink(
            {href: commonUrls.forms, target: '_blank'},
            t('Build your own form'),
            icon('Expand'),
          ),
        ),
      ),
    ),
    testId('container'),
  );
}
