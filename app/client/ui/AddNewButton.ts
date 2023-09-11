import {theme, vars} from 'app/client/ui2018/cssVars';
import {makeT} from 'app/client/lib/localization';
import {icon} from 'app/client/ui2018/icons';
import {dom, DomElementArg, Observable, styled} from "grainjs";

const t = makeT(`AddNewButton`);

export function addNewButton(
  {
    isOpen,
    isDisabled = false,
  }: {
    isOpen: Observable<boolean> | boolean,
    isDisabled?: boolean
  },
  ...args: DomElementArg[]
) {
  return cssAddNewButton(
    cssAddNewButton.cls('-open', isOpen),
    cssAddNewButton.cls('-disabled', isDisabled),
    // Setting spacing as flex items allows them to shrink faster when there isn't enough space.
    cssLeftMargin(),
    cssAddText(t("Add New")),
    dom('div', {style: 'flex: 1 1 16px'}),
    cssPlusButton(
      cssPlusButton.cls('-disabled', isDisabled),
      cssPlusIcon('Plus')
    ),
    dom('div', {style: 'flex: 0 1 16px'}),
    ...args,
  );
}

export const cssAddNewButton = styled('div', `
  display: flex;
  align-items: center;
  margin: 22px 0px 22px 0px;
  height: 40px;
  color: ${theme.controlPrimaryFg};
  border: none;
  border-radius: 4px;

  cursor: default;
  text-align: left;
  font-size: ${vars.bigControlFontSize};
  font-weight: bold;
  overflow: hidden;

  --circle-color: ${theme.addNewCircleSmallBg};

  &:hover, &.weasel-popup-open {
    --circle-color: ${theme.addNewCircleSmallHoverBg};
  }
  &-open {
    margin: 22px 16px 22px 16px;
    background-color: ${theme.controlPrimaryBg};
    --circle-color: ${theme.addNewCircleBg};
  }
  &-open:hover, &-open.weasel-popup-open {
    background-color: ${theme.controlPrimaryHoverBg};
    --circle-color: ${theme.addNewCircleHoverBg};
  }

  &-disabled, &-disabled:hover {
    color: ${theme.controlDisabledFg};
    background-color: ${theme.controlDisabledBg}
  }
`);
const cssLeftMargin = styled('div', `
  flex: 0 1 24px;
  display: none;
  .${cssAddNewButton.className}-open & {
    display: block;
  }
`);
const cssAddText = styled('div', `
  color: ${theme.controlPrimaryFg};
  flex: 0 0.5 content;
  white-space: nowrap;
  min-width: 0px;
  display: none;
  .${cssAddNewButton.className}-open & {
    display: block;
  }
`);
const cssPlusButton = styled('div', `
  flex: none;
  height: 28px;
  width: 28px;
  border-radius: 14px;
  background-color: var(--circle-color);
  text-align: center;
  &-disabled {
    background-color: ${theme.controlDisabledBg};
  }
`);
const cssPlusIcon = styled(icon, `
  background-color: ${theme.addNewCircleFg};
  margin-top: 6px;
`);
