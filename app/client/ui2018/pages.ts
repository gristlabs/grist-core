import { isDesktop } from 'app/client/lib/browserInfo';
import { cssEditorInput } from "app/client/ui/HomeLeftPane";
import { itemHeader, itemHeaderWrapper, treeViewContainer } from "app/client/ui/TreeViewComponentCss";
import { colors } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuItem, menuText } from "app/client/ui2018/menus";
import { dom, domComputed, DomElementArg, makeTestId, observable, Observable, styled } from "grainjs";

const testId = makeTestId('test-docpage-');

// the actions a page can do
export interface PageActions {
  onRename: (name: string) => Promise<void>|any;
  onRemove: () => void;
  onDuplicate: () => void;
  isRemoveDisabled: () => boolean;
  isReadonly: Observable<boolean>;
}

// build the dom for a document page entry. It shows an icon (for now the first letter of the name,
// but later we'll support user selected icon), the name and a dots menu containing a "Rename" and
// "Remove" entries. Clicking "Rename" turns the page name into an editable input, which then call
// the actions.onRename callback with the new name. Setting actions.onRemove to undefined disables
// the item in the menu.
export function buildPageDom(name: Observable<string>, actions: PageActions, ...args: DomElementArg[]) {

  const isRenaming = observable(false);
  const pageMenu = () => [
    menuItem(() => isRenaming.set(true), "Rename", testId('rename'),
            dom.cls('disabled', actions.isReadonly)),
    menuItem(actions.onRemove, 'Remove', testId('remove'),
             dom.cls('disabled', (use) => use(actions.isReadonly) || actions.isRemoveDisabled())),
    menuItem(actions.onDuplicate, 'Duplicate Page', testId('duplicate'),
             dom.cls('disabled', actions.isReadonly)),
    dom.maybe(actions.isReadonly, () => menuText('You do not have edit access to this document')),
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

  return pageElem = dom(
    'div',
    dom.autoDispose(lis),
    domComputed((use) => use(name) === '', blank => blank ? dom('div', '-') :
      domComputed(isRenaming, (isrenaming) => (
        isrenaming ?
          cssPageItem(
            cssPageInitial(dom.text((use) => use(name)[0])),
            cssEditorInput(
              {
                initialValue: name.get() || '',
                save: (val) => actions.onRename(val),
                close: () => isRenaming.set(false)
              },
              testId('editor'),
              dom.on('mousedown', (ev) => ev.stopPropagation()),
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
            ),
            // Note that we don't pass extra args when renaming is on, because they usually includes
            // mouse event handlers interferring with input editor and yields wrong behavior on
            // firefox.
          ) :
          cssPageItem(
            cssPageInitial(dom.text((use) => use(name)[0])),
            cssPageName(dom.text(name), testId('label')),
            cssPageMenuTrigger(
              cssPageIcon('Dots'),
              menu(pageMenu, {placement: 'bottom-start', parentSelectorToMark: '.' + itemHeader.className}),
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),

              // Let's prevent dragging to start when un-intentionally holding the mouse down on '...' menu.
              dom.on('mousedown', (ev) => ev.stopPropagation()),
              testId('dots'),
            ),
            // Prevents the default dragging behaviour that Firefox support for links which conflicts
            // with our own dragging pages.
            dom.on('dragstart', (ev) => ev.preventDefault()),
            args
          )
      )),
    ));
}

const cssPageItem = styled('a', `
  --icon-color: ${colors.slate};
  display: flex;
  flex-direction: row;
  height: 28px;
  align-items: center;
  flex-grow: 1;
  .${treeViewContainer.className}-close & {
    margin-left: 16px;
  }
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }
`);

const cssPageInitial = styled('div', `
  flex-shrink: 0;
  color: white;
  border-radius: 3px;
  background-color: ${colors.slate};
  width: 16px;
  height: 16px;
  text-align: center;
  margin-right: 8px;
`);

const cssPageName = styled('div', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  .${treeViewContainer.className}-close & {
    display: none;
  }
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

const cssPageMenuTrigger = styled('div', `
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
  &.weasel-popup-open {
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
    background-color: ${colors.darkGrey};
  }
  .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected &:hover,
  .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected &.weasel-popup-open {
    background-color: ${colors.slate};
  }

  .${itemHeader.className}.weasel-popup-open, .${itemHeader.className}-renaming {
    background-color: ${colors.mediumGrey};
  }
`);

const cssPageIcon = styled(icon, `
  .${itemHeader.className}.selected & {
    background-color: white;
  }
`);
