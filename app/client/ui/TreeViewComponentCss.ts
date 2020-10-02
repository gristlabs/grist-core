import { colors, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { styled } from "grainjs";

export const treeViewContainer = styled('div', `
  user-select: none;
  -moz-user-select: none;
  position: relative;
  display: flex;
  flex-direction: row;
  /* adds 2px to make room for the target when shown above the first item */
  margin-top: 2px;
`);

export const itemChildren = styled('div', `
  flex: 1 1 auto;
  min-width: 0;
  .itemContainer.collapsed > & {
    display: none;
  }
`);

export const dragDropContainer = styled('div', `
  position: relative;
`);

// pointer-events: none is set while dragging, to ensure that mouse events are sent to the element
// over which we are dragging, rather than the one being dragged (which is also under the cursor).
export const itemHeaderWrapper = styled('div', `
  display: flex;
  flex-direction: row;

  &.dragged {
    pointer-events: none;
  }
`);

export const itemHeader = styled('div', `
  display: flex;
  flex-direction: row;
  flex-grow: 1;
  min-width: 0;
  border-radius: 0 2px 2px 0;
  border: solid 1px transparent;
  .${itemHeaderWrapper.className}-not-dragging:hover > & {
    background-color: ${colors.mediumGrey};
  }
  .${itemHeaderWrapper.className}-not-dragging > &.selected {
    background-color: ${colors.darkBg};
    color: white;
  }
  &.highlight {
    border-color: ${vars.controlFg};
  }
`);

export const dropdown = styled(icon, `
  background-color: ${colors.slate};
  .${itemHeaderWrapper.className}-not-dragging > .${itemHeader.className}.selected & {
    background-color: white;
  }
`);

export const itemLabelRight = styled('div', `
  --icon-color: ${colors.slate};
  width: 16px;
  .${treeViewContainer.className}-close & {
    display: none;
  }
`);

export const centeredIcon = styled(icon, `
  height: 100%;
  visibility: hidden;
  .${itemHeaderWrapper.className}-not-dragging:hover &, .${itemHeaderWrapper.className}.dragged & {
    visibility: visible;
    cursor: grab;
  }
`);

export const itemLabel = styled('div', `
  flex-grow: 1;
  min-width: 0;
  cursor: pointer;
  .${itemHeaderWrapper.className}.dragged & {
    opacity: 0.5;
    transform: rotate(3deg);
    position: relative;
  }
`);

export const arrow = styled('div', `
  display: flex;
  flex-shrink: 0;
  align-items: center;
  width: 24px;
  justify-content: center;
  .${treeViewContainer.className}-close & {
    display: none;
  }
`);

export const offset = styled('div', `
  flex-shrink: 0;
  .${treeViewContainer.className}-close & {
    display: none;
  }
`);

// I gave target a 2px height in order to make it dstinguishable from the header's highlight which
// is a 1px border of same color. Setting pointer-events to prevent target from grabbing mouse
// events none and causes some intermittent interruptions to the processing of mouse events when
// hovering while dragging.
export const target = styled('div', `
  position: absolute;
  height: 2px;
  background: ${vars.controlFg};
  pointer-events: none;
`);
