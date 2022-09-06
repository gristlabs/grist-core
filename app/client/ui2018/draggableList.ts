import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';

// TODO: Update and move koForm draggableList here.

// Drag icon for use in koForm draggableList.
export const cssDragger = styled((...args: any[]) => icon('DragDrop', testId('dragger'), ...args), `
  --icon-color: ${theme.controlSecondaryFg};
  visibility: hidden;
  align-self: center;
  flex-shrink: 0;
  .kf_draggable:hover & {
    visibility: visible;
  }
`);
