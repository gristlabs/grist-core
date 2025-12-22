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
import { beaconOpenMessage } from 'app/client/lib/helpScout';
import { makeT } from 'app/client/lib/localization';
import { AppModel } from 'app/client/models/AppModel';
import { allCommands } from 'app/client/components/commands';
import { testId, theme, vars } from 'app/client/ui2018/cssVars';
import { colorIcon, icon } from 'app/client/ui2018/icons';
import { unstyledButton } from 'app/client/ui2018/unstyled';
import { visuallyHidden } from 'app/client/ui2018/visuallyHidden';
import { commonUrls, isFeatureEnabled } from 'app/common/gristUrls';
import { getGristConfig } from 'app/common/urlUtils';
import { dom, DomContents, Observable, styled } from 'grainjs';

const t = makeT('LeftPanelCommon');

/**
 * Creates the "help tools", a button/link to open HelpScout beacon, and one to open the
 * HelpCenter in a new tab.
 */
export function createHelpTools(appModel: AppModel): DomContents {
  if (!isFeatureEnabled("helpCenter")) {
    return [];
  }
  const { deploymentType } = getGristConfig();
  return cssSplitPageEntry(
    cssPageEntryMain(
      cssPageLink(cssPageIcon('Help'),
        cssLinkText(t("Help Center")),
        dom.cls('tour-help-center'),
        deploymentType === 'saas' ?
          dom.on('click', () => beaconOpenMessage({ appModel })) :
          { href: commonUrls.help, target: '_blank' },
        testId('left-feedback'),
      ),
    ),
    cssPageEntrySmall(
      cssPageLink(cssPageIcon('FieldLink'),
        { href: commonUrls.help, 'aria-label': t("Help Center"), target: '_blank' },
      ),
    ),
  );
}

export function createAccessibilityTools(): DomContents {
  // The accessibility is sometimes not available, make sure to not render the button in that case
  // (e.g. when rendering error pages)
  if (!allCommands.accessibility) {
    return [];
  }
  return cssPageEntry(
    cssPageButton(
      cssPageIcon('Accessibility'),
      // always have an accessible label in case we hide the text (collapsed panel)
      visuallyHidden(t("Accessibility")),
      // hide the visible text from screen readers to prevent duplicate labels with the visually hidden one
      cssLinkText(t("Accessibility"), { "aria-hidden": "true" }),
      cssKeyboardShortcut(
        'F4',
        testId('accessibility-shortcut-keys'),
      ),
      dom.on('click', () => allCommands.accessibility.run()),
      testId('accessibility-shortcut'),
    ),
  );
}

/**
 * Creates a basic left panel, used in error and billing pages. It only contains the help tools.
 * You can provide optional content to include above the help tools.
 */
export function leftPanelBasic(appModel: AppModel, panelOpen: Observable<boolean>, optContent: DomContents = null) {
  return cssLeftPanel(
    cssScrollPane(
      optContent,
      cssTools(
        cssTools.cls('-collapsed', use => !use(panelOpen)),
        cssSpacer(),
        createHelpTools(appModel),
        createAccessibilityTools(),
      ),
    ),
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

export const cssTools = styled('nav', `
  flex: none;
  margin-top: auto;
  padding: 16px 0 16px 0;
  cursor: default;
`);

export const cssHomeTools = styled(cssTools, `
  padding-top: 0px;
  border-top: 1px solid ${theme.pagePanelsBorder};
`);

export const cssSectionHeader = styled('div', `
  margin: 24px 0 8px 24px;
  display: flex;
  gap: 8px;
  align-items: center;
  .${cssTools.className}-collapsed > & {
    visibility: hidden;
  }
`);

export const cssSectionHeaderText = styled('span', `
  color: ${theme.lightText};
  text-transform: uppercase;
  font-weight: 500;
  font-size: ${vars.xsmallFontSize};
  letter-spacing: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

const cssPageAction = `
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  height: 32px;
  line-height: 32px;
  padding-left: 24px;
  outline: none;
  cursor: pointer;
  outline-offset: -3px;
  width: 100%;
  &, &:hover, &:focus, & a, & a:hover, & a:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }
  .${cssPageEntry.className}-disabled & {
    cursor: default;
  }
  .${cssTools.className}-collapsed & {
    padding-left: 16px;
  }
`;

export const cssPageLink = styled('a', cssPageAction);

export const cssPageLinkContainer = styled('div', `
  ${cssPageAction}

  .${cssPageEntry.className}-disabled & :is(a, button) {
    cursor: default;
  }
`);

export const cssPageButton = styled(unstyledButton, cssPageAction);

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

export const cssKeyboardShortcut = styled('span', `
  margin-left: auto;
  margin-right: 16px;
  color: ${theme.lightText};
  text-transform: uppercase;

  .${cssPageButton.className}:hover &,
  .${cssPageButton.className}:focus & {
    color: inherit;
  }
  .${cssTools.className}-collapsed & {
    position: absolute;
    line-height: 1;
    top: 3px;
    right: 3px;
    margin: 0;
    font-size: 0.8em;
  }
`);

export const cssPageColorIcon = styled(colorIcon, `
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
  --page-icon-margin: 0;
  & > .${cssPageLink.className}, & > .${cssPageButton.className} {
    padding: 0 16px 0 16px;
  }
  &:hover {
    --icon-color: ${theme.controlHoverFg};
  }
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);

export const cssMenuTrigger = styled(unstyledButton, `
  position: relative;
  z-index: 2;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: default;
  display: none;
  .${cssPageLinkContainer.className}:hover > &,
  .${cssPageLinkContainer.className}:focus-within > &,
  .${cssPageLink.className}:hover > &,
  .${cssPageLink.className}:focus-within > &,
  &.weasel-popup-open {
    display: block;
  }
  &:hover, &.weasel-popup-open {
    background-color: ${theme.pageOptionsHoverBg};
  }
  .${cssPageEntry.className}-selected &:hover, .${cssPageEntry.className}-selected &.weasel-popup-open {
    background-color: ${theme.pageOptionsSelectedHoverBg};
  }
`);
