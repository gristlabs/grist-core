import {BoxModel, RenderContext} from 'app/client/components/Forms/Model';
import {makeTestId} from 'app/client/lib/domUtils';
import {primaryButton} from 'app/client/ui2018/buttons';
const testId = makeTestId('test-forms-');

export class SubmitModel extends BoxModel {
  public render(context: RenderContext) {
    return primaryButton('Submit', testId('submit'));
  }
}
