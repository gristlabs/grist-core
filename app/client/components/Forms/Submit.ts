import * as css from "app/client/components/FormRendererCss";
import { BoxModel } from "app/client/components/Forms/Model";
import { makeTestId } from "app/client/lib/domUtils";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { dom } from "grainjs";
const testId = makeTestId("test-forms-");

export class SubmitModel extends BoxModel {
  public canRemove() {
    return false;
  }

  public override render() {
    const text = this.view.viewSection.layoutSpecObj.prop('submitText');
    return dom(
      "div",
      css.error(testId("error")),
      css.submitButtons(
        bigPrimaryButton(
          dom.text(use => use(text) || 'Submit'),
          { disabled: true },
          testId("submit"),
        ),
      ),
    );
  }
}
