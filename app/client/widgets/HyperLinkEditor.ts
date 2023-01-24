import {makeT} from 'app/client/lib/localization';
import {FieldOptions} from 'app/client/widgets/NewBaseEditor';
import {NTextEditor} from 'app/client/widgets/NTextEditor';

const t = makeT('HyperLinkEditor');

/**
 * HyperLinkEditor - Is the same NTextEditor but with some placeholder text to help explain
 * to the user how links should be formatted.
 */
export class HyperLinkEditor extends NTextEditor {
  constructor(options: FieldOptions) {
    super(options);
    this.textInput.setAttribute('placeholder', t('[link label] url'));
  }
}
