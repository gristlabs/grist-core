import {theme} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const ShortcutKeyContent = styled('span', `
  font-style: normal;
  font-family: inherit;
  color: ${theme.shortcutKeyPrimaryFg};
`);

export const ShortcutKeyContentStrong = styled(ShortcutKeyContent, `
  font-weight: 700;
`);

export const ShortcutKey = styled('div', `
  display: inline-block;
  padding: 2px 5px;
  border-radius: 4px;
  margin: 0px 2px;
  border: 1px solid ${theme.shortcutKeyBorder};
  color: ${theme.shortcutKeyFg};
  background-color: ${theme.shortcutKeyBg};
  font-family: inherit;
  font-style: normal;
  white-space: nowrap;
`);
