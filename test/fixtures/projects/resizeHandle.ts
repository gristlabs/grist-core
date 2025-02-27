import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {dom, observable, styled} from "grainjs";
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

function setupTest() {
  const width1 = observable<number|null>(null);
  const width2 = observable<number|null>(null);
  return [
    testBox(
      dom('div.test-left',
        dom.style('width', (use) => use(width1) ? use(width1) + 'px' : ''),
        dom.text((use) => `width ${use(width1)}`)
      ),
      myResizeFlexVHandle({target: 'left', onSave: (v) => width1.set(v)}),
      dom('div', {style: 'flex: auto'}),
      myResizeFlexVHandle({target: 'right', onSave: (v) => width2.set(v)}),
      dom('div.test-right',
        dom.style('width', (use) => use(width2) ? use(width2) + 'px' : ''),
        dom.text((use) => `width ${use(width2)}`)
      ),
    ),
    dom('button.test-reset', {style: 'margin-left: 100px; margin-top: 25px'},
      'Reset', dom.on('click', () => { width1.set(null); width2.set(null); })),
  ];
}

const myResizeFlexVHandle = styled(resizeFlexVHandle, `
  --resize-handle-color: lightblue;
  --resize-handle-highlight: red;
`);

const testBox = styled('div', `
  position: relative;
  display: flex;
  margin-top: 50px;
  margin-left: 100px;
  width: 600px;
  height: 200px;
  font-family: sans-serif;
  font-size: 1rem;
  text-align: center;
  & > .test-left, & > .test-right {
    position: relative;
    flex: none;
    width: 150px;
    min-width: 50px;
    max-width: 275px;
    background-color: #E0FFE0
  }
`);

void withLocale(() => dom.update(document.body, setupTest()));
