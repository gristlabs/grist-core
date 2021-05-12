import {CellValue} from 'app/common/DocActions';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {dom, styled} from 'grainjs';

/**
 * Creates a widget for displaying links.  Links can entered directly or following a title.
 * The last entry following a space is used as the url.
 * ie 'google https://www.google.com' would apears as 'google' to the user but link to the url.
 */
export class HyperLinkTextBox extends NTextBox {
  constructor(field: ViewFieldRec) {
    super(field, {defaultTextColor: colors.lightGreen.value});
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    return cssFieldClip(
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      dom.maybe((use) => Boolean(use(value)), () =>
        dom('a',
          dom.attr('href', (use) => _constructUrl(use(value))),
          dom.attr('target', '_blank'),
          // As per Google and Mozilla recommendations to prevent opened links
          // from running on the same process as Grist:
          // https://developers.google.com/web/tools/lighthouse/audits/noopener
          dom.attr('rel', 'noopener noreferrer'),
          cssLinkIcon('FieldLink', testId('tb-link-icon')),
          testId('tb-link')
        )
      ),
      dom.text((use) => _formatValue(use(value))),
    );
  }
}

/**
 * Formats value like `foo bar baz` by discarding `baz` and returning `foo bar`.
 */
function _formatValue(value: CellValue): string {
  if (typeof value !== 'string') { return ''; }
  const index = value.lastIndexOf(' ');
  return index >= 0 ? value.slice(0, index) : value;
}

/**
 * Given value like `foo bar baz`, constructs URL by checking if `baz` is a valid URL and,
 * if not, prepending `http://`.
 */
function _constructUrl(value: CellValue): string {
  if (typeof value !== 'string') { return ''; }
  const url = value.slice(value.lastIndexOf(' ') + 1);
  try {
    // Try to construct a valid URL
    return (new URL(url)).toString();
  } catch (e) {
    // Not a valid URL, so try to prefix it with http
    return 'http://' + url;
  }
}

const cssFieldClip = styled('div.field_clip', `
  color: var(--grist-actual-cell-color, ${colors.lightGreen});
`);

const cssLinkIcon = styled(icon, `
  background-color: var(--grist-actual-cell-color, ${colors.lightGreen});
  margin: -1px 2px 2px 0;
`);
