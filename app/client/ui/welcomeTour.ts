import * as commands from 'app/client/components/commands';
import { urlState } from 'app/client/models/gristUrlState';
import { IOnBoardingMsg, startOnBoarding } from "app/client/ui/OnBoardingPopups";
import { colors } from 'app/client/ui2018/cssVars';
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { dom, styled } from "grainjs";

export const welcomeTour: IOnBoardingMsg[] = [
  {
    title: 'Editing Data',
    body: () => [
      dom('p',
          'Double-click or hit ', Key(KeyContent('Enter')), ' on a cell to edit it. ',
          'Start with ', Key(KeyStrong('=')), ' to enter a formula.'
         )
    ],
    selector: '.field_clip',
    placement: 'bottom',
  },
  {
    selector: '.tour-creator-panel',
    title: 'Configuring your document',
    body: () => [
      dom('p',
          'Toggle the ', dom('em', 'creator panel'), ' to format columns, ',
          'convert to card view, select data, and more.'
         )
    ],
    placement: 'left',
    cropPadding: true,
  },
  {
    selector: '.tour-type-selector',
    title: 'Customizing columns',
    body: () => [
      dom('p',
          'Set formatting options, formulas, or column types, such as dates, choices, or attachments. '),
      dom('p',
          'Make it relational! Use the ', Key('Reference'), ' type to link tables. '
         )
    ],
    placement: 'right',
  },
  {
    selector: '.tour-add-new',
    title: 'Building up',
    body: () => [
      dom('p', 'Use ', Key('Add New'), ' to add widgets, pages, or import more data. ')
    ],
    placement: 'right',
  },
  {
    selector: '.tour-share-icon',
    title: 'Sharing',
    body: () => [
      dom('p', 'Use the Share button (', Icon('Share'), ') to share the document or export data.')
    ],
    placement: 'bottom',
    cropPadding: true,
  },
  {
    selector: '.tour-help-center',
    title: 'Flying higher',
    body: () => [
      dom('p', 'Use ', Key(GreyIcon('Help'), 'Help Center'), ' for documentation, videos, and tutorials.'),
      dom('p', 'Use ', Key(GreyIcon('Feedback'), 'Give Feedback'), ' for issues or questions.'),
    ],
    placement: 'right',
  },
  {
    selector: '.tour-welcome',
    title: 'Welcome to Grist!',
    body: () => [
      dom('p', 'Browse our ',
        cssLink({target: '_blank', href: urlState().makeUrl({homePage: "templates"})},
          'template library', cssInlineIcon('FieldLink')),
        "to discover what's possible and get inspired."
      ),
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
  color: ${colors.darkGreen};
`);

const KeyStrong = styled(KeyContent, `
  font-weight: 700;
`);

const Key = styled('div', `
  display: inline-block;
  padding: 2px 5px;
  border-radius: 4px;
  margin: 0px 2px;
  border: 1px solid ${colors.slate};
  color: black;
  background-color: white;
  font-family: inherit;
  font-style: normal;
  white-space: nowrap;
`);

const Icon = styled(icon, `
  --icon-color: ${colors.lightGreen};
`);

const GreyIcon = styled(icon, `
  --icon-color: ${colors.slate};
  margin-right: 8px;
`);

const cssInlineIcon = styled(icon, `
  margin: -3px 8px 0 4px;
`);
