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
import {AppModel} from 'app/client/models/AppModel';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {commonUrls} from 'app/common/gristUrls';
import {dom, DomContents, Observable, styled} from 'grainjs';

/**
 * Creates the "help tools", a button/link to open HelpScout beacon, and one to open the
 * HelpCenter in a new tab.
 */
export function createHelpTools(appModel: AppModel, spacer = true): DomContents {
  const isEfcr = (appModel.topAppModel.productFlavor === 'efcr');
  return [
    spacer ? cssSpacer() : null,
    cssPageEntry(
      cssPageLink(cssPageIcon('Feedback'), cssLinkText('Give Feedback'),
        dom.on('click', () => beaconOpenMessage({appModel}))),
      dom.hide(isEfcr),
      testId('left-feedback'),
    ),
    cssPageEntry(
      cssPageLink(cssPageIcon('Help'), {href: commonUrls.help, target: '_blank'}, cssLinkText('Help Center')),
      dom.hide(isEfcr),
    ),
  ];
}

/**
 * Creates a basic left panel, used in error and billing pages. It only contains the help tools.
 */
export function leftPanelBasic(appModel: AppModel, panelOpen: Observable<boolean>) {
  return cssLeftPanel(
    cssScrollPane(
      cssTools(
        cssTools.cls('-collapsed', (use) => !use(panelOpen)),
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
  color: ${colors.slate};
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
  color: ${colors.dark};
  --icon-color: ${colors.slate};
  cursor: default;

  &:hover, &.weasel-popup-open, &-renaming {
    background-color: ${colors.mediumGrey};
  }
  &-selected, &-selected:hover, &-selected.weasel-popup-open {
    background-color: ${colors.darkBg};
    color: ${colors.light};
    --icon-color: ${colors.light};
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
