import {cssLink} from 'app/client/ui2018/links';
import {commonUrls} from 'app/common/gristUrls';
import {BehavioralPrompt} from 'app/common/Prefs';
import {dom, DomContents, DomElementArg, styled} from 'grainjs';
import { icon } from '../ui2018/icons';

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

export type Tooltip =
  | 'dataSize'
  | 'setTriggerFormula'
  | 'selectBy'
  | 'workOnACopy'
  | 'openAccessRules'
  | 'addRowConditionalStyle'
  | 'addColumnConditionalStyle';

export type TooltipContentFunc = (...domArgs: DomElementArg[]) => DomContents;

// TODO: i18n
export const GristTooltips: Record<Tooltip, TooltipContentFunc> = {
  dataSize: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', 'The total size of all data in this document, excluding attachments.'),
    dom('div', 'Updates every 5 minutes.'),
    ...args,
  ),
  setTriggerFormula: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      'Formulas that trigger in certain cases, and store the calculated value as data.'
    ),
    dom('div',
      'Useful for storing the timestamp or author of a new record, data cleaning, and '
      + 'more.'
    ),
    dom('div',
      cssLink({href: commonUrls.helpTriggerFormulas, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
  selectBy: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', 'Link your new widget to an existing widget on this page.'),
    dom('div',
      cssLink({href: commonUrls.helpLinkingWidgets, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
  workOnACopy: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      'Try out changes in a copy, then decide whether to replace the original with your edits.'
    ),
    dom('div',
      cssLink({href: commonUrls.helpTryingOutChanges, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
  openAccessRules: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div',
      'Access rules give you the power to create nuanced rules to determine who can '
      + 'see or edit which parts of your document.'
    ),
    dom('div',
      cssLink({href: commonUrls.helpAccessRules, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
  addRowConditionalStyle: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', 'Apply conditional formatting to rows based on formulas.'),
    dom('div',
      cssLink({href: commonUrls.helpConditionalFormatting, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
  addColumnConditionalStyle: (...args: DomElementArg[]) => cssTooltipContent(
    dom('div', 'Apply conditional formatting to cells in this column when formula conditions are met.'),
    dom('div', 'Click on “Open row styles” to apply conditional formatting to rows.'),
    dom('div',
      cssLink({href: commonUrls.helpConditionalFormatting, target: '_blank'}, 'Learn more.'),
    ),
    ...args,
  ),
};

export interface BehavioralPromptContent {
  title: string;
  content: (...domArgs: DomElementArg[]) => DomContents;
}

// TODO: i18n
export const GristBehavioralPrompts: Record<BehavioralPrompt, BehavioralPromptContent> = {
  referenceColumns: {
    title: 'Reference Columns',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Reference columns are the key to ', cssBoldText('relational'), ' data in Grist.'),
      dom('div', 'They allow for one record to point (or refer) to another.'),
      dom('div',
        cssLink({href: commonUrls.helpColRefs, target: '_blank'}, 'Learn more.'),
      ),
      ...args,
    ),
  },
  referenceColumnsConfig: {
    title: 'Reference Columns',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Select the table to link to.'),
      dom('div', 'Cells in a reference column always identify an ', cssItalicizedText('entire'),
        ' record in that table, but you may select which column from that record to show.'),
      dom('div',
        cssLink({href: commonUrls.helpUnderstandingReferenceColumns, target: '_blank'}, 'Learn more.'),
      ),
      ...args,
    ),
  },
  rawDataPage: {
    title: 'Raw Data page',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'The Raw Data page lists all data tables in your document, '
        + 'including summary tables and tables not included in page layouts.'),
      dom('div', cssLink({href: commonUrls.helpRawData, target: '_blank'}, 'Learn more.')),
      ...args,
    ),
  },
  accessRules: {
    title: 'Access Rules',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Access rules give you the power to create nuanced rules '
        + 'to determine who can see or edit which parts of your document.'),
      dom('div', cssLink({href: commonUrls.helpAccessRules, target: '_blank'}, 'Learn more.')),
      ...args,
    ),
  },
  filterButtons: {
    title: 'Filter Buttons',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Pinned filters are displayed as buttons above the widget.'),
      dom('div', 'Unpin to hide the the button while keeping the filter.'),
      dom('div', cssLink({href: commonUrls.helpFilterButtons, target: '_blank'}, 'Learn more.')),
      ...args,
    ),
  },
  nestedFiltering: {
    title: 'Nested Filtering',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'You can filter by more than one column.'),
      dom('div', 'Only those rows will appear which match all of the filters.'),
      ...args,
    ),
  },
  pageWidgetPicker: {
    title: 'Selecting Data',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Select the table containing the data to show.'),
      dom('div', 'Use the 𝚺 icon to create summary (or pivot) tables, for totals or subtotals.'),
      ...args,
    ),
  },
  pageWidgetPickerSelectBy: {
    title: 'Linking Widgets',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Link your new widget to an existing widget on this page.'),
      dom('div', `This is the secret to Grist's dynamic and productive layouts.`),
      dom('div', cssLink({href: commonUrls.helpLinkingWidgets, target: '_blank'}, 'Learn more.')),
      ...args,
    ),
  },
  editCardLayout: {
    title: 'Editing Card Layout',
    content: (...args: DomElementArg[]) => cssTooltipContent(
      dom('div', 'Rearrange the fields in your card by dragging and resizing cells.'),
      dom('div', 'Clicking ', cssIcon('EyeHide'),
        ' in each cell hides the field from this view without deleting it.'),
      ...args,
    ),
  },
};
