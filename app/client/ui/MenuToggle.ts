import { dom, DomArg, IDisposableOwner, styled } from "grainjs";
import { icon } from "app/client/ui2018/icons";
import { colors } from "app/client/ui2018/cssVars";

/**
 * Creates a toggle button - little square button with a dropdown icon inside, used
 * by a context menu for a row inside a grid, a card inside a cardlist and column name.
 */
export function menuToggle(obs: IDisposableOwner, ...args: DomArg[]) {
  const contextMenu = cssMenuToggle(
    icon('Dropdown', dom.cls('menu_toggle_icon')),
    ...args
  );
  return contextMenu;
}

const cssMenuToggle = styled('div.menu_toggle', `
  background: white;
  cursor: pointer;
  --icon-color: ${colors.slate};
  border: 1px solid ${colors.slate};
  border-radius: 4px;
  &:hover  {
    --icon-color: ${colors.darkGreen};
    border-color: ${colors.darkGreen};
  }
  &:active  {
    --icon-color: ${colors.darkerGreen};
    border-color: ${colors.darkerGreen};
  }
  & > .menu_toggle_icon {
    display: block; /* don't create a line */
  }
`);
