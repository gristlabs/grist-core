import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {reportSuccess} from 'app/client/models/errors';
import {basicButton, bigPrimaryButton, primaryButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssModalTooltip, modalTooltip} from 'app/client/ui2018/modals';
import {dom, DomContents, keyframes, observable, styled, svg} from 'grainjs';
import {IPopupOptions} from 'popweasel';
import merge = require('lodash/merge');

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
      dom('div',
        labeledSquareCheckbox(remember, "Don't ask again.", testId('confirm-remember')),
        dom.style('margin-bottom', '10px'),
      ),
      cssButtons(
        primaryButton('Delete', testId('confirm-save'), dom.on('click', () => {
          onSave(remember.get());
          ctl.close();
        })),
        basicButton('Cancel', testId('confirm-cancel'), dom.on('click', () => ctl.close()))
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
  content: DomContents,
  onClose: (checked: boolean) => void,
) {
  const remember = observable(false);
  const tooltip = modalTooltip(refElement, (ctl) =>
    cssWideContainer(
      testId('popup-warning-deprecated'),
      elem => { FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}); },
      dom.onKeyDown({
        Escape: () => { ctl.close(); onClose(remember.get()); },
        Enter: () => { ctl.close(); onClose(remember.get()); },
      }),
      content,
      cssButtons(
        dom.style('margin-top', '12px'),
        dom.style('justify-content', 'space-between'),
        dom.style('align-items', 'center'),
        dom('div',
          labeledSquareCheckbox(remember, "Don't show again.", testId('confirm-remember')),
        ),
        basicButton('Dismiss', testId('confirm-save'),
          dom.on('click', () => { ctl.close(); onClose(remember.get()); })
        )
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

export interface ShowBehavioralPromptOptions {
  onClose: (dontShowTips: boolean) => void;
  /** Defaults to false. */
  hideArrow?: boolean;
  popupOptions?: IPopupOptions;
}

export function showBehavioralPrompt(
  refElement: Element,
  title: string,
  content: DomContents,
  options: ShowBehavioralPromptOptions
) {
  const {onClose, hideArrow, popupOptions} = options;
  const arrow = hideArrow ? null : buildArrow();
  const dontShowTips = observable(false);
  const tooltip = modalTooltip(refElement,
    (ctl) => [
      cssBehavioralPromptModal.cls(''),
      arrow,
      cssBehavioralPromptContainer(
        dom.autoDispose(dontShowTips),
        testId('behavioral-prompt'),
        elem => { FocusLayer.create(ctl, {defaultFocusElem: elem, pauseMousetrap: true}); },
        dom.onKeyDown({
          Escape: () => ctl.close(),
          Enter: () => { onClose(dontShowTips.get()); ctl.close(); },
        }),
        cssBehavioralPromptHeader(
          cssHeaderIconAndText(
            icon('Idea'),
            cssHeaderText('TIP'),
          ),
        ),
        cssBehavioralPromptBody(
          cssBehavioralPromptTitle(title, testId('behavioral-prompt-title')),
          content,
          cssButtons(
            dom.style('margin-top', '12px'),
            dom.style('justify-content', 'space-between'),
            dom.style('align-items', 'center'),
            dom('div',
              cssSkipTipsCheckbox(dontShowTips,
                cssSkipTipsCheckboxLabel("Don't show tips"),
                testId('behavioral-prompt-dont-show-tips')
              ),
            ),
            cssDismissPromptButton('Got it', testId('behavioral-prompt-dismiss'),
              dom.on('click', () => { onClose(dontShowTips.get()); ctl.close(); })
            ),
          ),
        ),
      ),
    ],
    merge(popupOptions, {
      modifiers: {
        ...(arrow ? {arrow: {element: arrow}}: {}),
        offset: {
          offset: '0,12',
        },
      }
    })
  );
  dom.onDisposeElem(refElement, () => {
    if (!tooltip.isDisposed()) {
      tooltip.close();
    }
  });
  return tooltip;
}

function buildArrow() {
  return cssArrowContainer(
    svg('svg',
      {style: 'width: 13px; height: 18px;'},
      svg('path', {'d': 'M 0 0 h 13 v 18 Z'}),
    ),
  );
}

function sideSelectorChunk(side: 'top'|'bottom'|'left'|'right') {
  return `.${cssModalTooltip.className}[x-placement^=${side}]`;
}

function fadeInFromSide(side: 'top'|'bottom'|'left'|'right') {
  let startPosition: string;
  switch(side) {
    case 'top': {
      startPosition = '0px -25px';
      break;
    }
    case 'bottom': {
      startPosition = '0px 25px';
      break;
    }
    case'left': {
      startPosition = '-25px 0px';
      break;
    }
    case 'right': {
      startPosition = '25px 0px';
      break;
    }
  }
  return keyframes(`
  from {translate: ${startPosition}; opacity: 0;}
  to {translate: 0px 0px; opacity: 1;}
  `);
}

const HEADER_HEIGHT_PX = 30;

const cssArrowContainer = styled('div', `
  position: absolute;

  & path {
    stroke: ${theme.popupBg};
    stroke-width: 2px;
    fill: ${theme.popupBg};
  }

  ${sideSelectorChunk('bottom')} > & path {
    stroke: ${theme.controlPrimaryBg};
    fill: ${theme.controlPrimaryBg};
  }

  ${sideSelectorChunk('top')} > & {
    bottom: -17px;
  }

  ${sideSelectorChunk('bottom')} > & {
    top: -14px;
  }

  ${sideSelectorChunk('right')} > & {
    left: -12px;
    margin: ${HEADER_HEIGHT_PX}px 0px ${HEADER_HEIGHT_PX}px 0px;
  }

  ${sideSelectorChunk('left')} > & {
    right: -12px;
    margin: ${HEADER_HEIGHT_PX}px 0px ${HEADER_HEIGHT_PX}px 0px;
  }

  ${sideSelectorChunk('top')} svg {
    transform: rotate(-90deg);
  }

  ${sideSelectorChunk('bottom')} svg {
    transform: rotate(90deg);
  }

  ${sideSelectorChunk('left')} svg {
    transform: scalex(-1);
  }
`);

const cssTheme = styled('div', `
  color: ${theme.text};
`);

const cssButtons = styled('div', `
  display: flex;
  gap: 6px;
`);

const cssContainer = styled(cssTheme, `
  max-width: 270px;
`);

const cssWideContainer = styled(cssTheme, `
  max-width: 340px;
`);

const cssFadeInFromTop = fadeInFromSide('top');

const cssFadeInFromBottom = fadeInFromSide('bottom');

const cssFadeInFromLeft = fadeInFromSide('left');

const cssFadeInFromRight = fadeInFromSide('right');

const cssBehavioralPromptModal = styled('div', `
  margin: 0px;
  padding: 0px;
  width: 400px;
  border-radius: 4px;

  animation-duration: 0.4s;
  position: relative;

  &[x-placement^=top] {
    animation-name: ${cssFadeInFromTop};
  }

  &[x-placement^=bottom] {
    animation-name: ${cssFadeInFromBottom};
  }

  &[x-placement^=left] {
    animation-name: ${cssFadeInFromLeft};
  }

  &[x-placement^=right] {
    animation-name: ${cssFadeInFromRight};
  }
`);

const cssBehavioralPromptContainer = styled(cssTheme, `
  line-height: 18px;
`);

const cssBehavioralPromptHeader = styled('div', `
  display: flex;
  justify-content: center;
  background-color: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  --icon-color: ${theme.controlPrimaryFg};
  border-radius: 4px 4px 0px 0px;
  line-height: ${HEADER_HEIGHT_PX}px;
`);

const cssBehavioralPromptBody = styled('div', `
  padding: 16px;
`);

const cssHeaderIconAndText = styled('div', `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);

const cssHeaderText = styled('div', `
  font-weight: 600;
`);

const cssDismissPromptButton = styled(bigPrimaryButton, `
  margin-right: 8px;
`);

const cssBehavioralPromptTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
  margin: 0 0 16px 0;
  line-height: 32px;
`);

const cssSkipTipsCheckbox = styled(labeledSquareCheckbox, `
  line-height: normal;
`);


const cssSkipTipsCheckboxLabel = styled('span', `
  color: ${theme.lightText};
`);
