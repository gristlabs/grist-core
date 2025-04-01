import {mouseDrag} from 'app/client/ui/mouseDrag';
import {dom, makeTestId, observable, styled} from "grainjs";
import pick = require('lodash/pick');
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const testId = makeTestId('test-');

function desc(ev: MouseEvent) {
  return pick(ev, ['pageX', 'pageY']);
}

function setupTest() {
  const status = observable<any>({status: "not-dragging"});
  let events = '';

  function onStart(startEv: MouseEvent, el: Element) {
    events = 's';
    status.set({status: "started", start: desc(startEv), events});
    return {
      onMove(moveEv: MouseEvent) {
        events += 'm';
        status.set({status: "moved", start: desc(startEv), move: desc(moveEv), events});
      },
      onStop(stopEv: MouseEvent) {
        events += 'S';
        status.set({status: "stopped", start: desc(startEv), stop: desc(stopEv), events});
      },
    };
  }

  function reset() {
    events = '';
    status.set({status: "not-dragging"});
  }

  return [
    testBox(mouseDrag(onStart),
      testId('box'),
      dom.style('background-color', '#A0A0FF')),
    testBox(
      {style: 'left: 350px; width: 400px'},
      result(
        testId('result'),
        dom.text((use) => JSON.stringify(use(status), null, 2))
      ),
    ),
    dom('button', 'Reset', dom.on('click', reset),
      {style: 'position: absolute; left: 350px; top: 280px;'}
    ),
  ];
}

const testBox = styled('div', `
  position: absolute;
  top: 50px;
  left: 50px;
  width: 250px;
  height: 200px;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
`);

const result = styled('pre', `
  margin: 0px;
  padding: 0px;
  height: 100%;
  width: 100%;
`);

void withLocale(() => dom.update(document.body, setupTest()));
