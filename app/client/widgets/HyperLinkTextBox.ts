import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { constructUrl } from 'app/client/models/gristUrlState';
import { testId, theme } from 'app/client/ui2018/cssVars';
import { cssIconBackground, icon } from 'app/client/ui2018/icons';
import { cssHoverIn, gristLink } from 'app/client/ui2018/links';
import { NTextBox } from 'app/client/widgets/NTextBox';
import { CellValue } from 'app/common/DocActions';
import { Computed, dom, styled } from 'grainjs';

/**
 * Creates a widget for displaying links.  Links can entered directly or following a title.
 * The last entry following a space is used as the url.
 * ie 'google https://www.google.com' would apears as 'google' to the user but link to the url.
 */
export class HyperLinkTextBox extends NTextBox {
  constructor(field: ViewFieldRec) {
    super(field, {defaultTextColor: theme.link.toString()});
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId()];
    const url = Computed.create(null, (use) => constructUrl(use(value)));
    return cssFieldClip(
      dom.autoDispose(url),
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      dom.maybe((use) => Boolean(use(value)), () =>
        gristLink(url,
          cssIconBackground(
            icon("FieldLink", testId('tb-link-icon')),
            dom.cls(cssHoverOnField.className),
          ),
          testId('tb-link'),
        ),
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

const cssFieldClip = styled('div.field_clip', `
  color: var(--grist-actual-cell-color, ${theme.link});
`);

const cssHoverOnField = cssHoverIn(cssFieldClip.className);
