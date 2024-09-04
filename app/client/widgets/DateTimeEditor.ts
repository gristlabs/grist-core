import {DateEditor} from 'app/client/widgets/DateEditor';
import {FieldOptions} from 'app/client/widgets/NewBaseEditor';
import {removePrefix} from 'app/common/gutil';
import {parseDate} from 'app/common/parseDate';

import moment from 'moment-timezone';
import {dom} from 'grainjs';

/**
 * DateTimeEditor - Editor for DateTime type. Includes a dropdown datepicker.
 *  See reference: http://bootstrap-datepicker.readthedocs.org/en/latest/index.html
 */
export class DateTimeEditor extends DateEditor {
  private _timeFormat: string|undefined;
  private _dateSizer: HTMLElement;
  private _timeSizer: HTMLElement;
  private _dateInput: HTMLTextAreaElement;
  private _timeInput: HTMLTextAreaElement;

  constructor(options: FieldOptions) {
    // Get the timezone from the end of the type string.
    const timezone = removePrefix(options.field.column().type(), "DateTime:");

    // Adjust the command group, but not for readonly mode.
    if (!options.readonly) {
      const origCommands = options.commands;
      options.commands = {
        ...origCommands,
        prevField: () => this._focusIndex() === 1 ? this._setFocus(0) : origCommands.prevField(),
        nextField: () => this._focusIndex() === 0 ? this._setFocus(1) : origCommands.nextField(),
      };
    }

    // Call the superclass.
    super(options, timezone || 'UTC');
    this._timeFormat = this.options.field.widgetOptionsJson.peek().timeFormat;

    // To reuse code, this knows all about the DOM that DateEditor builds (using TextEditor), and
    // modifies that to be two side-by-side textareas.
    this._dateSizer = this.contentSizer;    // For consistency with _timeSizer.
    this._dateInput = this.textInput;       // For consistency with _timeInput.

    const isValid = (typeof options.cellValue === 'number');
    const formatted = this.formatValue(options.cellValue, this._timeFormat, false);
    // Use a placeholder of 12:00am, since that is the autofill time value.
    const placeholder = moment.tz('0', 'H', this.timezone).format(this._timeFormat);

    // for readonly
    if (options.readonly) {
      if (!isValid) {
        // do nothing - DateEditor will show correct error
      } else {
        // append time format or a placeholder
        const time = (formatted || placeholder);
        const sep = time ? ' ' : '';
        this.textInput.value = this.textInput.value + sep + time;
      }
    } else {
      const widgetElem = this.getDom();
      dom.update(widgetElem, dom.cls('celleditor_datetime'));
      dom.update(this.cellEditorDiv, dom.cls('celleditor_datetime_editor'));
      widgetElem.appendChild(
        dom('div',
          dom.cls('celleditor_cursor_editor'),
          dom.cls('celleditor_datetime_editor'),
          this._timeSizer = dom('div', dom.cls('celleditor_content_measure')),
          this._timeInput = dom('textarea', dom.cls('celleditor_text_editor'),
            dom.attr('placeholder', placeholder),
            dom.prop('value', formatted),
            this.commandGroup.attach(),
            dom.on('input', () => this._onChange())
          )
        )
      );
    }

    // If the edit value is encoded json, use those values as a starting point
    if (typeof options.state == 'string') {
      try {
        const { date, time } = JSON.parse(options.state);
        this._dateInput.value = date;
        this._timeInput.value = time;
        this._onChange();
      } catch(e) {
        console.error("DateTimeEditor can't restore its previous state");
      }
    }
  }

  public getCellValue() {
    const date = this._dateInput.value;
    const time = this._timeInput.value;
    const timestamp = parseDate(date, {
      dateFormat: this.safeFormat,
      time: time,
      timeFormat: this._timeFormat,
      timezone: this.timezone
    });
    return timestamp !== null ? timestamp :
      (date && time ? `${date} ${time}` : date || time);
  }

  public setSizerLimits() {
    const maxSize = this.editorPlacement.calcSize({width: Infinity, height: Infinity}, {calcOnly: true});
    if (this.options.readonly) {
      return;
    }
    this._dateSizer.style.maxWidth =
      this._timeSizer.style.maxWidth = Math.ceil(maxSize.width / 2 - 6) + 'px';
  }

  /**
   * Overrides the resizing function in TextEditor.
   */
  protected resizeInput() {

    // for readonly field, we will use logic from a super class
    if (this.options.readonly) {
      return super.resizeInput();
    }
    // Use the size calculation provided in options.calcSize (that takes into account cell size and
    // screen size), with both date and time parts as the input. The resulting size is applied to
    // the parent (containing date + time), with date and time each expanding or shrinking from the
    // measured sizes using flexbox logic.
    this._dateSizer.textContent = this._dateInput.value;
    this._timeSizer.textContent = this._timeInput.value;
    const dateRect = this._dateSizer.getBoundingClientRect();
    const timeRect = this._timeSizer.getBoundingClientRect();
    // Textboxes get 3px of padding on left/right/top (see TextEditor.css); we specify it manually
    // since editorPlacement can't do a good job figuring it out with the flexbox arrangement.
    const size = this.editorPlacement.calcSize({
      width: dateRect.width + timeRect.width + 12,
      height: Math.max(dateRect.height, timeRect.height) + 3
    });
    this.getDom().style.width = size.width + 'px';
    this._dateInput.parentElement!.style.flexBasis = (dateRect.width + 6) + 'px';
    this._timeInput.parentElement!.style.flexBasis = (timeRect.width + 6) + 'px';
    this._dateInput.style.height = Math.ceil(size.height - 3) + 'px';
    this._timeInput.style.height = Math.ceil(size.height - 3) + 'px';
  }

  /**
   * Returns which element has focus: 0 if date, 1 if time, null if neither.
   */
  private _focusIndex() {
    return document.activeElement === this._dateInput ? 0 :
      (document.activeElement === this._timeInput ? 1 : null);
  }

  /**
   * Sets focus to date if index is 0, or time if index is 1.
   */
  private _setFocus(index: 0|1) {
    const elem = (index === 0 ? this._dateInput : (index === 1 ? this._timeInput : null));
    if (elem) {
      elem.focus();
      elem.selectionStart = 0;
      elem.selectionEnd = elem.value.length;
    }
  }

  /**
   * Occurs when user types something into the editor
   */
  private _onChange() {
    this.resizeInput();

    // store editor state as an encoded JSON string
    const date = this._dateInput.value;
    const time = this._timeInput.value;
    this.editorState.set(JSON.stringify({ date, time}));
  }
}
