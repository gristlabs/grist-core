import {colors, isNarrowScreen, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IEditorCommandGroup} from 'app/client/widgets/NewBaseEditor';
import {dom, styled} from 'grainjs';

/**
 * Detects if the device likely needs mobile editor buttons.
 *
 * Inspired by:
 * https://stackoverflow.com/questions/4817029/whats-an-optimal-or-efficient-way-to-detect-a-touch-screen-device-using-j
 * avas
 */
function needsMobileButtons(): boolean {
  // Check for touch support
  const hasTouchSupport = Boolean('ontouchstart' in window ||
                         (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

  // Check if primary pointer is coarse (finger/stylus) vs fine (mouse)
  const primaryPointerIsCoarse = window.matchMedia('(pointer: coarse)').matches;

  // Show mobile buttons if device has narrow screen OR (touch AND coarse pointer)
  return isNarrowScreen() || (hasTouchSupport && primaryPointerIsCoarse);
}

/**
 * Creates Save/Cancel icon buttons to show next to the cell editor.
 */
export function createMobileButtons(commands: IEditorCommandGroup) {
  return needsMobileButtons() ? [
    cssCancelBtn(cssIconWrap(cssFinishIcon('CrossSmall')), dom.on('mousedown', commands.fieldEditCancel)),
    cssSaveBtn(cssIconWrap(cssFinishIcon('Tick')), dom.on('mousedown', commands.fieldEditSaveHere)),
  ] : null;
}

export function getButtonMargins() {
  return needsMobileButtons() ? {left: 20, right: 20, top: 0, bottom: 0} : undefined;
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
