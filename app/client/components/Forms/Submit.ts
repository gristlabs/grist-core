import { BoxModel } from "app/client/components/Forms/Model";
import { makeTestId } from "app/client/lib/domUtils";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { dom } from "grainjs";
const testId = makeTestId("test-forms-");

export class SubmitModel extends BoxModel {
  public override render() {
    const text = this.view.viewSection.layoutSpecObj.prop('submitText');
    return dom(
      "div",
      { style: "text-align: center; margin-top: 20px;" },
      bigPrimaryButton(dom.text(use => use(text) || 'Submit'), testId("submit"))
    );
  }
}
