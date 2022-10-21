import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {reportSuccess} from 'app/client/models/errors';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {modalTooltip} from 'app/client/ui2018/modals';
import {dom, DomContents, observable, styled} from 'grainjs';

/**
 * This is a file for all custom and pre-configured popups, modals, toasts and tooltips, used
 * in more then one component.
 */

/**
 * Tooltip or popup to confirm row deletion.
 */
export function buildConfirmDelete(
  refElement: Element,
  onSave: (remember: boolean) => void,
  single = true,
) {
  const remember = observable(false);
  const tooltip = modalTooltip(refElement, (ctl) =>
    cssContainer(
      dom.autoDispose(remember),
      testId('confirm-deleteRows'),
      testId('confirm-popup'),
      elem => { FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}); },
      dom.onKeyDown({
        Escape: () => ctl.close(),
        Enter: () => { onSave(remember.get()); ctl.close(); },
      }),
      dom('div', `Are you sure you want to delete ${single ? 'this' : 'these'} record${single ? '' : 's'}?`,
        dom.style('margin-bottom', '10px'),
      ),
      cssButtons(
        dom.style('margin-bottom', '12px'),
        primaryButton('Delete', testId('confirm-save'), dom.on('click', () => {
          onSave(remember.get());
          ctl.close();
        })),
        basicButton('Cancel', testId('confirm-cancel'), dom.on('click', () => ctl.close()))
      ),
      dom('div',
        labeledSquareCheckbox(remember, "Don't ask again.", testId('confirm-remember')),
      )
    ), {}
  );
  // Attach this tooltip to a cell so that it is automatically closed when the cell is disposed.
  // or scrolled out of view (and then disposed).
  dom.onDisposeElem(refElement, () => {
    if (!tooltip.isDisposed()) {
      tooltip.close();
    }
  });
  return tooltip;
}

export function showDeprecatedWarning(
  refElement: Element,
  content: DomContents
) {
  const tooltip = modalTooltip(refElement, (ctl) =>
    cssWideContainer(
      testId('popup-warning-deprecated'),
      elem => { FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}); },
      dom.onKeyDown({
        Escape: () => ctl.close(),
        Enter: () => ctl.close(),
      }),
      content,
      cssButtons(
        dom.style('margin-top', '12px'),
        dom.style('justify-content', 'right'),
        basicButton('Close', testId('confirm-cancel'), dom.on('click', () => ctl.close()))
      ),
    )
  );
  // Attach this warning to a cell so that it is automatically closed when the cell is disposed.
  // or scrolled out of view (and then disposed).
  dom.onDisposeElem(refElement, () => {
    if (!tooltip.isDisposed()) {
      tooltip.close();
    }
  });
  return tooltip;
}

/**
 * Shows notification with a single button 'Undo' delete.
 */
export function reportUndo(
  doc: GristDoc,
  messageLabel: string,
  buttonLabel = 'Undo to restore'
) {
  // First create a notification with a button to undo the delete.
  let notification = reportSuccess(messageLabel, {
    key: 'undo',
    actions: [{
      label: buttonLabel,
      action: () => {
        // When user clicks on the button, undo the last action.
        commands.allCommands.undo.run();
        // And remove this notification.
        close();
      },
    }]
  });

  // When we received some actions from the server, cancel this popup,
  // as the undo might do something else.
  doc.on('onDocUserAction', close);
  notification?.onDispose(() => doc.off('onDocUserAction', close));

  function close() {
    if (notification && !notification?.isDisposed()) {
      notification.dispose();
      notification = undefined;
    }
  }
}

const cssTheme = styled('div', `
  color: ${theme.text};
`);

const cssButtons = styled('div', `
  display: flex;
  gap: 6px;
`);

const cssContainer = styled(cssTheme, `
  max-width: 210px;
`);

const cssWideContainer = styled(cssTheme, `
  max-width: 340px;
`);
