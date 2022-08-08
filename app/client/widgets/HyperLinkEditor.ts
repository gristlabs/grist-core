import {FieldOptions} from 'app/client/widgets/NewBaseEditor';
import {NTextEditor} from 'app/client/widgets/NTextEditor';

/**
 * HyperLinkEditor - Is the same NTextEditor but with some placeholder text to help explain
 * to the user how links should be formatted.
 */
export class HyperLinkEditor extends NTextEditor {
  constructor(options: FieldOptions) {
    super(options);
    this.textInput.setAttribute('placeholder', '[link label] url');
  }
}
