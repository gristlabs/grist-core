import {createSessionObs, isBoolean, isNumber} from 'app/client/lib/sessionObs';
import {safeJsonParse} from 'app/common/gutil';
import {StringUnion} from 'app/common/StringUnion';
import {dom, makeTestId, MultiHolder, Observable, styled} from 'grainjs';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const testId = makeTestId('test-');

const FruitType = StringUnion("apples", "oranges", "melons");

function setupTest(owner: MultiHolder) {
  const plainObs = Observable.create(owner, "Hello");   // Plain old observable, for comparison
  const boolObs = createSessionObs(owner, "boolObs", true, isBoolean);
  const numObs = createSessionObs(owner, "numObs", 100, isNumber);
  const fruitObs = createSessionObs(owner, "fruitObs", "apples", FruitType.guard);

  const inputs: HTMLInputElement[] = [];
  return [
    testBox(
      cssRow(dom('div', 'plainObs'), dom('div', dom.text(plainObs)),
        inputs[0] = dom('input', {value: plainObs.get()}, testId('plain-obs'))),

      cssRow(dom('div', 'boolObs'), dom('div', dom.text(use => JSON.stringify(use(boolObs)))),
        inputs[1] = dom('input', {value: JSON.stringify(boolObs.get())}, testId('bool-obs'))),

      cssRow(dom('div', 'numObs'), dom('div', dom.text(use => JSON.stringify(use(numObs)))),
        inputs[2] = dom('input', {value: JSON.stringify(numObs.get())}, testId('num-obs'))),

      cssRow(dom('div', 'fruitObs'), dom('div', dom.text(fruitObs)),
        inputs[3] = dom('input', {value: fruitObs.get()}, testId('fruit-obs'))),

      cssRow(dom('button', 'Save', testId('save'), dom.on('click', () => {
        plainObs.set(inputs[0].value);
        boolObs.set(safeJsonParse(inputs[1].value, "invalid"));
        numObs.set(safeJsonParse(inputs[2].value, "invalid"));
        fruitObs.set(inputs[3].value as typeof FruitType.type);
      }))),
    )
  ];
}

const testBox = styled('div', `
  position: relative;
  width: 25rem;
  font-family: sans-serif;
  font-size: 1rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  padding: 1rem;
  margin: 1rem;
`);

const cssRow = styled('div', `
  margin: 1rem;
  display: flex;
  & > div { width: 10rem; }
`);

void withLocale(() => dom.update(document.body, dom.create(setupTest)));
