import {cssLink} from 'app/client/ui2018/links';
import {commonUrls} from 'app/common/gristUrls';
import {dom, DomContents, DomElementArg, styled} from 'grainjs';

const cssTooltipContent = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 8px;
`);

type TooltipName =
  | 'dataSize'
  | 'setTriggerFormula'
  | 'selectBy'
  | 'workOnACopy'
  | 'openAccessRules'
  | 'addRowConditionalStyle'
  | 'addColumnConditionalStyle';

export type TooltipContentFunc = (...domArgs: DomElementArg[]) => DomContents;

export const GristTooltips: Record<TooltipName, TooltipContentFunc> = {
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
