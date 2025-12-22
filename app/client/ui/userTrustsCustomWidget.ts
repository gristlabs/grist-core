import { makeT } from "app/client/lib/localization";
import { inlineMarkdown } from "app/client/lib/markdown";
import { alert } from "app/client/ui2018/alerts";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { getConfirmText, saveModal } from "app/client/ui2018/modals";
import { gristThemeObs } from "app/client/ui2018/theme";

import { Computed, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("userTrustsCustomWidget");
const testId = makeTestId("test-custom-widget-warning-modal-");

/**
 * Show a modal to the user asking him to confirm he trusts the custom widget he's about to install.
 *
 * @returns Promise<boolean> Promise that resolves to true if the user confirms he trusts the widget, false otherwise.
 */
export function userTrustsCustomWidget() {
  let setUserChoice: (choice: boolean) => void;
  const waitForUserChoice = new Promise<boolean>((resolve) => {
    setUserChoice = resolve;
  });

  saveModal((ctl, owner) => {
    const src = Computed.create(owner, use => use(gristThemeObs()).appearance === "light" ?
      "img/security-alert.png" :
      "img/security-alert-dark-theme.png");
    const confirmIsChecked = Observable.create(owner, false);
    const saveDisabled = Computed.create(owner, use => !use(confirmIsChecked));
    return {
      title: t("Be careful with unknown custom widgets"),
      body: dom("div",
        cssImageContainer(cssImage(dom.attr("src", src))),
        alert(t("Please review the following before adding a new custom widget.")),
        dom("p", inlineMarkdown(
          t("Custom widgets are **powerful**! \
They may be able to read and write your document data, and send it elsewhere."),
        )),
        dom("ul",
          cssListItem(inlineMarkdown(t("Are you sure you **trust the resource** at this URL?"))),
          cssListItem(inlineMarkdown(t("Do you **trust the person** who shared this link?"))),
          cssListItem(inlineMarkdown(t("Have you **reviewed the code** at this URL?"))),
        ),
        dom("p", inlineMarkdown(
          t("If in doubt, do not install this widget, or ask an administrator \
of your organization to review it for safety."),
        )),
        cssConfirmCheckbox(
          labeledSquareCheckbox(confirmIsChecked,
            dom("span",
              inlineMarkdown(t("I confirm that I understand these warnings and accept the risks")),
            ),
            testId("confirm-checkbox"),
          ),
        ),
      ),
      saveLabel: getConfirmText(),
      saveFunc: () => Promise.resolve(setUserChoice(true)),
      saveDisabled,
      width: "fixed-wide",
    };
  }, {
    onCancel: () => setUserChoice(false),
  });

  return waitForUserChoice;
}

const cssImageContainer = styled("div", `
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
`);

const cssImage = styled("img", `
  width: 100px;
  height: 100px;
`);

const cssConfirmCheckbox = styled("div", `
  margin: 2rem 0 1rem;
`);

const cssListItem = styled("li", `
  margin: 0.5rem 0;
`);
