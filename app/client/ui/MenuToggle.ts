import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { dom, DomArg, IDisposableOwner, styled } from "grainjs";

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
  background: ${theme.menuToggleBg};
  cursor: pointer;
  --icon-color: ${theme.menuToggleFg};
  border: 1px solid ${theme.menuToggleBorder};
  border-radius: 4px;
  &:hover  {
    --icon-color: ${theme.menuToggleHoverFg};
    border-color: ${theme.menuToggleHoverFg};
  }
  &:active  {
    --icon-color: ${theme.menuToggleActiveFg};
    border-color: ${theme.menuToggleActiveFg};
  }
  & > .menu_toggle_icon {
    display: block; /* don't create a line */
  }
`);
