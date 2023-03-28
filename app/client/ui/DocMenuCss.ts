import {transientInput} from 'app/client/ui/transientInput';
import {mediaSmall, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';
import {bigBasicButton} from 'app/client/ui2018/buttons';

// Import popweasel to ensure that sortSelector style below comes later in CSS than popweasel
// styles, which gives it priority.
import 'popweasel';

// The "&:after" clause forces some padding below all docs.
export const docList = styled('div', `
  height: 100%;
  padding: 32px 64px 24px 64px;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;

  &:after {
    content: "";
    display: block;
    height: 64px;
  }
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
  @media print {
    & {
      display: none;
    }
  }
`);

export const docListContent = styled('div', `
  display: flex;
`);

export const docMenu = styled('div', `
  flex-grow: 1;
  max-width: 100%;
`);

const listHeader = styled('div', `
  min-height: 32px;
  line-height: 32px;
  color: ${theme.text};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

export const docListHeader = styled(listHeader, `
  margin-bottom: 24px;
`);

export const templatesHeaderWrap = styled('div', `
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;

  @media ${mediaSmall} {
    & {
      flex-direction: column;
      align-items: flex-start;
    }
  }
`);

export const templatesHeader = styled(listHeader, `
  cursor: pointer;
`);

export const featuredTemplatesHeader = styled(docListHeader, `
  display: flex;
  align-items: center;
`);

export const otherSitesHeader = templatesHeader;

export const allDocsTemplates = styled('div', `
  display: flex;
`);

export const docBlock = styled('div', `
  color: ${theme.text};
  max-width: 550px;
  min-width: 300px;
  margin-bottom: 28px;

  &-icons {
    max-width: max-content;
    min-width: calc(min(550px, 100%));
  }
`);

export const templatesDocBlock = styled(docBlock, `
  margin-top: 32px;
`);

export const otherSitesBlock = styled('div', `
  color: ${theme.text};
  margin-bottom: 32px;
`);

export const otherSitesButtons = styled('div', `
  display: flex;
  overflow: auto;
  padding-bottom: 16px;
  margin-top: 16px;
  margin-bottom: 28px;
  gap: 16px;
`);

export const siteButton = styled(bigBasicButton, `
  flex: 0 0 auto;
`);

export const docHeaderIcon = styled(icon, `
  margin-right: 8px;
  margin-top: -3px;
  --icon-color: ${theme.lightText};
`);

export const pinnedDocsIcon = styled(docHeaderIcon, `
  --icon-color: ${theme.text};
`);

export const featuredTemplatesIcon = styled(icon, `
  --icon-color: ${theme.text};
  margin-right: 8px;
  width: 20px;
  height: 20px;
`);

export const templatesHeaderIcon = styled(docHeaderIcon, `
  width: 24px;
  height: 24px;
`);

export const otherSitesHeaderIcon = templatesHeaderIcon;

const docBlockHeader = `
  display: flex;
  align-items: center;
  height: 40px;
  line-height: 40px;
  margin-bottom: 8px;
  margin-right: -16px;
  color: ${theme.text};
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }
`;

export const docBlockHeaderLink = styled('a', docBlockHeader);

export const templateBlockHeader = styled('div', docBlockHeader);

export const wsLeft = styled('div', `
  color: ${theme.text};
  flex: 1 0 50%;
  min-width: 0px;
  margin-right: 24px;
`);

export const docRowWrapper = styled('div', `
  position: relative;
  margin: 0px -16px 8px -16px;
  border-radius: 3px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  --icon-color: ${theme.lightText};

  &:hover, &.weasel-popup-open, &-renaming {
    background-color: ${theme.hover};
  }
`);

export const docRowLink = styled('a', `
  display: flex;
  align-items: center;
  height: 40px;
  line-height: 40px;
  border-radius: 3px;
  outline: none;
  transition: background-color 2s;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }
  &-no-access, &-no-access:hover, &-no-access:focus {
    color: ${theme.disabledText};
    cursor: not-allowed;
  }
`);

export const docLeft = styled('div', `
  flex: 1 0 50%;
  min-width: 0px;
  margin: 0 16px;
  display: flex;
  align-items: center;
`);

export const docName = styled('div', `
  flex: 0 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

export const docPinIcon = styled(icon, `
  flex: none;
  margin-left: 4px;
  --icon-color: ${theme.accentIcon};
`);

export const docPublicIcon = styled(icon, `
  flex: none;
  margin-left: auto;
  --icon-color: ${theme.accentIcon};
`);

export const docEditorInput = styled(transientInput, `
  flex: 1 0 50%;
  min-width: 0px;
  margin: 0 16px;
  color: initial;
  font-size: inherit;
  line-height: initial;
`);

export const docRowUpdatedAt = styled('div', `
  flex: 1 1 50%;
  color: ${theme.lightText};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: normal;
`);

export const docMenuTrigger = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: default;
  --icon-color: ${theme.docMenuDocOptionsFg};
  .${docRowLink.className}:hover > & {
    --icon-color: ${theme.docMenuDocOptionsHoverFg};
  }
  &:hover, &.weasel-popup-open {
    background-color: ${theme.docMenuDocOptionsHoverBg};
    --icon-color: ${theme.docMenuDocOptionsHoverFg};
  }
`);

export const moveDocModalBody = styled('div', `
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid ${theme.modalBorderDark};
  margin: 0 -64px;
  height: 200px;
`);

export const moveDocListItem = styled('div', `
  display: flex;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 12px 64px;
  cursor: pointer;
  font-size: ${vars.mediumFontSize};

  &-selected {
    background-color: ${theme.moveDocsSelectedBg};
    color: ${theme.moveDocsSelectedFg};
  }
  &-disabled {
    color: ${theme.moveDocsDisabledFg};
    cursor: default;
  }
`);

export const moveDocListText = styled('div', `
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  justify-content: center;
`);

export const moveDocListHintText = styled(moveDocListText, `
  text-align: right;
`);

export const spinner = styled('div', `
  display: flex;
  align-items: center;
  height: 80px;
  margin: auto;
  margin-top: 80px;
`);

export const prefSelectors = styled('div', `
  float: right;
  display: flex;
  align-items: center;
`);

export const sortSelector = styled('div', `
  margin-right: 24px;

  /* negate the styles of a select that normally looks like a button */
  border: none;
  display: inline-flex;
  height: unset;
  line-height: unset;
  align-items: center;
  border-radius: ${vars.controlBorderRadius};
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  background-color: unset;

  &:focus, &:hover {
    outline: none;
    box-shadow: none;
    background-color: ${theme.hover};
  }
  @media ${mediaSmall} {
    & {
      margin-right: 0;
    }
  }
`);

export const upgradeButton = styled('div', `
  margin-left: 32px;

  @media ${mediaSmall} {
    & {
      margin-left: 8px;
    }
  }
`);

export const upgradeCard = styled('div', `
  margin-left: 64px;
`);
