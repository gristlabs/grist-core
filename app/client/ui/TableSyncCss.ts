import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";

import { styled } from "grainjs";

const narrowSyncCell = "@container (max-width: 71px)"; // 71px figured out experimentally

export const cssSyncCell = styled("div", `
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  container-type: inline-size;
`);

export const cssAllowed = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: ${vars.smallFontSize};
  line-height: 18px;
  color: ${theme.text};
`);

export const cssAllowedIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
  flex-shrink: 0;
  width: 12px;
  height: 12px;
`);

export const cssSyncLabel = styled("span", `
  text-transform: uppercase;
  letter-spacing: 0.81px;
  font-weight: 500;
  font-size: 9px;
  margin-right: 2px;
  flex: none;
  white-space: nowrap;
  color: ${theme.lightText};
  overflow: hidden;
  text-overflow: ellipsis;
  ${narrowSyncCell} {
    & {
      display: none;
    }
  }
`);

export const cssSyncText = styled("span", `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${narrowSyncCell} {
    & {
      display: none;
    }
  }
`);
