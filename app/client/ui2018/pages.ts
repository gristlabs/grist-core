import { isDesktop } from 'app/client/lib/browserInfo';
import { makeT } from 'app/client/lib/localization';
import { cssEditorInput } from "app/client/ui/HomeLeftPane";
import { itemHeader, itemHeaderWrapper, treeViewContainer } from "app/client/ui/TreeViewComponentCss";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { hoverTooltip, overflowTooltip } from 'app/client/ui/tooltips';
import { unstyledButton, unstyledLink } from 'app/client/ui2018/unstyled';
import { menu, menuDivider, menuItem, menuItemAsync, menuText } from "app/client/ui2018/menus";
import { Computed, dom, domComputed, DomElementArg, makeTestId, observable, Observable, styled } from "grainjs";

const t = makeT('pages');

const testId = makeTestId('test-docpage-');

export interface PageOptions {
  onRename: (name: string) => Promise<void>;
  onRemove: () => void;
  onDuplicate: () => void;
  isRemoveDisabled: () => boolean;
  isReadonly: Observable<boolean>;
  isCollapsed: Observable<boolean>;
  onCollapse: (value: boolean) => void;
  isCollapsedByDefault: Computed<boolean>;
  onCollapseByDefault: (value: boolean) => Promise<void>;
  hasSubPages: () => boolean;
  href: DomElementArg;
}

function isTargetSelected(target: HTMLElement) {
  const parentItemHeader = target.closest('.' + itemHeader.className);
  return parentItemHeader ? parentItemHeader.classList.contains('selected') : false;
}

// build the dom for a document page entry. It shows an icon (for now the first letter of the name,
// but later we'll support user selected icon), the name and a dots menu containing a "Rename" and
// "Remove" entries. Clicking "Rename" turns the page name into an editable input, which then call
// the options.onRename callback with the new name. Setting options.onRemove to undefined disables
// the item in the menu.
export function buildPageDom(name: Observable<string>, options: PageOptions, ...args: DomElementArg[]) {
  const {
    onRename,
    onRemove,
    onDuplicate,
    isRemoveDisabled,
    isReadonly,
    isCollapsed,
    onCollapse,
    isCollapsedByDefault,
    onCollapseByDefault,
    hasSubPages,
    href
  } = options;
  const isRenaming = observable(false);
  const pageMenu = () => [
    menuItem(
      () => isRenaming.set(true),
      t("Rename"),
      dom.cls("disabled", isReadonly),
      testId("rename")
    ),
    menuItem(
      onRemove,
      t("Remove"),
      dom.cls("disabled", use => use(isReadonly) || isRemoveDisabled()),
      testId("remove")
    ),
    menuItem(
      onDuplicate,
      t("Duplicate page"),
      dom.cls("disabled", isReadonly),
      testId("duplicate")
    ),
    dom.maybe(hasSubPages(), () => [
      menuDivider(),
      menuItemAsync(
        () => onCollapse(false),
        t("Expand {{maybeDefault}}", {
          maybeDefault: dom.maybe(
            use => !use(isCollapsedByDefault),
            () => t("(default)")
          ),
        }),
        dom.cls("disabled", use => !use(isCollapsed)),
        testId("expand")
      ),
      menuItemAsync(
        () => onCollapse(true),
        t("Collapse {{maybeDefault}}", {
          maybeDefault: dom.maybe(isCollapsedByDefault, () => t("(default)")),
        }),
        dom.cls("disabled", isCollapsed),
        testId("collapse")
      ),
      menuItemAsync(
        async () => { await onCollapseByDefault(true); },
        t("Set default: Collapse"),
        dom.show(use => !use(isCollapsedByDefault)),
        testId("collapse-by-default")
      ),
      menuItemAsync(
        async () => { await onCollapseByDefault(false); },
        t("Set default: Expand"),
        dom.show(isCollapsedByDefault),
        testId("expand-by-default")
      ),
    ]),
    dom.maybe(options.isReadonly, () =>
      menuText(t("You do not have edit access to this document"))
    ),
  ];
  let pageElem: HTMLElement;

  // toggle '-renaming' class on the item's header. This is useful to make the background remain the
  // same while opening dots menu
  const lis = isRenaming.addListener(() => {
    const parent = pageElem.closest('.' + itemHeader.className);
    if (parent) {
      dom.clsElem(parent, itemHeader.className + '-renaming', isRenaming.get());
    }
  });

  const splitName = Computed.create(null, name, (use, _name) => splitPageInitial(_name));

  return pageElem = dom(
    'div',
    dom.autoDispose(lis),
    dom.autoDispose(splitName),
    domComputed(use => use(name) === '', blank => blank ? dom('div', '-') :
      domComputed(isRenaming, isrenaming => (
        isrenaming ?
          cssPageItem(
            cssPageInitial(
              testId('initial'),
              dom.text(use => use(splitName).initial),
              cssPageInitial.cls('-emoji', use => use(splitName).hasEmoji),
            ),
            cssEditorInput(
              {
                initialValue: name.get() || '',
                save: async val => onRename(val),
                close: () => isRenaming.set(false)
              },
              testId('editor'),
              dom.on('mousedown', ev => ev.stopPropagation()),
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
            ),
            // Note that we don't pass extra args when renaming is on, because they usually includes
            // mouse event handlers interfering with input editor and yields wrong behavior on
            // firefox.
          ) :
          cssPageItem(
            cssPageLink(
              testId('link'),
              href,
              cssPageInitial(
                testId('initial'),
                dom.text(use => use(splitName).initial),
                cssPageInitial.cls('-emoji', use => use(splitName).hasEmoji),
              ),
              cssPageName(
                dom.text(use => use(splitName).displayName),
                testId('label'),
                dom.on('click', ev => isTargetSelected(ev.target as HTMLElement) && isRenaming.set(true)),
                overflowTooltip(),
              ),
            ),
            cssPageMenuTrigger(
              dom.attr('aria-label', use => t("context menu - {{- pageName }}", {pageName: use(name)})),
              cssPageMenuIcon('Dots'),
              menu(pageMenu, {placement: 'bottom-start', parentSelectorToMark: '.' + itemHeader.className}),
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),

              // Let's prevent dragging to start when un-intentionally holding the mouse down on '...' menu.
              dom.on('mousedown', ev => ev.stopPropagation()),
              testId('dots'),
            ),
            // Prevents the default dragging behaviour that Firefox support for links which conflicts
            // with our own dragging pages.
            dom.on('dragstart', ev => ev.preventDefault()),
            args
          )
      )),
    ));
}

export function buildCensoredPage() {
  return cssPageItem(
    cssPageInitial(
      testId('initial'),
      dom.text('C'),
    ),
    cssCensoredPageName(
      dom.text('CENSORED'),
      testId('label'),
    ),
    hoverTooltip('This page is censored due to access rules.'),
  );
}

// This crazy expression matches all "possible emoji" and comes from a very official source:
// https://unicode.org/reports/tr51/#EBNF_and_Regex (linked from
// https://stackoverflow.com/a/68146409/328565). It is processed from the original by replacing \x
// with \u, removing whitespace, and factoring out a long subexpression.
const emojiPart = /(?:\p{RI}\p{RI}|\p{Emoji}(?:\p{EMod}|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?)/u;
const pageInitialRegex = new RegExp(`^${emojiPart.source}(?:\\u{200D}${emojiPart.source})*`, "u");

// Divide up the page name into an "initial" and "displayName", where an emoji initial, if
// present, is omitted from the displayName, but a regular character used as the initial is kept.
export function splitPageInitial(name: string): {initial: string, displayName: string, hasEmoji: boolean} {
  const m = name.match(pageInitialRegex);
  // A common false positive is digits; those match \p{Emoji} but should not be considered emojis.
  // (Other matching non-emojis include characters like '*', but those are nicer to show as emojis.)
  if (m && !/^\d$/.test(m[0])) {
    return {initial: m[0], displayName: name.slice(m[0].length).trim(), hasEmoji: true};
  } else {
    return {initial: Array.from(name)[0], displayName: name.trim(), hasEmoji: false};
  }
}

const cssPageItem = styled('div', `
  position: relative;
  display: flex;
  flex-direction: row;
  height: 28px;
  align-items: center;
  flex-grow: 1;
`);

const notClosedTreeViewContainer = `.${treeViewContainer.className}:not(.${treeViewContainer.className}-close)`;

const cssPageLink = styled(unstyledLink, `
  display: flex;
  align-items: center;
  height: 100%;
  flex-grow: 1;
  max-width: 100%;
  ${notClosedTreeViewContainer} .${cssPageItem.className}:focus-within &,
  ${notClosedTreeViewContainer} .${cssPageItem.className}:has(.weasel-popup-open) & {
    max-width: calc(100% - 28px);
  }
  @media ${onHoverSupport(true)} {
    ${notClosedTreeViewContainer} .${itemHeaderWrapper.className}-not-dragging:hover & {
      max-width: calc(100% - 28px);
    }
  }
  @media ${onHoverSupport(false)} {
    ${notClosedTreeViewContainer} .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected & {
      max-width: calc(100% - 28px);
    }
  }
  .${treeViewContainer.className}-close & {
    display: flex;
    justify-content: center;
  }
`);

const cssPageInitial = styled('div', `
  flex-shrink: 0;
  color: ${theme.pageInitialsFg};
  border-radius: 3px;
  background-color: ${theme.pageInitialsBg};
  width: 20px;
  height: 20px;
  margin-right: 8px;
  display: flex;
  justify-content: center;
  align-items: center;

  &-emoji {
    background-color: ${theme.pageInitialsEmojiBg};
    box-shadow: 0 0 0 1px ${theme.pageInitialsEmojiOutline};
    font-size: 15px;
    overflow: hidden;
    color: ${theme.text};
  }
  .${treeViewContainer.className}-close & {
    margin-right: 0;
  }
  .${itemHeader.className}.selected &-emoji {
    box-shadow: none;
  }
`);

const cssPageName = styled('div', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-grow: 1;
  .${treeViewContainer.className}-close & {
    display: none;
  }
`);

const cssCensoredPageName = styled(cssPageName, `
  color: ${theme.disabledPageFg};
`);

function onHoverSupport(yesNo: boolean) {
  // On desktop, we show page menu button on hover over page link. This isn't usable on mobile,
  // and interferes with clicks on iOS; so instead we show the button when the page is selected.
  //
  // We can achieve the distinction in CSS with
  //    @media (hover: hover) { ... }
  //    @media (hover: none) { ... }
  //
  // Except that it interferes with tests, because headless Chrome test on Linux incorrectly
  // matches (hover: none). To work around it, we assume desktop browsers can always hover,
  // and use trivial match-all/match-none media queries on desktop browsers.
  if (isDesktop()) {
    return yesNo ? 'all' : 'not all';
  } else {
    return yesNo ? '(hover: hover)' : '(hover: none)';
  }
}

const cssPageMenuTrigger = styled(unstyledButton, `
  position: relative;
  z-index: 2;
  cursor: default;
  display: none;
  margin-right: 4px;
  margin-left: auto;
  line-height: 0px;
  border-radius: 3px;
  height: 24px;
  width: 24px;
  padding: 4px;

  .${treeViewContainer.className}-close & {
    display: none !important;
  }
  .${cssPageItem.className}:focus-within &, &.weasel-popup-open {
    display: block;
  }
  @media ${onHoverSupport(true)} {
    .${itemHeaderWrapper.className}-not-dragging:hover & {
      display: block;
    }
  }
  @media ${onHoverSupport(false)} {
    .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected & {
      display: block;
    }
  }
  .${itemHeaderWrapper.className}-not-dragging &:hover, &.weasel-popup-open {
    background-color: ${theme.pageOptionsHoverBg};
  }
  .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected &:hover,
  .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected &.weasel-popup-open {
    background-color: ${theme.pageOptionsSelectedHoverBg};
  }

  .${itemHeader.className}.weasel-popup-open, .${itemHeader.className}-renaming {
    background-color: ${theme.pageHoverBg};
  }
`);

const cssPageMenuIcon = styled(icon, `
  background-color: ${theme.pageOptionsFg};
  .${itemHeader.className}.selected & {
    background-color: ${theme.pageOptionsHoverFg};
  }
`);
