import { ACResults, ACIndex, ACItem, buildHighlightedDom, normalizeText } from "app/client/lib/ACIndex";
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
    save: (value: string) => Promise<void> | void;
    isInputValid: Observable<boolean>;
  },
  ...args: DomElementArg[]
) {
  const { acIndex, emailObs, save, isInputValid } = options;
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
    if (item) {
      emailObs.set(item.value);
      emailInput.value = item.value;
    }
    emailInput.setCustomValidity("");
    const selectedEmail = item?.value || emailObs.get();
    try {
      if (selectedEmail && isInputValid.get()) {
        save(emailObs.get());
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

  const maybeShowAddNew = async (results: ACResults<ACUserItem>, text: string): Promise<ACResults<ACUserItem>> => {
    const cleanText = normalizeText(text);
    const newObject = {
      value: text,
      cleanText,
      name: "",
      email: "",
      isNew: true,
      label: text,
      id: 0,
    };
    const items = results.items.filter(item => item.cleanText.includes(cleanText));
    if (results.items.find((item) => item.cleanText === cleanText)) {
      results.items = items;
      return results;
    }
    results.items = items;
    results.items.push(newObject);
    return results;
  };

  const renderSearchItem = (item: ACUserItem, highlightFunc: any): HTMLLIElement => (item?.isNew ? cssSelectItem(
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
  ) : cssSelectItem(
    cssMemberListItem(
      cssMemberImage(createUserImage(item, "large")),
      cssMemberText(
        cssMemberPrimaryPlus(item.name, testId("um-member-name")),
        cssMemberSecondaryPlus(buildHighlightedDom(item.label, highlightFunc, cssMatchText))
      )
    )
  ));

  const enableAdd: Computed<boolean> = computed((use) => Boolean(use(emailObs) && use(isInputValid)));

  const acOptions: IAutocompleteOptions<ACUserItem> = {
    menuCssClass: `${menuCssClass} test-acselect-dropdown`,
    search: (term) => maybeShowAddNew(acIndex.search(term), term),
    renderItem: renderSearchItem,
    getItemText: (item) => item.value,
    onClick: commitIfValid,
  };
  return cssEmailInputContainer(
    dom.autoDispose(enableAdd),
    cssMailIcon("Mail"),
    (emailInput = cssEmailInput(
      emailObs,
      {onInput: true, isValid: isInputValid},
      { type: "email", placeholder: "Enter email address" },
      dom.on("input", acOpen),
      dom.on("focus", (_ev, elem) => elem.select()),
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
