import { Disposable, dom, Observable, styled } from "grainjs";
import { ColumnFilter } from "app/client/models/ColumnFilter";
import { testId } from "app/client/ui2018/cssVars";
import { textButton } from "app/client/ui2018/buttons";
import { IColumnFilterViewType } from "app/client/ui/ColumnFilterMenu";
import getCurrentTime from "app/common/getCurrentTime";
import { IRelativeDateSpec, isRelativeBound } from "app/common/FilterState";
import { updateRelativeDate } from "app/client/ui/RelativeDatesOptions";
import moment from "moment-timezone";

export class ColumnFilterCalendarView extends Disposable {

  private _$el: any;

  constructor(private _opts: {
    viewTypeObs: Observable<IColumnFilterViewType>,
    // Note the invariant: `selectedBoundObs.get() !== null` until this gets disposed.
    selectedBoundObs: Observable<'min' | 'max' | null>,
    columnFilter: ColumnFilter,
  }) {
    super();
    this._moveToSelected = this._moveToSelected.bind(this);
    this.autoDispose(this.columnFilter.min.addListener(() => this._setRange()));
    this.autoDispose(this.columnFilter.max.addListener(() => this._setRange()));
    this.autoDispose(this._opts.selectedBoundObs.addListener(this._moveToSelected));
  }

  public get columnFilter() { return this._opts.columnFilter; }
  public get selectedBoundObs() { return this._opts.selectedBoundObs; }

  public buildDom() {
    setTimeout(() => this._moveToSelected(), 0);
    return cssContainer(
      cssLinkRow(
        cssLink(
          '← List view',
          dom.on('click', () => this._opts.selectedBoundObs.set(null)),
        ),
        cssLink(
          'Today',
          dom.on('click', () => {
            this._$el.datepicker('update', this._getCurrentTime());
            this._cleanup();
          }),
        ),
        testId('calendar-links'),
      ),
      cssDatepickerContainer(
        (el) => {
          const $el = this._$el = $(el) as any;
          $el.datepicker({
            defaultViewDate: this._getCurrentTime(),
            todayHighlight: true,
          });
          $el[0].querySelector('.datepicker');
          this._setRange();
          $el.on('changeDate', () => this._onChangeDate());

          // Schedules cleanups after users navigations (ie: navigating to next/prev month).
          $el.on('changeMonth', () => setTimeout(() => this._cleanup(), 0));
          $el.on('changeYear', () => setTimeout(() => this._cleanup(), 0));
          $el.on('changeDecade', () => setTimeout(() => this._cleanup(), 0));
          $el.on('changeCentury', () => setTimeout(() => this._cleanup(), 0));
        },
      )
    );
  }

  private _setRange() {
    this._$el.datepicker('setRange', this._getRange());
    this._moveToSelected();
  }

  // Move calendar to the selected bound's current date.
  private _moveToSelected() {
    const minMax = this._opts.selectedBoundObs.get();
    let dateValue = this._getCurrentTime();

    if (minMax !== null) {
      const value = this.columnFilter.getBoundsValue(minMax);
      if (isFinite(value)) {
        dateValue = new Date(value * 1000);
      }
    }

    this._$el.datepicker('update', dateValue);
    this._cleanup();
  }

  private _getCurrentTime(): Date {
    return getCurrentTime().toDate();
  }

  private _onChangeDate() {
    const d = this._$el.datepicker('getUTCDate').valueOf() / 1000;
    const {min, max} = this.columnFilter;
    // Check the the min bounds is before max bounds. If not update the other bounds to the same
    // value.
    // TODO: also perform this check when users pick relative dates from popup
    if (this.selectedBoundObs.get() === 'min') {
      min.set(this._updateBoundValue(min.get(), d));
      if (this.columnFilter.getBoundsValue('max') < d) {
        max.set(this._updateBoundValue(max.get(), d));
      }
    } else {
      max.set(this._updateBoundValue(max.get(), d));
      if (this.columnFilter.getBoundsValue('min') > d) {
        min.set(this._updateBoundValue(min.get(), d));
      }
    }
    this._cleanup();
  }

  private _getRange() {
    const min = this.columnFilter.getBoundsValue('min');
    const max = this.columnFilter.getBoundsValue('max');
    const toDate = (val: number) => {
      const m = moment.utc(val * 1000);
      return new Date(Date.UTC(m.year(), m.month(), m.date()));
    };
    if (!isFinite(min) && !isFinite(max)) {
      return [];
    }
    if (!isFinite(min)) {
      return [{valueOf: () => -Infinity}, toDate(max)];
    }
    if (!isFinite(max)) {
      return [toDate(min), {valueOf: () => +Infinity}];
    }
    return [toDate(min), toDate(max)];
  }

  // Update val with date. Returns the new updated value. Useful to update bounds' value after users
  // have picked new value from calendar.
  private _updateBoundValue(val: IRelativeDateSpec|number|undefined, date: number) {
    return isRelativeBound(val) ? updateRelativeDate(val, date) : date;
  }

  // Removes the `.active` class from date elements in the datepicker. The active dates background
  // takes precedence over other backgrounds which are more important to us, such as range's bounds
  // and current day.
  private _cleanup() {
    const elements = this._$el.get()[0].querySelectorAll('.active');
    for (const el of elements) {
      el.classList.remove('active');
    }
  }
}

const cssContainer = styled('div', `
  padding: 16px 16px;
`);

const cssLink = textButton;

const cssLinkRow = styled('div', `
  display: flex;
  justify-content: space-between;
`);

const cssDatepickerContainer = styled('div', `
  padding-top: 16px;
`);
