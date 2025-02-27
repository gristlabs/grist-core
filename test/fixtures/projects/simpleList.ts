import { popupControl } from 'app/client/lib/popupControl';
import { SimpleList } from 'app/client/lib/simpleList';
import { dom, obsArray, observable, styled } from 'grainjs';
import { withLocale } from './helpers/withLocale';
import { cssRootVars, testId } from 'app/client/ui2018/cssVars';
import { PopupControl } from 'popweasel';

function setupTest() {
  const items = observable(['foo', 'bar']);
  const logs = obsArray<string>([]);
  let popup: PopupControl;
  return cssTestBox(
    dom('div', 'click to show options'),
    cssInput(
      elem => {
        popup = popupControl(
          elem,
          ctl => {
            const list = SimpleList<string>.create(null, ctl, items, val => logs.push(val));
            list.listenKeys(elem);
            return list.content;
          },
          {placement: 'right-start'}
        );
      },
      dom.on('click', () => popup.toggle()),
    ),
    dom('h1', 'LOGS'),
    dom(
      'div',
      testId('logs'),
      dom.forEach(logs, log => cssLog(log)),
    ),
  );
}
const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
  margin: 40px;
  max-width: 600px;
`);
const cssLog = styled('div', `color: red;`);
const cssInput = styled('input', `
  width: 300px;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
