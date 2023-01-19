import { makeT } from 'app/client/lib/localization';
import * as commands from 'app/client/components/commands';
import { urlState } from 'app/client/models/gristUrlState';
import { IOnBoardingMsg, startOnBoarding } from "app/client/ui/OnBoardingPopups";
import { theme } from 'app/client/ui2018/cssVars';
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { dom, styled } from "grainjs";

const t = makeT('WelcomeTour');

export const welcomeTour: IOnBoardingMsg[] = [
  {
    title: t('Editing Data'),
    body: () => [
      dom('p',
        t('Double-click or hit {{enter}} on a cell to edit it. ', {enter: Key(KeyContent(t('Enter')))}),
        t('Start with {{equal}} to enter a formula.', { equal: Key(KeyStrong('=')) }))
    ],
    selector: '.field_clip',
    placement: 'bottom',
  },
  {
    selector: '.tour-creator-panel',
    title: t('Configuring your document'),
    body: () => [
      dom('p',
          t('Toggle the {{creatorPanel}} to format columns, ', {creatorPanel: dom('em', t('creator panel'))}),
          t('convert to card view, select data, and more.')
         )
    ],
    placement: 'left',
    cropPadding: true,
  },
  {
    selector: '.tour-type-selector',
    title: t('Customizing columns'),
    body: () => [
      dom('p',
          t('Set formatting options, formulas, or column types, such as dates, choices, or attachments. ')),
      dom('p',
          t('Make it relational! Use the {{ref}} type to link tables. ', {ref: Key(t('Reference'))}),
         )
    ],
    placement: 'right',
  },
  {
    selector: '.tour-add-new',
    title: t('Building up'),
    body: () => [
      dom('p', t('Use {{addNew}} to add widgets, pages, or import more data. ', {addNew: Key(t('Add New'))}))
    ],
    placement: 'right',
  },
  {
    selector: '.tour-share-icon',
    title: t('Sharing'),
    body: () => [
      dom('p', t('Use the Share button ({{share}}) to share the document or export data.',
      {share:TopBarButtonIcon(t('Share'))}))
    ],
    placement: 'bottom',
    cropPadding: true,
  },
  {
    selector: '.tour-help-center',
    title: t('Flying higher'),
    body: () => [
      dom('p', t('Use {{helpCenter}} for documentation or questions.',
      {helpCenter: Key(GreyIcon('Help'), t('Help Center'))})),
    ],
    placement: 'right',
  },
  {
    selector: '.tour-welcome',
    title: t('Welcome to Grist!'),
    body: () => [
      dom('p', t("Browse our {{templateLibrary}} to discover what's possible and get inspired.",
        {
          templateLibrary: cssLink({ target: '_blank', href: urlState().makeUrl({ homePage: "templates" }) },
            t('template library'), cssInlineIcon('FieldLink'))
        }
      )),
    ],
    showHasModal: true,
  }

];

export function startWelcomeTour(onFinishCB: () => void) {
  commands.allCommands.fieldTabOpen.run();
  startOnBoarding(welcomeTour, onFinishCB);
}

const KeyContent = styled('span', `
  font-style: normal;
  font-family: inherit;
  color: ${theme.shortcutKeyPrimaryFg};
`);

const KeyStrong = styled(KeyContent, `
  font-weight: 700;
`);

const Key = styled('div', `
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

const TopBarButtonIcon = styled(icon, `
  --icon-color: ${theme.topBarButtonPrimaryFg};
`);

const GreyIcon = styled(icon, `
  --icon-color: ${theme.shortcutKeySecondaryFg};
  margin-right: 8px;
`);

const cssInlineIcon = styled(icon, `
  margin: -3px 8px 0 4px;
`);
