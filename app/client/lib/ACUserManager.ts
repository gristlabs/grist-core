import {makeT} from 'app/client/lib/localization';
import {ACIndex, ACItem, ACResults, buildHighlightedDom, normalizeText} from "app/client/lib/ACIndex";
import {cssSelectItem} from "app/client/lib/ACSelect";
import {Autocomplete, IAutocompleteOptions} from "app/client/lib/autocomplete";
import {colors, testId, theme} from "app/client/ui2018/cssVars";
import {icon} from "app/client/ui2018/icons";
import {menuCssClass} from "app/client/ui2018/menus";
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
import {createUserImage, cssUserImage} from "app/client/ui/UserImage";
import {Computed, computed, dom, DomElementArg, Holder, IDisposableOwner, Observable, styled} from "grainjs";
import {cssMenuItem} from "popweasel";

const t = makeT('ACUserManager');

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
    save: (value: string) => void;
    prompt?: {email: string},
  },
  ...args: DomElementArg[]
) {
  const {acIndex, emailObs, save, prompt} = options;
  const acHolder = Holder.create<Autocomplete<ACUserItem>>(owner);
  let emailInput: HTMLInputElement;

  const isValid = Observable.create(owner, true);

  const isOpen = () => !acHolder.isEmpty();
  const acOpen = () => acHolder.isEmpty() && Autocomplete.create(acHolder, emailInput, acOptions);
  const acClose = () => acHolder.clear();
  const finish = () => {
    acClose();
    emailObs.set("");
    emailInput.value = emailObs.get();
    emailInput.focus();
  };
  const onEnter = () => {
    isOpen() ? commitIfValid() : acOpen();
  };

  const commitIfValid = () => {
    const item = acHolder.get()?.getSelectedItem();
    if (item) {
      emailObs.set(item.value);
    }
    emailInput.setCustomValidity("");
    isValid.set(emailInput.checkValidity());

    const selectedEmail = item?.value || emailObs.get();
    try {
      if (selectedEmail && isValid.get()) {
        save(emailObs.get());
        finish();
      }
    } catch (e) {
      emailInput.setCustomValidity(e.message);
    } finally {
      emailInput.reportValidity();
    }
  };

  const maybeShowAddNew = async (results: ACResults<ACUserItem>, text: string): Promise<ACResults<ACUserItem>> => {
    const cleanText = normalizeText(text);
    const items = results.items
      .filter(item => item.cleanText.includes(cleanText))
      .sort((a, b) => a.cleanText.localeCompare(b.cleanText));
    results.items = items;
    if (!results.items.length && cleanText) {
      const newObject = {
        value: text,
        cleanText,
        name: "",
        email: "",
        isNew: true,
        label: text,
        id: 0,
      };
      results.items.push(newObject);
    }
    return results;
  };

  const renderSearchItem = (item: ACUserItem, highlightFunc: any): HTMLLIElement => (item?.isNew ? cssSelectItem(
    cssMemberListItem(
      cssUserImagePlus(
        cssPlusIcon('Plus'),
        cssUserImage.cls("-large"),
        cssUserImagePlus.cls('-invalid', (use) => !use(enableAdd),
        )),
      cssMemberText(
        cssMemberPrimaryPlus(t("Invite new member")),
        cssMemberSecondaryPlus(
          // dom.text(use => `We'll email an invite to ${use(emailObs)}`)
          dom.text(use => t("We'll email an invite to {{email}}", {email: use(emailObs)})) // TODO i18next
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

  const enableAdd: Computed<boolean> = computed((use) => Boolean(use(emailObs) && use(isValid)));

  const acOptions: IAutocompleteOptions<ACUserItem> = {
    attach: null,
    menuCssClass: `${menuCssClass} test-acselect-dropdown`,
    search: (term) => maybeShowAddNew(acIndex.search(term), term),
    renderItem: renderSearchItem,
    getItemText: (item) => item.value,
    onClick: commitIfValid,
  };

  const result = cssEmailInputContainer(
    cssMailIcon("Mail"),
    (emailInput = cssEmailInput(
      emailObs,
      {onInput: true, isValid},
      {type: "email", placeholder: t("Enter email address")},
      dom.on("input", acOpen),
      dom.on("focus", acOpen),
      dom.on("click", acOpen),
      dom.on("blur", acClose),
      dom.onKeyDown({
        Escape: finish,
        Enter: onEnter,
        ArrowDown: acOpen,
        Tab: commitIfValid,
      }),
    )),
    cssEmailInputContainer.cls('-green', enableAdd),
    ...args
  );

  // Reset custom validity that we sometimes set.
  owner.autoDispose(emailObs.addListener(() => emailInput.setCustomValidity("")));

  if (prompt) { setTimeout(() => emailInput.focus(), 0); }

  return result;
}

const cssMemberPrimaryPlus = styled(cssMemberPrimary, `
  .${cssSelectItem.className}.selected & {
    color: ${theme.menuItemSelectedFg};
  }
`);

const cssMemberSecondaryPlus = styled(cssMemberSecondary, `
  .${cssSelectItem.className}.selected & {
    color: ${theme.menuItemSelectedFg};
  }
`);

const cssMatchText = styled("span", `
  color: ${theme.autocompleteMatchText};
  .${cssSelectItem.className}.selected & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);

const cssUserImagePlus = styled(cssUserImage, `
  background-color: ${colors.lightGreen};
  margin: auto 0;

  &-invalid {
    background-color: ${colors.mediumGrey};
  }

  .${cssMenuItem.className}-sel & {
    background-color: ${theme.menuItemIconSelectedFg};
    color: ${theme.menuItemSelectedBg};
  }
`);

const cssPlusIcon = styled(icon, `
  width: 20px;
  height: 20px;
`);
