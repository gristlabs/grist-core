import { FieldOptions } from "app/client/widgets/NewBaseEditor";
import { NTextEditor } from "app/client/widgets/NTextEditor";
import NumberParse from "app/common/NumberParse";

import { dom } from "grainjs";

export class NumericEditor extends NTextEditor {
  constructor(protected options: FieldOptions) {
    // On many keyboard layouts the keypad's decimal key produces "." even where the locale's decimal
    // separator is ",". Insert the locale's separator instead, as spreadsheets do.
    const { decimalSeparator } = NumberParse.fromSettings(options.field.documentSettings.peek());
    if (options.event instanceof KeyboardEvent && isKeypadDecimalToRemap(options.event, decimalSeparator)) {
      options = { ...options, editValue: decimalSeparator };
    }
    if (options.editValue === undefined && typeof options.cellValue === "number") {
      // If opening a number for editing, we render it using the basic string representation (e.g.
      // no currency symbols or groupings), but it's important to use the right locale so that the
      // number can be parsed back (e.g. correct decimal separator).
      const locale = options.field.documentSettings.peek().locale;
      const fmt = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 });
      const editValue = fmt.format(options.cellValue);
      options = { ...options, editValue };
    }
    super(options);

    dom.onElem(this.textInput, "keydown", (ev) => {
      if (isKeypadDecimalToRemap(ev, decimalSeparator)) {
        ev.preventDefault();
        document.execCommand("insertText", false, decimalSeparator);
      }
    });
  }
}

// Whether the keypad's decimal key was pressed and produced a character other than the locale's separator.
function isKeypadDecimalToRemap(ev: KeyboardEvent, decimalSeparator: string) {
  // With NumLock off the key produces "Delete"; named keys like that are longer than one character.
  return ev.code === "NumpadDecimal" && ev.key.length === 1 && ev.key !== decimalSeparator;
}
