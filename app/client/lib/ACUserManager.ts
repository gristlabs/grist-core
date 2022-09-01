import { ACResults, ACIndex, ACItem, buildHighlightedDom } from "app/client/lib/ACIndex";
import { Autocomplete, IAutocompleteOptions } from "app/client/lib/autocomplete";
import { cssMenuItem } from "popweasel";

import { testId, colors } from "app/client/ui2018/cssVars";
import { menuCssClass } from "app/client/ui2018/menus";
import { dom, DomElementArg, Holder, IDisposableOwner, Observable, styled, computed, Computed } from "grainjs";
import {
  cssEmailInput,
  cssEmailInputContainer,
  cssMailIcon,
  cssMemberImage,
  cssMemberListItem,
  cssMemberPrimary,
  cssMemberSecondary,
  cssMemberText,
} from "app/client/ui/UserItem";
import { createUserImage, cssUserImage } from "app/client/ui/UserImage";

export interface ACUserItem extends ACItem {
  value: string;
  label: string;
  name: string;
  email: string;
  id: number;
  picture?: string | null; // when present, a url to a public image of unspecified dimensions.
  isNew?: boolean;
}

export function buildACMemberEmail(
  owner: IDisposableOwner,
  options: {
    acIndex: ACIndex<ACUserItem>;
    emailObs: Observable<string>;
    save: (value: string, item: ACUserItem | undefined) => Promise<void> | void;
    isValid: Observable<boolean>;
  },
  ...args: DomElementArg[]
) {
  const { acIndex, emailObs, save, isValid } = options;
  const acHolder = Holder.create<Autocomplete<ACUserItem>>(owner);
  let emailInput: HTMLInputElement;
  emailObs.addListener(() => emailInput.setCustomValidity(""));

  const isOpen = () => !acHolder.isEmpty();
  const acOpen = () => acHolder.isEmpty() && Autocomplete.create(acHolder, emailInput, acOptions);
  const acClose = () => acHolder.clear();
  const finish = () => {
    acClose();
    emailObs.set("");
    emailInput.value = emailObs.get();
    emailInput.focus();
  };
  const revert = () => {
    emailInput.value = emailObs.get();
    finish();
  };
  const commitOrRevert = () => {
    commitIfValid() || revert();
  };
  const openOrCommit = () => {
    isOpen() ? commitOrRevert() : acOpen();
  };

  const commitIfValid = () => {
    const item = acHolder.get()?.getSelectedItem();
    const selectedEmail = emailObs.get() || item?.value;
    emailInput.setCustomValidity("");
    try {
      if (selectedEmail && isValid.get()) {
        emailInput.value = selectedEmail;
        save(emailInput.value, item);
        finish();
        return true;
      }
    } catch (e) {
        emailInput.setCustomValidity(e.message);
        return false;
    } finally {
      emailInput.reportValidity();
    }
  };

  const onMouseDown = (ev: MouseEvent) => {
    ev.preventDefault(); // Don't let it affect focus, since we focus/blur manually.
    if (!isOpen()) {
      emailInput.focus();
    }
    openOrCommit();
  };

  const maybeShowAddNew = async (result: ACResults<ACUserItem>, text: string): Promise<ACResults<ACUserItem>> => {
    const newObject = {
      value: text,
      cleanText: text,
      name: "",
      email: "",
      isNew: true,
      label: text,
      id: 0,
    };
    if (result.items.find((item) => item.cleanText === newObject.cleanText)) {
      return result;
    }
    result.items.push(newObject);
    return result;
  };
  const enableAdd: Computed<boolean> = computed((use) => Boolean(use(emailObs) && use(isValid)));

  const acOptions: IAutocompleteOptions<ACUserItem> = {
    menuCssClass: `${menuCssClass} test-acselect-dropdown`,
    search: (term) => maybeShowAddNew(acIndex.search(term), term),
    renderItem: (item, highlightFunc) =>
      item?.isNew
        ? cssSelectItem(
            cssMemberListItem(
              cssUserImagePlus(
                "+",
                cssUserImage.cls("-large"),
                cssUserImagePlus.cls('-invalid', (use) => !use(enableAdd),
              )),
              cssMemberText(
                cssMemberPrimaryPlus("Invite new member"),
                cssMemberSecondaryPlus(
                  dom.text(use => `We'll email an invite to ${use(emailObs)}`)
                )
              ),
              testId("um-add-email")
            )
          )
        : cssSelectItem(
            cssMemberListItem(
              cssMemberImage(createUserImage(item, "large")),
              cssMemberText(
                cssMemberPrimaryPlus(item.name, testId("um-member-name")),
                cssMemberSecondaryPlus(buildHighlightedDom(item.label, highlightFunc, cssMatchText))
              )
            )
          ),
    getItemText: (item) => item.value,
    onClick: commitIfValid,
  };
  return cssEmailInputContainer(
    dom.autoDispose(enableAdd),
    cssMailIcon("Mail"),
    (emailInput = cssEmailInput(
      emailObs,
      {onInput: true, isValid: isValid},
      { type: "email", placeholder: "Enter email address but smarter" },
      dom.on("input", acOpen),
      dom.on("focus", (ev, elem) => elem.select()),
      dom.on("blur", commitOrRevert),
      dom.onKeyDown({
        Escape: revert,
        Enter: openOrCommit,
        ArrowDown: acOpen,
        Tab: commitIfValid,
      }),
      cssEmailInputContainer.cls('-green', enableAdd),
      ...args
    )),
    dom.on("mousedown", onMouseDown)
  );
}

const cssSelectItem = styled(
  "li",
  `
  display: block;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;

  &.selected {
    background-color: var(--weaseljs-selected-background-color, #5AC09C);
    color:            var(--weaseljs-selected-color, white);
  }
`
);

const cssMemberPrimaryPlus = styled(
  cssMemberPrimary,
  `
  .${cssSelectItem.className}.selected & {
    color: white;
  }
`
);

const cssMemberSecondaryPlus = styled(
  cssMemberSecondary,
  `
  .${cssSelectItem.className}.selected & {
    color: white;
  }
`
);

const cssMatchText = styled(
  "span",
  `
  color: ${colors.lightGreen};
  .selected > & {
    color: ${colors.lighterGreen};
  }
`
);

const cssUserImagePlus = styled(
  cssUserImage,
  `
  background-color: ${colors.lightGreen};
  margin: auto 0;

  &-invalid {
    background-color: ${colors.mediumGrey};
  }

  .${cssMenuItem.className}-sel & {
    background-color: white;
    color: ${colors.lightGreen};
  }
`
);
