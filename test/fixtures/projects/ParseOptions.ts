import {buildParseOptionsForm, ParseOptionValues} from 'app/client/components/ParseOptions';
import {testId} from 'app/client/ui2018/cssVars';
import {dom, Observable, styled} from "grainjs";
import {initSchema, initValues} from 'test/fixtures/projects/helpers/ParseOptionsData';
import {initGristStyles} from "test/fixtures/projects/helpers/gristStyles";

function setupTest() {
  const schemaObs = Observable.create(null, initSchema);
  const valuesObs = Observable.create<ParseOptionValues>(null, initValues);
  function doUpdate(values: ParseOptionValues) { valuesObs.set(values); }
  function doCancel() { /* no-op */ }

  return [
    dom('div', {style: 'display: flex; width: 100%; height: 400px'},
      testBox(
        dom('textarea', dom.text(use => JSON.stringify(use(schemaObs), null, 2)),
          {style: 'width: 100%; height: 100%; min-width: 400px; border: none;'},
          dom.on('change', (ev, elem) => schemaObs.set(JSON.parse(elem.value)))),
        testId('schema'),
      ),
      dom('div',
        testBox(
          dom.domComputed(use =>
            dom.create(buildParseOptionsForm, use(schemaObs), use(valuesObs), doUpdate, doCancel)
          ),
          testId('parse-options')
        ),
        testBox(
          dom.text(use => JSON.stringify(use(valuesObs), null, 2)),
          testId('values'),
        ),
      ),
    )
  ];
}

const testBox = styled('div', `
  flex: 1 0 auto;
  margin: 2rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  overflow: hidden;
`);

initGristStyles();
dom.update(document.body, setupTest());
