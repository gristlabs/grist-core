import { attachPageWidgetPicker, IOptions, IPageWidget, ISaveFunc } from 'app/client/ui/PageWidgetPicker';
import { basicButton } from 'app/client/ui2018/buttons';
import { cssRootVars, testId } from 'app/client/ui2018/cssVars';
import { dom, domComputed, DomElementMethod, obsArray, observable, styled } from "grainjs";
import { gristDocMock } from 'test/fixtures/projects/helpers/widgetPicker';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

interface ISaveCall {
  resolve: () => void;
  value: IPageWidget;
}

function setupTest() {

  const isNewPageObs = observable(false);
  const valueOpt = observable<IPageWidget|null>(null);
  const saveCalls = obsArray<ISaveCall>([]);

  const onSelect: ISaveFunc = async (val) => {
    const promise = new Promise<void>(resolve => {
      saveCalls.push({resolve, value: val});
    });
    await promise;
  };

  function pageWidgetPicker(onSave: ISaveFunc, option: IOptions): DomElementMethod {
    return (elem) => {
      attachPageWidgetPicker(elem, gristDocMock, onSave, option);
    };
  }

  return [

    domComputed( (use) => {
        const isNewPage = use(isNewPageObs);
        const value = use(valueOpt) ? () => valueOpt.get()! : undefined;
        return {isNewPage, value};
      }, (option) => [
        basicButton(
          'Page widget picker',
          pageWidgetPicker(onSelect, option),
          testId('trigger'),
        ),
        dom(
          'div',
          dom('h3', 'Options'),
          dom(
            'div', 'isNewPage: ',
            dom(
              'input', {type: 'checkbox'},
              dom.prop('checked', isNewPageObs),
              dom.on('change', (ev, elem) => isNewPageObs.set(elem.checked)),
              testId('option-isNewPage'),
            ),
          ),
          dom(
            'div', 'value: ', dom.text((use) => JSON.stringify(use(valueOpt))),
            dom(
              'button', 'Change',
              pageWidgetPicker(async (val) => valueOpt.set(val), option),
              testId('option-value'),
            ),
            dom(
              'button', 'omit',
              dom.on('click', () => valueOpt.set(null)),
              testId('option-omit-value')
            )
          ),
        ),
      ]),

    cssCallLogs(
      dom('h3', 'Call logs: '),
      dom.forEach(saveCalls, (call) => dom(
        'div',
        dom('span', JSON.stringify(call.value), testId('call-value')),
        dom('button', 'Resolve', dom.on('click', (ev, el) => {
          call.resolve();
          el.toggleAttribute('disabled', true);
        }), testId('resolve')),
        testId('call-log')
      )),
      testId('call-logs'),
    ),
  ];
}

const cssCallLogs = styled('div', `
  position: absolute;
  z-index: 1000;
  border: 1px solid grey;
  width: 400px;
  padding: 8px;
  bottom: 0;
  right: 0;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
