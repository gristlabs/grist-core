import { fromKoSave } from 'app/client/lib/fromKoSave';
import { findLinks } from 'app/client/lib/textUtils';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { cssRow } from 'app/client/ui/RightPanelStyles';
import { alignmentSelect, cssButtonSelect, makeButtonSelect } from 'app/client/ui2018/buttonSelect';
import { colors, testId } from 'app/client/ui2018/cssVars';
import { cssIconBackground, icon } from 'app/client/ui2018/icons';
import { gristLink } from 'app/client/ui2018/links';
import { NewAbstractWidget, Options } from 'app/client/widgets/NewAbstractWidget';
import { Computed, dom, DomArg, DomContents, fromKo, Observable, styled } from 'grainjs';
import {makeT} from 'app/client/lib/localization';

const t = makeT('NTextBox');

/**
 * TextBox - The most basic widget for displaying text information.
 */
export class NTextBox extends NewAbstractWidget {
  protected alignment: Observable<string>;
  protected wrapping: Observable<boolean>;

  constructor(field: ViewFieldRec, options: Options = {}) {
    super(field, options);

    this.alignment = fromKo(this.options.prop('alignment'));
    this.wrapping = fromKo(this.field.wrap);

    this.autoDispose(this.wrapping.addListener(() => {
      this.field.viewSection().events.trigger('rowHeightChange');
    }));
  }

  public buildConfigDom(): DomContents {
    const toggle = () => {
      const newValue = !this.field.config.wrap.peek();
      this.field.config.wrap.setAndSave(newValue).catch(reportError);
    };
    const options = this.field.config.options;
    // Some options might be disabled, as more than one column is selected.
    // Prop observable is owned by the options object.
    const alignmentDisabled = Computed.create(this, use => use(options.disabled('alignment')));
    const wrapDisabled = Computed.create(this, (use) => use(options.disabled('wrap')));
    return [
      cssRow(
        alignmentSelect(
          fromKoSave(this.field.config.alignment),
          cssButtonSelect.cls('-disabled', alignmentDisabled),
        ),
        dom('div', {style: 'margin-left: 8px;'},
          makeButtonSelect(
            fromKo(this.field.config.wrap),
            [{value: true, icon: 'Wrap'}],
            toggle,
            cssButtonSelect.cls('-disabled', wrapDisabled),
            ),
          testId('tb-wrap-text')
        )
      )
    ];
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()];
    return dom('div.field_clip',
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      dom.domComputed((use) => use(row._isAddRow) ? null : makeLinks(use(this.valueFormatter).formatAny(use(value), t)))
    );
  }
}

function makeLinks(text: string) {
  try {
    const domElements: DomArg[] = [];
    for (const {value, isLink} of findLinks(text)) {
      if (isLink) {
        // Wrap link with a span to provide hover on and to override wrapping.
        domElements.push(cssMaybeWrap(
          gristLink(value,
            cssIconBackground(
              icon("FieldLink", testId('tb-link-icon')),
              dom.cls(cssHoverInText.className),
            ),
          ),
          linkColor(value),
          testId("text-link")
        ));
      } else {
        domElements.push(value);
      }
    }
    return domElements;
  } catch(ex) {
    // In case when something went wrong, simply log and return original text, as showing
    // links is not that important.
    console.warn("makeLinks failed", ex);
    return text;
  }
}

// For links we want to break all the parts, not only words.
const cssMaybeWrap = styled('span', `
  white-space: inherit;
  .text_wrapping & {
    word-break: break-all;
    white-space: pre-wrap;
  }
`);

// A gentle transition effect on hover in, and the same effect on hover out with a little delay.
export const cssHoverIn = (parentClass: string) => styled('span', `
  --icon-color: var(--grist-actual-cell-color, ${colors.lightGreen});
  margin: -1px 2px 2px 0;
  border-radius: 3px;
  transition-property: background-color;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
  transition-delay: 90ms;
  .${parentClass}:hover & {
    --icon-background: ${colors.lightGreen};
    --icon-color: white;
    transition-duration: 80ms;
    transition-delay: 0ms;
  }
`);

const cssHoverInText = cssHoverIn(cssMaybeWrap.className);

const linkColor = styled('span', `
  color: var(--grist-actual-cell-color, ${colors.lightGreen});;
`);
