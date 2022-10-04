/**
 * Implements a widget for showing and editing a list of colIds. It offers a select dropdown to
 * add a new column, and allows removing already-added columns.
 */
import {aclSelect, cssSelect} from 'app/client/aclui/ACLSelect';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Computed, dom, Observable, styled} from 'grainjs';

export function aclColumnList(colIds: Observable<string[]>, validColIds: string[]) {
  // Define some helpers functions.
  function removeColId(colId: string) {
    colIds.set(colIds.get().filter(c => (c !== colId)));
  }
  function addColId(colId: string) {
    colIds.set([...colIds.get(), colId]);
    selectBox.focus();
  }
  function onFocus(ev: FocusEvent) {
    editing.set(true);
    // Focus the select box, except when focus just moved from it, e.g. after Shift-Tab.
    if (ev.relatedTarget !== selectBox) {
      selectBox.focus();
    }
  }
  function onBlur() {
    if (!selectBox.matches('.weasel-popup-open') && colIds.get().length > 0) {
      editing.set(false);
    }
  }

  // The observable for the selected element is a Computed, with a callback for being set, which
  // adds the selected colId to the list.
  const newColId = Computed.create(null, (use) => '')
    .onWrite((value) => { setTimeout(() => addColId(value), 0); });

  // We don't allow adding the same column twice, so for the select dropdown build a list of
  // unused colIds.
  const unusedColIds = Computed.create(null, colIds, (use, _colIds) => {
    const used = new Set(_colIds);
    return validColIds.filter(c => !used.has(c));
  });

  // The "editing" observable determines which of two states is active: to show or to edit.
  const editing = Observable.create(null, !colIds.get().length);

  let selectBox: HTMLElement;
  return cssColListWidget({tabIndex: '0'},
    dom.autoDispose(unusedColIds),
    cssColListWidget.cls('-editing', editing),
    dom.on('focus', onFocus),
    dom.forEach(colIds, colId =>
      cssColItem(
        cssColId(colId),
        cssColItemIcon(icon('CrossSmall'),
          dom.on('click', () => removeColId(colId)),
          testId('acl-col-remove'),
        ),
        testId('acl-column'),
      )
    ),
    cssNewColItem(
      dom.update(
        selectBox = aclSelect(newColId, unusedColIds, {defaultLabel: '[Add Column]'}),
        cssSelect.cls('-active'),
        dom.on('blur', onBlur),
        dom.onKeyDown({Escape: onBlur}),
        // If starting out in edit mode, focus the select box.
        (editing.get() ? (elem) => { setTimeout(() => elem.focus(), 0); } : null)
      ),
    )
  );
}


const cssColListWidget = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  outline: none;
  margin: 6px 8px;
  cursor: pointer;
  border-radius: 4px;

  border: 1px solid transparent;
  &:not(&-editing):hover {
    border: 1px solid ${theme.accessRulesColumnListBorder};
  }
`);

const cssColItem = styled('div', `
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 3px;
  padding-left: 6px;
  padding-right: 2px;
  color: ${theme.accessRulesColumnItemFg};

  .${cssColListWidget.className}-editing & {
    background-color: ${theme.accessRulesColumnItemBg};
  }
`);

const cssColId = styled('div', `
  flex: auto;
  height: 24px;
  line-height: 24px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssNewColItem = styled('div', `
  margin-top: 2px;
  display: none;
  .${cssColListWidget.className}-editing & {
    display: flex;
  }
`);

const cssColItemIcon = styled('div', `
  flex: none;
  height: 16px;
  width: 16px;
  border-radius: 16px;
  display: none;
  cursor: default;
  --icon-color: ${theme.accessRulesColumnItemIconFg};
  &:hover {
    background-color: ${theme.accessRulesColumnItemIconHoverBg};
    --icon-color: ${theme.accessRulesColumnItemIconHoverFg};
  }
  .${cssColListWidget.className}-editing & {
    display: flex;
  }
`);
