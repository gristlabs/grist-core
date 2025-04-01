import {transition} from 'app/client/ui/transitions';
import {dom, input, Observable, styled} from "grainjs";
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

function setupTest() {
  const toggle = Observable.create(null, false);
  const duration = Observable.create(null, '1s');
  const finishCount = Observable.create(null, 0);
  return [
    testBox(
      dom('div.test-left',
        dom.style('transition-duration', duration),
        transition(toggle, {
          prepare(elem, val) { elem.style.opacity = '0'; },
          run(elem, val) { elem.style.opacity = ''; },
          finish(elem, val) { finishCount.set(finishCount.get() + 1); },
        }),
        dom.cls('expanded', toggle),
      ),
      dom('div.test-right'),
    ),
    dom('div', {style: 'margin-left: 100px; margin-top: 25px'},
      dom('button.test-toggle', 'Toggle', dom.on('click', () => { toggle.set(!toggle.get()); })),
      'Transition time (ms): ',
      input(duration, {}, dom.cls('test-duration')),
      dom.text(duration),
    ),
    dom('div', {style: 'margin-left: 100px; margin-top: 25px'},
      ' Number of finished transitions: ',
      dom('span.test-finished', dom.text((use) => '' + use(finishCount)))
    ),
  ];
}

const testBox = styled('div', `
  position: relative;
  display: flex;
  margin-top: 50px;
  margin-left: 100px;
  width: 500px;
  height: 150px;
  font-family: sans-serif;
  font-size: 1rem;
  text-align: center;
  & > .test-left {
    background-color: #80FF80;
    width: 30px;
    transition: width 1s linear, opacity 1s linear;
  }
  & > .test-right {
    background-color: #FF8080;
    flex: 1 1 0px;
    min-width: 0px;
  }
  & > .test-left.expanded {
    width: 470px;
  }
`);

void withLocale(() => dom.update(document.body, setupTest()));
