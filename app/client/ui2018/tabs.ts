import { makeTestId } from 'app/client/lib/domUtils';
import { urlState } from 'app/client/models/gristUrlState';
import { isNarrowScreenObs, theme } from 'app/client/ui2018/cssVars';
import { IconName } from 'app/client/ui2018/IconList';
import { icon as cssIcon } from 'app/client/ui2018/icons';
import { IGristUrlState } from 'app/common/gristUrls';
import { useBindable } from 'app/common/gutil';
import { BindableValue, dom, IDomArgs, MaybeObsArray, styled, UseCBOwner } from 'grainjs';

const testId = makeTestId("test-component-tabs-");

export interface TabProps {
  /** Label to show */
  label: string;
  /* Optional id to use for selected comparison. If not provided label will be compared */
  id?: string;
  /** Icon to show */
  icon?: IconName;
  /** Function to call when tab is clicked */
  onClick?: () => void;
  /** Grist Link state to switch to when tab is clicked. */
  link?: IGristUrlState;
}

export function buildTabs(
  tabs: MaybeObsArray<TabProps>,
  selected: BindableValue<string|null|undefined>,
  ...args: IDomArgs<HTMLDivElement>
) {
  const isSelected = (tab: TabProps) => (use: UseCBOwner) => useBindable(use, selected) === (tab.id ?? tab.label);
  return cssTabs(
    dom.forEach(tabs, tab => cssTab(
      cssIconAndLabel(!tab.icon ? null : cssTabIcon(tab.icon, dom.hide(isNarrowScreenObs())),

        // The combination with space makes the label as wide as its bold version,
        // to avoid slight shifts of other labels when switching tabs.
        dom('div', tab.label, cssBoldLabelSpacer(tab.label))),

      cssTab.cls("-selected", isSelected(tab)),

      tab.onClick && dom.on('click', tab.onClick.bind(tab)),

      tab.link && urlState().setLinkUrl(tab.link, { replace: true }),

      testId('tab'),
      testId('tab-selected', isSelected(tab)),
    )),
    testId('list'),
    ...args,
  );
}

export const cssTabs = styled("div", `
  flex-grow: 1;
  display: flex;
  border-bottom: 1px solid ${theme.tableBodyBorder};
  user-select: none;
`);

export const cssTab = styled("a", `
  display: block;
  padding: 8px 16px;
  color: ${theme.mediumText};
  --icon-color: ${theme.lightText};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;

  &:hover, &:focus {
    color: ${theme.mediumText};
    text-decoration: none;
  }

  &-selected {
    --icon-color: ${theme.controlFg};
    font-weight: 700;
    border-bottom: 2px solid ${theme.controlFg};
    margin-bottom: -1px;
  }
`);

const cssIconAndLabel = styled("div", `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);

const cssBoldLabelSpacer = styled("div", `
  font-weight: bold;
  height: 1px;
  color: transparent;
  overflow: hidden;
  visibility: hidden;
`);

const cssTabIcon = styled(cssIcon, `
  width: 20px;
  height: 20px;
`);
