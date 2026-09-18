import { shadowScroll } from "app/client/ui/shadowScroll";
import { mediaSmall, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssModalButtons, cssModalCloseButton } from "app/client/ui2018/modals";
import { components, tokens } from "app/common/ThemePrefs";

import { styled } from "grainjs";

export const cssImportModal = styled("div", `
  height: min(480px, 90vh);
  min-width: 600px;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  position: relative;

  @media ${mediaSmall} {
    & {
      width: 100%;
      min-width: unset;
    }
  }
`);

export const cssImportModalCloseButton = styled(cssModalCloseButton, `
  position: absolute;
  top: 16px;
  right: 16px;
  margin: 0;
`);

export const cssHelperText = styled("div", `
  color: ${theme.lightText};
`);

export const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
`);

export const cssScrollableContent = styled(shadowScroll, `
  flex: 1 1 auto;
  width: auto;
  margin: 0 -64px;
  padding: 16px 64px 24px 64px;
  border-bottom: 1px solid ${theme.modalBorderDark};

  &-inert {
    opacity: 0.4;
  }

  @media ${mediaSmall} {
    & {
      margin: 0 -16px;
      padding: 16px;
    }
  }
`);

export const cssFooterButtons = styled(cssModalButtons, `
  display: flex;
  flex-wrap: wrap;
  margin: 16px 0 -16px 0;
  row-gap: 8px;
`);

export const cssMappingsGrid = styled("div", `
  align-items: baseline;
  display: grid;
  gap: 16px;
  grid-template-columns: auto minmax(220px, auto) minmax(160px, auto) auto;

  @media ${mediaSmall} {
    & {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
  }
`);

export const cssMappingsHeaderColumn = styled("div", `
  color: ${components.mediumText};
  font-size: ${tokens.smallFontSize};
  text-transform: uppercase;
`);

export const cssIncludeColumn = styled("div", `
  align-self: center;
  display: flex;
  grid-column: 1;
`);

export const cssTableNameColumn = styled("div", `
  font-weight: bold;
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

export const cssTableIconAndName = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

export const cssTableIcon = styled(icon, `
  flex-shrink: 0;
  --icon-color: ${theme.accentIcon};
`);

export const cssTableName = styled("div", `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

export const cssDestinationMenu = styled("div", `
  grid-column: 3;
`);

export const cssDestinationIconAndName = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
`);

export const cssDestinationIcon = styled(icon, `
  flex-shrink: 0;
  --icon-color: ${theme.accentIcon};
`);

export const cssDestinationName = styled("div", `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

export const cssAccentIconColor = styled("div", `
  --icon-color: ${theme.accentIcon};
`);

export const cssTableWarnings = styled("div", `
  align-items: center;
  display: flex;
  gap: 4px;

  @media ${mediaSmall} {
    & {
      grid-column-start: 2;
      grid-column-end: 4;
      margin-bottom: 8px;
    }
  }
`);

export const cssWarningIcon = styled(icon, `
  flex-shrink: 0;
  height: 20px;
  width: 20px;
  --icon-color: ${theme.iconError};
`);

export const cssWarningsLabel = styled("div", `
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);

export const cssWarningsList = styled("ul", `
  margin: 0px;
  max-width: 400px;
  padding: 8px 16px;
  text-align: left;
`);
