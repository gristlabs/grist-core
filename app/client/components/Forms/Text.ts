import * as style from './styles';
import {Builder, ignoreClick} from 'app/client/components/Forms/Model';
import {Computed, dom, IDisposableOwner, makeTestId} from 'grainjs';
const testId = makeTestId('test-forms-');

export const buildTextField: Builder = (owner: IDisposableOwner, {box, view}) => {

  const field = Computed.create(owner, use => {
    return view.gristDoc.docModel.viewFields.getRowModel(use(box.prop('leaf')));
  });
  return dom('div',
    testId('question'),
    testId('question-Text'),
    style.cssLabel(
      testId('label'),
      dom.text(use => use(use(field).question) || use(use(field).origLabel))
    ),
    style.cssInput(
      testId('input'),
      {type: 'text', tabIndex: "-1"},
      ignoreClick),
    dom.maybe(use => use(use(field).description), (description) => [
      style.cssDesc(description, testId('description')),
    ]),
  );
};
