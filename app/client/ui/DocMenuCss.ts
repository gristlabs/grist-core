import {transientInput} from 'app/client/ui/transientInput';
import {colors, mediaSmall, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';

// The "&:after" clause forces some padding below all docs.
export const docList = styled('div', `
  height: 100%;
  padding: 32px 64px 24px 64px;
  overflow-y: auto;
  position: relative;

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
`);

export const docListHeader = styled('div', `
  height: 32px;
  line-height: 32px;
  margin-bottom: 24px;
  color: ${colors.dark};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

export const templatesHeader = styled(docListHeader, `
  cursor: pointer;
`);

export const featuredTemplatesHeader = styled(docListHeader, `
  display: flex;
  align-items: center;
`);

export const docBlock = styled('div', `
  max-width: 550px;
  min-width: 300px;
  margin-bottom: 28px;

  &-icons {
    max-width: unset;
  }
`);

export const templatesDocBlock = styled(docBlock, `
  margin-top: 32px;
`);

export const docHeaderIconDark = styled(icon, `
  margin-right: 8px;
  margin-top: -3px;
`);

export const docHeaderIcon = styled(docHeaderIconDark, `
  --icon-color: ${colors.slate};
`);

export const featuredTemplatesIcon = styled(icon, `
  margin-right: 8px;
  width: 20px;
  height: 20px;
`);

export const templatesHeaderIcon = styled(docHeaderIcon, `
  width: 24px;
  height: 24px;
`);

const docBlockHeader = `
  display: flex;
  align-items: center;
  height: 40px;
  line-height: 40px;
  margin-bottom: 8px;
  margin-right: -16px;
  color: ${colors.dark};
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
  flex: 1 0 50%;
  min-width: 0px;
  margin-right: 24px;
`);

export const docRowWrapper = styled('div', `
  position: relative;
  margin: 0px -16px 8px -16px;
  border-radius: 3px;
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
  --icon-color: ${colors.slate};

  &:hover, &.weasel-popup-open, &-renaming {
    background-color: ${colors.mediumGrey};
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
    color: ${colors.slate};
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
  --icon-color: ${colors.lightGreen};
`);

export const docPublicIcon = styled(icon, `
  flex: none;
  margin-left: auto;
  --icon-color: ${colors.lightGreen};
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
  color: ${colors.slate};
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
  --icon-color: ${colors.darkGrey};
  .${docRowLink.className}:hover > & {
    --icon-color: ${colors.slate};
  }
  &:hover, &.weasel-popup-open {
    background-color: ${colors.darkGrey};
    --icon-color: ${colors.slate};
  }
`);

export const moveDocModalBody = styled('div', `
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid ${colors.darkGrey};
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
    background-color: ${colors.lightGreen};
    color: white;
  }
  &-disabled {
    color: ${colors.darkGrey};
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
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};

  &:focus, &:hover {
    outline: none;
    box-shadow: none;
    background-color: ${colors.mediumGrey};
  }
  @media ${mediaSmall} {
    & {
      margin-right: 0;
    }
  }
`);
