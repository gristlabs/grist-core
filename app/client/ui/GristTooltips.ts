import * as commands from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ShortcutKey, ShortcutKeyContent} from 'app/client/ui/ShortcutKey';
import {basicButtonLink} from 'app/client/ui2018/buttons';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls, GristDeploymentType} from 'app/common/gristUrls';
import {BehavioralPrompt} from 'app/common/Prefs';
import {dom, DomContents, DomElementArg, styled} from 'grainjs';

const t = makeT('GristTooltips');

const cssTooltipContent = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 8px;
`);

const cssBoldText = styled('span', `
  font-weight: 600;
`);

const cssItalicizedText = styled('span', `
  font-style: italic;
`);

const cssIcon = styled(icon, `
  height: 18px;
  width: 18px;
`);

const cssNewsPopupLearnMoreButton = styled(basicButtonLink, `
  color: white;
  border: 1px solid white;
  padding: 3px;

  &:hover, &:focus, &:visited {
    color: white;
    border-color: white;
  }
`);

export type Tooltip =
  | 'dataSize'
  | 'setTriggerFormula'
  | 'selectBy'
  | 'workOnACopy'
  | 'openAccessRules'
  | 'addRowConditionalStyle'
  | 'addColumnConditionalStyle'
  | 'uuid'
  | 'lookups'
  | 'formulaColumn'
  | 'accessRulesTableWide';

export type TooltipContentFunc = (...domArgs: DomElementArg[]) => DomContents;

export const GristTooltips: Record<Tooltip, TooltipContentFunc> = {
  dataSize: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('The total size of all data in this document, excluding attachments.')),
    dom('div', t('Updates every 5 minutes.')),
    ...args,
  ),
  setTriggerFormula: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      t('Formulas that trigger in certain cases, and store the calculated value as data.')
    ),
    dom('div',
      t('Useful for storing the timestamp or author of a new record, data cleaning, and more.')
    ),
    dom('div',
      cssLink({href: commonUrls.helpTriggerFormulas, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  selectBy: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('Link your new widget to an existing widget on this page.')),
    dom('div',
      cssLink({href: commonUrls.helpLinkingWidgets, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  workOnACopy: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      t('Try out changes in a copy, then decide whether to replace the original with your edits.')
    ),
    dom('div',
      cssLink({href: commonUrls.helpTryingOutChanges, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  openAccessRules: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      t('Access rules give you the power to create nuanced rules to determine who can \
see or edit which parts of your document.')
    ),
    dom('div',
      cssLink({href: commonUrls.helpAccessRules, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  addRowConditionalStyle: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('Apply conditional formatting to rows based on formulas.')),
    dom('div',
      cssLink({href: commonUrls.helpConditionalFormatting, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  addColumnConditionalStyle: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('Apply conditional formatting to cells in this column when formula conditions are met.')),
    dom('div', t('Click on “Open row styles” to apply conditional formatting to rows.')),
    dom('div',
      cssLink({href: commonUrls.helpConditionalFormatting, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  uuid: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('A UUID is a randomly-generated string that is useful for unique identifiers and link keys.')),
    dom('div',
      cssLink({href: commonUrls.helpLinkKeys, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  lookups: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('Lookups return data from related tables.')),
    dom('div', t('Use reference columns to relate data in different tables.')),
    dom('div',
      cssLink({href: commonUrls.helpColRefs, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  formulaColumn: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('Formulas support many Excel functions, full Python syntax, and include a helpful AI Assistant.')),
    dom('div',
      cssLink({href: commonUrls.formulas, target: '_blank'}, t('Learn more.')),
    ),
    ...args,
  ),
  accessRulesTableWide: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', t('These rules are applied after all column rules have been processed, if applicable.'))
  ),
};

export interface BehavioralPromptContent {
  popupType: 'tip' | 'news';
  title: () => string;
  content: (...domArgs: DomElementArg[]) => DomContents;
  deploymentTypes: GristDeploymentType[] | 'all';
  /** Defaults to `everyone`. */
  audience?: 'signed-in-users' | 'anonymous-users' | 'everyone';
  /** Defaults to `desktop`. */
  deviceType?: 'mobile' | 'desktop' | 'all';
  /** Defaults to `false`. */
  hideDontShowTips?: boolean;
  /** Defaults to `false`. */
  forceShow?: boolean;
  /** Defaults to `true`. */
  markAsSeen?: boolean;
}

export const GristBehavioralPrompts: Record<BehavioralPrompt, BehavioralPromptContent> = {
  referenceColumns: {
    popupType: 'tip',
    title: () => t('Reference Columns'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Reference columns are the key to {{relational}} data in Grist.', {
        relational: cssBoldText(t('relational'))
      })),
      dom('div', t('They allow for one record to point (or refer) to another.')),
      dom('div',
        cssLink({href: commonUrls.helpColRefs, target: '_blank'}, t('Learn more.')),
      ),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  referenceColumnsConfig: {
    popupType: 'tip',
    title: () => t('Reference Columns'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Select the table to link to.')),
      dom('div', t('Cells in a reference column always identify an {{entire}} \
record in that table, but you may select which column from that record to show.', {
          entire: cssItalicizedText(t('entire'))
        })),
      dom('div',
        cssLink({href: commonUrls.helpUnderstandingReferenceColumns, target: '_blank'}, t('Learn more.')),
      ),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  rawDataPage: {
    popupType: 'tip',
    title: () => t('Raw Data page'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('The Raw Data page lists all data tables in your document, \
including summary tables and tables not included in page layouts.')),
      dom('div', cssLink({href: commonUrls.helpRawData, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  accessRules: {
    popupType: 'tip',
    title: () => t('Access Rules'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Access rules give you the power to create nuanced rules \
to determine who can see or edit which parts of your document.')),
      dom('div', cssLink({href: commonUrls.helpAccessRules, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  filterButtons: {
    popupType: 'tip',
    title: () => t('Pinning Filters'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Pinned filters are displayed as buttons above the widget.')),
      dom('div', t('Unpin to hide the the button while keeping the filter.')),
      dom('div', cssLink({href: commonUrls.helpFilterButtons, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  nestedFiltering: {
    popupType: 'tip',
    title: () => t('Nested Filtering'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('You can filter by more than one column.')),
      dom('div', t('Only those rows will appear which match all of the filters.')),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  pageWidgetPicker: {
    popupType: 'tip',
    title: () => t('Selecting Data'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Select the table containing the data to show.')),
      dom('div', t('Use the 𝚺 icon to create summary (or pivot) tables, for totals or subtotals.')),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  pageWidgetPickerSelectBy: {
    popupType: 'tip',
    title: () => t('Linking Widgets'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Link your new widget to an existing widget on this page.')),
      dom('div', t('This is the secret to Grist\'s dynamic and productive layouts.')),
      dom('div', cssLink({href: commonUrls.helpLinkingWidgets, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  editCardLayout: {
    popupType: 'tip',
    title: () => t('Editing Card Layout'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Rearrange the fields in your card by dragging and resizing cells.')),
      dom('div', t('Clicking {{EyeHideIcon}} in each cell hides the field from this view without deleting it.', {
        EyeHideIcon: cssIcon('EyeHide')
      })),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  addNew: {
    popupType: 'tip',
    title: () => t('Add New'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Click the Add New button to create new documents or workspaces, or import data.')),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  rickRow: {
    popupType: 'tip',
    title: () => t('Anchor Links'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div',
        t('To make an anchor link that takes the user to a specific cell, click on a row and press {{shortcut}}.',
          {
            shortcut: ShortcutKey(ShortcutKeyContent(commands.allCommands.copyLink.humanKeys[0])),
          }
        ),
      ),
      ...args,
    ),
    deploymentTypes: 'all',
    deviceType: 'all',
    hideDontShowTips: true,
    forceShow: true,
    markAsSeen: false,
  },
  customURL: {
    popupType: 'tip',
    title: () => t('Custom Widgets'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div',
        t(
          'You can choose from widgets available to you in the dropdown, or embed your own by providing its full URL.'
        ),
      ),
      dom('div', cssLink({href: commonUrls.helpCustomWidgets, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  calendarConfig: {
    popupType: 'tip',
    title: () => t('Calendar'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t("To configure your calendar, select columns for start/end dates and event titles. \
Note each column's type.")),
      dom('div', t("Can't find the right columns? Click 'Change Widget' to select the table with events \
data.")),
      dom('div', cssLink({href: commonUrls.helpCalendarWidget, target: '_blank'}, t('Learn more.'))),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise', 'electron'],
  },
  formsAreHere: {
    popupType: 'news',
    audience: 'signed-in-users',
    title: () => t('Forms are here!'),
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', t('Build simple forms right in Grist and share in a click with our new widget. {{learnMoreButton}}', {
        learnMoreButton: cssNewsPopupLearnMoreButton(t('Learn more'), {
          href: commonUrls.forms,
          target: '_blank',
        }),
      })),
      ...args,
    ),
    deploymentTypes: ['saas', 'core', 'enterprise'],
  },
};
