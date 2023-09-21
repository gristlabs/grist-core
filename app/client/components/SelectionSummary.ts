import {CellSelector, COL, ROW} from 'app/client/components/CellSelector';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {Delay} from "app/client/lib/Delay";
import {KoArray} from 'app/client/lib/koArray';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {UserError} from 'app/client/models/errors';
import {ALL, RowsChanged, SortedRowSet} from "app/client/models/rowset";
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {isNarrowScreen, isNarrowScreenObs, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {CellValue} from 'app/common/DocActions';
import {isEmptyList, isListType, isRefListType} from "app/common/gristTypes";
import {TableData} from "app/common/TableData";
import {BaseFormatter} from 'app/common/ValueFormatter';
import ko from 'knockout';
import {Computed, Disposable, dom, makeTestId, Observable, styled, subscribe} from 'grainjs';
import {makeT} from 'app/client/lib/localization';

const t = makeT('SelectionSummary');

/**
 * A beginning and end index for a range of columns or rows.
 */
interface Range {
  begin: number;
  end: number;
}

/**
 * A single part of the cell selection summary.
 */
interface SummaryPart {
  /** Identifier for the summary part. */
  id: 'sum' | 'count' | 'dimensions';
  /** Label that's shown to the left of `value`. */
  label: string;
  /** Value of the summary part. */
  value: string;
  /** If true, displays a copy button on hover. Defaults to false. */
  clickToCopy?: boolean;
}

const testId = makeTestId('test-selection-summary-');

// We can handle a million cells in under 60ms on a good laptop. Much beyond that, and we'll break
// selection with the bad performance. Instead, skip the counting and summing for too many cells.
const MAX_CELLS_TO_SCAN = 1_000_000;

export class SelectionSummary extends Disposable {
  private _colTotalCount = Computed.create(this, (use) =>
    use(use(this._viewFields).getObservable()).length);

  private _rowTotalCount = Computed.create(this, (use) => {
    const rowIds = use(this._sortedRows.getKoArray().getObservable());
    const includesNewRow = (rowIds.length > 0 && rowIds[rowIds.length - 1] === 'new');
    return rowIds.length - (includesNewRow ? 1 : 0);
  });

  // In CellSelector, start and end are 0-based, inclusive, and not necessarily in order.
  // It's not good for representing an empty range. Here, we convert ranges as [begin, end),
  // with end >= begin.
  private _rowRange = Computed.create<Range>(this, (use) => {
    const type = use(this._cellSelector.currentSelectType);
    if (type === COL) {
      return {begin: 0, end: use(this._rowTotalCount)};
    } else {
      const start = use(this._cellSelector.row.start);
      const end = use(this._cellSelector.row.end);
      return {
        begin: Math.min(start, end),
        end: Math.max(start, end) + 1,
      };
    }
  });

  private _colRange = Computed.create<Range>(this, (use) => {
    const type = use(this._cellSelector.currentSelectType);
    if (type === ROW) {
      return {begin: 0, end: use(this._colTotalCount)};
    } else {
      const start = use(this._cellSelector.col.start);
      const end = use(this._cellSelector.col.end);
      return {
        begin: Math.min(start, end),
        end: Math.max(start, end) + 1,
      };
    }
  });

  private _summary = Observable.create<SummaryPart[]>(this, []);
  private _delayedRecalc = this.autoDispose(Delay.create());

  constructor(
    private _cellSelector: CellSelector,
    private _tableData: TableData,
    private _sortedRows: SortedRowSet,
    private _viewFields: ko.Computed<KoArray<ViewFieldRec>>,
  ) {
    super();

    this.autoDispose(this._sortedRows.getKoArray().subscribe(this._onSpliceChange, this, 'spliceChange'));
    const onRowNotify = this._onRowNotify.bind(this);
    this._sortedRows.on('rowNotify', onRowNotify);
    this.onDispose(() => this._sortedRows.off('rowNotify', onRowNotify));
    this.autoDispose(subscribe(this._rowRange, this._colRange,
      () => this._scheduleRecalc()));
    this.autoDispose(isNarrowScreenObs().addListener((isNarrow) => {
      if (isNarrow) { return; }
      // No calculations occur while the screen is narrow, so we need to schedule one.
      this._scheduleRecalc();
    }));
  }

  public buildDom() {
    return cssSummary(
      dom.forEach(this._summary, ({id, label, value, clickToCopy}) =>
        cssSummaryPart(
          label ? dom('span', cssLabelText(label), cssCopyIcon('Copy')) : null,
          value,
          cssSummaryPart.cls('-copyable', Boolean(clickToCopy)),
          (clickToCopy ? dom.on('click', (ev, elem) => doCopy(value, elem)) : null),
          testId(id),
        )
      ),
    );
  }

  private _onSpliceChange(splice: {start: number}) {
    const rowRange = this._rowRange.get();
    const rowCount = rowRange.end - rowRange.begin;
    if (rowCount === 1) { return; }
    if (splice.start >= rowRange.end) { return; }
    // We could be smart here and only recalculate when the splice affects our selection. But for
    // that to make sense, the selection itself needs to be smart. Currently, the selection is
    // lost whenever the cursor is affected. For example, when you have a selection and another
    // user adds/removes columns or rows before the selection, the selection won't be shifted
    // with the cursor, and will instead be cleared. Since we can't always rely on the selection
    // being there, we'll err on the safe side and always schedule a recalc.
    this._scheduleRecalc();
  }

  private _onRowNotify(rows: RowsChanged) {
    const rowRange = this._rowRange.get();
    if (rows === ALL) {
      this._scheduleRecalc();
    } else {
      const rowArray = this._sortedRows.getKoArray().peek();
      const rowIdSet = new Set(rows);
      for (let r = rowRange.begin; r < rowRange.end; r++) {
        if (rowIdSet.has(rowArray[r])) {
          this._scheduleRecalc();
          break;
        }
      }
    }
  }

  /**
   * Schedules a re-calculation to occur in the immediate future.
   *
   * May be called repeatedly, but only a single re-calculation will be scheduled, to
   * avoid queueing unnecessary amounts of work.
   */
  private _scheduleRecalc() {
    // `_recalc` may take a non-trivial amount of time, so we defer until the stack is clear.
    this._delayedRecalc.schedule(0, () => this._recalc());
  }

  private _recalc() {
    const rowRange = this._rowRange.get();
    const colRange = this._colRange.get();
    let rowCount = rowRange.end - rowRange.begin;
    let colCount = colRange.end - colRange.begin;
    const cellCount = rowCount * colCount;
    const summary: SummaryPart[] = [];
    // Do nothing on narrow screens, because we haven't come up with a place to render sum anyway.
    if (cellCount > 1 && !isNarrowScreen()) {
      if (cellCount <= MAX_CELLS_TO_SCAN) {
        const rowArray = this._sortedRows.getKoArray().peek();
        const fields = this._viewFields.peek().peek();
        let countNumeric = 0;
        let countNonEmpty = 0;
        let sum = 0;
        let sumFormatter: BaseFormatter|null = null;
        const rowIndices: number[] = [];
        for (let r = rowRange.begin; r < rowRange.end; r++) {
          const rowId = rowArray[r];
          if (rowId === undefined || rowId === 'new') {
            // We can run into this whenever the selection gets out of sync due to external
            // changes, like another user removing some rows. For now, we'll skip rows that are
            // still selected and no longer exist, but the real TODO is to better update the
            // selection so that it doesn't have out-of-date and invalid ranges.
            rowCount -= 1;
            continue;
          }
          rowIndices.push(this._tableData.getRowIdIndex(rowId)!);
        }
        for (let c = colRange.begin; c < colRange.end; c++) {
          const field = fields[c];
          if (field === undefined) {
            // Like with rows (see comment above), we need to watch out for out-of-date ranges.
            colCount -= 1;
            continue;
          }
          const col = fields[c].column.peek();
          const displayCol = fields[c].displayColModel.peek();
          const colType = col.type.peek();
          const visibleColType = fields[c].visibleColModel.peek().type.peek();
          const effectiveColType = visibleColType ?? colType;
          const displayColId = displayCol.colId.peek();
          // Note: we get values from the display column so that reference columns displaying
          // numbers are included in the computed sum. Unfortunately, that also means we can't
          // show a count of non-empty references. For now, that's a trade-off we'll have to make,
          // but in the future it should be possible to allow showing multiple summary parts with
          // some level of configurability.
          const values = this._tableData.getColValues(displayColId);
          if (!values) {
            throw new UserError(`Invalid column ${this._tableData.tableId}.${displayColId}`);
          }
          const isNumeric = ['Numeric', 'Int', 'Any'].includes(effectiveColType);
          const isEmpty: undefined | ((value: CellValue) => boolean) = (
            colType.startsWith('Ref:') && !visibleColType ? value => (value === 0) :
            isRefListType(colType) || isListType(effectiveColType) ? isEmptyList :
            undefined
          );
          // The loops below are optimized, minimizing the amount of work done per row. For
          // example, column values are retrieved in bulk above instead of once per row. In one
          // unscientific test, they take 30-60ms per million numeric cells.
          //
          // TODO: Add a benchmark test suite that automates checking for performance regressions.
          if (isNumeric) {
            if (!sumFormatter) {
              sumFormatter = fields[c].formatter.peek();
            }
            for (const i of rowIndices) {
              const value = values[i];
              if (typeof value === 'number') {
                countNumeric++;
                sum += value;
              } else if (value !== null && value !== undefined && value !== '' && !isEmpty?.(value)) {
                countNonEmpty++;
              }
            }
          } else {
            for (const i of rowIndices) {
              const value = values[i];
              if (value !== null && value !== undefined && value !== '' && value !== false && !isEmpty?.(value)) {
                countNonEmpty++;
              }
            }
          }
        }

        if (countNumeric > 0) {
          const sumValue = sumFormatter ? sumFormatter.formatAny(sum) : String(sum);
          summary.push({id: 'sum', label: 'Sum ', value: sumValue, clickToCopy: true});
        } else {
          summary.push({id: 'count', label: 'Count ', value: String(countNonEmpty), clickToCopy: true});
        }
      }
      summary.push({id: 'dimensions', label: '', value: `${rowCount}⨯${colCount}`});
    }
    this._summary.set(summary);
  }
}

async function doCopy(value: string, elem: Element) {
  await copyToClipboard(value);
  showTransientTooltip(elem, t("Copied to clipboard"), {key: 'copy-selection-summary'});
}

const cssSummary = styled('div', `
  position: absolute;
  bottom: -18px;
  height: 18px;
  line-height: 18px;
  display: flex;
  column-gap: 8px;
  width: 100%;
  justify-content: end;
  color: ${theme.text};
  font-family: ${vars.fontFamilyData};

  @media print {
    & {
      display: none;
    }
  }
`);

// Note: the use of an extra element for the background is to set its opacity, to make it a bit
// lighter (or darker, in dark-mode) than actual mediumGrey, without defining a special color.
const cssSummaryPart = styled('div', `
  padding: 0 8px;
  border-radius: 4px;
  border-top-left-radius: 0px;
  border-top-right-radius: 0px;
  border-top: none;
  z-index: 100;
  position: relative;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Set explicit backdrop to improve visibility in raw data views. */
  background-color: ${theme.mainPanelBg};

  &-copyable:hover {
    cursor: pointer;
  }
  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    background-color: ${theme.tableCellSummaryBg};
    opacity: 0.8;
    z-index: -1;
  }
`);

const cssLabelText = styled('span', `
  font-size: ${vars.xsmallFontSize};
  text-transform: uppercase;
  position: relative;
  margin-right: 4px;
  .${cssSummaryPart.className}-copyable:hover & {
    visibility: hidden;
  }
`);

const cssCopyIcon = styled(icon, `
  position: absolute;
  top: 0;
  margin: 1px 0 0 4px;
  --icon-color: ${theme.controlFg};
  display: none;
  .${cssSummaryPart.className}-copyable:hover & {
    display: block;
  }
`);
