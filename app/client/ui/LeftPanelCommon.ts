/**
 * These styles are used in HomeLeftPanel, and in Tools for the document left panel.
 * They work in a structure like this:
 *
 *    import * as css from 'app/client/ui/LeftPanelStyles';
 *    css.cssLeftPanel(
 *      css.cssScrollPane(
 *        css.cssTools(
 *          css.cssSectionHeader(...),
 *          css.cssPageEntry(css.cssPageLink(cssPageIcon(...), css.cssLinkText(...))),
 *          css.cssPageEntry(css.cssPageLink(cssPageIcon(...), css.cssLinkText(...))),
 *        )
 *      )
 *    )
 */
import {beaconOpenMessage} from 'app/client/lib/helpScout';
import {t} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {dom, DomContents, Observable, styled} from 'grainjs';

const translate = (x: string, args?: any): string => t(`LeftPanelCommon.${x}`, args);

/**
 * Creates the "help tools", a button/link to open HelpScout beacon, and one to open the
 * HelpCenter in a new tab.
 */
export function createHelpTools(appModel: AppModel): DomContents {
  if (shouldHideUiElement("helpCenter")) {
    return [];
  }
  return cssSplitPageEntry(
    cssPageEntryMain(
      cssPageLink(cssPageIcon('Help'),
        cssLinkText(translate('HelpCenter')),
        dom.cls('tour-help-center'),
        dom.on('click', (ev) => beaconOpenMessage({appModel})),
        testId('left-feedback'),
      ),
    ),
    cssPageEntrySmall(
      cssPageLink(cssPageIcon('FieldLink'),
        {href: commonUrls.help, target: '_blank'},
      ),
    ),
  );
}

/**
 * Creates a basic left panel, used in error and billing pages. It only contains the help tools.
 */
export function leftPanelBasic(appModel: AppModel, panelOpen: Observable<boolean>) {
  return cssLeftPanel(
    cssScrollPane(
      cssTools(
        cssTools.cls('-collapsed', (use) => !use(panelOpen)),
        cssSpacer(),
        createHelpTools(appModel),
      )
    )
  );
}


export const cssLeftPanel = styled('div', `
  flex: 1 1 0px;
  font-size: ${vars.mediumFontSize};
  display: flex;
  flex-direction: column;
`);

export const cssScrollPane = styled('div', `
  flex: 1 1 0px;
  overflow: hidden auto;
  display: flex;
  flex-direction: column;
`);

export const cssTools = styled('div', `
  flex: none;
  margin-top: auto;
  padding: 16px 0 16px 0;
`);

export const cssSectionHeader = styled('div', `
  margin: 24px 0 8px 24px;
  color: ${theme.lightText};
  text-transform: uppercase;
  font-weight: 500;
  font-size: ${vars.xsmallFontSize};
  letter-spacing: 1px;
  .${cssTools.className}-collapsed > & {
    visibility: hidden;
  }
`);

export const cssPageEntry = styled('div', `
  margin: 0px 16px 0px 0px;
  border-radius: 0 3px 3px 0;
  color: ${theme.text};
  --icon-color: ${theme.lightText};
  cursor: default;

  &:hover, &.weasel-popup-open, &-renaming {
    background-color: ${theme.pageHoverBg};
  }
  &-selected, &-selected:hover, &-selected.weasel-popup-open {
    background-color: ${theme.activePageBg};
    color: ${theme.activePageFg};
    --icon-color: ${theme.activePageFg};
  }
  &-disabled, &-disabled:hover, &-disabled.weasel-popup-open {
    background-color: initial;
    color: ${theme.disabledPageFg};
    --icon-color: ${theme.disabledPageFg};
  }
  .${cssTools.className}-collapsed > & {
    margin-right: 0;
  }
`);

export const cssPageLink = styled('a', `
  display: flex;
  align-items: center;
  height: 32px;
  line-height: 32px;
  padding-left: 24px;
  outline: none;
  cursor: pointer;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }
  .${cssTools.className}-collapsed & {
    padding-left: 16px;
  }
`);

export const cssLinkText = styled('span', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);

export const cssPageIcon = styled(icon, `
  flex: none;
  margin-right: var(--page-icon-margin, 8px);
  .${cssTools.className}-collapsed & {
    margin-right: 0;
  }
`);

export const cssSpacer = styled('div', `
  height: 18px;
`);

export const cssSplitPageEntry = styled('div', `
  display: flex;
  align-items: center;
`);

export const cssPageEntryMain = styled(cssPageEntry, `
  flex: auto;
  margin: 0;
  min-width: 0px;
`);

export const cssPageEntrySmall = styled(cssPageEntry, `
  flex: none;
  border-radius: 3px;
  --icon-color: ${theme.controlFg};
  & > .${cssPageLink.className} {
    padding: 0 8px 0 16px;
  }
  &:hover {
    --icon-color: ${theme.controlHoverFg};
  }
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);
