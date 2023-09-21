import {isDesktop} from 'app/client/lib/browserInfo';
import {colors, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IEditorCommandGroup} from 'app/client/widgets/NewBaseEditor';
import {dom, styled} from 'grainjs';

/**
 * Creates Save/Cancel icon buttons to show next to the cell editor.
 */
export function createMobileButtons(commands: IEditorCommandGroup) {
  // TODO A better check may be to detect a physical keyboard or touch support.
  return isDesktop() ? null : [
    cssCancelBtn(cssIconWrap(cssFinishIcon('CrossSmall')), dom.on('click', commands.fieldEditCancel)),
    cssSaveBtn(cssIconWrap(cssFinishIcon('Tick')), dom.on('click', commands.fieldEditSaveHere)),
  ];
}

export function getButtonMargins() {
  return isDesktop() ? undefined : {left: 20, right: 20, top: 0, bottom: 0};
}

const cssFinishBtn = styled('div', `
  height: 40px;
  width: 40px;
  padding: 8px;
  position: absolute;
  top: -8px;
  --icon-color: ${theme.controlPrimaryFg};
`);

const cssCancelBtn = styled(cssFinishBtn, `
  --icon-background-color: ${colors.error};
  left: -40px;
`);

const cssSaveBtn = styled(cssFinishBtn, `
  --icon-background-color: ${theme.controlPrimaryBg};
  right: -40px;
`);

const cssIconWrap = styled('div', `
  border-radius: 20px;
  background-color: var(--icon-background-color);
  height: 24px;
  width: 24px;
`);

const cssFinishIcon = styled(icon, `
  height: 24px;
  width: 24px;
`);
