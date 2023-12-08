import {DataRowModel} from 'app/client/models/DataRowModel';
import {urlState} from 'app/client/models/gristUrlState';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {isList} from 'app/common/gristTypes';
import {Computed, dom, styled} from 'grainjs';
import {cssChoiceList, cssToken} from "app/client/widgets/ChoiceListCell";
import {Reference} from "app/client/widgets/Reference";
import {choiceToken} from "app/client/widgets/ChoiceToken";

/**
 * ReferenceList - The widget for displaying lists of references to another table's records.
 */
export class ReferenceList extends Reference {
  private _hasRecordCard = Computed.create(this, (use) => {
    const table = use(this._refTable);
    if (!table) { return false; }

    return !use(use(table.recordCardViewSection).disabled);
  });

  public buildDom(row: DataRowModel) {
    return cssChoiceList(
      dom.cls('field_clip'),
      cssChoiceList.cls('-wrap', this.wrapping),
      dom.style('justify-content', use => use(this.alignment) === 'right' ? 'flex-end' : use(this.alignment)),
      dom.domComputed((use) => {
        if (use(row._isAddRow) || this.isDisposed() || use(this.field.displayColModel).isDisposed()) {
          // Work around JS errors during certain changes (noticed when visibleCol field gets removed
          // for a column using per-field settings).
          return null;
        }

        const valueObs = row.cells[use(this.field.colId)];
        const value = valueObs && use(valueObs);
        if (!value) { return null; }

        const displayValueObs = row.cells[use(use(this.field.displayColModel).colId)];
        const displayValue = displayValueObs && use(displayValueObs);
        if (!displayValue) { return null; }

        // TODO: Figure out what the implications of this block are for ReferenceList.
        // if (isVersions(content)) {
        //   // We can arrive here if the reference value is unchanged (viewed as a foreign key)
        //   // but the content of its displayCol has changed.  Postponing doing anything about
        //   // this until we have three-way information for computed columns.  For now,
        //   // just showing one version of the cell.  TODO: elaborate.
        //   return use(this._formatValue)(content[1].local || content[1].parent);
        // }
        const values = isList(value) ? value.slice(1) : [value];
        const displayValues = isList(displayValue) ? displayValue.slice(1) : [displayValue];
        // Use field.visibleColFormatter instead of field.formatter
        // because we're formatting each list element to render tokens, not the whole list.
        const formatter = use(this.field.visibleColFormatter);
        return values.map((referenceId, i) => {
          return {
            referenceId,
            formattedValue: formatter.formatAny(displayValues[i]),
          };
        });
      },
      (values) => {
        if (!values) {
          return null;
        }
        return values.map(({referenceId, formattedValue}) => {
          const isBlankReference = formattedValue.trim() === '';
          return choiceToken(
            [
              cssRefIcon('FieldReference',
                cssRefIcon.cls('-view-as-card', use =>
                  referenceId !== 0 && use(this._hasRecordCard)),
                dom.on('click', async () => {
                  if (referenceId === 0 || !this._hasRecordCard.get()) { return; }

                  const rowId = referenceId as number;
                  const sectionId = this._refTable.get()?.recordCardViewSectionRef();
                  if (sectionId === undefined) {
                    throw new Error('Unable to open Record Card: undefined section id');
                  }

                  const anchorUrlState = {hash: {rowId, sectionId, recordCard: true}};
                  await urlState().pushUrl(anchorUrlState, {replace: true});
                }),
                dom.on('mousedown', (ev) => {
                  ev.stopPropagation();
                  ev.preventDefault();
                }),
                testId('ref-list-link-icon'),
              ),
              cssLabel(isBlankReference ? '[Blank]' : formattedValue,
                testId('ref-list-cell-token-label'),
              ),
              dom.cls(cssRefIconAndLabel.className),
            ],
            {
              blank: isBlankReference,
            },
            dom.cls(cssToken.className),
            testId('ref-list-cell-token')
          );
        });
      }),
    );
  }
}

const cssRefIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  flex-shrink: 0;

  &-view-as-card {
    cursor: pointer;
  }
  &-view-as-card:hover {
    --icon-color: ${theme.controlFg};
  }
`);

const cssRefIconAndLabel = styled('div', `
  display: flex;
  align-items: center;
`);

const cssLabel = styled('div', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`);
