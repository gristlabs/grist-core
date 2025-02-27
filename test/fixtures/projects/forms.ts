/**
 * A fixture for checking the looks of the elements provided by the 'forms' module.
 */
import {formDataToObj} from 'app/client/lib/formUtils';
import * as forms from 'app/client/ui/forms';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {dom, IDisposableOwner, Observable} from 'grainjs';

function setupTest(owner: IDisposableOwner) {
  const formValue = Observable.create(owner, "");
  const isFilled = Observable.create(owner, false);
  return forms.form({style: 'width: 50%'},
    forms.question(
      forms.text('What color is the sky right now?'),
      forms.checkboxItem([{name: 'sky-blue'}], 'Blue'),
      forms.checkboxItem([{name: 'sky-orange'}], 'Orange'),
      forms.checkboxOther([], {name: 'sky-other', placeholder: 'Other...'}),
    ),
    forms.question(
      forms.text('What is the meaning of life, universe, and everything?'),
      forms.textBox({name: 'meaning', placeholder: 'Your answer'}),
    ),

    // Show the form contents.
    forms.checkboxItem([{disabled: true}, dom.prop('checked', isFilled)], "Is Form Filled?"),
    dom('textarea', {rows: '8', cols: '80'}, dom.prop('value', formValue)),
    dom.on('change', (e, form) => {
      isFilled.set(forms.isFormFilled(form, ['sky-*', 'meaning']));
      formValue.set(JSON.stringify(formDataToObj(form), null, 2));
    }),
  );
}

dom.update(document.body, dom.cls(cssRootVars), dom.create(setupTest));
